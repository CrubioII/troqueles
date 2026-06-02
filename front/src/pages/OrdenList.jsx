import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, OP_STATUS_DEFS } from '../components/core'
import { getOrdenes, deleteOrden, anularOrden } from '../api'
import { useAuth } from '../context/AuthContext'

const STATUS_ALL = { id: '', label: 'Todos', cls: '' }

function OpBadge({ estado }) {
  const def = OP_STATUS_DEFS.find(s => s.id === estado)
  if (!def) return null
  return (
    <span className={'badge ' + def.cls}>
      <span className="dot"></span>
      {def.label}
    </span>
  )
}

function ProgressBar({ value, warn }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div className="op-progress-track" style={{ width: 60 }}>
        <div
          className={'op-progress-fill' + (warn ? ' warn' : '')}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', minWidth: 28 }}>{value}%</span>
    </div>
  )
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

export default function OrdenList() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [ordenes, setOrdenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [nextPage, setNextPage] = useState(null)
  const [prevPage, setPrevPage] = useState(null)
  const [count, setCount] = useState(0)
  const [confirmAction, setConfirmAction] = useState(null)
  const debounceRef = useRef(null)

  const load = (params = '', initial = false) => {
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

  const buildParams = (s, st) => {
    const parts = []
    if (s) parts.push(`search=${encodeURIComponent(s)}`)
    if (st) parts.push(`estado=${encodeURIComponent(st)}`)
    return parts.length ? '?' + parts.join('&') : ''
  }

  const applyFilters = (s, st) => load(buildParams(s, st))

  const handleSearch = (v) => {
    setSearch(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => applyFilters(v, statusFilter), 350)
  }

  const handleStatus = (st) => {
    setStatusFilter(st)
    applyFilters(search, st)
  }

  const handleAnular = (e, ord) => {
    e.stopPropagation()
    if (confirmAction === `anular-${ord.id}`) {
      setOrdenes(prev => prev.map(o => o.id === ord.id ? { ...o, estado: 'anulada' } : o))
      setConfirmAction(null)
      anularOrden(ord.id).catch(() => {
        setOrdenes(prev => prev.map(o => o.id === ord.id ? ord : o))
      })
    } else {
      setConfirmAction(`anular-${ord.id}`)
    }
  }

  const goPage = (url) => {
    if (!url) return
    const rel = url.replace(/^https?:\/\/[^/]+/, '')
    const params = rel.replace('/api/ordenes', '')
    load(params)
  }

  const clearConfirm = () => setConfirmAction(null)

  return (
    <div className="app" onClick={clearConfirm}>
      <div className="topbar">
        <div className="brand">
          <div className="mod">Órdenes de Producción</div>
        </div>
        <div className="topbar-right">
          {isAdmin && (
            <button className="btn accent" onClick={() => navigate('/ordenes/nuevo')}>
              + Nueva OP
            </button>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px' }}>
        {/* Toolbar */}
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

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[STATUS_ALL, ...OP_STATUS_DEFS].map(s => (
              <span
                key={s.id}
                className={'badge ' + s.cls + (statusFilter === s.id ? ' active' : '')}
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={e => { e.stopPropagation(); handleStatus(s.id) }}
              >
                {s.id && <span className="dot"></span>}
                {s.label}
              </span>
            ))}
          </div>

        </div>

        {/* Progress bar on refresh */}
        {refreshing && (
          <div style={{ height: 2, background: 'var(--accent)', borderRadius: 1, marginBottom: 12, animation: 'pulse 1s ease-in-out infinite' }} />
        )}

        {/* Table */}
        <div className="section">
          {loading ? <Skeleton /> : error ? (
            <div className="note" style={{ margin: 16 }}>Error: {error}</div>
          ) : ordenes.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <div>No hay órdenes de producción</div>
              {isAdmin && (
                <button className="btn accent" style={{ marginTop: 16 }} onClick={() => navigate('/ordenes/nuevo')}>
                  <Icon.Plus /> Crear primera OP
                </button>
              )}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)' }}>
                  {['OP #', 'Fecha', 'Cliente', 'Referencia', 'Estado', 'Progreso proc.', 'Unidades', 'Valor total', 'Saldo', 'Cond. pago', ''].map((h, i) => (
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
                {ordenes.map((ord, idx) => (
                  <tr
                    key={ord.id}
                    style={{
                      borderBottom: '1px solid var(--line)',
                      background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onClick={() => navigate(`/ordenes/${ord.id}`)}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft)'}
                    onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12 }}>
                      {ord.numero}
                      {ord.cotizacion_numero && (
                        <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 400 }}>← {ord.cotizacion_numero}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)' }}>{ord.fecha}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{ord.cliente_nombre}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--ink-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ord.referencia}
                    </td>
                    <td style={{ padding: '10px 12px' }}><OpBadge estado={ord.estado} /></td>
                    <td style={{ padding: '10px 12px' }}>
                      <ProgressBar value={ord.progreso_procesos} warn={false} />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <ProgressBar value={ord.progreso_unidades} warn={false} />
                      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>unidades</div>
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      {fmtCOP(ord.valor_total)}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: ord.saldo > 0 ? 'var(--ok)' : 'var(--ink-3)' }}>
                      {fmtCOP(ord.saldo)}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--ink-3)' }}>
                      {ord.condicion_pago?.replace('_', ' ')}
                    </td>
                    <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => navigate(`/ordenes/${ord.id}`)}
                        >Abrir</button>
                        {isAdmin && ord.estado !== 'anulada' && (
                          <button
                            className={'btn' + (confirmAction === `anular-${ord.id}` ? ' danger' : '')}
                            style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={e => handleAnular(e, ord)}
                          >
                            {confirmAction === `anular-${ord.id}` ? '¿Anular?' : 'Anular'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
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
