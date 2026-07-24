import { useState, useEffect, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import {
  ModeloViewer, FormatosCuchillasHistory, TroquelCostos,
} from '../components/Troquel'
import {
  getFormatosPendientes, aprobarFormatoCuchillas, aprobarFormatosLote,
  devolverFormatoCuchillas, getOrden, getTroquelModelo,
} from '../api'
import { useSyncPolling } from '../lib/useSyncPolling'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))

// Normaliza para búsqueda insensible a mayúsculas/acentos.
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Fecha de entrega formateada + color según urgencia (vencido / próximo)
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

const fmtFechaHora = (s) => {
  try { return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

function Section({ title, children, style, actions }) {
  return (
    <div className="section" style={{ marginTop: 16, ...style }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  )
}

// ─────────────── Cola de troqueles pendientes ───────────────

function ColaPendientes({ pendientes, loading, onRevisar, onReload }) {
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [confirmando, setConfirmando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sinCostos, setSinCostos] = useState([])   // [{id, orden_numero, cliente_nombre}]

  // Al recargar la lista, descarta de la selección los ids que ya no están pendientes.
  useEffect(() => {
    setSel(prev => {
      const vivos = new Set(pendientes.map(f => f.id))
      const next = new Set([...prev].filter(id => vivos.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [pendientes])

  const filtradas = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return pendientes
    return pendientes.filter(f => [f.orden_numero, f.cliente_nombre, f.referencia].some(v => norm(v).includes(t)))
  }, [pendientes, busqueda])

  // Agrupa por cliente (mismo patrón que la pestaña de remisiones).
  const grupos = useMemo(() => {
    const map = new Map()
    for (const f of filtradas) {
      const key = f.cliente_nombre || '—'
      if (!map.has(key)) map.set(key, { cliente: key, formatos: [] })
      map.get(key).formatos.push(f)
    }
    return [...map.values()]
  }, [filtradas])

  const toggle = (id) => setSel(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const toggleGrupo = (formatos) => setSel(prev => {
    const next = new Set(prev)
    const ids = formatos.map(f => f.id)
    if (ids.every(id => next.has(id))) ids.forEach(id => next.delete(id))
    else ids.forEach(id => next.add(id))
    return next
  })

  const visiblesIds = filtradas.map(f => f.id)
  const allVisibleSel = visiblesIds.length > 0 && visiblesIds.every(id => sel.has(id))
  const toggleAll = () => setSel(prev => {
    const next = new Set(prev)
    if (allVisibleSel) visiblesIds.forEach(id => next.delete(id))
    else visiblesIds.forEach(id => next.add(id))
    return next
  })

  const aprobarLote = () => {
    setBusy(true); setError(null)
    aprobarFormatosLote([...sel])
      .then(res => {
        setConfirmando(false)
        setSinCostos(res?.sin_costos || [])
        setSel(new Set())
        return onReload()
      })
      .catch(e => { setConfirmando(false); setError(e?.message || 'No se pudo aprobar en lote') })
      .finally(() => setBusy(false))
  }

  const revisarSinCosto = (id) => {
    const f = pendientes.find(x => x.id === id)
    if (f) onRevisar(f)
  }

  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }

  return (
    <>
      {sinCostos.length > 0 && (
        <Section title={`Faltan precios (${sinCostos.length})`} style={{ borderColor: 'var(--warn, #e0a800)' }}>
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 12 }}>
              Estos troqueles no se aprobaron porque su tabla de costos aún tiene conceptos sin precio.
              Ábrelos para completar los precios y aprobarlos individualmente.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sinCostos.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8 }}>
                  <div>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{s.orden_numero || '—'}</span>
                    <span style={{ color: 'var(--ink-2)', marginLeft: 10 }}>{s.cliente_nombre || '—'}</span>
                  </div>
                  <button className="btn sm primary" onClick={() => revisarSinCosto(s.id)}>Revisar</button>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      <Section
        title={`Troqueles por aprobar${pendientes.length ? ` (${pendientes.length})` : ''}`}
        actions={sel.size > 0 && (
          <button className="btn primary sm" onClick={() => setConfirmando(true)} disabled={busy}>
            Aprobar {sel.size} seleccionado{sel.size > 1 ? 's' : ''}
          </button>
        )}
      >
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
        ) : pendientes.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>No hay troqueles esperando aprobación 🎉</div>
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
            {error && <div style={{ padding: '12px 16px', color: 'var(--danger, #c0392b)', fontSize: 13 }}>{error}</div>}
            {filtradas.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin resultados para «{busqueda.trim()}»</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)' }}>
                    <th style={{ ...th, width: 36 }}>
                      <input type="checkbox" checked={allVisibleSel} onChange={toggleAll} title="Seleccionar todo" />
                    </th>
                    {['OP #', 'Referencia', 'Operador', 'Registrado', 'Entrega', ''].map((h, i) => (
                      <th key={i} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grupos.map(g => {
                    const groupIds = g.formatos.map(f => f.id)
                    const groupAll = groupIds.every(id => sel.has(id))
                    return (
                      <Fragment key={g.cliente}>
                        <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                          <td style={{ padding: '8px 12px' }}>
                            <input type="checkbox" checked={groupAll} onChange={() => toggleGrupo(g.formatos)} title={`Seleccionar todo de ${g.cliente}`} />
                          </td>
                          <td colSpan={6} style={{ padding: '8px 12px', fontWeight: 700, fontSize: 12 }}>
                            {g.cliente} <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>· {g.formatos.length}</span>
                          </td>
                        </tr>
                        {g.formatos.map((f, idx) => {
                          const ent = fmtEntrega(f.fecha_entrega)
                          return (
                            <tr key={f.id}
                              style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                              onClick={() => onRevisar(f)}>
                              <td style={{ padding: '12px' }} onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} />
                              </td>
                              <td style={{ padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13 }}>{f.orden_numero}</td>
                              <td style={{ padding: '12px', color: 'var(--ink-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.referencia || '—'}</td>
                              <td style={{ padding: '12px' }}>{f.operador_username || '—'}</td>
                              <td style={{ padding: '12px', fontSize: 12, color: 'var(--ink-2)' }}>{fmtFechaHora(f.fecha_hora)}</td>
                              <td style={{ padding: '12px', fontSize: 12, fontWeight: 600, color: ent.color }}>{ent.txt}</td>
                              <td style={{ padding: '12px' }}>
                                <button className="btn sm primary" onClick={e => { e.stopPropagation(); onRevisar(f) }}>Revisar</button>
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </Section>

      {confirmando && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Aprobar {sel.size} troquel{sel.size > 1 ? 'es' : ''}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
              Cada troquel quedará <strong>completado</strong> y, si su OP llega al 100%, pasará a remisión.
              Los que aún tengan <strong>precios sin completar</strong> no se aprobarán y quedarán listados aparte para revisarlos.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmando(false)} disabled={busy}>Cancelar</button>
              <button className="btn primary" onClick={aprobarLote} disabled={busy}>
                {busy ? 'Aprobando…' : 'Sí, aprobar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────── Revisión de un troquel ───────────────

function RevisionDetalle({ formato, onVolver, onResuelto }) {
  const [orden, setOrden] = useState(null)
  const [modelo, setModelo] = useState(null)
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [confirmando, setConfirmando] = useState(false)   // modal Aprobar
  const [devolviendo, setDevolviendo] = useState(false)   // modal Devolver
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [costosDirty, setCostosDirty] = useState(false)   // costos escritos sin guardar
  const [avisoCostos, setAvisoCostos] = useState(false)   // popup "guarda antes de aprobar"

  useEffect(() => {
    setLoadingInfo(true)
    Promise.all([
      getOrden(formato.orden).catch(() => null),
      getTroquelModelo(formato.orden).then(d => asList(d)[0] || null).catch(() => null),
    ])
      .then(([ord, mod]) => { setOrden(ord); setModelo(mod) })
      .finally(() => setLoadingInfo(false))
  }, [formato.orden])

  // El 409 llega si el operador canceló el envío mientras se revisaba:
  // se muestra el mensaje del servidor en lugar de uno genérico.
  const aprobar = () => {
    setBusy(true); setError(null)
    aprobarFormatoCuchillas(formato.id)
      .then(() => { setConfirmando(false); onResuelto() })
      .catch((e) => { setConfirmando(false); setError(e?.message || 'No se pudo aprobar el formato') })
      .finally(() => setBusy(false))
  }

  const devolver = () => {
    setBusy(true); setError(null)
    devolverFormatoCuchillas(formato.id, motivo)
      .then(() => { setDevolviendo(false); onResuelto() })
      .catch((e) => { setDevolviendo(false); setError(e?.message || 'No se pudo devolver el formato') })
      .finally(() => setBusy(false))
  }

  const ent = fmtEntrega(formato.fecha_entrega)

  return (
    <>
      <button className="btn" style={{ marginBottom: 4 }} onClick={onVolver}><Icon.ArrowLeft /> Volver a la lista</button>

      {/* Encabezado de la OP */}
      <Section title={`Revisión de troquel · ${formato.orden_numero}`}>
        <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          {[
            ['OP', formato.orden_numero, true],
            ['Cliente', formato.cliente_nombre || orden?.cliente_nombre || '—'],
            ['Referencia', orden?.referencia || '—'],
            ['Cantidad', orden?.cantidad ?? '—', true],
            ['Registrado por', formato.operador_username || '—'],
            ['Fecha registro', fmtFechaHora(formato.fecha_hora)],
          ].map(([label, value, mono]) => (
            <div key={label}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'JetBrains Mono, monospace' : undefined }}>{value}</div>
            </div>
          ))}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Entrega</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: ent.color }}>{ent.txt}</div>
          </div>
        </div>
      </Section>

      <Section title="Modelo del troquel">
        {loadingInfo
          ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
          : <ModeloViewer modelo={modelo} />}
      </Section>

      <Section title="Formato de cuchillas registrado">
        <FormatosCuchillasHistory formatos={[formato]} loading={false} />
      </Section>

      <Section title="Costos (del formato de cuchillas)">
        <TroquelCostos
          ordenId={formato.orden}
          refreshKey={0}
          onDirtyChange={setCostosDirty}
          clienteId={orden?.cliente}
          clienteNombre={formato.cliente_nombre || orden?.cliente_nombre}
        />
      </Section>

      {error && <div style={{ marginTop: 12, color: 'var(--danger, #c0392b)', fontSize: 13 }}>{error}</div>}

      {/* Barra de acciones */}
      <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onVolver} disabled={busy}><Icon.ArrowLeft /> Volver a la lista</button>
        <button className="btn" style={{ color: 'var(--danger, #c0392b)' }} onClick={() => { setMotivo(''); setDevolviendo(true) }} disabled={busy}>
          Devolver al operador
        </button>
        <button className="btn primary" onClick={() => (costosDirty ? setAvisoCostos(true) : setConfirmando(true))} disabled={busy}>
          Aprobar → remisión
        </button>
      </div>

      {avisoCostos && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Costos sin guardar</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
              Escribiste precios o cantidades en la tabla de costos que aún no se han guardado.
              Presiona <strong>Guardar costos</strong> antes de aprobar, para que la remisión
              se genere con el total correcto.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn primary" onClick={() => setAvisoCostos(false)}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {confirmando && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Aprobar formato de cuchillas</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
              El troquel de <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formato.orden_numero}</strong> quedará
              <strong> completado</strong> y, si la OP llega al 100%, pasará automáticamente a remisión.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmando(false)} disabled={busy}>Cancelar</button>
              <button className="btn primary" onClick={aprobar} disabled={busy}>
                {busy ? 'Aprobando…' : 'Sí, aprobar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {devolviendo && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Devolver formato al operador</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>
              El troquel de <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formato.orden_numero}</strong> volverá
              a la lista de pendientes del operador para que corrija y reenvíe el formato.
            </div>
            <textarea
              className="input"
              style={{ width: '100%', minHeight: 70, resize: 'vertical', marginBottom: 16 }}
              placeholder="Motivo de la devolución (opcional)"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              maxLength={300}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setDevolviendo(false)} disabled={busy}>Cancelar</button>
              <button className="btn primary" onClick={devolver} disabled={busy}>
                {busy ? 'Devolviendo…' : 'Devolver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────── Página ───────────────

export default function TroquelRevision() {
  const navigate = useNavigate()
  const [pendientes, setPendientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)   // formato en revisión

  const loadPendientes = (silent = false) => {
    if (!silent) setLoading(true)
    return getFormatosPendientes()
      .then(d => setPendientes(asList(d)))
      .catch(() => setPendientes([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadPendientes() }, [])

  // Tiempo real: refrescar la cola solo cuando se está viendo la lista
  useSyncPolling({ formatos_pendientes: () => loadPendientes(true) }, { enabled: !sel })

  const volver = () => { setSel(null); loadPendientes() }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><div className="mod">Revisión de troqueles</div></div>
        <div className="topbar-right">
          <button className="btn" onClick={() => navigate('/produccion/troqueles')}><Icon.ArrowLeft /> Volver</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px', width: '100%' }}>
        {sel ? (
          <RevisionDetalle formato={sel} onVolver={volver} onResuelto={volver} />
        ) : (
          <ColaPendientes pendientes={pendientes} loading={loading} onRevisar={setSel} onReload={() => loadPendientes(true)} />
        )}
      </div>
    </div>
  )
}
