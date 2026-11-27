import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtNum, REMISION_STATUS_DEFS, LibreBadge } from '../components/core'
import { RegistroProcesoHistory } from '../components/RegistroProceso'
import {
  getRemisionablesCentral, previsualizarRemisionOperador, consolidarRemisionOperador,
  pdfRemisionOperadorConsolidada, getRemisionesGeneradasOperador, devolverRemisionOperador,
  descartarRemisionableOperador, cancelarEnvioFormato, getRegistrosProceso,
} from '../api'
import { useAuth } from '../context/AuthContext'
import { useSyncPolling } from '../lib/useSyncPolling'
import { saveBlob } from '../lib/download'
import { puedeRemisionesGenerales, puedeCorregirRegistros } from '../lib/accesoProduccion'

// Producción › Remisiones: one page for every exit — die tasks (Troqueles) and
// the rest of the production (it replaced Producción General). Same rules:
// one client per remisión, the PDF carries no prices, generated remisiones move
// to Historial. Before generating, the user sees exactly what the file will
// carry (POST previsualizar_remision_operador runs the real preparation and
// rolls it back).

const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const asList = (d) => Array.isArray(d) ? d : (d?.results || [])

const TIPO = {
  troquel: { label: 'Troquel', bg: '#FBE9DA', fg: '#8A3D12' },
  produccion: { label: 'Producción', bg: '#DCEFE3', fg: '#1F5C41' },
}

function fmtFecha(s) {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtFechaHora(s) {
  if (!s) return ''
  return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function TipoBadge({ tipo }) {
  const t = TIPO[tipo]
  if (!t) return null
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
      {t.label}
    </span>
  )
}

function Modal({ children, onClose, maxWidth = 900 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 12, maxWidth, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        {children}
      </div>
    </div>
  )
}

function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button className="btn sm" onClick={onClose}>Cerrar</button>
    </div>
  )
}

const blockStyle = { border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }
const blockHead = { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }
const th = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)' }
const td = { padding: '8px 12px', fontSize: 13, borderTop: '1px solid var(--line)', verticalAlign: 'top' }

