import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum } from '../components/core'
import { getOrdenes, deleteOrden } from '../api'
import { useAuth } from '../context/AuthContext'
import { useSyncPolling } from '../lib/useSyncPolling'

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
  const [nextPage, setNextPage] = useState(null)
  const [prevPage, setPrevPage] = useState(null)
  const [count, setCount] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(null)
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

  useSyncPolling({ ordenes: () => load(paramsRef.current) }, { enabled: confirmDelete == null })

  const handleSearch = (v) => {
    setSearch(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      load(v ? `?search=${encodeURIComponent(v)}` : '')
    }, 350)
  }

  const handleDelete = (e, ord) => {
    e.stopPropagation()
    if (confirmDelete === ord.id) {
      setOrdenes(prev => prev.filter(o => o.id !== ord.id))
      setConfirmDelete(null)
      deleteOrden(ord.id).catch(() => {
        setOrdenes(prev => [ord, ...prev])
      })
    } else {
      setConfirmDelete(ord.id)
    }
  }

  const goPage = (url) => {
    if (!url) return
    const rel = url.replace(/^https?:\/\/[^/]+/, '')
    const params = rel.replace('/api/ordenes', '')
    load(params)
  }

  return (
    <div className="app" onClick={() => setConfirmDelete(null)}>
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
        </div>

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
                  {['OP #', 'Fecha', 'Cliente', 'Referencia', 'Cantidad', 'Valor total', 'Abono', 'Saldo', 'Origen', ''].map((h, i) => (
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
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)' }}>{ord.fecha}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{ord.cliente_nombre}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--ink-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ord.referencia}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      {fmtNum(ord.cantidad)}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      {fmtCOP(ord.valor_total_efectivo)}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--ink-2)' }}>
                      {fmtCOP(ord.abono)}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: ord.saldo > 0 ? 'var(--danger, #c0392b)' : 'var(--ok, #27ae60)' }}>
                      {fmtCOP(ord.saldo)}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {ord.cotizacion_numero ? (
                        <span className="badge converted"><span className="dot"></span>{ord.cotizacion_numero}</span>
                      ) : (
                        <span className="badge draft"><span className="dot"></span>Directa</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => navigate(`/ordenes/${ord.id}`)}
                        >Abrir</button>
                        {isAdmin && (
                          <button
                            className={'btn' + (confirmDelete === ord.id ? ' danger' : '')}
                            style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={e => handleDelete(e, ord)}
                          >
                            {confirmDelete === ord.id ? '¿Eliminar?' : 'Eliminar'}
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
