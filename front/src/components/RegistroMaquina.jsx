import { useState, useEffect } from 'react'
import { fmtCOP, MoneyInput } from './core'
import { getOrdenes, createRegistroMaquina } from '../api'

const fmtFecha = (iso) => new Date(iso).toLocaleString('es-CO', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

const MAQUINA_LABELS = {
  guillotina: '¿Qué se cortó?',
  troquel:    '¿Qué se troquelò?',
}

export function RegistroMaquinaForm({ maquina, onCreated }) {
  const requiresOrden = maquina !== 'guillotina'
  const descripcionLabel = MAQUINA_LABELS[maquina] || 'Descripción del trabajo'
  const [ordenes, setOrdenes] = useState([])
  const [ordenId, setOrdenId] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [costo, setCosto] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!requiresOrden) return
    getOrdenes()
      .then(data => setOrdenes(Array.isArray(data) ? data : (data.results || [])))
      .catch(() => {})
  }, [requiresOrden])

  const handleSubmit = (e) => {
    e.preventDefault()
    if ((requiresOrden && !ordenId) || !descripcion.trim()) return
    setSaving(true)
    setError(null)
    const payload = { maquina, descripcion: descripcion.trim(), costo }
    if (requiresOrden) payload.orden = ordenId
    createRegistroMaquina(payload)
      .then(reg => {
        setDescripcion('')
        setCosto(0)
        setOrdenId('')
        onCreated && onCreated(reg)
      })
      .catch(e => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <form className="section" onSubmit={handleSubmit} style={{ padding: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {requiresOrden && (
        <div style={{ flex: '2 1 240px' }}>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>
            Orden de producción
          </label>
          <select className="input" value={ordenId} onChange={e => setOrdenId(e.target.value)} required>
            <option value="">Seleccionar OP…</option>
            {ordenes.map(o => (
              <option key={o.id} value={o.id}>{o.numero} — {o.cliente_nombre} — {o.referencia}</option>
            ))}
          </select>
        </div>
      )}
      <div style={{ flex: '2 1 240px' }}>
        <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>
          {descripcionLabel}
        </label>
        <input
          className="input"
          placeholder="Descripción del trabajo realizado"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          required
        />
      </div>
      <div style={{ flex: '1 1 160px' }}>
        <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)', display: 'block', marginBottom: 4 }}>
          Costo cobrado
        </label>
        <MoneyInput value={costo} onChange={setCosto} />
      </div>
      <div>
        <button className="btn accent" type="submit" disabled={saving}>
          {saving ? 'Guardando…' : 'Registrar'}
        </button>
      </div>
      {error && <div className="note" style={{ width: '100%' }}>Error: {error}</div>}
    </form>
  )
}

export function RegistroMaquinaHistory({ registros, loading, showOrden = true }) {
  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
  }
  if (!registros.length) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin registros todavía</div>
  }
  const headers = showOrden
    ? ['Fecha / Hora', 'OP #', 'Cliente', 'Descripción', 'Costo', 'Operador']
    : ['Fecha / Hora', 'Descripción', 'Costo', 'Operador']
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--line)' }}>
          {headers.map((h, i) => (
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
        {registros.map((r, idx) => (
          <tr key={r.id} style={{
            borderBottom: '1px solid var(--line)',
            background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
          }}>
            <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--ink-2)' }}>
              {fmtFecha(r.fecha_hora)}
            </td>
            {showOrden && (
              <>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12 }}>
                  {r.orden_numero}
                </td>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.orden_cliente}</td>
              </>
            )}
            <td style={{ padding: '10px 12px', color: 'var(--ink-2)' }}>{r.descripcion}</td>
            <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
              {fmtCOP(r.costo)}
            </td>
            <td style={{ padding: '10px 12px', color: 'var(--ink-2)', fontSize: 12 }}>{r.operador_username || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
