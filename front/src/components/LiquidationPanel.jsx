import { useState } from 'react'
import { Icon } from './Icons'
import { fmtCOP, fmtNum } from './core'
import { pdfInterno } from '../api'

function LiqInput({ value, onChange, isOverridden, onReset, big }) {
  const display = Number(Math.round(value || 0)).toLocaleString('es-CO')
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
      {isOverridden && (
        <span onClick={onReset} title="Restaurar al cálculo automático"
          style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>↺</span>
      )}
      <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11, marginRight: -2 }}>$</span>
      <input
        type="text"
        inputMode="numeric"
        className={'liq-input mono' + (big ? ' big' : '') + (isOverridden ? ' overridden' : '')}
        value={display}
        onChange={(e) => {
          const v = parseInt(e.target.value.replace(/[^\d]/g, '')) || 0
          onChange(v)
        }}
      />
    </div>
  )
}

export default function LiquidationPanel({ d, set, calc, onSave, saving }) {
  const isConvertida = d.estado === 'convertida'
  const [dlPdf, setDlPdf] = useState(false)

  const handlePdfInterno = async () => {
    if (!d.id) return
    setDlPdf(true)
    try {
      const r = await pdfInterno(d.id, calc)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `Interno_${d.numero}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setDlPdf(false)
    }
  }

  return (
    <div className="liq">
      <div className="liq-header">
        <div>
          <div className="ttl">Liquidación</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>Sección 4 · siempre visible</div>
        </div>
        <div className="sub">{d.numero}</div>
      </div>
      <div className="liq-body">
        <table className="liq-table">
          <tbody>
            <tr>
              <td>Papel</td>
              <td className="mono">{fmtCOP(calc.costoPapel)}</td>
            </tr>
            {calc.procRows.map((p) => (
              <tr key={p.id} className="indent">
                <td>{p.nombre}</td>
                <td className="mono">{fmtCOP(p.costo)}</td>
              </tr>
            ))}
            <tr className="subtotal">
              <td>Total Costos OP <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>· suma de procesos</span></td>
              <td>
                <LiqInput
                  value={calc.totalCostosOP}
                  onChange={(v) => set({ totalCostosOverride: v })}
                  isOverridden={d.totalCostosOverride !== null}
                  onReset={() => set({ totalCostosOverride: null })}
                />
              </td>
            </tr>

            <tr>
              <td style={{ paddingTop: 6 }}>
                Margen de ganancia <span className="editable-flag"><Icon.Pencil /></span>
              </td>
              <td style={{ paddingTop: 6 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="liq-input mono"
                    style={{ width: 52 }}
                    value={d.margen ?? 80}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value.replace(/[^\d.]/g, '')) || 0
                      set({ margen: v })
                    }}
                  />
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>%</span>
                </div>
              </td>
            </tr>

            <tr style={{ height: 6 }}><td colSpan="2"></td></tr>

            <tr>
              <td>Cantidad solicitada</td>
              <td className="mono">{fmtNum(d.cantidad)} u</td>
            </tr>
            <tr>
              <td>× Valor unitario <span className="editable-flag"><Icon.Pencil /></span></td>
              <td>
                <LiqInput
                  value={calc.valorUnitario}
                  onChange={(v) => set({ valorUnitarioOverride: v })}
                  isOverridden={d.valorUnitarioOverride !== null}
                  onReset={() => set({ valorUnitarioOverride: null })}
                />
              </td>
            </tr>
            <tr className="subtotal">
              <td>Valor Total</td>
              <td>
                <LiqInput
                  value={calc.valorTotal}
                  onChange={(v) => set({ valorTotalOverride: v })}
                  isOverridden={d.valorTotalOverride !== null}
                  onReset={() => set({ valorTotalOverride: null })}
                />
              </td>
            </tr>

            <tr style={{ height: 6 }}><td colSpan="2"></td></tr>

            <tr className="subtotal">
              <td>Subtotal <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>· Valor Total − Costos OP</span></td>
              <td>
                <LiqInput
                  value={calc.subtotal}
                  onChange={(v) => set({ subtotalOverride: v })}
                  isOverridden={d.subtotalOverride !== null}
                  onReset={() => set({ subtotalOverride: null })}
                />
              </td>
            </tr>
            <tr className="total">
              <td>Total cliente</td>
              <td>{fmtCOP(calc.valorTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: 14, padding: 10, background: 'var(--surface-2)', borderRadius: 6, fontSize: 11, color: 'var(--ink-3)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Icon.Calc />
          <div>Todos los valores son editables: escribe directamente el número que deseas. El ↺ restaura el cálculo automático.</div>
        </div>
      </div>
      <div className="liq-footer">
<button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={onSave} disabled={saving || isConvertida}>
          <Icon.Save /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
            onClick={handlePdfInterno}
            disabled={dlPdf || !d.id}
            title="Descargar PDF interno (con costos)"
          >
            <Icon.Print /> {dlPdf ? '…' : 'PDF interno'}
          </button>
        </div>
        {isConvertida && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-3)', justifyContent: 'center', paddingTop: 6 }}>
            <Icon.Lock /> Convertida a OP — solo lectura
          </div>
        )}
      </div>
    </div>
  )
}
