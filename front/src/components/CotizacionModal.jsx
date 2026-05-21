import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons'
import { fmtCOP, fmtNum, CONDICIONES_PAGO, STATUS_DEFS } from './core'
import logo from '../assets/logo.png'

function DocSection({ title, children }) {
  return (
    <div className="cot-doc-section">
      <div className="cot-doc-section-title">{title}</div>
      {children}
    </div>
  )
}

export default function CotizacionModal({ d, calc, procesos, onClose, onSend }) {
  const [email, setEmail] = useState(d.clienteEmail || '')
  const [extraEmails, setExtraEmails] = useState([])
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null) // { ok, msg }

  const condicionLabel = (() => {
    if (d.condicionPago === 'custom') return d.condicionCustom || 'Personalizado'
    return CONDICIONES_PAGO.find(x => x.id === d.condicionPago)?.lbl || '—'
  })()

  const estadoDef = STATUS_DEFS.find(s => s.id === d.estado)

  const handleSend = async () => {
    if (!email.trim()) return
    setSending(true)
    setSendResult(null)
    try {
      const validExtras = extraEmails.filter(e => e.trim())
      await onSend(email.trim(), validExtras)
      const allAddrs = [email.trim(), ...validExtras]
      setSendResult({ ok: true, msg: `Enviado a ${allAddrs.join(', ')}` })
    } catch (e) {
      setSendResult({ ok: false, msg: e.message || 'Error al enviar' })
    } finally {
      setSending(false)
    }
  }

  const addExtraEmail = () => setExtraEmails(prev => [...prev, ''])
  const updateExtraEmail = (i, v) => setExtraEmails(prev => prev.map((e, idx) => idx === i ? v : e))
  const removeExtraEmail = (i) => setExtraEmails(prev => prev.filter((_, idx) => idx !== i))

  const handlePrint = () => window.print()

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div className="cot-modal-backdrop" onClick={handleBackdrop}>
      <div className="cot-modal">

        {/* Modal header */}
        <div className="cot-modal-header">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={logo} alt="Troqueles INK" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            <div className="biz">Troqueles INK</div>
            <span className="div">/</span>
            <div className="mod mono">{d.numero}</div>
            {estadoDef && (
              <span className={'badge ' + estadoDef.cls} style={{ marginLeft: 4 }}>
                <span className="dot"></span>{estadoDef.label}
              </span>
            )}
          </div>
          <button
            className="btn cot-modal-close"
            style={{ padding: '4px 8px', fontSize: 13 }}
            onClick={onClose}
          >
            <Icon.X /> Cerrar
          </button>
        </div>

        {/* Document body */}
        <div className="cot-modal-body">

          {/* Client + general info */}
          <DocSection title="Información general">
            <table className="cot-doc-table">
              <tbody>
                <tr>
                  <td style={{ color: 'var(--ink-3)', width: 160 }}>Cliente</td>
                  <td style={{ fontWeight: 600 }}>{d.cliente || '—'}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Tipo</td>
                  <td>{d.tipoCliente === 'terciario' ? 'Cliente Terciario' : 'Cliente Final'}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Fecha</td>
                  <td className="mono">{d.fecha}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Referencia</td>
                  <td>{d.referencia || '—'}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Cantidad</td>
                  <td className="mono">{fmtNum(d.cantidad)} unidades</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Condición de pago</td>
                  <td>{condicionLabel}</td>
                </tr>
              </tbody>
            </table>
          </DocSection>

          {/* Active processes */}
          {calc.procRows.length > 0 && (
            <DocSection title="Procesos de producción">
              <table className="cot-doc-table">
                <thead>
                  <tr>
                    <th>Proceso</th>
                    <th className="num">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.procRows.map(p => (
                    <tr key={p.id}>
                      <td>{p.nombre}</td>
                      <td className="num">{fmtCOP(p.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DocSection>
          )}

          {/* Liquidation */}
          <DocSection title="Liquidación">
            <table className="cot-doc-table">
              <tbody>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Papel</td>
                  <td className="num">{fmtCOP(calc.costoPapel)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Total costos OP</td>
                  <td className="num">{fmtCOP(calc.totalCostosOP)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Valor unitario</td>
                  <td className="num">{fmtCOP(calc.valorUnitario)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--ink-3)' }}>Cantidad</td>
                  <td className="num">{fmtNum(d.cantidad)} u</td>
                </tr>
                <tr className="cot-doc-total">
                  <td>Total cliente</td>
                  <td className="num">{fmtCOP(calc.valorTotal)}</td>
                </tr>
              </tbody>
            </table>
          </DocSection>

          {/* Observations */}
          {d.observaciones && (
            <DocSection title="Observaciones">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {d.observaciones}
              </p>
            </DocSection>
          )}

        </div>

        {/* Actions (hidden on print) */}
        <div className="cot-modal-actions">
          <div className="cot-modal-email-row">
            <input
              className="input"
              type="email"
              placeholder="Correo del cliente…"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn accent"
              onClick={handleSend}
              disabled={sending || !email.trim()}
              style={{ whiteSpace: 'nowrap' }}
            >
              <Icon.Send /> {sending ? 'Enviando…' : 'Enviar correo'}
            </button>
          </div>
          {extraEmails.map((e, i) => (
            <div key={i} className="cot-modal-email-row" style={{ marginTop: 6 }}>
              <input
                className="input"
                type="email"
                placeholder="Correo adicional…"
                value={e}
                onChange={ev => updateExtraEmail(i, ev.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn"
                onClick={() => removeExtraEmail(i)}
                style={{ whiteSpace: 'nowrap', padding: '6px 10px' }}
                title="Eliminar"
              >
                <Icon.X />
              </button>
            </div>
          ))}
          <button
            className="btn"
            onClick={addExtraEmail}
            style={{ alignSelf: 'flex-start', fontSize: 12, marginTop: 4 }}
          >
            + Agregar destinatario
          </button>
          {sendResult && (
            <span style={{
              fontSize: 12, fontWeight: 500,
              color: sendResult.ok ? 'var(--ok)' : 'var(--danger)',
              width: '100%', textAlign: 'right',
            }}>
              {sendResult.ok ? '✓ ' : '✗ '}{sendResult.msg}
            </span>
          )}
          <button className="btn" onClick={handlePrint} style={{ whiteSpace: 'nowrap' }}>
            <Icon.Print /> Descargar PDF
          </button>
        </div>

      </div>
    </div>,
    document.body
  )
}
