import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fmtNum, ESTACIONES_CONFIG } from '../components/core'
import { Icon } from '../components/Icons'
import { RegistroProcesoForm, RegistroProcesoHistory } from '../components/RegistroProceso'
import { getOrdenesEstacion, getRegistrosProceso, setEstacionPrioridades } from '../api'
import { useSyncPolling } from '../lib/useSyncPolling'
import { useDragOrder } from '../hooks/useDragOrder'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))

// Búsqueda sin distinguir mayúsculas ni tildes
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Fecha de entrega formateada + color según urgencia (mismo criterio que Troqueles)
function fmtEntrega(s) {
  if (!s) return { txt: 'Sin fecha', color: 'var(--ink-3)' }
  const d = new Date(s + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  const txt = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  let color = 'var(--ink-2)'
  if (diff < 0) color = 'var(--danger, #c0392b)'
  else if (diff <= 2) color = 'var(--warn, #e0a800)'
  return { txt: diff < 0 ? `${txt} · vencido` : txt, color }
}

function Section({ title, children, actions }) {
  return (
    <div className="section" style={{ marginTop: 16 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  )
}

const TH = {
  padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)',
  background: 'var(--surface-2)',
}

// Solo se usa cuando se combinan varias estaciones (Guillotina: corte inicial
// + corte final en una sola cola) para distinguir de un vistazo cada fila.
const TIPO_CORTE_LABEL = { guillotina: 'Corte inicial', guillotina_final: 'Corte final' }

// Manija de arrastre: recibe tal cual lo que devuelve drag.handleProps(op).
function DragHandle({ style, ...props }) {
  return (
    <span {...props} style={{ ...style, display: 'inline-flex', color: 'var(--ink-3)' }}>
      <Icon.Drag />
    </span>
  )
}

/**
 * Puesto de trabajo de una máquina de la cadena.
 *
 * Las cuatro estaciones comparten esta pantalla; `estacion` decide la cola que
 * se pide, cómo se pinta y qué campos muestra el formulario. El orden de la
 * cadena y el bloqueo son del backend: aquí solo se pinta la cola que llega.
 *
 * `estaciones` (array) permite combinar varias colas en una sola pantalla —
 * hoy solo lo usa Guillotina para juntar corte inicial y corte final.
 * `embedded` omite el `.app`/topbar propios para poder anidarse dentro de
 * otra página (también Guillotina, como pestaña "Cadena").
 */
export default function EstacionMaquina({ estacion, estaciones, embedded = false }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const ids = estaciones || [estacion]
  const idsKey = ids.join(',')
  const combinado = ids.length > 1
  const cfg = combinado ? ESTACIONES_CONFIG.guillotina_central : ESTACIONES_CONFIG[estacion]

  const [tab, setTab] = useState('pendientes')
  const [lista, setLista] = useState([])
  const [loadingLista, setLoadingLista] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState(null)      // OP abierta en el detalle
  const [historial, setHistorial] = useState([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [busquedaHist, setBusquedaHist] = useState('')
  const [aviso, setAviso] = useState(null)      // { tipo, texto } tras registrar
  const [ordenError, setOrdenError] = useState(null)  // fallo al guardar prioridades

  const loadLista = (silent = false) => {
    if (!silent) setLoadingLista(true)
    Promise.all(ids.map(id => getOrdenesEstacion(id).then(d => asList(d).map(op => ({ ...op, _estacionId: id })))))
      .then(arrs => setLista(arrs.flat()))
      .catch(() => setLista([]))
      .finally(() => setLoadingLista(false))
  }

  const loadHistorial = () => {
    setLoadingHist(true)
    Promise.all(ids.map(id => getRegistrosProceso(`?estacion=${id}`).then(asList)))
      .then(arrs => setHistorial(arrs.flat().sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora))))
      .catch(() => setHistorial([]))
      .finally(() => setLoadingHist(false))
  }

  // Al cambiar de estación (misma pantalla, otra ruta) se reinicia todo.
  useEffect(() => {
    setTab('pendientes'); setOrden(null); setBusqueda(''); setAviso(null)
    loadLista()
  }, [idsKey])

  useEffect(() => { if (tab === 'historial') loadHistorial() }, [tab, idsKey])

  // Tiempo real: solo mientras se mira la cola, para no pisar lo que se escribe.
  useSyncPolling(
    { ordenes: () => loadLista(true), registros_proceso: () => loadLista(true) },
    { enabled: !orden && tab === 'pendientes' },
  )

  const filtrando = !!busqueda.trim()
  const filtradas = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return lista
    return lista.filter(op => [op.numero, op.cliente_nombre, op.referencia].some(v => norm(v).includes(t)))
  }, [lista, busqueda])

  // Reordenar la cola arrastrando (solo Admin — priorizar la cola no es
  // decisión del Operador). La prioridad vive por estación, así que una
  // pantalla combinada (Guillotina) guarda la subsecuencia de cada una por
  // separado, conservando el orden relativo que quedó en la lista.
  const guardarOrden = (nueva) => {
    const snapshot = lista
    setLista(nueva)
    setOrdenError(null)
    Promise.all(ids.map(id => {
      const suyas = nueva.filter(op => op._estacionId === id).map(op => op.id)
      return suyas.length ? setEstacionPrioridades(id, suyas) : Promise.resolve()
    })).catch(() => {
      setLista(snapshot)
      setOrdenError('No se pudo guardar el orden. Intenta de nuevo.')
    })
  }

  // Con búsqueda activa se ve solo un pedazo de la cola: reordenar ahí
  // renumeraría mal las OPs escondidas, así que el arrastre se apaga.
  const drag = useDragOrder(filtradas, guardarOrden, { disabled: filtrando || !isAdmin })

  const histFiltrado = useMemo(() => {
    const t = norm(busquedaHist.trim())
    if (!t) return historial
    return historial.filter(r => [r.orden_numero, r.orden_cliente, r.orden_referencia, r.operador_username]
      .some(v => norm(v).includes(t)))
  }, [historial, busquedaHist])

  // Tras registrar: la OP sale de esta cola y se avisa a dónde viajó.
  const handleCreated = (data) => {
    const sig = data.siguiente_estacion
    setAviso({
      tipo: 'ok',
      texto: sig
        ? `${orden.numero} registrada. La OP pasó a ${sig.label}.`
        : `${orden.numero} registrada. Era el último proceso: la OP quedó completa.`,
    })
    setOrden(null)
    loadLista(true)
  }

  const abrir = (op) => { setOrden(op); setAviso(null) }

  const body = (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: embedded ? '4px 0 0' : 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)', width: '100%' }}>

        {aviso && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 4,
            background: 'var(--ok-soft, #e8f6ec)', color: 'var(--ink-1)',
            display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center',
          }}>
            <span>✓ {aviso.texto}</span>
            <button className="btn" style={{ padding: '2px 8px' }} onClick={() => setAviso(null)}>
              <Icon.X />
            </button>
          </div>
        )}

        {orden ? (
          <>
            {embedded && (
              <button className="btn" style={{ marginBottom: 4 }} onClick={() => setOrden(null)}>
                <Icon.ArrowLeft /> Volver a la cola
              </button>
            )}
            <DetalleOP
              estacion={combinado ? orden._estacionId : estacion}
              orden={orden}
              onCreated={handleCreated}
              onCambio={() => loadLista(true)}
            />
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {[['pendientes', 'En cola'], ['historial', 'Historial']].map(([id, label]) => (
                <button
                  key={id}
                  className={'btn' + (tab === id ? ' primary' : '')}
                  onClick={() => setTab(id)}
                >
                  {label}
                  {id === 'pendientes' && lista.length > 0 ? ` (${lista.length})` : ''}
                </button>
              ))}
            </div>

            {tab === 'pendientes' ? (
              <Section
                title="OPs esperando esta máquina"
                actions={
                  <input
                    className="input"
                    style={{ maxWidth: 240 }}
                    placeholder="Buscar OP, cliente o referencia…"
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                  />
                }
              >
                {isAdmin && (ordenError || filtradas.length > 0) && (
                  <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: ordenError ? 'var(--danger, #c0392b)' : 'var(--ink-3)' }}>
                    {ordenError || (filtrando
                      ? 'Limpia la búsqueda para poder reordenar la cola.'
                      : 'Arrastra una fila por su manija para cambiar la prioridad: la de arriba se trabaja primero.')}
                  </div>
                )}
                {!isAdmin && filtradas.length > 0 && (
                  <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)' }}>
                    Orden de la cola: lo define el administrador.
                  </div>
                )}
                {loadingLista ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
                ) : filtradas.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
                    {lista.length === 0
                      ? 'No hay órdenes esperando esta máquina. Las OPs llegan solas cuando terminan el proceso anterior.'
                      : 'Ninguna OP coincide con la búsqueda.'}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--line)' }}>
                          {['', '#', ...(combinado ? ['Tipo'] : []), 'OP #', 'Entrega', 'Cliente', 'Referencia', ...(cfg.multiproceso ? ['Trabajo'] : []), 'Esperadas', ''].map((h, i) => (
                            <th key={i} style={TH}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {drag.items.map((op, idx) => {
                          const ent = fmtEntrega(op.fecha_entrega)
                          const dr = drag.rowProps(op)
                          return (
                            <tr key={op.id} {...dr} style={{
                              borderBottom: '1px solid var(--line)',
                              background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                              cursor: 'pointer',
                              ...dr.style,
                            }} onClick={() => abrir(op)}>
                              <td style={{ padding: '10px 6px', width: 28, color: 'var(--ink-3)' }}>
                                {isAdmin && !filtrando && <DragHandle {...drag.handleProps(op)} />}
                              </td>
                              <td style={{ padding: '10px 12px', color: 'var(--ink-3)', fontSize: 12 }}>{idx + 1}</td>
                              {combinado && (
                                <td style={{ padding: '10px 12px' }}>
                                  <span style={{
                                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                                    background: 'var(--surface-2)', color: 'var(--ink-2)', whiteSpace: 'nowrap',
                                  }}>
                                    {TIPO_CORTE_LABEL[op._estacionId]}
                                  </span>
                                </td>
                              )}
                              <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12 }}>
                                {op.numero}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 12, color: ent.color }}>{ent.txt}</td>
                              <td style={{ padding: '10px 12px', fontWeight: 600 }}>{op.cliente_nombre}</td>
                              <td style={{ padding: '10px 12px', color: 'var(--ink-2)', fontSize: 13 }}>{op.referencia}</td>
                              {cfg.multiproceso && (
                                <td style={{ padding: '10px 12px', color: 'var(--ink-2)', fontSize: 13 }}>
                                  {(op.estacion_procesos || []).filter(p => !p.completado).map(p => p.label).join(' + ') || '—'}
                                </td>
                              )}
                              <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                                {fmtNum(op.cantidad_esperada)}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                <button className="btn accent" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => abrir(op)}>
                                  Abrir
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            ) : (
              <Section
                title={`Registros de ${cfg.label}`}
                actions={
                  <input
                    className="input"
                    style={{ maxWidth: 240 }}
                    placeholder="Buscar OP, cliente u operador…"
                    value={busquedaHist}
                    onChange={e => setBusquedaHist(e.target.value)}
                  />
                }
              >
                <RegistroProcesoHistory
                  registros={histFiltrado}
                  loading={loadingHist}
                  onAnulado={() => { loadHistorial(); loadLista(true) }}
                />
              </Section>
            )}
          </>
        )}
      </div>
  )

  if (embedded) return body

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="mod">{cfg.label}</div>
        </div>
        <div className="topbar-right">
          <button className="btn" onClick={() => (orden ? setOrden(null) : navigate('/produccion'))}>
            <Icon.ArrowLeft /> {orden ? 'Volver a la cola' : 'Volver'}
          </button>
        </div>
      </div>
      {body}
    </div>
  )
}

