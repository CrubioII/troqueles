import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ProgressBar, REMISION_STATUS_DEFS, SaveStatus } from '../components/core'
import { Icon } from '../components/Icons'
import { useAutosave } from '../hooks/useAutosave'
import {
  FormatosCuchillasHistory, FormatoCuchillasForm, ModeloViewer,
  NuevaTareaTroquelModal,
} from '../components/Troquel'
import {
  getOrdenesTodas, deleteOrden, getFormatosCuchillas, getFormatosCuchillasTodos, getOrdenesPendientes,
  getOrdenProduccion, getTroquelModelo,
  updateFormatoCuchillas, cancelarEnvioFormato,
  getRemisionablesOperador, consolidarRemisionOperador, pdfRemisionOperadorConsolidada,
  getRemisionesGeneradasOperador, devolverRemisionOperador,
  getRemisionesSolicitadas, setProcesoPrioridades,
  getClientes, editarCamposOrden,
} from '../api'
import { useSyncPolling } from '../lib/useSyncPolling'
import { useDragOrder } from '../hooks/useDragOrder'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))

// Fecha de subida al sistema formateada + color según antigüedad sin registrar
// el formato de cuchillas: neutro (0-1 días), ámbar (1-2 días), rojo (3+ días).
function fmtSubida(s) {
  if (!s) return { txt: 'Sin fecha', color: 'var(--ink-3)' }
  const d = new Date(s)
  const today = new Date()
  const diff = Math.floor((today - d) / 86400000)
  const txt = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  let color = 'var(--ink-2)'
  if (diff >= 3) color = 'var(--danger, #c0392b)'
  else if (diff >= 1) color = 'var(--warn, #e0a800)'
  return { txt, color }
}

