import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { REMISION_STATUS_DEFS } from '../components/core'
import { getRemisiones } from '../api'
import { usePolling } from '../lib/usePolling'

const TAB_DEFS = [
  { id: 'pendiente', label: 'Activas' },
  { id: 'liquidada', label: 'Historial' },
]

function StatusBadge({ estado }) {
  const def = REMISION_STATUS_DEFS.find(s => s.id === estado)
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
          background: 'var(--surface-2)', borderRadius: 4,
          animation: 'pulse 1.4s ease-in-out infinite',
          animationDelay: `${i * 0.1}s`,
        }} />
      ))}
    </div>
  )
}

export default function Remisiones() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('pendiente')
  const [remisiones, setRemisiones] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [count, setCount] = useState(0)
  const debounceRef = useRef(null)
  const paramsRef = useRef('')

  const buildParams = (estado, s, desde, hasta) => {
    const parts = [`estado=${estado}`]
    if (s) parts.push(`search=${encodeURIComponent(s)}`)
    if (estado === 'liquidada') {
      if (desde) parts.push(`fecha_after=${desde}`)
      if (hasta) parts.push(`fecha_before=${hasta}`)
    }
    return '?' + parts.join('&')
  }

  const load = (params, initial = false) => {
    paramsRef.current = params
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    getRemisiones(params)
      .then(data => {
        const list = Array.isArray(data) ? data : (data.results || [])
        setRemisiones(list)
        setCount(Array.isArray(data) ? data.length : (data.count || list.length))
      })
      .catch(e => setError(e.message))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => {
    load(buildParams(tab, search, fechaDesde, fechaHasta), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  usePolling(() => load(paramsRef.current))

  const reapply = (s = search, desde = fechaDesde, hasta = fechaHasta) => {
    load(buildParams(tab, s, desde, hasta))
  }

  const handleSearch = (v) => {
    setSearch(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => reapply(v), 350)
  }

  const fmtFecha = (str) => {
    if (!str) return '—'
    const d = new Date(str)
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="mod">Remisiones</div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {TAB_DEFS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: '7px 16px', fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
                color: tab === t.id ? 'var(--accent)' : 'var(--ink-3)',
                background: 'none', border: 'none',
                borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer', marginBottom: -1,
              }}
            >
              {t.id === 'liquidada' && <span style={{ marginRight: 6 }}><Icon.Stamp width="13" height="13" /></span>}
              {t.label}
            </button>
          ))}
        </div>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
            {tab === 'pendiente' ? 'Remisiones por liquidar' : 'Historial de remisiones'}
          </h1>
          {!loading && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {count} {count === 1 ? 'remisión' : 'remisiones'}
            </div>
          )}
        </div>

        {/* Search + filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="input-affix" style={{ flex: '1 1 200px', minWidth: 0 }}>
            <input
              className="input"
              style={{ paddingLeft: 34 }}
              placeholder="Buscar por N°, cliente, OP…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', pointerEvents: 'none' }}>
              <Icon.Search />
            </span>
          </div>
          {tab === 'liquidada' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" className="input" value={fechaDesde}
                onChange={e => { setFechaDesde(e.target.value); reapply(search, e.target.value, fechaHasta) }}
                style={{ fontSize: 12 }} title="Desde" />
              <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>→</span>
              <input type="date" className="input" value={fechaHasta}
                onChange={e => { setFechaHasta(e.target.value); reapply(search, fechaDesde, e.target.value) }}
                style={{ fontSize: 12 }} title="Hasta" />
            </div>
          )}
        </div>

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
          ) : remisiones.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin remisiones</div>
              <div style={{ fontSize: 12 }}>
                {tab === 'pendiente'
                  ? 'Las OP que lleguen al 100% aparecerán aquí automáticamente.'
                  : 'Aún no hay remisiones liquidadas.'}
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                    {['N°', 'Fecha', 'Cliente', 'OP', 'Estado', ''].map((h, i) => (
                      <th key={i} style={{
                        padding: '10px 16px', textAlign: i >= 3 ? 'center' : 'left',
                        fontWeight: 600, fontSize: 11, color: 'var(--ink-3)',
                        textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {remisiones.map((rem, idx) => (
                    <tr
                      key={rem.id}
                      onClick={() => navigate(`/remisiones/${rem.id}`)}
                      style={{
                        borderBottom: '1px solid var(--border)', cursor: 'pointer',
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)'}
                    >
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <span className="mono" style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 12 }}>
                          {rem.numero || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', color: 'var(--ink-3)', fontSize: 12 }}>
                        {fmtFecha(rem.fecha)}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--ink)', maxWidth: 220 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rem.cliente_nombre || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{rem.orden_numero || '—'}</span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <StatusBadge estado={rem.estado} />
                      </td>
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap', width: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            className="btn"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); navigate(`/remisiones/${rem.id}`) }}
                          >
                            {rem.estado === 'pendiente' ? 'Liquidar' : 'Ver'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes progress-bar {
          0% { opacity: 1; transform: scaleX(0.3); transform-origin: left; }
          50% { opacity: 1; transform: scaleX(0.7); transform-origin: left; }
          100% { opacity: 0.5; transform: scaleX(1); transform-origin: left; }
        }
      `}</style>
    </div>
  )
}
