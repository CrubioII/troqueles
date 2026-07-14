import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum } from '../components/core'
import { getClientesResumen } from '../api'
import { useSyncPolling } from '../lib/useSyncPolling'

const ACTIVIDAD_LABEL = {
  cotizacion: 'cotización',
  orden: 'OP',
  remision: 'remisión',
}

const SEGMENTS = [
  { id: 'todos', label: 'Todos' },
  { id: 'inactivos', label: 'Inactivos' },
  { id: 'activos', label: 'Activos' },
]

function diasLabel(dias) {
  if (dias == null) return 'Sin actividad'
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Hace 1 día'
  return `Hace ${dias} días`
}

function Skeleton() {
  return (
    <div style={{ padding: '32px 0' }}>
      {[1, 2, 3, 4, 5].map(i => (
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

export default function ClienteList() {
  const navigate = useNavigate()
  const [clientes, setClientes] = useState([])
  const [inactivos, setInactivos] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState('todos')

  const load = (initial = false) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    getClientesResumen()
      .then(data => {
        setClientes(data.clientes || [])
        setInactivos(data.inactivos || 0)
      })
      .catch(e => setError(e.message))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => { load(true) }, [])
  useSyncPolling({ clientes: () => load() })

  const rows = useMemo(() => {
    let list = clientes
    if (segment === 'inactivos') list = list.filter(c => c.inactivo)
    else if (segment === 'activos') list = list.filter(c => !c.inactivo)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(c => c.nombre.toLowerCase().includes(q))
    // Más inactivos primero; sin actividad al final.
    return [...list].sort((a, b) => {
      const da = a.dias_inactivo == null ? -1 : a.dias_inactivo
      const db = b.dias_inactivo == null ? -1 : b.dias_inactivo
      return db - da
    })
  }, [clientes, segment, search])

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <div className="mod">Clientes</div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)' }}>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
            Directorio de clientes
          </h1>
          {!loading && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {clientes.length} {clientes.length === 1 ? 'cliente' : 'clientes'}
            </div>
          )}
        </div>

        {/* Recordatorio de re-engagement */}
        {!loading && inactivos > 0 && (
          <button
            type="button"
            onClick={() => setSegment('inactivos')}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              marginBottom: 16, padding: '12px 16px', cursor: 'pointer',
              background: '#FAEAC7', border: '1px solid #E8CF91', borderRadius: 10,
              color: '#7A5410',
            }}
          >
            <span style={{
              flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
              background: '#A67012', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14,
            }}>{inactivos}</span>
            <span style={{ fontSize: 13, lineHeight: 1.35 }}>
              <strong>{inactivos} {inactivos === 1 ? 'cliente lleva' : 'clientes llevan'} +90 días sin actividad.</strong>
              {' '}Considera contactarlos para que vuelvan a cotizar. →
            </span>
          </button>
        )}

        {/* Search + segmentos */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="input-affix" style={{ flex: '1 1 200px', minWidth: 0 }}>
            <input
              className="input"
              style={{ paddingLeft: 34 }}
              placeholder="Buscar por nombre…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', pointerEvents: 'none' }}>
              <Icon.Search />
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SEGMENTS.map(s => (
              <button
                key={s.id}
                type="button"
                className={'chip-toggle' + (segment === s.id ? ' active' : '')}
                onClick={() => setSegment(s.id)}
              >
                {s.label}
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

        {/* Tabla */}
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
          ) : rows.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin clientes</div>
              <div style={{ fontSize: 12 }}>
                {search || segment !== 'todos' ? 'Ninguno coincide con los filtros actuales.' : 'Aún no hay clientes registrados.'}
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                    {['Cliente', 'Última actividad', 'Cot.', 'OP', 'Total facturado', 'Saldo', 'Estado'].map((h, i) => (
                      <th key={i} style={{
                        padding: '10px 16px', textAlign: i >= 2 ? (i >= 4 && i <= 5 ? 'right' : 'center') : 'left',
                        fontWeight: 600, fontSize: 11, color: 'var(--ink-3)',
                        textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, idx) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/clientes/${c.id}`)}
                      style={{
                        borderBottom: '1px solid var(--border)', cursor: 'pointer',
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)'}
                    >
                      <td style={{ padding: '12px 16px', maxWidth: 220 }}>
                        <div style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.nombre}
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 400 }}>
                          {c.tipo === 'terciario' ? 'Terciario' : 'Cliente final'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 12, color: c.inactivo ? 'var(--warn, #A67012)' : 'var(--ink-2)', fontWeight: c.inactivo ? 600 : 400 }}>
                          {diasLabel(c.dias_inactivo)}
                        </div>
                        {c.ultima_actividad_tipo && (
                          <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                            últ. {ACTIVIDAD_LABEL[c.ultima_actividad_tipo]}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span className="mono" style={{ fontSize: 12 }}>{fmtNum(c.n_cotizaciones)}</span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span className="mono" style={{ fontSize: 12 }}>{fmtNum(c.n_ordenes)}</span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--ink)' }}>{fmtCOP(c.total_facturado)}</span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <span className="mono" style={{ fontSize: 12, color: c.saldo_pendiente > 0 ? 'var(--danger, #9C2A2A)' : 'var(--ink-3)' }}>
                          {fmtCOP(c.saldo_pendiente)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span className={'badge ' + (c.inactivo ? 'rejected' : 'approved')}>
                          <span className="dot"></span>
                          {c.inactivo ? 'Inactivo' : 'Activo'}
                        </span>
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