// Fecha (o fecha+hora ISO) en formato corto local
function fmtFechaCorta(s) {
  if (!s) return '—'
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Búsqueda sin distinguir mayúsculas ni tildes
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Orden FIFO por fecha de subida al sistema ascendente (la más antigua primero)
const byCreado = (a, b) => {
  if (!a.creado && !b.creado) return 0
  if (!a.creado) return 1
  if (!b.creado) return -1
  return a.creado < b.creado ? -1 : (a.creado > b.creado ? 1 : 0)
}

// Manija de arrastre: recibe tal cual lo que devuelve drag.handleProps(op).
function DragHandle({ style, ...props }) {
  return (
    <span {...props} style={{ ...style, display: 'inline-flex', color: 'var(--ink-3)' }}>
      <Icon.Drag />
    </span>
  )
}

function Section({ title, children, style, actions }) {
  return (
    <div className="section" style={{ marginTop: 16, ...style }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  )
}

// ─────────────── Confirmación de remisión (Operador) ───────────────
// Avisa antes de generar: si hace falta una observación general para toda la
// remisión, este es el momento de escribirla — sale impresa en el documento.
function ConfirmarRemisionModal({ cantidad, cliente, observaciones, onObservaciones, busy, error, onClose, onConfirm }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 460, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          ⚠ Antes de generar la remisión
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 14 }}>
          Vas a generar una remisión de <strong>{cliente || 'este cliente'}</strong> con{' '}
          <strong>{cantidad}</strong> {cantidad === 1 ? 'troquel' : 'troqueles'}. Si necesitas dejar una{' '}
          <strong>observación general</strong> para toda la remisión, escríbela aquí:{' '}
          <strong>aparecerá impresa en el documento generado</strong>. Las observaciones de cada
          formato de cuchillas ya salen aparte, bajo su troquel.
        </div>
        <textarea
          className="input"
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
          placeholder="Observación general de la remisión (opcional)…"
          value={observaciones}
          onChange={e => onObservaciones(e.target.value)}
        />
        {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger, #c0392b)' }}>✗ {error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Generando…' : 'Generar remisión'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────── Vista Admin ───────────────

function AdminTroqueles() {
  const navigate = useNavigate()
  const [ordenes, setOrdenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNueva, setShowNueva] = useState(false)      // modal Nueva tarea de troquel
  const [solicitudes, setSolicitudes] = useState([])     // envíos de remisión bloqueados por falta de precios
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busqueda, setBusqueda] = useState('')           // filtro de la cola del operador
  const [prioridadError, setPrioridadError] = useState(null)

  const loadSolicitudes = () =>
    getRemisionesSolicitadas()
      .then(d => setSolicitudes(asList(d)))
      .catch(() => setSolicitudes([]))

  useEffect(() => { loadSolicitudes() }, [])
  useSyncPolling({
    ordenes: () => loadOrdenes(),
    remisiones_solicitadas: loadSolicitudes,
  })

  const loadOrdenes = () => {
    setLoading(true)
    return getOrdenesTodas('?proceso=troquel')
      .then(d => {
        const list = asList(d).sort(byCreado)
        setOrdenes(list)
        return list
      })
      .catch(() => [])
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadOrdenes() }, [])

  const abrirGestion = (ord) => navigate(`/produccion/troqueles/${ord.id}`)

  const handleDelete = (e, ord) => {
    e.stopPropagation()
    if (confirmDelete === ord.id) {
      setOrdenes(prev => prev.filter(o => o.id !== ord.id))
      setConfirmDelete(null)
      deleteOrden(ord.id).catch(() => {
        setOrdenes(prev => [ord, ...prev].sort(byCreado))
      })
    } else {
      setConfirmDelete(ord.id)
    }
  }

  // Cola del Operador: toda OP con troquel activo entra automáticamente al subir
  // la tarea. Orden FIFO por fecha de subida; la prioridad manual manda si está.
  const ordenesEnCola = useMemo(() => (
    [...ordenes].sort((a, b) => {
      const pa = a.prioridad_troquel ?? Infinity
      const pb = b.prioridad_troquel ?? Infinity
      return pa !== pb ? pa - pb : byCreado(a, b)
    })
  ), [ordenes])

  const filtrando = !!busqueda.trim()
  const ordenesFiltradas = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return ordenesEnCola
    return ordenesEnCola.filter(o => [o.numero, o.cliente_nombre, o.referencia].some(v => norm(v).includes(t)))
  }, [ordenesEnCola, busqueda])

  // Reordena la cola y persiste la numeración 1..N (optimista + rollback)
  const reordenar = (nuevaCola) => {
    const snapshot = ordenes
    const prioridadPorId = new Map(nuevaCola.map((o, i) => [o.id, i + 1]))
    setOrdenes(prev => prev.map(o => (
      prioridadPorId.has(o.id) ? { ...o, prioridad_troquel: prioridadPorId.get(o.id) } : o
    )))
    setPrioridadError(null)
    setProcesoPrioridades('troquel', nuevaCola.map(o => o.id)).catch(() => {
      setOrdenes(snapshot)
      setPrioridadError('No se pudo guardar el orden. Intenta de nuevo.')
    })
  }

  // Manda una OP directo al primer puesto de la cola.
  const priorizar = (e, ord) => {
    e.stopPropagation()
    const cola = [ord, ...ordenesEnCola.filter(o => o.id !== ord.id)]
    reordenar(cola)
  }

  // Con búsqueda activa se ve solo un pedazo de la cola: reordenar ahí
  // renumeraría mal las OPs escondidas, así que el arrastre se apaga.
  const drag = useDragOrder(ordenesFiltradas, reordenar, { disabled: filtrando })

  // Los precios del troquel se ponen sobre la remisión, no en la OP.
  const irAPrecios = (s) => navigate(`/remisiones/${s.remision_id}`)

  return (
    <div onClick={() => setConfirmDelete(null)}>
      {solicitudes.length > 0 && (
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--danger-soft, #fdecea)', border: '1px solid var(--danger, #c0392b)', fontSize: 13, color: 'var(--ink-2)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            🔔 Remisiones esperando precios de troquel ({solicitudes.length})
          </div>
          {solicitudes.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '6px 0', borderTop: '1px solid var(--danger, #c0392b22)' }}>
              <span style={{ flex: 1, minWidth: 220 }}>
                El operador {s.solicitada_por && <strong>{s.solicitada_por}</strong>} solicitó enviar la remisión de{' '}
                <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{s.numero}</strong>
                {s.cliente_nombre && <> ({s.cliente_nombre})</>} — faltan los precios del troquel.
              </span>
              {s.remision_id ? (
                <button className="btn sm primary" onClick={() => irAPrecios(s)}>Poner precios en la remisión</button>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  Aún sin remisión — se crea al terminar la OP
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Section
        title={`Cola del Operador${ordenesEnCola.length ? ` (${ordenesEnCola.length})` : ''}`}
        actions={<button className="btn sm primary" onClick={() => setShowNueva(true)}>+ Nueva tarea de troquel</button>}
      >
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)' }}>
          Toda tarea de troquel que se crea entra automáticamente aquí, en orden de subida (FIFO).
          {filtrando
            ? ' Limpia la búsqueda para poder reordenar la cola.'
            : ' Arrastra una fila por su manija para cambiar la prioridad, o usa «Priorizar» para mandarla al primer puesto.'}
        </div>
        {prioridadError && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--danger, #c0392b)' }}>
            ✗ {prioridadError}
          </div>
        )}
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
        ) : ordenesEnCola.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>No hay OPs con troquel activo</div>
        ) : (
          <>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ position: 'relative', maxWidth: 420 }}>
              <input
                className="input"
                placeholder="Buscar por número, cliente, referencia…"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                style={{ paddingLeft: 32 }}
              />
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                <Icon.Search />
              </span>
            </div>
          </div>
          {ordenesFiltradas.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin resultados para «{busqueda.trim()}»</div>
          ) : (
          <div className="table-scroll">
          <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)' }}>
                {['', '#', 'OP #', 'Subida', 'Cliente', 'Referencia', 'Progreso', '', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drag.items.map((ord, idx) => {
                const sub = fmtSubida(ord.creado)
                const esPrimero = ordenesEnCola[0]?.id === ord.id
                const dr = drag.rowProps(ord)
                return (
                  <tr key={ord.id} {...dr}
                    style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer', ...dr.style }}
                    onClick={() => abrirGestion(ord)}>
                    <td style={{ padding: '10px 6px', width: 28 }}>
                      {!filtrando && <DragHandle {...drag.handleProps(ord)} />}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: 'var(--ink-3)', width: 40 }}>{idx + 1}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12 }}>{ord.numero}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: sub.color }}>{sub.txt}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{ord.cliente_nombre}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--ink-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ord.referencia}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {ord.progreso ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ProgressBar pct={ord.progreso.porcentaje} />
                          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'JetBrains Mono, monospace' }}>{ord.progreso.completados}/{ord.progreso.total}</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <button className="btn sm" title="Mandar al primer puesto" disabled={esPrimero} onClick={e => priorizar(e, ord)}>Priorizar</button>
                    </td>
                    <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <button
                        className={'btn sm' + (confirmDelete === ord.id ? ' danger' : '')}
                        onClick={e => handleDelete(e, ord)}
                      >
                        {confirmDelete === ord.id ? '¿Eliminar?' : 'Eliminar'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          )}
          </>
        )}
      </Section>

      {showNueva && (
        <NuevaTareaTroquelModal
          onClose={() => setShowNueva(false)}
          onCreated={(orden) => {
            setShowNueva(false)
            abrirGestion(orden)
          }}
        />
      )}
    </div>
  )
}

