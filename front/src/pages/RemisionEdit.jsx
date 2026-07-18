import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, REMISION_STATUS_DEFS } from '../components/core'
import { getRemision, updateRemision, liquidarRemision, pdfRemision, getRemisionesImportables, importarRemisiones } from '../api'
import logo from '../assets/logo.png'

// ─────────── Modal de envío (espeja CotizacionModal) ───────────
function SendModal({ rem, items, total, onClose, onSend }) {
  const totalCantidad = items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0)
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
                <tr className="cot-doc-total"><td colSpan={2}>Total entregado</td><td className="num">{fmtNum(totalCantidad)} u</td></tr>
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

// ─────────── Modal de importación (fusionar remisiones del mismo cliente) ───────────
function ImportRemisionModal({ rem, onClose, onImport }) {
  const [opciones, setOpciones] = useState(null)
  const [selected, setSelected] = useState([])
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getRemisionesImportables(rem.id)
      .then(setOpciones)
      .catch(e => { setError(e.message); setOpciones([]) })
  }, [rem.id])

  const toggle = (rid) => setSelected(prev => prev.includes(rid) ? prev.filter(x => x !== rid) : [...prev, rid])

  const handleImport = async () => {
    if (!selected.length) return
    setImporting(true)
    setError(null)
    try {
      await onImport(selected)
    } catch (e) {
      setError(e.message || 'Error al importar')
      setImporting(false)
    }
  }

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  return createPortal(
    <div className="cot-modal-backdrop" onClick={handleBackdrop}>
      <div className="cot-modal">
        <div className="cot-modal-header">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={logo} alt="Troqueles INK" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            <div className="biz">Importar a {rem.numero}</div>
          </div>
          <button className="btn cot-modal-close" style={{ padding: '4px 8px', fontSize: 13 }} onClick={onClose}>
            <Icon.X /> Cerrar
          </button>
        </div>

        <div className="cot-modal-body">
          <div className="note" style={{ fontSize: 12, marginBottom: 12 }}>
            <Icon.Info /> Remisiones pendientes de <strong>{rem.cliente_nombre}</strong>. Al importar, sus ítems se suman a esta remisión y quedan consolidadas.
          </div>
          {opciones === null ? (
            <div style={{ padding: 24, color: 'var(--ink-3)', fontSize: 13 }}>Cargando…</div>
          ) : opciones.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--ink-3)', fontSize: 13, textAlign: 'center' }}>
              No hay otras remisiones pendientes de este cliente.
            </div>
          ) : (
            <table className="cot-doc-table">
              <thead><tr><th style={{ width: 36 }}></th><th>Remisión</th><th>OP</th><th className="num">Cantidad</th><th className="num">Vr. Total</th></tr></thead>
              <tbody>
                {opciones.map(o => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => toggle(o.id)}>
                    <td><input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} /></td>
                    <td className="mono">{o.numero}</td>
                    <td className="mono">{o.orden_numero || '—'}</td>
                    <td className="num">{fmtNum(o.total_cantidad)}</td>
                    <td className="num">{fmtCOP(o.total_valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="cot-modal-actions">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{selected.length} seleccionada(s)</span>
            <button className="btn accent" onClick={handleImport} disabled={importing || !selected.length}>
              <Icon.Plus /> {importing ? 'Importando…' : 'Importar seleccionadas'}
            </button>
          </div>
          {error && (
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--danger)', width: '100%', textAlign: 'right' }}>✗ {error}</span>
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
  const [showImport, setShowImport] = useState(false)
  const [toast, setToast] = useState(null)
  const [mostrarValores, setMostrarValores] = useState(false)

  const editable = rem?.estado === 'pendiente'
  const liquidada = rem?.estado === 'liquidada'
  const consolidada = rem?.estado === 'consolidada'
  const total = items.reduce((s, it) => s + (Number(it.valor_total) || 0), 0)
  const totalCantidad = items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0)

  const hydrate = (data) => {
    setRem(data)
    setItems((data.items || []).map(i => ({ descripcion: i.descripcion, cantidad: i.cantidad, valor_total: i.valor_total })))
    setDireccion(data.direccion || '')
    setCiudad(data.ciudad || '')
    setObservaciones(data.observaciones || '')
    setMostrarValores(!!data.mostrar_valores)
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
    mostrar_valores: mostrarValores,
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

  const handleImport = async (ids) => {
    // Persistir ediciones locales antes de fusionar (importar agrega sobre lo guardado)
    await updateRemision(id, payload())
    const updated = await importarRemisiones(id, ids)
    hydrate(updated)
    setShowImport(false)
  }

  const updateItem = (i, field, value) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it))
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const [dlPdf, setDlPdf] = useState(null) // 'cliente' | 'admin' mientras descarga
  const handlePdf = async (tipo) => {
    setDlPdf(tipo)
    try {
      // Persistir ediciones para que el PDF refleje lo que se ve en pantalla
      if (editable) await updateRemision(id, payload()).then(hydrate)
      const r = await pdfRemision(id, tipo)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = tipo === 'admin' ? `Remision_${rem.numero}_admin.pdf` : `Remision_${rem.numero}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setSavedMsg('Error: no se pudo generar el PDF')
    } finally {
      setDlPdf(null)
    }
  }

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

        {consolidada && (
          <div className="note" style={{ marginBottom: 16 }}>
            <Icon.Info /> Esta remisión fue consolidada dentro de{' '}
            {rem.consolidada_en_remision
              ? <Link to={`/remisiones/${rem.consolidada_en_remision}`} style={{ color: 'var(--accent)', fontWeight: 700 }}>{rem.consolidada_en_numero || 'otra remisión'}</Link>
              : 'otra remisión'}. Sus ítems se entregan en ese comprobante.
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
              <input className="input" value={direccion} disabled={!editable}
                onChange={e => setDireccion(e.target.value)} placeholder="Dirección…" />
            </label>
            <label style={{ fontSize: 12 }}>
              <div style={{ color: 'var(--ink-3)', marginBottom: 4 }}>Ciudad</div>
              <input className="input" value={ciudad} disabled={!editable}
                onChange={e => setCiudad(e.target.value)} placeholder="Ciudad…" />
            </label>
          </div>
        </div>

        {/* Ítems */}
        <div className="section open" style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Ítems · OP {rem.orden_numero}</div>
            {editable && (
              <button className="btn" style={{ fontSize: 12 }} onClick={() => setShowImport(true)}>
                <Icon.Plus /> Importar de otra remisión
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>Descripción</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', width: 90 }}>Cantidad</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', width: 130 }}>Vr. Total</th>
                  {editable && <th style={{ width: 36 }}></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 6px' }}>
                      <input className="input" value={it.descripcion} disabled={!editable}
                        onChange={e => updateItem(i, 'descripcion', e.target.value)} placeholder="Descripción del ítem…" />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input className="input" type="number" step="0.01" value={it.cantidad} disabled={!editable}
                        onChange={e => updateItem(i, 'cantidad', e.target.value)} style={{ textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input className="input" type="number" step="1" value={it.valor_total} disabled={!editable}
                        onChange={e => updateItem(i, 'valor_total', e.target.value)} style={{ textAlign: 'right' }} />
                    </td>
                    {editable && (
                      <td style={{ padding: '6px 2px', textAlign: 'center' }}>
                        <button className="btn" style={{ padding: '4px 6px', color: 'var(--danger)', borderColor: 'transparent' }}
                          onClick={() => removeItem(i)} title="Eliminar ítem"><Icon.Trash /></button>
                      </td>
                    )}
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700 }}>Total entregado</td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmtNum(totalCantidad)}</td>
                  <td></td>
                  {editable && <td></td>}
                </tr>
                <tr>
                  <td colSpan={2} style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700 }}>Total</td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmtCOP(total)}</td>
                  {editable && <td></td>}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Observaciones */}
        <div className="section open" style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Observaciones</div>
          <textarea className="input" rows={3} value={observaciones} disabled={!editable}
            onChange={e => setObservaciones(e.target.value)} placeholder="Notas para el comprobante…" style={{ resize: 'vertical' }} />
        </div>

        {/* Remisión del Operador: permitir mostrar valores */}
        <div className="section open" style={{ marginBottom: 16, padding: 18 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: editable ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={mostrarValores} disabled={!editable}
              onChange={e => setMostrarValores(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Mostrar valores en la remisión del operador</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                Por defecto la remisión del operador se entrega sin precios. Actívalo para que su PDF incluya los valores.
              </span>
            </span>
          </label>
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
          {savedMsg && <span style={{ fontSize: 12, color: savedMsg.startsWith('Error') ? 'var(--danger)' : 'var(--ok)' }}>{savedMsg}</span>}
          <button className="btn" onClick={() => handlePdf('cliente')} disabled={!!dlPdf} title="PDF que recibe el cliente (sin valores por ítem)">
            <Icon.Print /> {dlPdf === 'cliente' ? 'Generando…' : 'PDF cliente'}
          </button>
          <button className="btn" onClick={() => handlePdf('admin')} disabled={!!dlPdf} title="Documento interno con desglose de costos del troquel">
            <Icon.Print /> {dlPdf === 'admin' ? 'Generando…' : 'PDF admin (desglose)'}
          </button>
          {editable && (
            <>
              <button className="btn" onClick={handleSave} disabled={saving}>
                <Icon.Save /> {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
              <button className="btn accent" onClick={() => setShowModal(true)}>
                <Icon.Send /> Liquidar y enviar
              </button>
            </>
          )}
        </div>
      </div>

      {showModal && (
        <SendModal rem={rem} items={items} total={total} onClose={() => setShowModal(false)} onSend={handleSend} />
      )}

      {showImport && (
        <ImportRemisionModal rem={rem} onClose={() => setShowImport(false)} onImport={handleImport} />
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
