import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, REMISION_STATUS_DEFS } from '../components/core'
import { getRemision, updateRemision, liquidarRemision } from '../api'
import logo from '../assets/logo.png'

function emptyItem() {
  return { descripcion: '', cantidad: 1, valor_total: 0 }
}

// ─────────── Modal de envío (espeja CotizacionModal) ───────────
function SendModal({ rem, items, total, onClose, onSend }) {
  const [email, setEmail] = useState(rem.cliente_email || '')
  const [extraEmails, setExtraEmails] = useState([])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  const handleSend = async () => {
    setSending(true)
    setResult(null)
    try {
      const validExtras = extraEmails.filter(e => e.trim())
      const res = await onSend(email.trim(), validExtras)
      setResult({ ok: true, msg: `Enviado a ${(res.enviado_a || []).join(', ')}` })
    } catch (e) {
      setResult({ ok: false, msg: e.message || 'Error al enviar' })
      setSending(false)
    }
  }

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  return createPortal(
    <div className="cot-modal-backdrop" onClick={handleBackdrop}>
      <div className="cot-modal">
        <div className="cot-modal-header">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={logo} alt="Troqueles INK" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            <div className="biz">Troqueles INK</div>
            <span className="div">/</span>
            <div className="mod mono">{rem.numero}</div>
          </div>
          <button className="btn cot-modal-close" style={{ padding: '4px 8px', fontSize: 13 }} onClick={onClose}>
            <Icon.X /> Cerrar
          </button>
        </div>

        <div className="cot-modal-body">
          <div className="cot-doc-section">
            <div className="cot-doc-section-title">Remisión {rem.numero}</div>
            <table className="cot-doc-table">
              <tbody>
                <tr><td style={{ color: 'var(--ink-3)', width: 160 }}>Cliente</td><td style={{ fontWeight: 600 }}>{rem.cliente_nombre}</td></tr>
                <tr><td style={{ color: 'var(--ink-3)' }}>OP origen</td><td className="mono">{rem.orden_numero}</td></tr>
                <tr><td style={{ color: 'var(--ink-3)' }}>Fecha</td><td className="mono">{rem.fecha}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="cot-doc-section">
            <div className="cot-doc-section-title">Ítems</div>
            <table className="cot-doc-table">
              <thead><tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Vr. Total</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}><td>{it.descripcion || '—'}</td><td className="num">{it.cantidad}</td><td className="num">{fmtCOP(it.valor_total)}</td></tr>
                ))}
                <tr className="cot-doc-total"><td colSpan={2}>Total</td><td className="num">{fmtCOP(total)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="note" style={{ fontSize: 12 }}>
            <Icon.Info /> Se enviará al cliente y a contaduría (configurado en el sistema).
          </div>
        </div>

        <div className="cot-modal-actions">
          <div className="cot-modal-email-row">
            <input className="input" type="email" placeholder="Correo del cliente…" value={email}
              onChange={e => setEmail(e.target.value)} style={{ flex: 1 }} />
            <button className="btn accent" onClick={handleSend} disabled={sending} style={{ whiteSpace: 'nowrap' }}>
              <Icon.Send /> {sending ? 'Enviando…' : 'Liquidar y enviar'}
            </button>
          </div>
          {extraEmails.map((e, i) => (
            <div key={i} className="cot-modal-email-row" style={{ marginTop: 6 }}>
              <input className="input" type="email" placeholder="Correo adicional…" value={e}
                onChange={ev => setExtraEmails(prev => prev.map((x, idx) => idx === i ? ev.target.value : x))} style={{ flex: 1 }} />
              <button className="btn" onClick={() => setExtraEmails(prev => prev.filter((_, idx) => idx !== i))}
                style={{ whiteSpace: 'nowrap', padding: '6px 10px' }} title="Eliminar"><Icon.X /></button>
            </div>
          ))}
          <button className="btn" onClick={() => setExtraEmails(prev => [...prev, ''])} style={{ alignSelf: 'flex-start', fontSize: 12, marginTop: 4 }}>
            + Agregar destinatario
          </button>
          {result && (
            <span style={{ fontSize: 12, fontWeight: 500, color: result.ok ? 'var(--ok)' : 'var(--danger)', width: '100%', textAlign: 'right' }}>
              {result.ok ? '✓ ' : '✗ '}{result.msg}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function RemisionEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [rem, setRem] = useState(null)
  const [items, setItems] = useState([])
  const [direccion, setDireccion] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState(null)

  const liquidada = rem?.estado === 'liquidada'
  const total = items.reduce((s, it) => s + (Number(it.valor_total) || 0), 0)

  const hydrate = (data) => {
    setRem(data)
    setItems((data.items || []).map(i => ({ descripcion: i.descripcion, cantidad: i.cantidad, valor_total: i.valor_total })))
    setDireccion(data.direccion || '')
    setCiudad(data.ciudad || '')
    setObservaciones(data.observaciones || '')
  }

  useEffect(() => {
    setLoading(true)
    getRemision(id)
      .then(hydrate)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const payload = () => ({
    direccion, ciudad, observaciones,
    items: items.map((it, idx) => ({
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad) || 0,
      valor_total: Number(it.valor_total) || 0,
      orden: idx,
    })),
  })

  const handleSave = async () => {
    setSaving(true)
    setSavedMsg(null)
    try {
      const updated = await updateRemision(id, payload())
      hydrate(updated)
      setSavedMsg('Cambios guardados')
      setTimeout(() => setSavedMsg(null), 2500)
    } catch (e) {
      setSavedMsg('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSend = async (email, extraEmails) => {
    // Persistir ediciones antes de liquidar
    await updateRemision(id, payload())
    const res = await liquidarRemision(id, email, extraEmails)
    if (res.remision) hydrate(res.remision)
    setTimeout(() => {
      setShowModal(false)
      setToast(true)
    }, 700)
    return res
  }

  const updateItem = (i, field, value) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it))
  const addItem = () => setItems(prev => [...prev, emptyItem()])
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  if (loading) return <div style={{ padding: 40, color: 'var(--ink-3)' }}>Cargando…</div>
  if (error) return <div style={{ padding: 40, color: 'var(--danger)' }}>Error: {error}</div>
  if (!rem) return null

  const estadoDef = REMISION_STATUS_DEFS.find(s => s.id === rem.estado)

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn" style={{ padding: '4px 10px' }} onClick={() => navigate('/remisiones')}>
            <Icon.ArrowLeft /> Remisiones
          </button>
          <div className="mod mono">{rem.numero}</div>
          {estadoDef && (
            <span className={'badge ' + estadoDef.cls}><span className="dot"></span>{estadoDef.label}</span>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: '0 auto', padding: 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)' }}>

        {liquidada && (
          <div className="note" style={{ marginBottom: 16 }}>
            <Icon.Info /> Esta remisión ya fue liquidada y enviada{rem.enviada_en ? ` (${new Date(rem.enviada_en).toLocaleString('es-CO')})` : ''}. Está en el historial.
          </div>
        )}

        {/* Cliente */}
        <div className="section open" style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Cliente</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{rem.cliente_nombre}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
            {rem.cliente_nit && <span style={{ marginRight: 14 }}>NIT {rem.cliente_nit}</span>}
            {rem.cliente_telefono && <span>Tel. {rem.cliente_telefono}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <label style={{ fontSize: 12 }}>
              <div style={{ color: 'var(--ink-3)', marginBottom: 4 }}>Dirección</div>
              <input className="input" value={direccion} disabled={liquidada}
                onChange={e => setDireccion(e.target.value)} placeholder="Dirección…" />
            </label>
            <label style={{ fontSize: 12 }}>
              <div style={{ color: 'var(--ink-3)', marginBottom: 4 }}>Ciudad</div>
              <input className="input" value={ciudad} disabled={liquidada}
                onChange={e => setCiudad(e.target.value)} placeholder="Ciudad…" />
            </label>
          </div>
        </div>

        {/* Ítems */}
        <div className="section open" style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Ítems · OP {rem.orden_numero}</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>Descripción</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', width: 90 }}>Cantidad</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', width: 130 }}>Vr. Total</th>
                  {!liquidada && <th style={{ width: 36 }}></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 6px' }}>
                      <input className="input" value={it.descripcion} disabled={liquidada}
                        onChange={e => updateItem(i, 'descripcion', e.target.value)} placeholder="Descripción del ítem…" />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input className="input" type="number" step="0.01" value={it.cantidad} disabled={liquidada}
                        onChange={e => updateItem(i, 'cantidad', e.target.value)} style={{ textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input className="input" type="number" step="1" value={it.valor_total} disabled={liquidada}
                        onChange={e => updateItem(i, 'valor_total', e.target.value)} style={{ textAlign: 'right' }} />
                    </td>
                    {!liquidada && (
                      <td style={{ padding: '6px 2px', textAlign: 'center' }}>
                        <button className="btn" style={{ padding: '4px 6px', color: 'var(--danger)', borderColor: 'transparent' }}
                          onClick={() => removeItem(i)} title="Eliminar ítem"><Icon.Trash /></button>
                      </td>
                    )}
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700 }}>Total</td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmtCOP(total)}</td>
                  {!liquidada && <td></td>}
                </tr>
              </tbody>
            </table>
          </div>
          {!liquidada && (
            <button className="btn" onClick={addItem} style={{ marginTop: 10, fontSize: 12 }}>
              <Icon.Plus /> Agregar ítem
            </button>
          )}
        </div>

        {/* Observaciones */}
        <div className="section open" style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Observaciones</div>
          <textarea className="input" rows={3} value={observaciones} disabled={liquidada}
            onChange={e => setObservaciones(e.target.value)} placeholder="Notas para el comprobante…" style={{ resize: 'vertical' }} />
        </div>

        {/* Acciones */}
        {!liquidada && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
            {savedMsg && <span style={{ fontSize: 12, color: savedMsg.startsWith('Error') ? 'var(--danger)' : 'var(--ok)' }}>{savedMsg}</span>}
            <button className="btn" onClick={handleSave} disabled={saving}>
              <Icon.Save /> {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button className="btn accent" onClick={() => setShowModal(true)}>
              <Icon.Send /> Liquidar y enviar
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <SendModal rem={rem} items={items} total={total} onClose={() => setShowModal(false)} onSend={handleSend} />
      )}

      {/* Notificación sutil al historial */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--ink)', color: 'var(--bg)', padding: '12px 18px', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
          zIndex: 1000, fontSize: 13, maxWidth: 'calc(100vw - 32px)',
        }}>
          <Icon.Check />
          <span>Remisión enviada al historial — puedes seguir viéndola aquí.</span>
          <Link to="/remisiones" style={{ color: '#E8945A', fontWeight: 700, textDecoration: 'underline' }}>
            Ver historial
          </Link>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'var(--bg)', cursor: 'pointer', opacity: 0.6 }}>
            <Icon.X />
          </button>
        </div>
      )}
    </div>
  )
}
