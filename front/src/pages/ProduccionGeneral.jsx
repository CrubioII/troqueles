import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtNum, ProgressBar, Checkbox } from '../components/core'
import { getOrdenes, getOrden, toggleProcesoCompletado } from '../api'
import { usePolling } from '../lib/usePolling'

const PROCESO_LABELS = {
  impresion: 'Impresión',
  laminado: 'Laminado',
  uvTotal: 'UV total',
  uvParcial: 'UV parcial',
  uvReserva: 'UV reserva',
  estampado: 'Estampado',
  troquel: 'Troquel',
  troquelado: 'Troquelado',
  positivo: 'Positivo',
  muestra: 'Muestra',
  terminado: 'Terminado',
  diseno: 'Diseño',
  pegante: 'Pegante',
  tinta: 'Tinta',
  cajas: 'Cajas',
  envio: 'Envío',
  recogida: 'Recogida',
  otros: 'Otros',
}

function Skeleton() {
  return (
    <div style={{ padding: '32px 0' }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{
          height: 52, marginBottom: 1,
          background: 'var(--surface-2)',
          borderRadius: 4,
          animation: 'pulse 1.4s ease-in-out infinite',
          animationDelay: `${i * 0.1}s`,
        }} />
      ))}
    </div>
  )
}

function ChecklistRow({ ordId, proceso, onToggled }) {
  const [busy, setBusy] = useState(false)

  const handleToggle = () => {
    if (busy) return
    setBusy(true)
    toggleProcesoCompletado(ordId, proceso.proceso_id, !proceso.completado)
      .then(updated => onToggled(proceso.proceso_id, updated.completado))
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <Checkbox checked={proceso.completado} onChange={handleToggle} />
      <span style={{ fontSize: 13, color: proceso.completado ? 'var(--ink-3)' : 'var(--ink)', textDecoration: proceso.completado ? 'line-through' : 'none' }}>
        {PROCESO_LABELS[proceso.proceso_id] || proceso.proceso_id}
      </span>
    </div>
  )
}

function ExpandedDetail({ ordId, onProgresoChange }) {
  const [procesos, setProcesos] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getOrden(ordId)
      .then(data => setProcesos((data.procesos || []).filter(p => p.active)))
      .catch(() => setProcesos([]))
      .finally(() => setLoading(false))
  }, [ordId])

  const handleToggled = (procesoId, completado) => {
    setProcesos(prev => {
      const next = prev.map(p => p.proceso_id === procesoId ? { ...p, completado } : p)
      onProgresoChange(ordId, next.filter(p => p.completado).length, next.length)
      return next
    })
  }

  if (loading) return <div style={{ padding: '8px 16px', color: 'var(--ink-3)', fontSize: 12 }}>Cargando procesos…</div>
  if (!procesos.length) return <div style={{ padding: '8px 16px', color: 'var(--ink-3)', fontSize: 12 }}>Esta OP no tiene procesos activos</div>

  return (
    <div style={{ padding: '8px 16px 14px' }}>
      {procesos.map(p => (
        <ChecklistRow key={p.proceso_id} ordId={ordId} proceso={p} onToggled={handleToggled} />
      ))}
    </div>
  )
}

export default function ProduccionGeneral() {
  const navigate = useNavigate()

  const [ordenes, setOrdenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [nextPage, setNextPage] = useState(null)
  const [prevPage, setPrevPage] = useState(null)
  const [count, setCount] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const debounceRef = useRef(null)
  const paramsRef = useRef('')

  const load = (params = '', initial = false) => {
    paramsRef.current = params
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    getOrdenes(params)
      .then(data => {
        if (Array.isArray(data)) {
          setOrdenes(data)
          setCount(data.length)
          setNextPage(null)
          setPrevPage(null)
        } else {
          setOrdenes(data.results || [])
          setCount(data.count || 0)
          setNextPage(data.next || null)
          setPrevPage(data.previous || null)
        }
      })
      .catch(e => setError(e.message))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => { load('', true) }, [])

  usePolling(() => load(paramsRef.current))

  const handleSearch = (v) => {
    setSearch(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      load(v ? `?search=${encodeURIComponent(v)}` : '')
    }, 350)
  }

  const handleProgresoChange = (ordId, completados, total) => {
    setOrdenes(prev => prev.map(o => o.id === ordId ? { ...o, progreso: { ...o.progreso, completados, total } } : o))
  }

  const goPage = (url) => {
    if (!url) return
    const rel = url.replace(/^https?:\/\/[^/]+/, '')
    const params = rel.replace('/api/ordenes', '')
    load(params)
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="mod">Producción General</div>
        </div>
        <div className="topbar-right">
          <button className="btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/produccion'))}>
            <Icon.ArrowLeft /> Volver
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px', width: '100%' }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <input
              className="input"
              placeholder="Buscar por número, cliente, referencia…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
              <Icon.Search />
            </span>
          </div>
        </div>

        {refreshing && (
          <div style={{ height: 2, background: 'var(--accent)', borderRadius: 1, marginBottom: 12, animation: 'pulse 1s ease-in-out infinite' }} />
        )}

        <div className="section">
          {loading ? <Skeleton /> : error ? (
            <div className="note" style={{ margin: 16 }}>Error: {error}</div>
          ) : ordenes.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>
              No hay órdenes de producción
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)' }}>
                  {['', 'OP #', 'Fecha', 'Cliente', 'Referencia', 'Cantidad', 'Progreso'].map((h, i) => (
                    <th key={i} style={{
                      padding: '10px 12px', textAlign: 'left',
                      fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.04em', color: 'var(--ink-3)',
                      background: 'var(--surface-2)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordenes.map((ord, idx) => {
                  const isExpanded = expanded === ord.id
                  return (
                    <Fragment key={ord.id}>
                      <tr
                        style={{
                          borderBottom: isExpanded ? 'none' : '1px solid var(--line)',
                          background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setExpanded(isExpanded ? null : ord.id)}
                      >
                        <td style={{ padding: '10px 12px', width: 24 }}>
                          <span style={{ display: 'inline-flex', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s', color: 'var(--ink-3)' }}>
                            <Icon.Chev />
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12 }}>
                          {ord.numero}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)' }}>{ord.fecha}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{ord.cliente_nombre}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--ink-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ord.referencia}
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                          {fmtNum(ord.cantidad)}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {ord.progreso ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <ProgressBar pct={ord.progreso.porcentaje} />
                              <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                                {ord.progreso.completados}/{ord.progreso.total}
                              </span>
                            </div>
                          ) : <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Sin procesos</span>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderBottom: '1px solid var(--line)', background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)' }}>
                          <td colSpan={7} style={{ padding: 0 }} onClick={e => e.stopPropagation()}>
                            <ExpandedDetail ordId={ord.id} onProgresoChange={handleProgresoChange} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {(prevPage || nextPage) && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
            <button className="btn" disabled={!prevPage} onClick={() => goPage(prevPage)}>← Anterior</button>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtNum(count)} total</span>
            <button className="btn" disabled={!nextPage} onClick={() => goPage(nextPage)}>Siguiente →</button>
          </div>
        )}

        {!loading && !refreshing && ordenes.length > 0 && !nextPage && !prevPage && (
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: 'var(--ink-3)' }}>
            {fmtNum(count)} orden{count !== 1 ? 'es' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
