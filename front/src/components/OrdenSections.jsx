import { useState, useRef } from 'react'
import { Section, Checkbox, MoneyInput, NumField, fmtCOP, PROCESOS_OP, MAQUINAS_OP, OP_STATUS_DEFS, OP_PROCESO_ESTADOS, CONDICIONES_PAGO_OP } from './core'
import { Icon } from './Icons'
import { getClientes } from '../api'

// ─── Generales ────────────────────────────────────────────────────────────────

export function SectionOpGenerales({ d, set, open, onToggle, operarios = [], isAdmin }) {
  const [sugs, setSugs] = useState([])
  const debRef = useRef(null)

  const onClienteInput = (v) => {
    set({ clienteNombre: v, clienteId: null })
    clearTimeout(debRef.current)
    if (v.length < 2) { setSugs([]); return }
    debRef.current = setTimeout(() =>
      getClientes(v).then(r => setSugs(r.results || r)).catch(() => setSugs([])), 250)
  }

  const selectCliente = (c) => {
    set({ clienteNombre: c.nombre, clienteId: c.id, tipoClienteOp: c.tipo || 'final' })
    setSugs([])
  }

  const summary = d.clienteNombre
    ? `${d.clienteNombre} · ${d.referencia || '—'}`
    : '—'

  return (
    <Section num="1" title="Generales" desc="cliente, referencia, fecha" open={open} onToggle={onToggle} summary={summary}>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <div className="field-label">Fecha <span className="req">*</span></div>
          <input
            type="date"
            className="input"
            value={d.fecha}
            onChange={e => set({ fecha: e.target.value })}
            readOnly={!isAdmin}
          />
        </div>
        <div className="field">
          <div className="field-label">OP # (auto)</div>
          <input className="input readonly" value={d.numero || 'Auto'} readOnly />
        </div>

        <div className="field col-span-2" style={{ position: 'relative' }}>
          <div className="field-label">Cliente <span className="req">*</span></div>
          <input
            className="input"
            value={d.clienteNombre}
            onChange={e => onClienteInput(e.target.value)}
            placeholder="Buscar cliente…"
            readOnly={!isAdmin}
          />
          {sugs.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius)', zIndex: 40, maxHeight: 200, overflowY: 'auto',
              boxShadow: 'var(--shadow-md)',
            }}>
              {sugs.map(c => (
                <div
                  key={c.id}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
                  onMouseDown={() => selectCliente(c)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <strong>{c.nombre}</strong>
                  <span style={{ color: 'var(--ink-3)', marginLeft: 8, fontSize: 11 }}>
                    {c.tipo === 'terciario' ? '· Terciario' : '· Final'}
                    {c.nit ? ` · NIT ${c.nit}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="field col-span-2">
          <div className="field-label">Referencia del producto <span className="req">*</span></div>
          <input
            className="input"
            value={d.referencia}
            onChange={e => set({ referencia: e.target.value })}
            placeholder="Ej: Caja 20×15×8 cm — Corrugado doble"
            readOnly={!isAdmin}
          />
        </div>

        <div className="field col-span-2">
          <div className="field-label">Descripción adicional</div>
          <textarea
            className="input textarea"
            value={d.descripcion}
            onChange={e => set({ descripcion: e.target.value })}
            placeholder="Detalles técnicos, instrucciones especiales…"
            readOnly={!isAdmin}
          />
        </div>

        {d.cotizacionNumero && (
          <div className="field col-span-2">
            <div className="field-label">Cotización origen</div>
            <input className="input readonly" value={d.cotizacionNumero} readOnly />
          </div>
        )}
      </div>
    </Section>
  )
}

// ─── Especificaciones técnicas ─────────────────────────────────────────────────

export function SectionOpEspecificaciones({ d, set, open, onToggle, isAdmin }) {
  return (
    <Section num="2" title="Especificaciones técnicas" desc="cantidad, pliegos, medidas" open={open} onToggle={onToggle}>
      <div className="grid grid-3" style={{ gap: 12 }}>
        <div className="field">
          <div className="field-label">Cantidad solicitada <span className="req">*</span></div>
          <NumField
            value={d.cantidad}
            onChange={v => set({ cantidad: v })}
            step={1}
            className={!isAdmin ? 'readonly' : ''}
          />
        </div>
        <div className="field">
          <div className="field-label">Valor unitario</div>
          <MoneyInput
            value={d.valorUnitario}
            onChange={v => set({ valorUnitario: v })}
            style={{ flex: 1 }}
          />
        </div>
        <div className="field">
          <div className="field-label">Cantidad pliegos</div>
          <NumField
            value={d.cantidadPliegos}
            onChange={v => set({ cantidadPliegos: v })}
            step={1}
            className={!isAdmin ? 'readonly' : ''}
          />
        </div>

        <div className="field">
          <div className="field-label">Referencia papel</div>
          <input
            className="input"
            value={d.papelReferencia}
            onChange={e => set({ papelReferencia: e.target.value })}
            placeholder="Ej: Propalcote 300g"
            readOnly={!isAdmin}
          />
        </div>
        <div className="field">
          <div className="field-label">Corte inicial</div>
          <input
            className="input"
            value={d.corteInicial}
            onChange={e => set({ corteInicial: e.target.value })}
            placeholder="Ej: 70 × 50 cm"
            readOnly={!isAdmin}
          />
        </div>
        <div className="field">
          <div className="field-label">Corte final</div>
          <input
            className="input"
            value={d.corteFinal}
            onChange={e => set({ corteFinal: e.target.value })}
            placeholder="Ej: 35 × 25 cm"
            readOnly={!isAdmin}
          />
        </div>

        <div className="field">
          <div className="field-label">Medida del producto</div>
          <input
            className="input"
            value={d.medidaProducto}
            onChange={e => set({ medidaProducto: e.target.value })}
            placeholder="Ej: 20 × 15 × 8 cm"
            readOnly={!isAdmin}
          />
        </div>
        <div className="field">
          <div className="field-label">Cantidad impresión</div>
          <NumField
            value={d.cantidadImpresion}
            onChange={v => set({ cantidadImpresion: v })}
            step={1}
            className={!isAdmin ? 'readonly' : ''}
          />
        </div>
      </div>
    </Section>
  )
}

// ─── Procesos ─────────────────────────────────────────────────────────────────

export function SectionOpProcesos({ procesos, setProc, open, onToggle, operarios = [], isAdmin }) {
  // Group by machine for visual organization
  const byMaquina = {}
  PROCESOS_OP.forEach(([pid, label, mid]) => {
    if (!byMaquina[mid]) byMaquina[mid] = []
    byMaquina[mid].push([pid, label])
  })

  const maquinaLabel = (mid) => MAQUINAS_OP.find(m => m.id === mid)?.label || mid

  return (
    <Section num="3" title="Procesos" desc="activar procesos y asignar operarios" open={open} onToggle={onToggle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {Object.entries(byMaquina).map(([mid, procs]) => (
          <div key={mid}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
              color: 'var(--ink-3)', marginBottom: 8, paddingBottom: 4,
              borderBottom: '1px solid var(--line)',
            }}>
              {maquinaLabel(mid)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {procs.map(([pid, label]) => {
                const p = procesos[pid] || {}
                return (
                  <div
                    key={pid}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isAdmin
                        ? '24px 1fr 160px 160px 120px'
                        : '24px 1fr 120px 120px',
                      gap: 8,
                      alignItems: 'center',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius)',
                      background: p.active ? 'var(--accent-soft)' : 'transparent',
                      border: '1px solid',
                      borderColor: p.active ? 'var(--accent)' : 'transparent',
                    }}
                  >
                    <Checkbox
                      checked={!!p.active}
                      onChange={isAdmin ? () => setProc(pid, { active: !p.active }) : undefined}
                    />
                    <span style={{ fontSize: 13, fontWeight: p.active ? 600 : 400, color: p.active ? 'var(--ink)' : 'var(--ink-2)' }}>
                      {label}
                    </span>
                    {p.active && (
                      <>
                        <div className="field" style={{ margin: 0 }}>
                          <MoneyInput
                            value={p.costo || 0}
                            onChange={v => isAdmin && setProc(pid, { costo: v })}
                          />
                        </div>
                        {isAdmin && (
                          <select
                            className="select"
                            value={p.operario || ''}
                            onChange={e => setProc(pid, {
                              operario: e.target.value ? Number(e.target.value) : null,
                              operarioNombre: e.target.options[e.target.selectedIndex]?.text || '',
                            })}
                          >
                            <option value="">Sin asignar</option>
                            {operarios.map(op => (
                              <option key={op.id} value={op.id}>
                                {op.first_name ? `${op.first_name} ${op.last_name}`.trim() : op.username}
                              </option>
                            ))}
                          </select>
                        )}
                        <div>
                          <span className={`semaforo ${p.estado || 'pendiente'}`} style={{ display: 'inline-block', marginRight: 4 }} />
                          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            {OP_PROCESO_ESTADOS.find(e => e.id === (p.estado || 'pendiente'))?.label}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Liquidación ──────────────────────────────────────────────────────────────

export function SectionOpLiquidacion({ d, set, procesos, open, onToggle, isAdmin }) {
  const totalCostosCalc = PROCESOS_OP
    .filter(([pid]) => procesos[pid]?.active)
    .reduce((s, [pid]) => s + (procesos[pid]?.costo || 0), 0)

  const valorTotal = d.valorTotal || 0
  const subtotal = valorTotal - (d.totalCostos || 0)
  const saldo = valorTotal - (d.abono || 0)

  return (
    <Section num="4" title="Liquidación" desc="costos, valor total, abono, saldo" open={open} onToggle={onToggle}>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <div className="field-label">Total costos OP</div>
          <MoneyInput
            value={d.totalCostos || totalCostosCalc}
            onChange={v => isAdmin && set({ totalCostos: v })}
          />
          <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            Auto: {fmtCOP(totalCostosCalc)}
          </span>
        </div>
        <div className="field">
          <div className="field-label">Valor unitario</div>
          <MoneyInput
            value={d.valorUnitario || 0}
            onChange={v => isAdmin && set({ valorUnitario: v })}
          />
        </div>

        <div className="field">
          <div className="field-label">Valor total</div>
          <MoneyInput
            value={d.valorTotal || 0}
            onChange={v => isAdmin && set({ valorTotal: v })}
          />
        </div>
        <div className="field">
          <div className="field-label">Subtotal (Val. total − Costos)</div>
          <input
            className="input calc mono"
            value={fmtCOP(subtotal)}
            readOnly
          />
        </div>

        <div className="field">
          <div className="field-label">Abono recibido</div>
          <MoneyInput
            value={d.abono || 0}
            onChange={v => isAdmin && set({ abono: v })}
          />
        </div>
        <div className="field">
          <div className="field-label">Saldo pendiente</div>
          <input
            className="input calc mono"
            value={fmtCOP(saldo)}
            readOnly
            style={{ color: saldo > 0 ? 'var(--warn)' : 'var(--ok)', fontWeight: 700 }}
          />
        </div>
      </div>
    </Section>
  )
}

// ─── Condiciones ──────────────────────────────────────────────────────────────

export function SectionOpCondiciones({ d, set, open, onToggle, isAdmin }) {
  return (
    <Section num="5" title="Condiciones" desc="tipo cliente, pago, facturación" open={open} onToggle={onToggle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Tipo cliente OP */}
        <div className="field">
          <div className="field-label">Tipo de cliente (para esta OP)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['final', 'Cliente Final'], ['terciario', 'Cliente Terciario']].map(([v, lbl]) => (
              <div
                key={v}
                className={'cond-pago-options'}
                style={{ display: 'flex' }}
              >
                <div
                  className={'opt' + (d.tipoClienteOp === v ? ' active' : '')}
                  onClick={() => isAdmin && set({ tipoClienteOp: v })}
                  style={{ cursor: isAdmin ? 'pointer' : 'default' }}
                >
                  <div className="lbl">{lbl}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Condición cobro terciario */}
        {d.tipoClienteOp === 'terciario' && (
          <div className="field">
            <div className="field-label">Cobrar con</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['op', 'Solo OP'], ['remision', 'Remisión'], ['factura', 'Factura']].map(([v, lbl]) => (
                <div
                  key={v}
                  style={{
                    padding: '8px 14px', borderRadius: 'var(--radius)',
                    border: `1px solid ${d.condicionCobroTerciario === v ? 'var(--accent)' : 'var(--line-strong)'}`,
                    background: d.condicionCobroTerciario === v ? 'var(--accent-soft)' : 'transparent',
                    cursor: isAdmin ? 'pointer' : 'default',
                    fontSize: 12, fontWeight: 600,
                  }}
                  onClick={() => isAdmin && set({ condicionCobroTerciario: v })}
                >
                  {lbl}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Condición pago */}
        <div className="field">
          <div className="field-label">Condición de pago</div>
          <div className="cond-pago-options">
            {CONDICIONES_PAGO_OP.map(c => (
              <div
                key={c.id}
                className={'opt' + (d.condicionPago === c.id ? ' active' : '')}
                onClick={() => isAdmin && set({ condicionPago: c.id })}
                style={{ cursor: isAdmin ? 'pointer' : 'default' }}
              >
                <div className="lbl">{c.lbl}</div>
                <div className="sub">{c.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Observaciones */}
        <div className="field">
          <div className="field-label">Observaciones</div>
          <textarea
            className="input textarea"
            value={d.observaciones}
            onChange={e => set({ observaciones: e.target.value })}
            placeholder="Instrucciones especiales, notas internas…"
            readOnly={!isAdmin}
          />
        </div>
      </div>
    </Section>
  )
}

// ─── Estado (admin only) ────────────────────────────────────────────────────────

export function SectionOpEstado({ d, set, open, onToggle, onCambiarEstado, saving }) {
  return (
    <Section num="6" title="Estado de la OP" desc="cambiar estado manualmente" open={open} onToggle={onToggle}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {OP_STATUS_DEFS.map(s => (
          <span
            key={s.id}
            className={'badge ' + s.cls + (d.estado === s.id ? ' active' : '')}
            style={{
              cursor: s.id !== 'anulada' ? 'pointer' : 'default',
              userSelect: 'none',
              opacity: saving ? 0.6 : 1,
              transform: d.estado === s.id ? 'scale(1.05)' : 'scale(1)',
              transition: 'transform 0.1s',
            }}
            onClick={() => s.id !== 'anulada' && !saving && onCambiarEstado(s.id)}
          >
            <span className="dot"></span>
            {s.label}
            {d.estado === s.id && ' ✓'}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-3)' }}>
        "Anulada" solo se puede cambiar desde el botón Anular en la lista.
      </div>
    </Section>
  )
}
