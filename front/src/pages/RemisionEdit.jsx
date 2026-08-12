import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, REMISION_STATUS_DEFS } from '../components/core'
import { TroquelCostos } from '../components/Troquel'
import { getRemision, updateRemision, liquidarRemision, pdfRemision, getRemisionDesglose, getRemisionesImportables, importarRemisiones, devolverFormatoCuchillas, deleteRemision } from '../api'
import logo from '../assets/logo.png'

// ─────────── Desglose por concepto del troquel ───────────
// Los valores llegan ya formateados en COP desde el backend (mismos datos que
// van al PDF adjunto y al cuerpo del correo).
function DesgloseTroqueles({ desglose }) {
  if (!desglose || !desglose.troqueles?.length) return null
  return (
    <>
      {desglose.troqueles.map((t, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
            <div>
              <strong style={{ fontSize: 13 }}>{t.referencia || 'Troquel'}</strong>{' '}
              <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{t.op_numero}</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Cantidad entregada: {t.cantidad}</span>
          </div>
          {t.consumos?.length ? (
            <div className="table-scroll">
            <table className="cot-doc-table" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Elemento</th><th>Detalle</th>
                  <th className="num">Consumo</th><th className="num">Precio unit.</th><th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {t.consumos.map((c, j) => (
                  <tr key={j}>
                    <td>{c.concepto}</td>
                    <td style={{ color: 'var(--ink-3)' }}>{c.detalle}</td>
                    <td className="num">{c.cantidad} {c.unidad}</td>
                    <td className="num">{c.precio}</td>
                    <td className="num">{c.total}</td>
                  </tr>
                ))}
                <tr className="cot-doc-total"><td colSpan={4}>Subtotal troquel</td><td className="num">{t.total}</td></tr>
              </tbody>
            </table>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic', padding: '6px 0' }}>
              Sin formato de cuchillas registrado.
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 10, paddingTop: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)' }}>
          Total general del desglose
        </span>
        <span className="mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)' }}>{desglose.total_general}</span>
      </div>
    </>
  )
}

// ─────────── Precios del troquel (editables) ───────────
// Esta es la única pantalla donde se cotiza el troquel: el Operador registra el
// consumo en su formato de cuchillas y aquí se le pone precio. Al guardar, el
// backend recalcula el Vr. Total del ítem que esa OP aporta a la remisión.
function PreciosTroqueles({ desglose, rem, onSaved, onDevolver }) {
  return (
    <>
      {desglose.troqueles.map(t => (
        <div key={t.op_id} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong style={{ fontSize: 13 }}>{t.referencia || 'Troquel'}</strong>{' '}
              <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{t.op_numero}</span>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Cantidad entregada: {t.cantidad}</div>
            </div>
            {t.formato_id && (
              <button className="btn" style={{ fontSize: 12, color: 'var(--danger)' }} onClick={() => onDevolver(t)}>
                <Icon.ArrowLeft /> Devolver al operador
              </button>
            )}
          </div>
          {t.precios_incompletos && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--warn, #b8860b)', borderBottom: '1px solid var(--line)' }}>
              ⚠ Hay conceptos con consumo y precio en cero — complétalos antes de liquidar.
            </div>
          )}
          {t.consumos?.length ? (
            <TroquelCostos
              ordenId={t.op_id}
              clienteId={rem.cliente}
              clienteNombre={rem.cliente_nombre}
              onSaved={onSaved}
            />
          ) : (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
              Sin formato de cuchillas registrado.
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)' }}>
          Total general del desglose
        </span>
        <span className="mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)' }}>{desglose.total_general}</span>
      </div>
    </>
  )
}

// ─────────── Modal: devolver el troquel al operador ───────────
function DevolverModal({ troquel, varios, busy, error, motivo, onMotivo, onClose, onConfirm }) {
  return createPortal(
    <div className="cot-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cot-modal" style={{ maxWidth: 460 }}>
        <div className="cot-modal-header">
          <div className="brand"><div className="biz">Devolver al operador</div></div>
          <button className="btn cot-modal-close" style={{ padding: '4px 8px', fontSize: 13 }} onClick={onClose}>
            <Icon.X /> Cerrar
          </button>
        </div>
        <div className="cot-modal-body">
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>
            El troquel de <strong className="mono">{troquel.op_numero}</strong> vuelve a la cola del operador
            para que corrija el formato de cuchillas y lo reenvíe. <strong>Esta remisión se elimina</strong>;
            al reenviarlo se generará una nueva.
          </div>
          {varios && (
            <div className="note" style={{ fontSize: 12, marginBottom: 12 }}>
              <Icon.Info /> Esta remisión agrupa varios troqueles: al devolver uno, los demás se separan
              y cada OP recupera su propia remisión pendiente.
            </div>
          )}
          <textarea
            className="input"
            style={{ width: '100%', minHeight: 70, resize: 'vertical' }}
            placeholder="Motivo de la devolución (lo verá el operador)"
            value={motivo}
            onChange={e => onMotivo(e.target.value)}
            maxLength={300}
          />
        </div>
        <div className="cot-modal-actions">
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
            <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn accent" onClick={onConfirm} disabled={busy}>
              {busy ? 'Devolviendo…' : 'Devolver troquel'}
            </button>
          </div>
          {error && <span style={{ fontSize: 12, color: 'var(--danger)', width: '100%', textAlign: 'right' }}>✗ {error}</span>}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─────────── Modal: eliminar la remisión ───────────
// Deshace una liquidación equivocada. El comprobante desaparece y sus OPs
// vuelven a la cola de remisiones del operador para poder rehacerla.
function EliminarModal({ rem, liquidada, agrupadas, busy, error, onClose, onConfirm }) {
  return createPortal(
    <div className="cot-modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="cot-modal" style={{ maxWidth: 460 }}>
        <div className="cot-modal-header">
          <div className="brand"><div className="biz">Eliminar remisión</div></div>
          <button className="btn cot-modal-close" style={{ padding: '4px 8px', fontSize: 13 }} onClick={onClose} disabled={busy}>
            <Icon.X /> Cerrar
          </button>
        </div>
        <div className="cot-modal-body">
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>
            Se eliminará la remisión <strong className="mono">{rem.numero}</strong> de{' '}
            <strong>{rem.cliente_nombre}</strong> con todos sus ítems. <strong>Esta acción no se
            puede deshacer.</strong> Sus OPs vuelven a la cola de remisiones del operador, que podrá
            generarla de nuevo.
          </div>
          {liquidada && (
            <div className="note" style={{ fontSize: 12, marginBottom: 12 }}>
              <Icon.Info /> Esta remisión ya se liquidó y se envió por correo al cliente y a
              contaduría. Borrarla aquí <strong>no deshace ese correo</strong>.
            </div>
          )}
          {agrupadas && (
            <div className="note" style={{ fontSize: 12, marginBottom: 12 }}>
              <Icon.Info /> Agrupa varios troqueles: al eliminarla, cada OP recupera su propia
              remisión pendiente.
            </div>
          )}
        </div>
        <div className="cot-modal-actions">
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
            <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
            <button
              className="btn"
              style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
              onClick={onConfirm}
              disabled={busy}
            >
              <Icon.Trash /> {busy ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
          </div>
          {error && <span style={{ fontSize: 12, color: 'var(--danger)', width: '100%', textAlign: 'right' }}>✗ {error}</span>}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─────────── Modal de envío (espeja CotizacionModal) ───────────
function SendModal({ rem, items, total, desglose, onClose, onSend }) {
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
            <div className="table-scroll">
            <table className="cot-doc-table" style={{ minWidth: 380 }}>
              <thead><tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Vr. Total</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}><td>{it.descripcion || '—'}</td><td className="num">{it.cantidad}</td><td className="num">{fmtCOP(it.valor_total)}</td></tr>
                ))}
                <tr className="cot-doc-total"><td colSpan={2}>Total entregado</td><td className="num">{fmtNum(totalCantidad)} u</td></tr>
                <tr className="cot-doc-total"><td colSpan={2}>Total a pagar</td><td className="num">{fmtCOP(total)}</td></tr>
              </tbody>
            </table>
            </div>
          </div>
          {desglose?.troqueles?.length > 0 && (
            <div className="cot-doc-section">
              <div className="cot-doc-section-title">Desglose del troquel</div>
              <DesgloseTroqueles desglose={desglose} />
            </div>
          )}
          <div className="note" style={{ fontSize: 12 }}>
            <Icon.Info /> Se enviará al cliente y a contabilidad@troquelesink.com, con el total en COP y este mismo desglose en el correo y en el PDF adjunto.
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
            <div className="table-scroll">
            <table className="cot-doc-table" style={{ minWidth: 480 }}>
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
            </div>
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
  const [desglose, setDesglose] = useState(null)
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
  const [devolviendo, setDevolviendo] = useState(null)   // troquel del desglose en devolución
  const [motivo, setMotivo] = useState('')
  const [devBusy, setDevBusy] = useState(false)
  const [devError, setDevError] = useState(null)
  const [borrando, setBorrando] = useState(false)    // modal de eliminación abierto
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState(null)

  const editable = rem?.estado === 'pendiente'
  const liquidada = rem?.estado === 'liquidada'
  const consolidada = rem?.estado === 'consolidada'
  const total = items.reduce((s, it) => s + (Number(it.valor_total) || 0), 0)
  const totalCantidad = items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0)

  const hydrate = (data) => {
    setRem(data)
    // `op` viaja de vuelta al guardar: es lo que ata cada ítem a su OP y permite
    // que poner precios al troquel actualice el valor cobrado.
    setItems((data.items || []).map(i => ({ descripcion: i.descripcion, cantidad: i.cantidad, valor_total: i.valor_total, op: i.op })))
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
    // El desglose es informativo: si falla no debe tumbar la página
    getRemisionDesglose(id).then(setDesglose).catch(() => setDesglose(null))
  }, [id])

  // Tras guardar precios del troquel el backend reescribe el ítem: recarga ambos.
  const recargarTrasPrecios = () => Promise.all([
    getRemision(id).then(hydrate).catch(() => {}),
    getRemisionDesglose(id).then(setDesglose).catch(() => {}),
  ])

  const payload = () => ({
    direccion, ciudad, observaciones,
    items: items.map((it, idx) => ({
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad) || 0,
      valor_total: Number(it.valor_total) || 0,
      orden: idx,
      op: it.op ?? null,
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
    // Al consolidar entran troqueles de otras OPs: el desglose cambia
    getRemisionDesglose(id).then(setDesglose).catch(() => setDesglose(null))
    setShowImport(false)
  }

  const updateItem = (i, field, value) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it))
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  // Devolver el troquel borra la remisión de esa OP. Si es la que se está viendo,
  // ya no hay nada que mostrar; si sobrevive (agrupaba otras OPs), se recarga.
  const handleDevolver = async () => {
    setDevBusy(true)
    setDevError(null)
    try {
      const res = await devolverFormatoCuchillas(devolviendo.formato_id, motivo)
      setDevolviendo(null)
      if (String(res.remision_eliminada_id) === String(id)) navigate('/remisiones', { replace: true })
      else await recargarTrasPrecios()
    } catch (e) {
      setDevError(e.message || 'No se pudo devolver el troquel')
    } finally {
      setDevBusy(false)
    }
  }

  const handleEliminar = async () => {
    setDelBusy(true)
    setDelError(null)
    try {
      await deleteRemision(id)
      navigate('/remisiones', { replace: true })
    } catch (e) {
      setDelError(e.message || 'No se pudo eliminar la remisión')
    } finally {
      setDelBusy(false)
    }
  }

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
          <div className="table-scroll">
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
                  <td colSpan={2} style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700 }}>Total a pagar</td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmtCOP(total)}</td>
                  {editable && <td></td>}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Precios del troquel — editables mientras la remisión esté pendiente */}
        {desglose?.troqueles?.length > 0 && (
          <div className="section open" style={{ marginBottom: 16, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
              {editable ? 'Precios del troquel' : 'Desglose del troquel'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
              {editable
                ? 'El operador registró el consumo; aquí le pones precio. Al guardar, el Vr. Total del ítem se actualiza con el nuevo total. Si el formato de cuchillas está mal, devuelve el troquel al operador.'
                : 'Ítem por ítem, tal como sale en el correo y en el PDF adjunto de la liquidación.'}
            </div>
            <div className="table-scroll">
              {editable
                ? <PreciosTroqueles desglose={desglose} rem={rem} onSaved={recargarTrasPrecios} onDevolver={t => { setMotivo(''); setDevError(null); setDevolviendo(t) }} />
                : <DesgloseTroqueles desglose={desglose} />}
            </div>
          </div>
        )}

        {/* Observaciones */}
        <div className="section open" style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Observaciones</div>
          <textarea className="input" rows={3} value={observaciones} disabled={!editable}
            onChange={e => setObservaciones(e.target.value)} placeholder="Notas para el comprobante…" style={{ resize: 'vertical' }} />
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
          {savedMsg && <span style={{ fontSize: 12, color: savedMsg.startsWith('Error') ? 'var(--danger)' : 'var(--ok)' }}>{savedMsg}</span>}
          {!consolidada && (
            <button
              className="btn"
              style={{ color: 'var(--danger)', marginRight: 'auto' }}
              onClick={() => { setDelError(null); setBorrando(true) }}
              title="Elimina la remisión y devuelve sus OPs a la cola del operador"
            >
              <Icon.Trash /> Eliminar remisión
            </button>
          )}
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
        <SendModal rem={rem} items={items} total={total} desglose={desglose} onClose={() => setShowModal(false)} onSend={handleSend} />
      )}

      {showImport && (
        <ImportRemisionModal rem={rem} onClose={() => setShowImport(false)} onImport={handleImport} />
      )}

      {borrando && (
        <EliminarModal
          rem={rem}
          liquidada={liquidada}
          agrupadas={(desglose?.troqueles?.length || 0) > 1}
          busy={delBusy}
          error={delError}
          onClose={() => setBorrando(false)}
          onConfirm={handleEliminar}
        />
      )}

      {devolviendo && (
        <DevolverModal
          troquel={devolviendo}
          varios={(desglose?.troqueles?.length || 0) > 1}
          busy={devBusy}
          error={devError}
          motivo={motivo}
          onMotivo={setMotivo}
          onClose={() => setDevolviendo(null)}
          onConfirm={handleDevolver}
        />
      )}

      {/* Notificación sutil al historial */}
      {toast && (
        <div className="floating-bar" style={{
          background: 'var(--ink)', color: 'var(--bg)', padding: '12px 18px', borderRadius: 10,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)', fontSize: 13,
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