// ─────────────── Vista Operador ───────────────

// El Operador puede corregir referencia / fecha de entrega / cliente de la OP.
// Cada cambio queda auditado server-side (quién / cuándo). El cliente se bloquea
// cuando la OP proviene de una cotización (coherente con el backend).
function OperadorOpDatos({ orden, onSaved }) {
  const locked = !!orden.desde_cotizacion
  const [referencia, setReferencia] = useState(orden.referencia || '')
  const [clienteId, setClienteId] = useState(orden.cliente || null)
  const [clienteNombre, setClienteNombre] = useState(orden.cliente_nombre || '')
  const [suggestions, setSuggestions] = useState([])
  const [showSugg, setShowSugg] = useState(false)

  useEffect(() => {
    setReferencia(orden.referencia || '')
    setClienteId(orden.cliente || null)
    setClienteNombre(orden.cliente_nombre || '')
    setSuggestions([]); setShowSugg(false)
  }, [orden.id])

  const buscarClientes = (q) => {
    setClienteNombre(q)
    setClienteId(null)   // sin sugerencia elegida no hay cliente válido
    if (!q || q.trim().length < 2) { setSuggestions([]); setShowSugg(false); return }
    getClientes(q)
      .then(d => { const l = asList(d); setSuggestions(l); setShowSugg(l.length > 0) })
      .catch(() => { setSuggestions([]); setShowSugg(false) })
  }

  const elegirCliente = (c) => { setClienteId(c.id); setClienteNombre(c.nombre); setShowSugg(false) }

  const { status: saveStatus, retry: retrySave } = useAutosave(
    { referencia, clienteId },
    (v) => {
      const payload = { referencia: v.referencia.trim() }
      if (!locked) payload.cliente = v.clienteId
      return editarCamposOrden(orden.id, payload).then(full => { onSaved && onSaved(full) })
    },
    { enabled: false, isValid: (v) => locked || !!v.clienteId }
  )
  const needsClienteSelection = !locked && !clienteId && clienteNombre.trim().length > 0

  const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }
  return (
    <div style={{ marginTop: 16, overflow: 'visible' }} className="section">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span><span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{orden.numero}</span> — Datos de la OP</span>
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--ink-3)' }}>Cantidad: {orden.cantidad}</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div style={lbl}>Cliente{locked && ' (bloqueado — OP de cotización)'}</div>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              style={{ width: '100%' }}
              placeholder="Buscar cliente…"
              value={clienteNombre}
              disabled={locked}
              onChange={e => buscarClientes(e.target.value)}
              onBlur={() => setTimeout(() => setShowSugg(false), 150)}
              onFocus={() => suggestions.length > 0 && setShowSugg(true)}
            />
            {showSugg && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, maxHeight: 240, overflowY: 'auto' }}>
                {suggestions.map(c => (
                  <div
                    key={c.id}
                    onMouseDown={() => elegirCliente(c)}
                    style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >{c.nombre}</div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div style={lbl}>Referencia</div>
          <input className="input" style={{ width: '100%' }} value={referencia} onChange={e => setReferencia(e.target.value)} />
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <div style={lbl}>Fecha de subida</div>
          <div style={{ padding: '9px 0', fontSize: 13, color: 'var(--ink-2)' }}>{fmtFechaCorta(orden.creado)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {needsClienteSelection
            ? <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>Selecciona un cliente de la lista</span>
            : (
              <>
                <button className="btn sm" onClick={retrySave} disabled={saveStatus === 'saving'}>Guardar</button>
                <SaveStatus status={saveStatus} onRetry={retrySave} style={{ fontSize: 12 }} />
              </>
            )}
        </div>
      </div>
    </div>
  )
}

function OperadorTroqueles() {
  const { user } = useAuth()
  const [tab, setTab] = useState('pendientes')
  const [showNueva, setShowNueva] = useState(false)   // modal Nueva tarea de troquel
  const [lista, setLista] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [loadingLista, setLoadingLista] = useState(true)
  const [orden, setOrden] = useState(null)
  const [opening, setOpening] = useState(false)
  const [formatos, setFormatos] = useState([])
  const [loadingFormatos, setLoadingFormatos] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [cancelError, setCancelError] = useState(null)
  // Desbloqueo inline desde el historial: formato en curso + error, para poder
  // editar un formato aprobado sin salir de la tabla del historial.
  const [histUnlockBusy, setHistUnlockBusy] = useState(null)
  const [histUnlockError, setHistUnlockError] = useState(null)
  // Historial: formatos de cuchillas (todas las OPs / operadores) y remisiones generadas
  const [histTab, setHistTab] = useState('formatos')  // 'formatos' | 'remisiones'
  const [historial, setHistorial] = useState([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)
  const [editHist, setEditHist] = useState(null)
  const [busquedaHist, setBusquedaHist] = useState('')
  const [histRem, setHistRem] = useState([])
  const [loadingHistRem, setLoadingHistRem] = useState(false)
  const [busquedaHistRem, setBusquedaHistRem] = useState('')
  const [histRemBusy, setHistRemBusy] = useState(null)   // id de remisión en PDF/devolución
  const [histRemError, setHistRemError] = useState(null)
  // Tab de remisiones del Operador (consolidar varias OP de un cliente en un PDF)
  const [remisionables, setRemisionables] = useState([])
  const [loadingRem, setLoadingRem] = useState(false)
  const [busquedaRem, setBusquedaRem] = useState('')
  const [selRem, setSelRem] = useState([])          // ids de OP seleccionadas
  const [selCliente, setSelCliente] = useState(null) // cliente_id de la selección
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState(null)
  const [genOk, setGenOk] = useState(null)          // número de la última remisión generada
  const [confirmGen, setConfirmGen] = useState(false) // modal previo a generar
  const [obsRem, setObsRem] = useState('')            // observación general de la remisión

  const loadLista = (silent = false) => {
    if (!silent) setLoadingLista(true)
    getOrdenesPendientes('troquel')
      .then(d => setLista(asList(d)))
      .catch(() => setLista([]))
      .finally(() => setLoadingLista(false))
  }

  useEffect(() => { loadLista() }, [])

  const loadHistorial = () => {
    setLoadingHistorial(true)
    getFormatosCuchillasTodos()
      .then(d => setHistorial(asList(d)))
      .catch(() => setHistorial([]))
      .finally(() => setLoadingHistorial(false))
  }

  const loadHistRem = () => {
    setLoadingHistRem(true)
    getRemisionesGeneradasOperador()
      .then(d => setHistRem(asList(d)))
      .catch(() => setHistRem([]))
      .finally(() => setLoadingHistRem(false))
  }

  useEffect(() => {
    if (tab !== 'historial') return
    if (histTab === 'formatos') loadHistorial()
    else loadHistRem()
  }, [tab, histTab])

  const loadRemisionables = () => {
    setLoadingRem(true)
    getRemisionablesOperador()
      .then(d => setRemisionables(asList(d)))
      .catch(() => setRemisionables([]))
      .finally(() => setLoadingRem(false))
  }

  useEffect(() => { if (tab === 'remisiones') loadRemisionables() }, [tab])

  // Tiempo real: refrescar la lista de pendientes solo cuando se está viendo
  useSyncPolling({ ordenes: () => loadLista(true) }, { enabled: !orden && tab === 'pendientes' })

  // Remisionables filtradas por búsqueda y agrupadas por cliente
  const remisionablesFiltradas = useMemo(() => {
    const t = norm(busquedaRem.trim())
    if (!t) return remisionables
    return remisionables.filter(op => [op.numero, op.cliente_nombre, op.referencia].some(v => norm(v).includes(t)))
  }, [remisionables, busquedaRem])

  const gruposRem = useMemo(() => {
    const map = new Map()
    for (const op of remisionablesFiltradas) {
      const key = op.cliente_id
      if (!map.has(key)) map.set(key, { cliente_id: key, cliente_nombre: op.cliente_nombre, ops: [] })
      map.get(key).ops.push(op)
    }
    return [...map.values()]
  }, [remisionablesFiltradas])

  // Al marcar una OP: si es de otro cliente, reinicia la selección a ese cliente.
  const toggleRem = (op) => {
    setGenError(null)
    if (selCliente !== null && op.cliente_id !== selCliente) {
      setSelCliente(op.cliente_id)
      setSelRem([op.id])
      return
    }
    setSelCliente(op.cliente_id)
    setSelRem(prev => {
      const next = prev.includes(op.id) ? prev.filter(x => x !== op.id) : [...prev, op.id]
      if (next.length === 0) setSelCliente(null)
      return next
    })
  }

  // Descarga el PDF de una remisión ya creada (al generarla y al re-descargarla
  // desde el historial).
  const descargarPdfRemision = async (remisionId) => {
    const r = await pdfRemisionOperadorConsolidada(remisionId)
    if (!r.ok) {
      const body = await r.json().catch(() => null)
      throw new Error(body?.error || `HTTP ${r.status}`)
    }
    const nombre = (r.headers.get('Content-Disposition') || '').match(/filename="(.+?)"/)?.[1]
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nombre || 'Remision.pdf'
    a.click()
    URL.revokeObjectURL(url)
  }

  const generarRemision = async () => {
    if (!selRem.length) return
    setGenBusy(true)
    setGenError(null)
    setGenOk(null)
    try {
      const { remision_id, remision_numero } = await consolidarRemisionOperador(selRem, obsRem.trim())
      await descargarPdfRemision(remision_id)
      setSelRem([]); setSelCliente(null)
      setConfirmGen(false); setObsRem('')
      setGenOk(remision_numero)
      // Las OPs generadas salen de esta lista y quedan en Historial › Remisiones.
      loadRemisionables()
    } catch (e) {
      setGenError(e.message || 'No se pudo generar la remisión')
    } finally {
      setGenBusy(false)
    }
  }

  const rehacerPdfRemision = async (rem) => {
    setHistRemBusy(rem.id)
    setHistRemError(null)
    try {
      await descargarPdfRemision(rem.id)
    } catch (e) {
      setHistRemError(e?.message || 'No se pudo generar el PDF')
    } finally {
      setHistRemBusy(null)
    }
  }

  const devolverRemision = async (rem) => {
    if (!window.confirm(`¿Devolver las OPs de ${rem.numero} a la cola de remisiones? Podrás volver a generarla.`)) return
    setHistRemBusy(rem.id)
    setHistRemError(null)
    try {
      await devolverRemisionOperador(rem.id)
      loadHistRem()
      loadRemisionables()
    } catch (e) {
      setHistRemError(e?.message || 'No se pudo devolver la remisión')
    } finally {
      setHistRemBusy(null)
    }
  }

  const filtrandoLista = !!busqueda.trim()
  const listaFiltrada = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return lista
    return lista.filter(op => [op.numero, op.cliente_nombre, op.referencia].some(v => norm(v).includes(t)))
  }, [lista, busqueda])

  // El Operador prioriza su propia cola arrastrando: la posición se guarda como
  // prioridad del proceso troquel (1 = primero), igual que la vista del Admin.
  const [ordenError, setOrdenError] = useState(null)
  const guardarOrden = (nueva) => {
    const snapshot = lista
    setLista(nueva)
    setOrdenError(null)
    setProcesoPrioridades('troquel', nueva.map(op => op.id)).catch(() => {
      setLista(snapshot)
      setOrdenError('No se pudo guardar el orden. Intenta de nuevo.')
    })
  }
  const drag = useDragOrder(listaFiltrada, guardarOrden, { disabled: filtrandoLista })

  const historialFiltrado = useMemo(() => {
    const t = norm(busquedaHist.trim())
    if (!t) return historial
    return historial.filter(f => [f.orden_numero, f.cliente_nombre, f.referencia].some(v => norm(v).includes(t)))
  }, [historial, busquedaHist])

  const histRemFiltrado = useMemo(() => {
    const t = norm(busquedaHistRem.trim())
    if (!t) return histRem
    return histRem.filter(r => [
      r.numero, r.cliente_nombre,
      ...(r.ops || []).flatMap(op => [op.numero, op.referencia]),
    ].some(v => norm(v).includes(t)))
  }, [histRem, busquedaHistRem])

  const loadFormatos = (ordenId) => {
    setLoadingFormatos(true)
    getFormatosCuchillas(ordenId)
      .then(d => setFormatos(asList(d)))
      .catch(() => setFormatos([]))
      .finally(() => setLoadingFormatos(false))
  }

  const abrir = (op) => {
    setOpening(true)
    setCancelError(null)
    getOrdenProduccion(op.id)
      .then(full => { setOrden(full); loadFormatos(full.id) })
      .catch(() => {})
      .finally(() => setOpening(false))
  }

  const esMio = (f) => !!user?.username && f?.operador_username === user.username

  // Cancelar el envío del formato para volver a editarlo (→ borrador). Deshace el
  // cierre del troquel y borra su remisión; si el Admin ya liquidó (409), se
  // muestra el motivo y se refresca el estado real.
  const cancelarEnvio = (formatoId) => {
    if (!window.confirm('¿Cancelar el envío del formato para volver a editarlo?')) return
    setCancelando(true)
    setCancelError(null)
    cancelarEnvioFormato(formatoId)
      .catch(e => setCancelError(e?.message || 'No se pudo cancelar el envío'))
      .finally(() => {
        setCancelando(false)
        loadFormatos(orden.id)
      })
  }

  // Desbloquear un formato aprobado directamente desde el historial: cancela su
  // envío (saca la remisión, vuelve a borrador) y abre el editor de una vez con
  // el formato ya actualizado que devuelve el servidor.
  const desbloquearYEditar = (f) => {
    setHistUnlockBusy(f.id)
    setHistUnlockError(null)
    cancelarEnvioFormato(f.id)
      .then(updated => { setEditHist(updated); loadHistorial() })
      .catch(e => setHistUnlockError(e?.message || 'No se pudo desbloquear el formato'))
      .finally(() => setHistUnlockBusy(null))
  }

  const volver = () => { setOrden(null); setFormatos([]); loadLista() }

  if (!orden) {
    const puedeEditar = (f) => f.estado !== 'aprobado' && esMio(f)
    const puedeDesbloquear = (f) => f.estado === 'aprobado' && esMio(f)
    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className={`btn sm${tab === 'pendientes' ? ' primary' : ''}`} onClick={() => { setTab('pendientes'); setEditHist(null) }}>Pendientes</button>
          <button className={`btn sm${tab === 'remisiones' ? ' primary' : ''}`} onClick={() => { setTab('remisiones'); setEditHist(null) }}>Remisiones</button>
          <button className={`btn sm${tab === 'historial' ? ' primary' : ''}`} onClick={() => setTab('historial')}>Historial</button>
        </div>

        {tab === 'historial' && editHist && (
          <>
            <button className="btn" style={{ marginTop: 16 }} onClick={() => setEditHist(null)}><Icon.ArrowLeft /> Volver al historial</button>
            {editHist.estado === 'pendiente' && (
              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--warn-soft, #fef6e7)', border: '1px solid var(--warn, #e0a800)', fontSize: 13, color: 'var(--ink-2)' }}>
                ⏳ Este formato sigue <strong>pendiente de aprobación</strong>; al guardar los cambios seguirá en la cola del administrador.
              </div>
            )}
            <Section title={`Editar formato — OP ${editHist.orden_numero || ''}${editHist.cliente_nombre ? ` · ${editHist.cliente_nombre}` : ''}`}>
              <FormatoCuchillasForm
                resubmit
                formato={editHist}
                ordenId={editHist.orden}
                onCreated={() => { setEditHist(null); loadHistorial() }}
              />
            </Section>
          </>
        )}

        {tab === 'historial' && !editHist && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className={`btn sm${histTab === 'formatos' ? ' primary' : ''}`} onClick={() => setHistTab('formatos')}>Formatos</button>
            <button className={`btn sm${histTab === 'remisiones' ? ' primary' : ''}`} onClick={() => setHistTab('remisiones')}>Remisiones</button>
          </div>
        )}

        {tab === 'historial' && !editHist && histTab === 'remisiones' && (
          <Section title="Remisiones generadas">
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)' }}>
              Cada remisión que generas sale de la cola y queda aquí. Puedes volver a descargar su PDF, o devolverla para rehacerla mientras el administrador no la haya liquidado.
            </div>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ position: 'relative', maxWidth: 420 }}>
                <input
                  className="input"
                  placeholder="Buscar por remisión, cliente, OP, referencia…"
                  value={busquedaHistRem}
                  onChange={e => setBusquedaHistRem(e.target.value)}
                  style={{ paddingLeft: 32 }}
                />
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                  <Icon.Search />
                </span>
              </div>
              {histRemError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger, #c0392b)' }}>✗ {histRemError}</div>}
            </div>
            {loadingHistRem ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
            ) : histRemFiltrado.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
                {busquedaHistRem.trim() ? `Sin resultados para «${busquedaHistRem.trim()}»` : 'Todavía no has generado remisiones.'}
              </div>
            ) : (
              <div className="table-scroll">
              <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left', fontSize: 12, color: 'var(--ink-3)' }}>
                    <th style={{ padding: '8px 12px' }}>Remisión</th>
                    <th style={{ padding: '8px 12px' }}>Fecha</th>
                    <th style={{ padding: '8px 12px' }}>Cliente</th>
                    <th style={{ padding: '8px 12px' }}>Troqueles</th>
                    <th style={{ padding: '8px 12px' }}>Generada por</th>
                    <th style={{ padding: '8px 12px' }}>Estado</th>
                    <th style={{ padding: '8px 12px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {histRemFiltrado.map((rem, idx) => {
                    const def = REMISION_STATUS_DEFS.find(s => s.id === rem.estado)
                    const busy = histRemBusy === rem.id
                    return (
                      <tr key={rem.id} style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)' }}>
                        <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13 }}>{rem.numero}</td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)' }}>{fmtFechaCorta(rem.generada_en || rem.fecha)}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{rem.cliente_nombre || '—'}</td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)' }}>
                          {(rem.ops || []).map(op => (
                            <div key={op.numero}>
                              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{op.numero}</span>
                              {op.referencia ? ` · ${op.referencia}` : ''}
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)' }}>{rem.generada_por_username || '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          {def && <span className={'badge ' + def.cls}><span className="dot"></span>{def.label}</span>}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn sm" disabled={busy} onClick={() => rehacerPdfRemision(rem)}>PDF</button>
                          {rem.estado === 'pendiente' && (
                            <button className="btn sm" style={{ marginLeft: 6 }} disabled={busy} onClick={() => devolverRemision(rem)}>Devolver</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            )}
          </Section>
        )}

        {tab === 'historial' && !editHist && histTab === 'formatos' && (
          <Section title="Historial de formatos de cuchillas">
            {!loadingHistorial && historial.length > 0 && (
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ position: 'relative', maxWidth: 420 }}>
                  <input
                    className="input"
                    placeholder="Buscar por OP, cliente, referencia…"
                    value={busquedaHist}
                    onChange={e => setBusquedaHist(e.target.value)}
                    style={{ paddingLeft: 32 }}
                  />
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                    <Icon.Search />
                  </span>
                </div>
              </div>
            )}
            {histUnlockError && (
              <div style={{ margin: '0 16px 12px', fontSize: 12, color: 'var(--danger, #c0392b)' }}>{histUnlockError}</div>
            )}
            {!loadingHistorial && historial.length > 0 && historialFiltrado.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin resultados para «{busquedaHist.trim()}»</div>
            ) : (
              <FormatosCuchillasHistory
                formatos={historialFiltrado}
                loading={loadingHistorial}
                compact
                onEdit={setEditHist}
                canEdit={puedeEditar}
                onUnlock={desbloquearYEditar}
                canUnlock={puedeDesbloquear}
                unlockBusyId={histUnlockBusy}
              />
            )}
          </Section>
        )}

        {tab === 'pendientes' && (
          <Section
            title="Troqueles del día — selecciona una OP"
            actions={
              <button className="btn sm primary" onClick={() => setShowNueva(true)}>
                + Nueva tarea de troquel
              </button>
            }
          >
            {!loadingLista && lista.length > 0 && (
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: ordenError ? 'var(--danger, #c0392b)' : 'var(--ink-3)' }}>
                {ordenError || (filtrandoLista
                  ? 'Limpia la búsqueda para poder reordenar la cola.'
                  : 'Arrastra una fila por su manija para cambiar la prioridad: la de arriba se trabaja primero.')}
              </div>
            )}
            {loadingLista ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
            ) : lista.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>No hay troqueles pendientes 🎉</div>
            ) : (
              <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ position: 'relative', maxWidth: 420 }}>
                  <input
                    className="input"
                    placeholder="Buscar por número, cliente, referencia…"
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    style={{ paddingLeft: 32 }}
                  />
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                    <Icon.Search />
                  </span>
                </div>
              </div>
              {listaFiltrada.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin resultados para «{busqueda.trim()}»</div>
              ) : (
              <div className="table-scroll">
              <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)' }}>
                    {['', '#', 'OP #', 'Subida', 'Cliente', 'Referencia', 'Cantidad', ''].map((h, i) => (
                      <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drag.items.map((op, idx) => {
                    const sub = fmtSubida(op.creado)
                    const dr = drag.rowProps(op)
                    return (
                      <tr key={op.id} {...dr}
                        style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer', ...dr.style }}
                        onClick={() => !opening && abrir(op)}>
                        <td style={{ padding: '12px 6px', width: 28 }}>
                          {!filtrandoLista && <DragHandle {...drag.handleProps(op)} />}
                        </td>
                        <td style={{ padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: 'var(--ink-3)', width: 40 }}>{idx + 1}</td>
                        <td style={{ padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13 }}>{op.numero}</td>
                        <td style={{ padding: '12px', fontSize: 12, fontWeight: 600, color: sub.color }}>{sub.txt}</td>
                        <td style={{ padding: '12px', fontWeight: 600 }}>{op.cliente_nombre || '—'}</td>
                        <td style={{ padding: '12px', color: 'var(--ink-2)' }}>{op.referencia}</td>
                        <td style={{ padding: '12px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink-2)' }}>{op.cantidad}</td>
                        <td style={{ padding: '12px' }}>
                          <button className="btn sm primary" disabled={opening} onClick={e => { e.stopPropagation(); abrir(op) }}>Abrir</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
              )}
              </>
            )}
          </Section>
        )}

        {tab === 'remisiones' && (
          <Section
            title="Remisiones — selecciona troqueles de un cliente"
            actions={
              <button
                className="btn sm primary"
                disabled={genBusy || !selRem.length}
                onClick={() => { setGenError(null); setGenOk(null); setConfirmGen(true) }}
              >
                {genBusy ? 'Generando…' : `Generar remisión${selRem.length ? ` (${selRem.length})` : ''}`}
              </button>
            }
          >
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)' }}>
              Marca varios troqueles del <strong>mismo cliente</strong> para reunirlos en una sola remisión. El PDF muestra el consumo en cm y la firma del cliente (sin precios, salvo que el administrador los habilite). Al generarla, esos troqueles salen de esta lista y quedan en <strong>Historial › Remisiones</strong>.
            </div>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ position: 'relative', maxWidth: 420 }}>
                <input
                  className="input"
                  placeholder="Buscar por número, cliente, referencia…"
                  value={busquedaRem}
                  onChange={e => setBusquedaRem(e.target.value)}
                  style={{ paddingLeft: 32 }}
                />
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                  <Icon.Search />
                </span>
              </div>
              {genError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger, #c0392b)' }}>✗ {genError}</div>}
              {genOk && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ok, #2e7d32)' }}>
                  ✓ Remisión <strong>{genOk}</strong> generada ·{' '}
                  <button className="btn sm" style={{ padding: '2px 8px' }} onClick={() => { setGenOk(null); setTab('historial'); setHistTab('remisiones') }}>
                    Ver en Historial
                  </button>
                </div>
              )}
            </div>
            {loadingRem ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
            ) : gruposRem.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
                {busquedaRem.trim() ? `Sin resultados para «${busquedaRem.trim()}»` : 'No hay troqueles pendientes de remisión.'}
              </div>
            ) : (
              gruposRem.map(g => {
                const bloqueado = selCliente !== null && g.cliente_id !== selCliente
                return (
                  <div key={g.cliente_id} style={{ opacity: bloqueado ? 0.5 : 1 }}>
                    <div style={{ padding: '8px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13 }}>
                      {g.cliente_nombre || '—'}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                      <tbody>
                        {g.ops.map((op, idx) => {
                          const checked = selRem.includes(op.id)
                          return (
                            <tr key={op.id}
                              style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                              onClick={() => toggleRem(op)}>
                              <td style={{ padding: '10px 12px', width: 36 }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleRem(op)} onClick={e => e.stopPropagation()} />
                              </td>
                              <td style={{ padding: '10px 12px', width: 90, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13 }}>{op.numero}</td>
                              <td style={{ padding: '10px 12px', color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.referencia}</td>
                              <td style={{ padding: '10px 12px', width: 70, fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink-2)' }}>{op.cantidad}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })
            )}
          </Section>
        )}

        {showNueva && (
          <NuevaTareaTroquelModal
            onClose={() => setShowNueva(false)}
            onCreated={(orden) => {
              setShowNueva(false)
              loadLista()
              abrir(orden)
            }}
          />
        )}

        {confirmGen && (
          <ConfirmarRemisionModal
            cantidad={selRem.length}
            cliente={remisionables.find(op => op.cliente_id === selCliente)?.cliente_nombre}
            observaciones={obsRem}
            onObservaciones={setObsRem}
            busy={genBusy}
            error={genError}
            onClose={() => { if (!genBusy) { setConfirmGen(false); setGenError(null) } }}
            onConfirm={generarRemision}
          />
        )}
      </>
    )
  }

  return (
    <>
      <button className="btn" style={{ marginBottom: 4 }} onClick={volver}><Icon.ArrowLeft /> Volver a la lista</button>
      {orden && (
        <>
          <OperadorOpDatos orden={orden} onSaved={setOrden} />

          <Section title="Modelo del troquel">
            <ModeloViewer modelo={orden.troquel_modelo} />
          </Section>

          {!loadingFormatos && formatos.length === 0 && (
            <Section title="Formato de cuchillas + tiempos">
              <FormatoCuchillasForm
                ordenId={orden.id}
                onCreated={() => loadFormatos(orden.id)}
                onDraftSaved={() => loadFormatos(orden.id)}
              />
            </Section>
          )}

          {formatos.length > 0 && formatos[0].estado === 'pendiente' && (
            <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--warn-soft, #fef6e7)', border: '1px solid var(--warn, #e0a800)', fontSize: 13, color: 'var(--ink-2)' }}>
              <div>
                ⏳ El formato de cuchillas fue enviado y está <strong>esperando revisión del administrador</strong>.
                Si necesitas corregirlo, cancela el envío para volver a editarlo.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <button className="btn sm" disabled={cancelando} onClick={() => cancelarEnvio(formatos[0].id)}>
                  {cancelando ? 'Cancelando…' : 'Cancelar envío'}
                </button>
                {cancelError && <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>{cancelError}</span>}
              </div>
            </div>
          )}

          {formatos.length > 0 && formatos[0].estado === 'borrador' && (
            <>
              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--surface-2, #f2f2f2)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink-2)' }}>
                ✏️ Formato guardado como <strong>borrador</strong> — el administrador no lo verá hasta que lo envíes.
              </div>
              <Section title="Editar y enviar formato de cuchillas">
                <FormatoCuchillasForm
                  resubmit
                  formato={formatos[0]}
                  ordenId={orden.id}
                  onCreated={() => loadFormatos(orden.id)}
                  onDraftSaved={() => loadFormatos(orden.id)}
                />
              </Section>
            </>
          )}

          {formatos.length > 0 && formatos[0].estado === 'devuelto' && (
            <>
              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--danger-soft, #fdecea)', border: '1px solid var(--danger, #c0392b)', fontSize: 13, color: 'var(--ink-2)' }}>
                ↩ El administrador <strong>devolvió</strong> el formato de cuchillas.
                {formatos[0].devolucion_motivo && <> Motivo: <strong>{formatos[0].devolucion_motivo}</strong>.</>}
                {' '}Corrige los datos y reenvíalo.
              </div>
              <Section title="Corregir y reenviar formato de cuchillas">
                <FormatoCuchillasForm
                  resubmit
                  formato={formatos[0]}
                  ordenId={orden.id}
                  onCreated={() => loadFormatos(orden.id)}
                  onDraftSaved={() => loadFormatos(orden.id)}
                />
              </Section>
            </>
          )}

          {formatos.length > 0 && formatos[0].estado === 'aprobado' && (
            <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--warn-soft, #fef6e7)', border: '1px solid var(--warn, #e0a800)', fontSize: 13, color: 'var(--ink-2)' }}>
              <div>
                ✅ El formato de cuchillas quedó <strong>registrado</strong> y el troquel está terminado.
                {esMio(formatos[0])
                  ? ' Si te equivocaste, cancela el envío ahora para volver a editarlo; una vez el administrador liquide la remisión ya no se puede.'
                  : ' Si necesitas un cambio, contacta al administrador.'}
              </div>
              {esMio(formatos[0]) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <button className="btn sm" disabled={cancelando} onClick={() => cancelarEnvio(formatos[0].id)}>
                    {cancelando ? 'Cancelando…' : 'Cancelar envío y corregir'}
                  </button>
                  {cancelError && <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>{cancelError}</span>}
                </div>
              )}
            </div>
          )}

          <Section title="Formato registrado en esta OP">
            <FormatosCuchillasHistory formatos={formatos} loading={loadingFormatos} />
          </Section>
        </>
      )}
    </>
  )
}

// ─────────────── Página ───────────────

export default function Troqueles() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><div className="mod">Troqueles</div></div>
        <div className="topbar-right">
          <button className="btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/produccion'))}><Icon.ArrowLeft /> Volver</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)', width: '100%' }}>
        {isAdmin ? <AdminTroqueles /> : <OperadorTroqueles />}
      </div>
    </div>
  )
}
