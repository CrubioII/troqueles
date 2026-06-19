import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, STATUS_DEFS, REMISION_STATUS_DEFS } from '../components/core'
import { getClientePerfil, updateCliente } from '../api'

const ACTIVIDAD_LABEL = {
  cotizacion: 'cotización',
  orden: 'orden de producción',
  remision: 'remisión',
}

function diasLabel(dias) {
  if (dias == null) return 'sin actividad registrada'
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'hace 1 día'
  return `hace ${dias} días`
}

const fmtFecha = (str) => {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function StatusBadge({ estado, defs }) {
  const def = defs.find(s => s.id === estado)
  if (!def) return <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{estado}</span>
  return (
    <span className={'badge ' + def.cls}>
      <span className="dot"></span>
      {def.label}
    </span>
  )
}

function MetricCard({ label, value, accent }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 10, padding: '14px 16px', minWidth: 0,
    }}>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color: accent || 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}

function HistorySection({ title, count, children }) {
  return (
    <div style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>
        {title} <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>({count})</span>
      </h2>
      <div className="section open" style={{ padding: 0, overflow: 'hidden' }}>
        {count === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            Sin registros.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>
        )}
      </div>
    </div>
  )
}

const TH = ({ children, align = 'left' }) => (
  <th style={{
    padding: '9px 14px', textAlign: align, fontWeight: 600, fontSize: 10,
    color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
  }}>{children}</th>
)

function rowStyle(idx) {
  return {
    borderBottom: '1px solid var(--border)', cursor: 'pointer',
    background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)',
    transition: 'background 0.12s',
  }
}

