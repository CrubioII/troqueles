import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtNum, STATUS_DEFS } from '../components/core'
import { getCotizaciones, deleteCotizacion } from '../api'
import { useAuth } from '../context/AuthContext'

const TAB_DEFS = [
  { id: 'cotizaciones', label: 'Cotizaciones' },
]

const STATUS_ALL = { id: '', label: 'Todos', cls: '' }

function StatusBadge({ estado }) {
  const def = STATUS_DEFS.find(s => s.id === estado)
  if (!def) return null
  return (
    <span className={'badge ' + def.cls}>
      <span className="dot"></span>
      {def.label}
    </span>
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

export default function CotizacionList() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState('cotizaciones')
  const [cotizaciones, setCotizaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [nextPage, setNextPage] = useState(null)
  const [prevPage, setPrevPage] = useState(null)
  const [count, setCount] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const debounceRef = useRef(null)

  const load = (params = '', initial = false) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    getCotizaciones(params)
      .then(data => {
        if (Array.isArray(data)) {
          setCotizaciones(data)
          setCount(data.length)
          setNextPage(null)
          setPrevPage(null)
        } else {
          setCotizaciones(data.results || [])
          setCount(data.count || 0)
          setNextPage(data.next || null)
          setPrevPage(data.previous || null)
        }
      })
      .catch(e => setError(e.message))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => {
    load('', true)
  }, [])

  const buildParams = (s, st) => {
    const parts = []
    if (s) parts.push(`search=${encodeURIComponent(s)}`)
    if (st) parts.push(`estado=${encodeURIComponent(st)}`)
    return parts.length ? '?' + parts.join('&') : ''
  }

  const applyFilters = (s, st) => {
    load(buildParams(s, st))
  }

  const handleSearch = (v) => {
    setSearch(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => applyFilters(v, statusFilter), 350)
  }

  const handleStatus = (st) => {
    setStatusFilter(st)
    applyFilters(search, st)
  }

  const handleDelete = (e, cot) => {
    e.stopPropagation()
    if (confirmDelete === cot.id) {
      // Optimistic: remove immediately, fire API in background
      setCotizaciones(prev => prev.filter(c => c.id !== cot.id))
      setCount(prev => prev - 1)
      setConfirmDelete(null)
      deleteCotizacion(cot.id).catch(() => {
        // Rollback on failure
        setCotizaciones(prev => [...prev, cot].sort((a, b) => b.id - a.id))
        setCount(prev => prev + 1)
      })
    } else {
      setConfirmDelete(cot.id)
    }
  }

  const goPage = (url) => {
    if (!url) return
    const rel = url.replace(/^https?:\/\/[^/]+/, '')
    const params = rel.replace('/api/cotizaciones', '')
    load(params)
  }

  const fmtFecha = (str) => {
    if (!str) return '—'
    const d = new Date(str)
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const filters = [STATUS_ALL, ...STATUS_DEFS]

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <div className="mark">TI</div>
          <div className="biz">Troqueles INK</div>
          <span className="div">/</span>
          <div className="mod">Cotizaciones</div>
        </div>
        <div className="topbar-right">
          <button
            className="btn"
            style={{ fontSize: 12 }}
            onClick={() => navigate('/ordenes')}
          >
            Producción
          </button>
          <div className="userchip">
            <div className="av">{user?.username?.slice(0, 2).toUpperCase()}</div>
            <div>
              <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{user?.username}</div>
              <div className="role">{isAdmin ? 'Administrador' : 'Operador'}</div>
            </div>
          </div>
          <button
            className="btn"
            style={{ padding: '4px 10px', fontSize: 11 }}
            onClick={logout}
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </div>

      {/* List workspace */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
          {TAB_DEFS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id)
              }}
              style={{
                padding: '7px 16px', fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
                color: tab === t.id ? 'var(--accent)' : 'var(--ink-3)',
                background: 'none', border: 'none',
                borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer', marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
              Listado de cotizaciones
            </h1>
            {!loading && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                {count} {count === 1 ? 'cotización' : 'cotizaciones'}
              </div>
            )}
          </div>
{isAdmin && (
          <button
            className="btn accent"
            onClick={() => navigate('/cotizaciones/nuevo')}
          >
            <Icon.Plus /> Nueva cotización
          </button>
          )}
        </div>

        {/* Search + filter bar */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="input-affix" style={{ flex: '1 1 240px', maxWidth: 380 }}>
            <input
              className="input"
              style={{ paddingLeft: 34 }}
              placeholder="Buscar por número, cliente, referencia…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', pointerEvents: 'none' }}>
              <Icon.Search />
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {filters.map(f => (
              <button
                key={f.id}
                type="button"
                className={'chip-toggle' + (statusFilter === f.id ? ' active' : '')}
                onClick={() => handleStatus(f.id)}
              >
                {f.id ? <><span className={'dot badge ' + f.cls} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginRight: 5, padding: 0 }}></span>{f.label}</> : f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="note" style={{ marginBottom: 16, color: 'var(--danger, #c0392b)' }}>
            <Icon.Info /> Error al cargar: {error}. ¿Está el servidor corriendo?
          </div>
        )}

        {/* Table */}
        <div className="section open" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
          {refreshing && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 10,
              background: 'var(--accent)', borderRadius: 2,
              animation: 'progress-bar 0.8s ease-in-out infinite',
            }} />
          )}
          {loading ? (
            <div style={{ padding: '0 20px' }}><Skeleton /></div>
          ) : cotizaciones.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin cotizaciones</div>
              <div style={{ fontSize: 12 }}>
                {search || statusFilter ? 'Ninguna coincide con los filtros actuales.' : 'Aún no hay cotizaciones creadas.'}
              </div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  {['N°', 'Fecha', 'Cliente', 'Referencia', 'Cantidad', 'Estado', ''].map((h, i) => (
                    <th key={i} style={{
                      padding: '10px 16px', textAlign: i >= 4 ? 'center' : 'left',
                      fontWeight: 600, fontSize: 11, color: 'var(--ink-3)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cotizaciones.map((cot, idx) => (
                  <tr
                    key={cot.id}
                    onClick={() => navigate(`/cotizaciones/${cot.id}`)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)'}
                  >
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                      <span className="mono" style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 12 }}>
                        {cot.numero || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', color: 'var(--ink-3)', fontSize: 12 }}>
                      {fmtFecha(cot.fecha)}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--ink)', maxWidth: 200 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cot.cliente_nombre || '—'}
                      </div>
                      {cot.tipo_cliente === 'terciario' && (
                        <span style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 400 }}>Terciario</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--ink-2)', maxWidth: 280 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cot.referencia || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {fmtNum(cot.cantidad)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <StatusBadge estado={cot.estado} />
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
                        <button
                          className="btn"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={e => { e.stopPropagation(); navigate(`/cotizaciones/${cot.id}`) }}
                        >
                          Abrir
                        </button>
                        {isAdmin && cot.estado !== 'convertida' && (
                          confirmDelete === cot.id ? (
                            <>
                              <button
                                className="btn"
                                style={{ padding: '4px 8px', fontSize: 11, background: 'var(--danger, #c0392b)', color: '#fff', borderColor: 'var(--danger, #c0392b)' }}
                                onClick={e => handleDelete(e, cot)}
                              >
                                Confirmar
                              </button>
                              <button
                                className="btn"
                                style={{ padding: '4px 8px', fontSize: 11 }}
                                onClick={e => { e.stopPropagation(); setConfirmDelete(null) }}
                              >
                                ✕
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn"
                              style={{ padding: '4px 8px', color: 'var(--danger, #c0392b)', borderColor: 'transparent' }}
                              title="Eliminar cotización"
                              onClick={e => handleDelete(e, cot)}
                            >
                              <Icon.Trash />
                            </button>
                          )
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
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <button
              className="btn"
              disabled={!prevPage}
              onClick={() => goPage(prevPage)}
            >
              ← Anterior
            </button>
            <button
              className="btn"
              disabled={!nextPage}
              onClick={() => goPage(nextPage)}
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes progress-bar {
          0% { opacity: 1; transform: scaleX(0.3); transform-origin: left; }
          50% { opacity: 1; transform: scaleX(0.7); transform-origin: left; }
          100% { opacity: 0.5; transform: scaleX(1); transform-origin: left; }
        }
      `}</style>
    </div>
  )
}