// ────────── Detalle: cabecera de la OP + formulario + registros previos ──────────

function DetalleOP({ estacion, orden, onCreated, onCambio }) {
  const cfg = ESTACIONES_CONFIG[estacion]
  const [registros, setRegistros] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    getRegistrosProceso(`?orden=${orden.id}`)
      .then(d => setRegistros(asList(d)))
      .catch(() => setRegistros([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [orden.id])

  const previo = orden.registro_previo
  const ent = fmtEntrega(orden.fecha_entrega)

  return (
    <>
      <Section title={`${orden.numero} · ${cfg.label}`}>
        <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {[
            ['Cliente', orden.cliente_nombre],
            ['Referencia', orden.referencia || '—'],
            ['Entrega', ent.txt],
            ...(cfg.multiproceso ? [['Trabajo', (orden.estacion_procesos || []).filter(p => !p.completado).map(p => p.label).join(' + ') || '—']] : []),
            ['Cantidad esperada', `${fmtNum(orden.cantidad_esperada)} unidades`],
          ].map(([label, valor]) => (
            <div key={label} style={{ minWidth: 140 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{valor}</div>
            </div>
          ))}
        </div>
        {previo && (
          <div style={{
            margin: '0 16px 16px', padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: previo.faltante ? 'var(--warn-soft, #fef6e7)' : 'var(--surface-2)',
            color: 'var(--ink-2)',
          }}>
            De <strong>{previo.estacion_label}</strong> llegaron{' '}
            <strong>{fmtNum(previo.cantidad_realizada)}</strong> unidades
            {previo.faltante && ' — ya venían incompletas'}.
          </div>
        )}
      </Section>

      {estacion === 'troqueladora' && !orden.troquel_modelo ? (
        <Section title="Registrar producción">
          <div style={{
            margin: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: 'var(--warn-soft, #fef6e7)', color: 'var(--ink-2)',
          }}>
            ⚠ Esta OP todavía no tiene el troquel registrado. Pide al Admin que cargue
            el molde antes de poder troquelar.
          </div>
        </Section>
      ) : (
        <Section title="Registrar producción">
          <RegistroProcesoForm
            estacion={estacion}
            orden={orden}
            onCreated={(data) => { load(); onCreated(data) }}
          />
        </Section>
      )}

      <Section title="Lo ya registrado en esta OP">
        <RegistroProcesoHistory
          registros={registros}
          loading={loading}
          showOrden={false}
          onAnulado={() => { load(); onCambio && onCambio() }}
        />
      </Section>
    </>
  )
}
