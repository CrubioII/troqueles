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

export default function LiquidationPanel({
  d, set, calc, onSave, onSaveAndSend, saving, originalEstado,
  mode = 'cot', locked = false, onPdfAdmin, onPdfProduccion,
}) {
  const isOp = mode === 'op'
  const isConvertida = !isOp && (originalEstado || d.estado) === 'convertida'
  const [dlPdf, setDlPdf] = useState(false)
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900)

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

  const saldo = (calc.valorTotal || 0) - (d.abono || 0)
  // Celda editable u override-able; en modo locked se muestra texto plano
  const liqCell = (value, overrideKey) =>
    locked
      ? <span className="mono">{fmtCOP(value)}</span>
      : (
        <LiqInput
          value={value}
          onChange={(v) => set({ [overrideKey]: v })}
          isOverridden={d[overrideKey] !== null}
          onReset={() => set({ [overrideKey]: null })}
        />
      )

  return (
    <div className={'liq' + (collapsed ? ' collapsed' : '')}>
      <div className="liq-header" style={{ cursor: 'pointer' }} onClick={() => setCollapsed(c => !c)}>
        <div>
          <div className="ttl">Liquidación</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>Sección 4 · siempre visible</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <div className="sub">{d.numero}</div>
          <span style={{
            fontSize: 16, lineHeight: 1, color: 'rgba(255,255,255,0.8)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(90deg)',
            transition: 'transform 0.2s',
            display: 'inline-block',
          }}>›</span>
        </div>
      </div>
      {!collapsed && <div className="liq-body">
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
              <td>{liqCell(calc.totalCostosOP, 'totalCostosOverride')}</td>
            </tr>

            <tr>
              <td style={{ paddingTop: 6 }}>
                Margen de ganancia {!locked && <span className="editable-flag"><Icon.Pencil /></span>}
              </td>
              <td style={{ paddingTop: 6 }}>
                {locked ? (
                  <span className="mono">{d.margen ?? 80} %</span>
                ) : (
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
                )}
              </td>
            </tr>

            <tr style={{ height: 6 }}><td colSpan="2"></td></tr>

            <tr>
              <td>Cantidad solicitada</td>
              <td className="mono">{fmtNum(d.cantidad)} u</td>
            </tr>
            <tr>
              <td>× Valor unitario {!locked && <span className="editable-flag"><Icon.Pencil /></span>}</td>
              <td>{liqCell(calc.valorUnitario, 'valorUnitarioOverride')}</td>
            </tr>
            <tr className="subtotal">
              <td>Valor Total</td>
              <td>{liqCell(calc.valorTotal, 'valorTotalOverride')}</td>
            </tr>

            <tr style={{ height: 6 }}><td colSpan="2"></td></tr>

            <tr className="subtotal">
              <td>Subtotal <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>· Valor Total − Costos OP</span></td>
              <td>{liqCell(calc.subtotal, 'subtotalOverride')}</td>
            </tr>
            <tr className="total">
              <td>Total cliente</td>
              <td>{fmtCOP(calc.valorTotal)}</td>
            </tr>

            {isOp && (
              <>
                <tr style={{ height: 6 }}><td colSpan="2"></td></tr>
                <tr>
                  <td>Abono <span className="editable-flag"><Icon.Pencil /></span></td>
                  <td>
                    <LiqInput
                      value={d.abono || 0}
                      onChange={(v) => set({ abono: v })}
                      isOverridden={false}
                    />
                  </td>
                </tr>
                <tr className="total">
                  <td>Saldo pendiente</td>
                  <td style={saldo > 0 ? { color: 'var(--danger, #c0392b)' } : undefined}>{fmtCOP(saldo)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>

        <div style={{ marginTop: 14, padding: 10, background: 'var(--surface-2)', borderRadius: 6, fontSize: 11, color: 'var(--ink-3)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Icon.Calc />
          <div>
            {locked
              ? 'Valores pactados en la cotización. Solo el abono es editable.'
              : 'Todos los valores son editables: escribe directamente el número que deseas. El ↺ restaura el cálculo automático.'}
          </div>
        </div>
      </div>}
      {!collapsed && <div className="liq-footer">
        {!isOp && (
          <button
            className="btn accent"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={onSaveAndSend}
            disabled={saving || isConvertida}
          >
            <Icon.Send /> {saving ? 'Guardando…' : 'Guardar y Enviar al Cliente'}
          </button>
        )}
        <button className={'btn' + (isOp ? ' accent' : '')} style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={onSave} disabled={saving || isConvertida}>
          <Icon.Save /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          {isOp ? (
            <>
              <button
                className="btn"
                style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                onClick={onPdfAdmin}
                disabled={!d.id}
                title="PDF completo: cliente + finanzas"
              >
                <Icon.Print /> PDF Admin
              </button>
              <button
                className="btn"
                style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                onClick={onPdfProduccion}
                disabled={!d.id}
                title="PDF para taller: sin cliente ni valores"
              >
                <Icon.Print /> PDF Producción
              </button>
            </>
          ) : (
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
              onClick={handlePdfInterno}
              disabled={dlPdf || !d.id}
              title="Descargar PDF interno (con costos)"
            >
              <Icon.Print /> {dlPdf ? '…' : 'PDF interno'}
            </button>
          )}
        </div>
        {isConvertida && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-3)', justifyContent: 'center', paddingTop: 6 }}>
            <Icon.Lock /> Convertida a OP — solo lectura
          </div>
        )}
      </div>}
    </div>
  )
}