export default function ClienteDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ nombre: '', email: '', telefono: '', nit: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    getClientePerfil(id)
      .then(d => {
        setData(d)
        setForm({ nombre: d.cliente.nombre || '', email: d.cliente.email || '', telefono: d.cliente.telefono || '', nit: d.cliente.nit || '' })
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const saveContacto = () => {
    setSaving(true)
    updateCliente(id, form)
      .then(updated => {
        setData(prev => ({ ...prev, cliente: { ...prev.cliente, ...updated } }))
        setEditing(false)
      })
      .catch(e => setError(e.message))
      .finally(() => setSaving(false))
  }

  if (loading) {
    return (
      <div className="app">
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: 28 }}>
          <div style={{ height: 120, background: 'var(--surface-2)', borderRadius: 10, animation: 'pulse 1.4s ease-in-out infinite' }} />
        </div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="app">
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: 28 }}>
          <button className="btn" onClick={() => navigate('/clientes')}><Icon.ArrowLeft /> Volver</button>
          <div className="note" style={{ marginTop: 16, color: 'var(--danger, #c0392b)' }}>
            <Icon.Info /> {error || 'No se pudo cargar el cliente.'}
          </div>
        </div>
      </div>
    )
  }

  const { cliente, finanzas, cotizaciones, ordenes, remisiones } = data

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn" style={{ padding: '4px 10px' }} onClick={() => navigate('/clientes')}>
            <Icon.ArrowLeft />
          </button>
          <div className="mod">{cliente.nombre}</div>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)' }}>

        {/* Header / contacto */}
        <div className="section open" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>{cliente.nombre}</h1>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                {cliente.tipo === 'terciario' ? 'Cliente terciario' : 'Cliente final'}
                {' · '}Registrado {fmtFecha(cliente.creado)}
              </div>
            </div>
            {!editing && (
              <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setEditing(true)}>
                <Icon.Pencil /> Editar contacto
              </button>
            )}
          </div>

          {/* Datos de contacto */}
          {editing ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                <span className="label">Nombre</span>
                <input className="input" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
              </label>
              <label className="field">
                <span className="label">Email</span>
                <input className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </label>
              <label className="field">
                <span className="label">Teléfono</span>
                <input className="input" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
              </label>
              <label className="field">
                <span className="label">NIT</span>
                <input className="input" value={form.nit} onChange={e => setForm(f => ({ ...f, nit: e.target.value }))} />
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <button className="btn accent" disabled={saving || !form.nombre.trim()} onClick={saveContacto}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button className="btn" disabled={saving} onClick={() => {
                  setEditing(false)
                  setForm({ nombre: cliente.nombre || '', email: cliente.email || '', telefono: cliente.telefono || '', nit: cliente.nit || '' })
                }}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 16, fontSize: 13 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</div>
                <div style={{ color: 'var(--ink-2)' }}>{cliente.email || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Teléfono</div>
                <div style={{ color: 'var(--ink-2)' }}>{cliente.telefono || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>NIT</div>
                <div style={{ color: 'var(--ink-2)' }}>{cliente.nit || '—'}</div>
              </div>
            </div>
          )}
        </div>

        {/* Callout re-engagement */}
        {finanzas.inactivo && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
            padding: '12px 16px', background: '#FAEAC7', border: '1px solid #E8CF91',
            borderRadius: 10, color: '#7A5410', fontSize: 13, lineHeight: 1.35,
          }}>
            <span style={{ flexShrink: 0, fontSize: 18 }}>⏰</span>
            <span>
              <strong>Última actividad {diasLabel(finanzas.dias_inactivo)}</strong>
              {finanzas.ultima_actividad_tipo ? ` (${ACTIVIDAD_LABEL[finanzas.ultima_actividad_tipo]}).` : '.'}
              {' '}Recuérdale al cliente que vuelva a cotizar o producir.
            </span>
          </div>
        )}

        {/* Tarjetas financieras */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <MetricCard label="Total facturado" value={fmtCOP(finanzas.total_facturado)} />
          <MetricCard label="Saldo pendiente" value={fmtCOP(finanzas.saldo_pendiente)} accent={finanzas.saldo_pendiente > 0 ? 'var(--danger, #9C2A2A)' : undefined} />
          <MetricCard label="Cotizaciones" value={fmtNum(finanzas.n_cotizaciones)} />
          <MetricCard label="Órdenes" value={fmtNum(finanzas.n_ordenes)} />
        </div>

        {/* Cotizaciones */}
        <HistorySection title="Cotizaciones" count={cotizaciones.length}>
          <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <TH>N°</TH><TH>Fecha</TH><TH>Referencia</TH><TH align="center">Cant.</TH><TH align="center">Estado</TH>
              </tr>
            </thead>
            <tbody>
              {cotizaciones.map((c, idx) => (
                <tr key={c.id} onClick={() => navigate(`/cotizaciones/${c.id}`)} style={rowStyle(idx)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)'}>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}><span className="mono" style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 12 }}>{c.numero || '—'}</span></td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: 'var(--ink-3)', fontSize: 12 }}>{fmtFecha(c.fecha)}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--ink-2)', maxWidth: 240 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.referencia || '—'}</div></td>
                  <td style={{ padding: '11px 14px', textAlign: 'center' }}><span className="mono" style={{ fontSize: 12 }}>{fmtNum(c.cantidad)}</span></td>
                  <td style={{ padding: '11px 14px', textAlign: 'center' }}><StatusBadge estado={c.estado} defs={STATUS_DEFS} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </HistorySection>

        {/* Órdenes */}
        <HistorySection title="Órdenes de producción" count={ordenes.length}>
          <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <TH>N°</TH><TH>Fecha</TH><TH>Referencia</TH><TH align="right">Valor</TH><TH align="right">Saldo</TH><TH align="center">Progreso</TH>
              </tr>
            </thead>
            <tbody>
              {ordenes.map((o, idx) => (
                <tr key={o.id} onClick={() => navigate(`/ordenes/${o.id}`)} style={rowStyle(idx)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)'}>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}><span className="mono" style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 12 }}>{o.numero || '—'}</span></td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: 'var(--ink-3)', fontSize: 12 }}>{fmtFecha(o.fecha)}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--ink-2)', maxWidth: 200 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.referencia || '—'}</div></td>
                  <td style={{ padding: '11px 14px', textAlign: 'right' }}><span className="mono" style={{ fontSize: 12 }}>{o.valor_total_efectivo != null ? fmtCOP(o.valor_total_efectivo) : '—'}</span></td>
                  <td style={{ padding: '11px 14px', textAlign: 'right' }}><span className="mono" style={{ fontSize: 12, color: o.saldo > 0 ? 'var(--danger, #9C2A2A)' : 'var(--ink-3)' }}>{o.saldo != null ? fmtCOP(o.saldo) : '—'}</span></td>
                  <td style={{ padding: '11px 14px', textAlign: 'center' }}><span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{o.progreso?.porcentaje != null ? `${o.progreso.porcentaje}%` : '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </HistorySection>

        {/* Remisiones */}
        <HistorySection title="Remisiones" count={remisiones.length}>
          <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <TH>N°</TH><TH>Fecha</TH><TH>OP</TH><TH align="center">Estado</TH>
              </tr>
            </thead>
            <tbody>
              {remisiones.map((r, idx) => (
                <tr key={r.id} onClick={() => navigate(`/remisiones/${r.id}`)} style={rowStyle(idx)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)'}>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}><span className="mono" style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 12 }}>{r.numero || '—'}</span></td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: 'var(--ink-3)', fontSize: 12 }}>{fmtFecha(r.fecha)}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--ink-2)' }}><span className="mono" style={{ fontSize: 12 }}>{r.orden_numero || '—'}</span></td>
                  <td style={{ padding: '11px 14px', textAlign: 'center' }}><StatusBadge estado={r.estado} defs={REMISION_STATUS_DEFS} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </HistorySection>
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  )
}