// What the remisión PDF will carry, block by block (mirrors
// pdf_remision_operador.html: die consumption, production records, extras).
function ContenidoRemision({ preview }) {
  const { troqueles = [], procesos = [], complementary_processes: extras = [] } = preview
  return (
    <>
      {troqueles.map(t => (
        <div key={`t-${t.op_id}`} style={blockStyle}>
          <div style={blockHead}>
            <div>
              <TipoBadge tipo="troquel" />{' '}
              <strong style={{ fontSize: 13 }}>{t.referencia || 'Troquel'}</strong>{' '}
              <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{t.op_numero}</span>
              {t.operador_username && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                  Formato de cuchillas de <strong>{t.operador_username}</strong>{t.fecha_hora ? ` · ${fmtFechaHora(t.fecha_hora)}` : ''}
                </div>
              )}
            </div>
            <div style={{ fontSize: 13 }}><strong>Cantidad entregada:</strong> {t.cantidad}</div>
          </div>
          {t.consumos?.length ? (
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                <thead><tr><th style={th}>Concepto</th><th style={th}>Detalle</th><th style={{ ...th, textAlign: 'right' }}>Consumo</th></tr></thead>
                <tbody>
                  {t.consumos.map((c, i) => (
                    <tr key={i}>
                      <td style={td}>{c.concepto}</td>
                      <td style={{ ...td, color: 'var(--ink-2)' }}>{c.detalle}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>{c.cantidad} {c.unidad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--ink-3)' }}>Sin consumos registrados.</div>
          )}
          {t.observaciones && (
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--line)', fontSize: 13 }}>
              <strong>Observaciones del troquel:</strong> {t.observaciones}
            </div>
          )}
        </div>
      ))}

      {procesos.map(p => (
        <div key={`p-${p.op_id}`} style={blockStyle}>
          <div style={blockHead}>
            <div>
              <TipoBadge tipo="produccion" />{' '}
              <strong style={{ fontSize: 13 }}>{p.referencia || 'Producción'}</strong>{' '}
              <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{p.op_numero}</span>
            </div>
            <div style={{ fontSize: 13 }}><strong>Cantidad entregada:</strong> {p.cantidad_entregada}</div>
          </div>
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <thead><tr><th style={th}>Proceso</th><th style={th}>Especificación y observaciones</th><th style={{ ...th, textAlign: 'right' }}>Cantidad</th></tr></thead>
              <tbody>
                {p.items.map((it, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{it.proceso_label}</td>
                    <td style={{ ...td, color: 'var(--ink-2)' }}>
                      {(it.detalle || []).map((line, j) => <div key={j}>{line}</div>)}
                      {it.observaciones && <div style={{ marginTop: 4, color: 'var(--ink)' }}><strong>Observaciones:</strong> {it.observaciones}</div>}
                      {!it.detalle?.length && !it.observaciones && '—'}
                      {it.fecha_hora && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{fmtFechaHora(it.fecha_hora)}</div>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmtNum(it.cantidad_realizada)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {extras.length > 0 && (
        <div style={blockStyle}>
          <div style={blockHead}><strong style={{ fontSize: 13 }}>Procesos complementarios</strong></div>
          <ul style={{ margin: 0, padding: '10px 12px 10px 28px', fontSize: 13 }}>
            {extras.flatMap(g => g.items.map((d, i) => (
              <li key={`${g.op_numero}-${i}`}>{d} <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{g.op_numero}</span></li>
            )))}
          </ul>
        </div>
      )}
    </>
  )
}

function usePreview(ids) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const key = ids.join(',')
  useEffect(() => {
    let vivo = true
    setState({ loading: true, data: null, error: null })
    previsualizarRemisionOperador(key.split(',').map(Number))
      .then(data => { if (vivo) setState({ loading: false, data, error: null }) })
      .catch(e => { if (vivo) setState({ loading: false, data: null, error: e?.message || 'No se pudo armar la vista previa' }) })
    return () => { vivo = false }
  }, [key])
  return state
}

// "Ver registros": what this OP adds to the file, plus everything the plant
// logged on it (all station records, not only the latest per process).
function RegistrosModal({ op, onClose }) {
  const preview = usePreview([op.id])
  const [registros, setRegistros] = useState([])
  const [loadingReg, setLoadingReg] = useState(op.tipo === 'produccion')
  useEffect(() => {
    if (op.tipo !== 'produccion') return
    getRegistrosProceso(`?orden=${op.id}&ordering=fecha_hora`)
      .then(d => setRegistros(asList(d)))
      .catch(() => setRegistros([]))
      .finally(() => setLoadingReg(false))
  }, [op.id, op.tipo])

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title={<><span className="mono">{op.numero}</span> · Lo que va en la remisión</>}
        subtitle={`${op.cliente_nombre || '—'}${op.referencia ? ` · ${op.referencia}` : ''} · ${TIPO[op.tipo]?.label || ''}`}
        onClose={onClose}
      />
      <div style={{ overflow: 'auto', padding: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10 }}>
          Esto es exactamente lo que esta OP aporta al PDF de la remisión. Todavía no se ha generado nada.
        </div>
        {preview.loading ? <div style={{ padding: 16, color: 'var(--ink-3)' }}>Cargando…</div>
          : preview.error ? <div style={{ padding: 16, color: 'var(--danger, #c0392b)', fontSize: 13 }}>✗ {preview.error}</div>
          : <ContenidoRemision preview={preview.data} />}
        {op.tipo === 'produccion' && (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, margin: '18px 0 8px' }}>Todos los registros de planta</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
              Cada envío de los operarios en las estaciones. En el PDF va el último registro de cada proceso.
            </div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
              <RegistroProcesoHistory registros={registros} loading={loadingReg} showOrden={false} />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// Confirm step: the whole remisión as it will be generated.
function GenerarModal({ ops, busy, error, onClose, onConfirm }) {
  const preview = usePreview(ops.map(o => o.id))
  const nTroq = ops.filter(o => o.tipo === 'troquel').length
  const nProd = ops.length - nTroq
  const d = preview.data
  return (
    <Modal onClose={() => { if (!busy) onClose() }} maxWidth={960}>
      <ModalHeader
        title={d ? <>Remisión <span className="mono">{d.numero_estimado}</span> · revisión antes de generar</> : 'Revisión antes de generar'}
        subtitle={[nTroq && `${nTroq} ${nTroq === 1 ? 'troquel' : 'troqueles'}`, nProd && `${nProd} de producción`].filter(Boolean).join(' + ')}
        onClose={() => { if (!busy) onClose() }}
      />
      <div style={{ overflow: 'auto', padding: 16 }}>
        {preview.loading ? <div style={{ padding: 16, color: 'var(--ink-3)' }}>Armando la vista previa…</div>
          : preview.error ? <div style={{ padding: 16, color: 'var(--danger, #c0392b)', fontSize: 13 }}>✗ {preview.error}</div>
          : (
            <>
              <div style={{ ...blockStyle, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)' }}>Cliente</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{d.cliente.nombre}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>
                  {d.cliente.nit && <span><strong>NIT</strong> {d.cliente.nit}</span>}
                  {d.direccion && <span><strong>Dirección</strong> {d.direccion}</span>}
                  {d.cliente.telefono && <span><strong>Tel.</strong> {d.cliente.telefono}</span>}
                  {d.ciudad && <span><strong>Ciudad</strong> {d.ciudad}</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: 'var(--ink-2)', marginTop: 8 }}>
                  <span><strong>Fecha</strong> {fmtFecha(d.fecha)}</span>
                  <span><strong>N.º</strong> {d.numero_estimado} <span style={{ color: 'var(--ink-3)' }}>(se confirma al generar)</span></span>
                  <span><strong>OPs</strong> {d.ops.map(o => o.numero).join(', ')}</span>
                </div>
              </div>
              <ContenidoRemision preview={d} />
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                El PDF no lleva precios y tiene espacio para la firma del cliente. Al generarla, estas OPs salen de la lista y quedan en <strong>Historial</strong>, desde donde puedes volver a descargarla o devolverla mientras el administrador no la liquide.
              </div>
            </>
          )}
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {error && <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginRight: 'auto' }}>✗ {error}</span>}
        <button className="btn sm" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="btn sm primary" disabled={busy || !d} onClick={onConfirm}>
          {busy ? 'Generando…' : `Generar remisión y descargar PDF`}
        </button>
      </div>
    </Modal>
  )
}

function Historial() {
  const [lista, setLista] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    getRemisionesGeneradasOperador()
      .then(d => setLista(asList(d)))
      .catch(e => setError(e?.message || 'No se pudo cargar el historial'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useSyncPolling({ remisiones: () => cargar(true) })

  const filtrada = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return lista
    return lista.filter(r => [r.numero, r.cliente_nombre, ...(r.ops || []).flatMap(o => [o.numero, o.referencia])].some(v => norm(v).includes(t)))
  }, [lista, busqueda])

  const pdf = async (rem) => {
    setBusy(rem.id); setError(null)
    try {
      const r = await pdfRemisionOperadorConsolidada(rem.id)
      if (!r.ok) { const b = await r.json().catch(() => null); throw new Error(b?.error || `HTTP ${r.status}`) }
      const nombre = (r.headers.get('Content-Disposition') || '').match(/filename="(.+?)"/)?.[1]
      saveBlob(await r.blob(), nombre || 'Remision.pdf')
    } catch (e) { setError(e?.message || 'No se pudo generar el PDF') } finally { setBusy(null) }
  }

  const devolver = async (rem) => {
    if (!window.confirm(`¿Devolver ${rem.numero}?\n\nSus OPs vuelven a la lista «Por remisionar» y podrás generarla de nuevo.`)) return
    setBusy(rem.id); setError(null)
    try { await devolverRemisionOperador(rem.id); cargar() } catch (e) { setError(e?.message || 'No se pudo devolver') } finally { setBusy(null) }
  }

  return (
    <div className="section">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ position: 'relative', maxWidth: 420 }}>
          <input className="input" placeholder="Buscar por remisión, cliente, OP, referencia…" value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ paddingLeft: 32 }} />
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}><Icon.Search /></span>
        </div>
        {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger, #c0392b)' }}>✗ {error}</div>}
      </div>
      {loading ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
        : filtrada.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>{busqueda.trim() ? `Sin resultados para «${busqueda.trim()}»` : 'Aún no hay remisiones generadas.'}</div>
        : (
          <div className="table-scroll">
            <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)', background: 'var(--surface-2)' }}>
                  {['Remisión', 'Fecha', 'Cliente', 'Contenido', 'Generada por', 'Estado', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtrada.map((rem, idx) => {
                  const def = REMISION_STATUS_DEFS.find(s => s.id === rem.estado)
                  return (
                    <tr key={rem.id} style={{ background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)' }}>
                      <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{rem.numero || '—'}</td>
                      <td style={{ ...td, fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{fmtFecha(rem.generada_en || rem.fecha)}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{rem.cliente_nombre || '—'}</td>
                      <td style={{ ...td, color: 'var(--ink-2)' }}>
                        <TipoBadge tipo={rem.is_production ? 'produccion' : 'troquel'} />{' '}
                        {(rem.ops || []).map(o => o.numero).join(', ')}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: 'var(--ink-2)' }}>{rem.generada_por_username || '—'}</td>
                      <td style={td}>{def && <span className={'badge ' + def.cls}><span className="dot"></span>{def.label}</span>}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn sm" disabled={busy === rem.id} onClick={() => pdf(rem)}>PDF</button>
                        {rem.estado === 'pendiente' && <button className="btn sm" style={{ marginLeft: 6 }} disabled={busy === rem.id} onClick={() => devolver(rem)}>Devolver</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

export default function RemisionesCentral() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const veProduccion = puedeRemisionesGenerales(user)
  const [tab, setTab] = useState('pendientes') // 'pendientes' | 'historial'
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [sel, setSel] = useState([])
  const [verOp, setVerOp] = useState(null)
  const [confirmar, setConfirmar] = useState(false)
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState(null)
  const [aviso, setAviso] = useState(null) // { tipo: 'ok'|'error', texto, irHistorial? }
  const [accionBusy, setAccionBusy] = useState(null)

  const cargar = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    setLoadError(null)
    getRemisionablesCentral()
      .then(d => {
        const lista = asList(d)
        setFilas(lista)
        // Drop selected OPs that are no longer in the queue.
        setSel(prev => prev.filter(id => lista.some(f => f.id === id)))
      })
      .catch(e => setLoadError(e?.message || 'No se pudo cargar la lista'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { cargar() }, [cargar])
  // Coming back from Historial (where a remisión may have been returned).
  useEffect(() => { if (tab === 'pendientes') cargar(true) }, [tab, cargar])
  useSyncPolling({ remisiones: () => cargar(true), registros_proceso: () => cargar(true) })

  const seleccionadas = filas.filter(f => sel.includes(f.id))
  const clienteSel = seleccionadas[0]?.cliente_id ?? null

  const filtradas = useMemo(() => {
    const t = norm(busqueda.trim())
    return filas.filter(op =>
      (filtroTipo === 'todos' || op.tipo === filtroTipo)
      && (!t || [op.numero, op.cliente_nombre, op.referencia].some(v => norm(v).includes(t))))
  }, [filas, busqueda, filtroTipo])

  const grupos = useMemo(() => {
    const map = new Map()
    for (const op of filtradas) {
      if (!map.has(op.cliente_id)) map.set(op.cliente_id, { cliente_id: op.cliente_id, cliente_nombre: op.cliente_nombre, ops: [] })
      map.get(op.cliente_id).ops.push(op)
    }
    return [...map.values()]
  }, [filtradas])

  const toggle = (op) => {
    setAviso(null)
    setSel(prev => {
      if (clienteSel !== null && op.cliente_id !== clienteSel) return [op.id]
      return prev.includes(op.id) ? prev.filter(x => x !== op.id) : [...prev, op.id]
    })
  }

  const toggleCliente = (g) => {
    setAviso(null)
    const ids = g.ops.map(o => o.id)
    const todas = ids.every(id => sel.includes(id))
    setSel(todas ? [] : ids)
  }

  const generar = async () => {
    setGenBusy(true); setGenError(null)
    try {
      const { remision_id, remision_numero } = await consolidarRemisionOperador(seleccionadas.map(o => o.id))
      // From here on the remisión exists: a failed download must not look
      // like a failed generation.
      setConfirmar(false); setSel([]); cargar()
      try {
        const r = await pdfRemisionOperadorConsolidada(remision_id)
        if (!r.ok) { const b = await r.json().catch(() => null); throw new Error(b?.error || `HTTP ${r.status}`) }
        const nombre = (r.headers.get('Content-Disposition') || '').match(/filename="(.+?)"/)?.[1]
        saveBlob(await r.blob(), nombre || `Remision_${remision_numero}.pdf`)
        setAviso({ tipo: 'ok', texto: <>Remisión <strong>{remision_numero}</strong> generada y descargada.</>, irHistorial: true })
      } catch (e) {
        setAviso({ tipo: 'error', texto: <>Remisión <strong>{remision_numero}</strong> generada, pero el PDF no se descargó ({e?.message || 'error de descarga'}). Descárgalo desde Historial.</>, irHistorial: true })
      }
    } catch (e) {
      setGenError(e?.message || 'No se pudo generar la remisión')
    } finally {
      setGenBusy(false)
    }
  }

  // Die task back to the die maker: same as "Cancelar envío" in Troqueles.
  const devolver = async (op) => {
    if (!window.confirm(`¿Devolver ${op.numero} para corregir su formato de cuchillas?\n\nSale de esta lista y vuelve a Troqueles › Pendientes como borrador. Cuando se reenvíe, volverá a aparecer aquí.`)) return
    setAccionBusy(op.id); setAviso(null)
    try {
      await cancelarEnvioFormato(op.formato_id)
      setAviso({ tipo: 'ok', texto: <><strong>{op.numero}</strong> devuelta: corrígela en Troqueles › Pendientes.</>, irTroqueles: true })
      cargar()
    } catch (e) {
      setAviso({ tipo: 'error', texto: e?.message || 'No se pudo devolver la OP' })
    } finally { setAccionBusy(null) }
  }

  // Does not delete anything: only drops the OP from this list (same endpoint
  // as the Descartar link in Troqueles).
  const descartar = async (op) => {
    if (!window.confirm(`¿Descartar ${op.numero}?\n\nEsto NO genera la remisión ni la envía a nadie: solo la quita de esta lista y quedará a cargo del administrador.\n\nPara remisionarla, cancela, márcala y usa «Revisar y generar».`)) return
    setAccionBusy(op.id); setAviso(null)
    try { await descartarRemisionableOperador(op.id); cargar() }
    catch (e) { setAviso({ tipo: 'error', texto: e?.message || 'No se pudo descartar' }) }
    finally { setAccionBusy(null) }
  }

  const nTroqSel = seleccionadas.filter(o => o.tipo === 'troquel').length
  const nProdSel = seleccionadas.length - nTroqSel
  const conteo = { todos: filas.length, troquel: filas.filter(f => f.tipo === 'troquel').length, produccion: filas.filter(f => f.tipo === 'produccion').length }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><div className="mod">Remisiones</div></div>
        <button className="btn" onClick={() => navigate('/produccion')}><Icon.ArrowLeft /> Producción</button>
      </div>

      <div style={{ padding: 'clamp(16px, 3vw, 28px)', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className={`btn sm${tab === 'pendientes' ? ' primary' : ''}`} onClick={() => setTab('pendientes')}>Por remisionar</button>
          <button className={`btn sm${tab === 'historial' ? ' primary' : ''}`} onClick={() => setTab('historial')}>Historial</button>
        </div>

        {tab === 'historial' ? <Historial /> : (
          <div className="section">
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
              Salidas de {veProduccion ? <><strong>troqueles</strong> y <strong>producción</strong></> : <strong>troqueles</strong>} en un solo lugar.
              Marca las OPs de <strong>un mismo cliente</strong>, revisa lo que va a salir en el PDF y genera la remisión.
              Con <strong>Ver registros</strong> ves lo que cada OP aporta al archivo antes de generarlo.
            </div>

            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
                <input className="input" placeholder="Buscar por número, cliente, referencia…" value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ paddingLeft: 32 }} />
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}><Icon.Search /></span>
              </div>
              {veProduccion && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[['todos', 'Todo'], ['troquel', 'Troqueles'], ['produccion', 'Producción']].map(([id, label]) => (
                    <button key={id} className={`btn sm${filtroTipo === id ? ' primary' : ''}`} onClick={() => setFiltroTipo(id)}>
                      {label} ({conteo[id]})
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ position: 'sticky', top: 0, zIndex: 5, padding: '10px 16px', borderBottom: '1px solid var(--line)', background: seleccionadas.length ? 'var(--accent-soft, #eef4fd)' : 'var(--surface)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              {seleccionadas.length ? (
                <div style={{ fontSize: 13, minWidth: 0 }}>
                  <strong>{seleccionadas[0].cliente_nombre}</strong> · {seleccionadas.length} {seleccionadas.length === 1 ? 'OP' : 'OPs'}
                  {' '}({[nTroqSel && `${nTroqSel} ${nTroqSel === 1 ? 'troquel' : 'troqueles'}`, nProdSel && `${nProdSel} de producción`].filter(Boolean).join(' + ')})
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{seleccionadas.map(o => o.numero).join(', ')}</div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Marca una o varias OPs de un mismo cliente.</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {seleccionadas.length > 0 && <button className="btn sm" onClick={() => setSel([])}>Quitar selección</button>}
                <button className="btn sm primary" disabled={!seleccionadas.length} onClick={() => { setGenError(null); setConfirmar(true) }}>
                  Revisar y generar remisión
                </button>
              </div>
            </div>

            {aviso && (
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, color: aviso.tipo === 'ok' ? 'var(--ok, #2e7d32)' : 'var(--danger, #c0392b)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span>{aviso.tipo === 'ok' ? '✓ ' : '✗ '}{aviso.texto}</span>
                {aviso.irHistorial && <button className="btn sm" onClick={() => { setAviso(null); setTab('historial') }}>Ver en Historial</button>}
                {aviso.irTroqueles && <button className="btn sm" onClick={() => navigate('/produccion/troqueles')}>Ir a Troqueles</button>}
              </div>
            )}

            {loading ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
              : loadError ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger, #c0392b)', fontSize: 13 }}>
                  ✗ {loadError}<div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => cargar()}>Reintentar</button></div>
                </div>
              )
              : grupos.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
                  {busqueda.trim() ? `Sin resultados para «${busqueda.trim()}»` : 'No hay OPs pendientes de remisión.'}
                </div>
              ) : grupos.map(g => {
                const bloqueado = clienteSel !== null && g.cliente_id !== clienteSel
                const todas = g.ops.every(o => sel.includes(o.id))
                return (
                  <div key={g.cliente_id} style={{ opacity: bloqueado ? 0.5 : 1 }}>
                    <div style={{ padding: '8px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <input type="checkbox" checked={todas} onChange={() => toggleCliente(g)} title="Marcar todas las OPs de este cliente" />
                      <strong style={{ fontSize: 13 }}>{g.cliente_nombre || '—'}</strong>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{g.ops.length} {g.ops.length === 1 ? 'OP' : 'OPs'}</span>
                      {bloqueado && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>· otro cliente, no entra en esta remisión</span>}
                    </div>
                    {/* OP rows stay plain: the shaded band is reserved for client names. */}
                    {g.ops.map(op => (
                      <div key={op.id} onClick={() => toggle(op)} style={{
                        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '10px 16px',
                        borderBottom: '1px solid var(--line)', background: sel.includes(op.id) ? 'var(--accent-soft, #eef4fd)' : 'var(--surface)', cursor: 'pointer',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 320px', minWidth: 0 }}>
                          <input type="checkbox" checked={sel.includes(op.id)} onChange={() => toggle(op)} onClick={e => e.stopPropagation()} />
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>{op.numero}</span>
                          <TipoBadge tipo={op.tipo} />
                          <span style={{ color: 'var(--ink-2)', fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {op.referencia}{op.origen === 'registro_libre' && <LibreBadge />}
                          </span>
                          <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}
                            title={op.tipo === 'troquel' ? 'Unidades del producto en la OP; el troquel se entrega como 1' : 'Unidades de la OP'}>
                            {fmtNum(op.cantidad)} uds
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
                          <button className="btn sm" onClick={() => setVerOp(op)} title="Ver lo que esta OP aporta a la remisión (no genera nada)">Ver registros</button>
                          {op.tipo === 'troquel' && op.formato_id && puedeCorregirRegistros(user) && (
                            <button className="btn sm" disabled={accionBusy === op.id} onClick={() => devolver(op)} title="Devolver el formato de cuchillas para corregirlo">
                              Devolver
                            </button>
                          )}
                          <button className="btn sm ghost" style={{ color: 'var(--ink-3)', textDecoration: 'underline', fontWeight: 400 }}
                            disabled={accionBusy === op.id} onClick={() => descartar(op)} title="Quitarla de la lista sin remisionarla (no genera ni envía nada)">
                            Descartar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
          </div>
        )}
      </div>

      {verOp && <RegistrosModal op={verOp} onClose={() => setVerOp(null)} />}
      {confirmar && (
        <GenerarModal ops={seleccionadas} busy={genBusy} error={genError}
          onClose={() => { setConfirmar(false); setGenError(null) }} onConfirm={generar} />
      )}
    </div>
  )
}
