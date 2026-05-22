import { useState, useRef } from 'react'
import { Icon } from './Icons'
import { getClientes } from '../api'
import {
  fmtCOP, fmtNum,
  PLIEGO_SIZES, DISENADORES, PROCESS_GROUPS, STATUS_DEFS, CONDICIONES_PAGO,
  SheetDiagram, Checkbox, MoneyInput, StatusPicker, NumField,
} from './core'

// =========================================================
// Section 1 — Datos Generales
// =========================================================
export function SectionGenerales({ d, set }) {
  const [suggestions, setSuggestions] = useState([])
  const [showSugg, setShowSugg] = useState(false)
  const searchRef = useRef(null)

  const handleClienteChange = (v) => {
    set({ cliente: v, clienteId: null })
    clearTimeout(searchRef.current)
    if (!v.trim()) { setSuggestions([]); setShowSugg(false); return }
    searchRef.current = setTimeout(() => {
      getClientes(v).then(data => {
        const results = data.results || data
        setSuggestions(results)
        setShowSugg(results.length > 0)
      }).catch(() => {})
    }, 250)
  }

  const selectCliente = (c) => {
    set({ cliente: c.nombre, clienteId: c.id, clienteEmail: c.email || '', clienteTelefono: c.telefono || '', clienteNit: c.nit || '' })
    setSuggestions([])
    setShowSugg(false)
  }

  return (
    <div className="grid grid-6" style={{ gap: 14 }}>
      <div className="field">
        <label className="field-label">N° cotización <Icon.Lock /></label>
        <input className="input readonly mono" value={d.numero} readOnly />
      </div>
      <div className="field">
        <label className="field-label">Fecha <span className="editable-flag" title="Editable por admin"><Icon.Pencil /></span></label>
        <input className="input admin-editable mono" value={d.fecha} onChange={e => set({ fecha: e.target.value })} />
      </div>
      <div className="field col-span-2" style={{ position: 'relative' }}>
        <label className="field-label">
          Cliente <span className="req">*</span>
          {d.clienteId && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ok, #27ae60)', fontWeight: 600 }}>✓ vinculado</span>}
          {!d.clienteId && d.cliente && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-3)' }}>· se creará nuevo</span>}
        </label>
        <input
          className="input"
          placeholder="Buscar cliente existente o escribir nuevo…"
          value={d.cliente}
          onChange={e => handleClienteChange(e.target.value)}
          onBlur={() => setTimeout(() => setShowSugg(false), 150)}
          onFocus={() => suggestions.length > 0 && setShowSugg(true)}
        />
        {showSugg && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2,
          }}>
            {suggestions.map(c => (
              <div
                key={c.id}
                onMouseDown={() => selectCliente(c)}
                style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ flex: 1 }}>{c.nombre}</span>
                {c.tipo === 'terciario' && <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Terciario</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="field col-span-2">
        <label className="field-label">Tipo de cliente</label>
        <div className="seg">
          <button className={d.tipoCliente === 'final' ? 'active' : ''} onClick={() => set({ tipoCliente: 'final' })}>Cliente Final</button>
          <button className={d.tipoCliente === 'terciario' ? 'active' : ''} onClick={() => set({ tipoCliente: 'terciario' })}>Cliente Terciario</button>
        </div>
      </div>

      <div className="field col-span-2">
        <label className="field-label">Correo del cliente</label>
        <input
          className="input"
          type="email"
          placeholder="correo@empresa.com"
          value={d.clienteEmail || ''}
          onChange={e => set({ clienteEmail: e.target.value })}
        />
      </div>
      <div className="field col-span-2">
        <label className="field-label">Teléfono</label>
        <input
          className="input"
          type="tel"
          placeholder="Ej. 3001234567"
          value={d.clienteTelefono || ''}
          onChange={e => set({ clienteTelefono: e.target.value })}
        />
      </div>
      <div className="field col-span-2">
        <label className="field-label">NIT / Cédula</label>
        <input
          className="input"
          placeholder="Ej. 900.123.456-7"
          value={d.clienteNit || ''}
          onChange={e => set({ clienteNit: e.target.value })}
        />
      </div>

      <div className="field col-span-2">
        <label className="field-label">Referencia / descripción del producto <span className="req">*</span></label>
        <input className="input" placeholder="Ej. Caja plegadiza para fragancia 100ml" value={d.referencia} onChange={e => set({ referencia: e.target.value })} />
      </div>
      <div className="field col-span-1">
        <label className="field-label">Cantidad solicitada <span className="req">*</span></label>
        <div className="input-affix">
          <NumField value={d.cantidad} onChange={v => set({ cantidad: Math.round(v) })} step={1} />
          <span className="suffix">uds</span>
        </div>
      </div>
      <div className="field col-span-1">
        <label className="field-label">Sobrante</label>
        <div className="input-affix">
          <NumField value={d.sobrante || 0} onChange={v => set({ sobrante: Math.round(v) })} step={1} min={0} />
          <span className="suffix">uds</span>
        </div>
      </div>
      <div className="field col-span-2">
        <label className="field-label">Estado <span className="editable-flag"><Icon.Pencil /></span></label>
        <StatusPicker value={d.estado} onChange={(v) => set({ estado: v })} />
      </div>
    </div>
  )
}

// =========================================================
// Section 2 — Calculadora de Papel
// =========================================================
export function SectionPapel({ d, set, calc, papelCatalog }) {
  return (
    <div className="papel-layout">
      <div className="papel-block">
        <div className="papel-block-title">Dimensiones</div>
        <div className="grid grid-2" style={{ gap: 14 }}>
          <div className="field">
            <label className="field-label">Ancho del molde abierto</label>
            <div className="input-affix">
              <NumField value={d.moldeAncho} onChange={v => set({ moldeAncho: v })} step={0.1} />
              <span className="suffix">cm</span>
            </div>
          </div>
          <div className="field">
            <label className="field-label">Alto del molde abierto</label>
            <div className="input-affix">
              <NumField value={d.moldeAlto} onChange={v => set({ moldeAlto: v })} step={0.1} />
              <span className="suffix">cm</span>
            </div>
          </div>

          <div className={'field ' + (d.pliegoTipo === 'custom' ? '' : 'col-span-2')}>
            <label className="field-label">Tipo de pliego</label>
            <select className="select" value={d.pliegoTipo} onChange={e => {
              const t = PLIEGO_SIZES.find(p => p.id === e.target.value)
              if (t && t.id !== 'custom') set({ pliegoTipo: t.id, pliegoW: t.w, pliegoH: t.h })
              else set({ pliegoTipo: 'custom' })
            }}>
              {PLIEGO_SIZES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          {d.pliegoTipo === 'custom' && (
            <>
              <div className="field">
                <label className="field-label">Pliego ancho</label>
                <div className="input-affix"><NumField value={d.pliegoW} onChange={v => set({ pliegoW: v })} step={0.1} /><span className="suffix">cm</span></div>
              </div>
              <div className="field">
                <label className="field-label">Pliego alto</label>
                <div className="input-affix"><NumField value={d.pliegoH} onChange={v => set({ pliegoH: v })} step={0.1} /><span className="suffix">cm</span></div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="papel-block">
        <div className="papel-block-title">Catálogo de papel · costo</div>
        <div className="grid grid-3" style={{ gap: 14 }}>
          <div className="field col-span-2">
            <label className="field-label">Referencia del papel <span className="hint">— catálogo administrable</span></label>
            <select className="select" value={d.papelId} onChange={e => {
              const v = e.target.value
              if (v === 'manual') { set({ papelId: 'manual' }); return }
              const p = papelCatalog.find(x => String(x.id) === v)
              set({ papelId: v, precioPliego: p ? Number(p.precio) : d.precioPliego })
            }}>
              {papelCatalog.map(p => (
                <option key={p.id} value={String(p.id)}>
                  {p.nombre} {p.gramaje}g · {p.material} · {fmtCOP(p.precio)} / pliego
                </option>
              ))}
              <option value="manual">+ Registrar papel temporal (precio manual)</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Precio / pliego <span className="editable-flag"><Icon.Pencil /></span></label>
            <MoneyInput
              className="admin-editable"
              value={d.precioPliego}
              onChange={(v) => set({ precioPliego: v, papelId: 'manual' })}
            />
          </div>

          <div className="field col-span-3">
            <label className="field-label">
              <Icon.Calc /> Costo total de papel
              <span className="hint">— pliegos × precio/pliego — sobreescribible</span>
            </label>
            <div style={{ position: 'relative' }}>
              <MoneyInput
                className="calc admin-editable"
                style={{ fontSize: 16, fontWeight: 600, padding: '10px 12px', paddingRight: 60 }}
                value={d.costoPapelOverride !== null ? d.costoPapelOverride : calc.costoPapel}
                onChange={(v) => set({ costoPapelOverride: v })}
              />
              {d.costoPapelOverride !== null && (
                <span
                  style={{ position: 'absolute', right: 56, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}
                  onClick={() => set({ costoPapelOverride: null })}
                  title="Restaurar al cálculo automático"
                >↺ auto</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="papel-block">
        <div className="papel-block-title">Cortes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { key: 'corteInicial', label: 'Corte inicial', activeKey: 'corteInicialActive', precioKey: 'corteInicialPrecio' },
            { key: 'corteFinal',   label: 'Corte final',   activeKey: 'corteFinalActive',   precioKey: 'corteFinalPrecio' },
          ].map(({ label, activeKey, precioKey }) => (
            <div key={activeKey} className={'proc-row' + (d[activeKey] ? ' active' : '')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Checkbox checked={!!d[activeKey]} onChange={() => set({ [activeKey]: !d[activeKey] })} />
              <div className="proc-name" style={{ flex: 1 }}>{label}</div>
              <div className="proc-cost">
                <MoneyInput
                  className="admin-editable"
                  style={{ fontWeight: d[activeKey] ? 600 : 400 }}
                  value={d[precioKey] || 0}
                  onChange={(v) => set({ [precioKey]: v })}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="papel-diagram">
        <div className="sheet-diagram-card">
          <div className="ttl"><Icon.Calc /> Diagrama del pliego — distribución óptima</div>
          <SheetDiagram
            pliegoW={d.pliegoW} pliegoH={d.pliegoH}
            unitW={calc.unitW} unitH={calc.unitH}
            cols={calc.cols} rows={calc.rows}
            total={calc.unidadesPorPliego}
            needed={calc.pliegosNecesarios}
          />
          <div className="sheet-stats">
            <div className="sheet-stat">
              <div className="lbl">Unidades / pliego</div>
              <div className="val">{calc.unidadesPorPliego}</div>
            </div>
            <div className="sheet-stat">
              <div className="lbl">Pliegos necesarios</div>
              <div className="val">{calc.pliegosNecesarios}</div>
            </div>
            <div className="sheet-stat">
              <div className="lbl">Desperdicio</div>
              <div className="val">{fmtNum(calc.desperdicio, 1)}<span className="sm">%</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// =========================================================
// Section 3 — Procesos
// =========================================================
function ImpresionSide({ titulo, activo, onToggle, tipo, onTipo, colores, onColores, costo, onCosto }) {
  return (
    <div className={'impresion-side' + (activo ? ' active' : ' inactive')}>
      <div className="impresion-side-header" onClick={onToggle}>
        <Checkbox checked={activo} onChange={onToggle} />
        <span className="side-title">{titulo}</span>
        {activo && <span className="side-cost mono">{fmtCOP(costo)}</span>}
      </div>
      {activo && (
        <div className="impresion-side-body">
          <div className="field">
            <label className="field-label">Tipo de impresión</label>
            <select className="select" value={tipo} onChange={e => onTipo(e.target.value)}>
              <option>1 color</option>
              <option>Full Color</option>
              <option>Colores especiales</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">¿Cuáles colores?</label>
            <input
              className="input"
              placeholder={tipo === '1 color' ? 'Ej. Negro, Pantone 187C…' : tipo === 'Full Color' ? 'Ej. CMYK' : 'Ej. Pantone 187C + dorado metalizado'}
              value={colores || ''}
              onChange={e => onColores(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">Costo {titulo.toLowerCase()} <span className="editable-flag"><Icon.Pencil /></span></label>
            <MoneyInput value={costo} onChange={onCosto} className="admin-editable" />
          </div>
        </div>
      )}
    </div>
  )
}

function ImpresionRow({ pdef, p, onToggle, onUpdate }) {
  const active = !!p.active
  const costoTotal = (active && p.tiroActive ? (p.costoTiro || 0) : 0) + (active && p.retiroActive ? (p.costoRetiro || 0) : 0)
  return (
    <div className={'proc-row impresion-row' + (active ? ' active' : '')}>
      <div className="impresion-top">
        <Checkbox checked={active} onChange={onToggle} />
        <div className="proc-name">
          {pdef.nombre}
          {pdef.desc && <span className="desc">— {pdef.desc}</span>}
        </div>
        <div className="proc-cost">
          <div className="input-affix">
            <input
              type="text" readOnly
              className="input mono calc"
              style={{ textAlign: 'right', paddingRight: 38, fontWeight: active ? 600 : 400, cursor: 'default' }}
              value={Number(Math.round(costoTotal || 0)).toLocaleString('es-CO')}
            />
            <span className="suffix" style={{ fontSize: 10 }}>COP</span>
          </div>
        </div>
      </div>
      {active && (
        <div className="impresion-bottom">
          <ImpresionSide
            titulo="Tiro"
            activo={!!p.tiroActive} onToggle={() => onUpdate({ tiroActive: !p.tiroActive })}
            tipo={p.tiroTipo} onTipo={(v) => onUpdate({ tiroTipo: v })}
            colores={p.tiroColores} onColores={(v) => onUpdate({ tiroColores: v })}
            costo={p.costoTiro || 0} onCosto={(v) => onUpdate({ costoTiro: v })}
          />
          <ImpresionSide
            titulo="Retiro"
            activo={!!p.retiroActive} onToggle={() => onUpdate({ retiroActive: !p.retiroActive })}
            tipo={p.retiroTipo} onTipo={(v) => onUpdate({ retiroTipo: v })}
            colores={p.retiroColores} onColores={(v) => onUpdate({ retiroColores: v })}
            costo={p.costoRetiro || 0} onCosto={(v) => onUpdate({ costoRetiro: v })}
          />
        </div>
      )}
    </div>
  )
}

function LaminadoSide({ titulo, activo, onToggle, tipoLaminado, onTipo, precioM2, onPrecioM2, costoAuto, tipoMetalizado, onTipoMetalizado, metalizadoOtros, onMetalizadoOtros }) {
  return (
    <div className={'impresion-side' + (activo ? ' active' : ' inactive')}>
      <div className="impresion-side-header" onClick={onToggle}>
        <Checkbox checked={activo} onChange={onToggle} />
        <span className="side-title">{titulo}</span>
        {activo && <span className="side-cost mono">{fmtCOP(costoAuto)}</span>}
      </div>
      {activo && (
        <div className="impresion-side-body">
          <div className="field">
            <label className="field-label">Tipo de laminado</label>
            <select className="select" value={tipoLaminado} onChange={e => onTipo(e.target.value)}>
              <option>Mate</option><option>Brillante</option><option>Metalizado</option>
            </select>
          </div>
          {tipoLaminado === 'Metalizado' && (
            <div className="field">
              <label className="field-label">Tipo de metalizado</label>
              <select className="select" value={tipoMetalizado || 'Plateado'} onChange={e => onTipoMetalizado(e.target.value)}>
                <option>Plateado</option><option>Dorado</option><option>Rosado</option><option>Otros</option>
              </select>
            </div>
          )}
          {tipoLaminado === 'Metalizado' && (tipoMetalizado || 'Plateado') === 'Otros' && (
            <div className="field">
              <label className="field-label">Especificar tipo</label>
              <input
                className="input"
                type="text"
                placeholder="Ej. Holográfico, Azul…"
                value={metalizadoOtros || ''}
                onChange={e => onMetalizadoOtros(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label className="field-label">Precio $/m² <span className="editable-flag"><Icon.Pencil /></span></label>
            <MoneyInput value={precioM2} onChange={onPrecioM2} className="admin-editable" suffix="" />
          </div>
        </div>
      )}
    </div>
  )
}

function LaminadoRow({ pdef, p, onToggle, onUpdate, autoVal }) {
  const active = !!p.active
  const costoTiro = autoVal?.tiro || 0
  const costoRetiro = autoVal?.retiro || 0
  const costoTotal = (active && p.tiroActive ? costoTiro : 0) + (active && p.retiroActive ? costoRetiro : 0)
  return (
    <div className={'proc-row impresion-row' + (active ? ' active' : '')}>
      <div className="impresion-top">
        <Checkbox checked={active} onChange={onToggle} />
        <div className="proc-name">
          {pdef.nombre}
          {pdef.desc && <span className="desc">— {pdef.desc}</span>}
        </div>
        <div className="proc-cost">
          <div className="input-affix">
            <input
              type="text" readOnly
              className="input mono calc"
              style={{ textAlign: 'right', paddingRight: 38, fontWeight: active ? 600 : 400, cursor: 'default' }}
              value={Number(Math.round(costoTotal || 0)).toLocaleString('es-CO')}
            />
            <span className="suffix" style={{ fontSize: 10 }}>COP</span>
          </div>
        </div>
      </div>
      {active && (
        <div className="impresion-bottom">
          <LaminadoSide
            titulo="Tiro"
            activo={!!p.tiroActive} onToggle={() => onUpdate({ tiroActive: !p.tiroActive })}
            tipoLaminado={p.tiroTipoLaminado || 'Mate'} onTipo={(v) => onUpdate({ tiroTipoLaminado: v })}
            precioM2={p.tiroPrecioM2 || 0} onPrecioM2={(v) => onUpdate({ tiroPrecioM2: v })}
            costoAuto={costoTiro}
            tipoMetalizado={p.tiroTipoMetalizado} onTipoMetalizado={(v) => onUpdate({ tiroTipoMetalizado: v })}
            metalizadoOtros={p.tiroMetalizadoOtros} onMetalizadoOtros={(v) => onUpdate({ tiroMetalizadoOtros: v })}
          />
          <LaminadoSide
            titulo="Retiro"
            activo={!!p.retiroActive} onToggle={() => onUpdate({ retiroActive: !p.retiroActive })}
            tipoLaminado={p.retiroTipoLaminado || 'Mate'} onTipo={(v) => onUpdate({ retiroTipoLaminado: v })}
            precioM2={p.retiroPrecioM2 || 0} onPrecioM2={(v) => onUpdate({ retiroPrecioM2: v })}
            costoAuto={costoRetiro}
            tipoMetalizado={p.retiroTipoMetalizado} onTipoMetalizado={(v) => onUpdate({ retiroTipoMetalizado: v })}
            metalizadoOtros={p.retiroMetalizadoOtros} onMetalizadoOtros={(v) => onUpdate({ retiroMetalizadoOtros: v })}
          />
        </div>
      )}
    </div>
  )
}

function ProcRowDefault({ pdef, p, onToggle, onUpdate, autoVal }) {
  const active = !!p.active
  return (
    <div className={'proc-row' + (active ? ' active' : '')}>
      <Checkbox checked={active} onChange={onToggle} />
      <div className="proc-name">
        {pdef.nombre}
        {pdef.desc && <span className="desc">— {pdef.desc}</span>}
      </div>
      <div className="proc-fields">
        {pdef.id === 'diseno' && (
          <select className="select" value={p.disenador} onChange={e => onUpdate({ disenador: e.target.value })} style={{ flex: '0 0 160px' }}>
            {DISENADORES.map(n => <option key={n}>{n}</option>)}
          </select>
        )}
        {pdef.id === 'cajas' && (
          <>
            <div className="input-affix" style={{ width: 90 }}>
              <NumField value={p.cantidad} onChange={v => onUpdate({ cantidad: Math.round(v) })} step={1} />
              <span className="suffix" style={{ fontSize: 10 }}>cajas</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>$/u</span>
              <MoneyInput value={p.precioUnit} onChange={(v) => onUpdate({ precioUnit: v })} style={{ width: 130 }} suffix="" />
            </div>
          </>
        )}
        {pdef.id === 'otros' && (
          <input className="input" placeholder="Descripción del proceso adicional"
            value={p.descripcion || ''}
            onChange={e => onUpdate({ descripcion: e.target.value })} />
        )}
        {pdef.note && active && (
          <div className="note" style={{ flex: 1 }}>
            <Icon.Info /><span>{pdef.note}</span>
          </div>
        )}
      </div>
      <div className="proc-cost">
        <div style={{ position: 'relative' }}>
          <MoneyInput
            className={pdef.autoCalc ? 'calc admin-editable' : 'admin-editable'}
            style={{ fontWeight: active ? 600 : 400 }}
            value={p.costoOverride != null ? p.costoOverride : (pdef.autoCalc ? autoVal : p.costo)}
            onChange={(v) => {
              if (pdef.autoCalc) onUpdate({ costoOverride: v })
              else onUpdate({ costo: v, costoOverride: null })
            }}
          />
          {p.costoOverride != null && pdef.autoCalc && (
            <span
              style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}
              onClick={() => onUpdate({ costoOverride: null })}
              title="Restaurar al cálculo automático"
            >↺</span>
          )}
        </div>
      </div>
    </div>
  )
}

function ProcRow(props) {
  if (props.pdef.id === 'impresion') return <ImpresionRow {...props} />
  if (props.pdef.id === 'laminado') return <LaminadoRow {...props} />
  return <ProcRowDefault {...props} />
}

export function SectionProcesos({ procesos, setProc, autoValues }) {
  return (
    <div>
      {PROCESS_GROUPS.map(g => {
        const activos = g.procesos.filter(p => procesos[p.id]?.active).length
        return (
          <div className="proc-group" data-group={g.id} key={g.id}>
            <div className="proc-group-header">
              {g.titulo}
              <span className="count">{activos} de {g.procesos.length} activos</span>
            </div>
            {g.procesos.map(pdef => (
              <ProcRow
                key={pdef.id}
                pdef={pdef}
                p={procesos[pdef.id]}
                autoVal={autoValues[pdef.id]}
                onToggle={() => setProc(pdef.id, { active: !procesos[pdef.id]?.active })}
                onUpdate={(patch) => setProc(pdef.id, patch)}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

// =========================================================
// Section 5 — Condiciones comerciales
// =========================================================
export function SectionCondiciones({ d, set }) {
  return (
    <div>
      <div className="cond-pago-options">
        {CONDICIONES_PAGO.map(c => (
          <div key={c.id} className={'opt' + (d.condicionPago === c.id ? ' active' : '')} onClick={() => set({ condicionPago: c.id })}>
            <div className="lbl">{c.lbl}</div>
            <div className="sub">{c.sub}</div>
          </div>
        ))}
      </div>
      {d.condicionPago === 'custom' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label className="field-label">Condición personalizada</label>
          <input className="input" placeholder="Ej. 50% anticipo, 50% a 15 días"
            value={d.condicionCustom || ''}
            onChange={e => set({ condicionCustom: e.target.value })} />
        </div>
      )}
      <div className="note info" style={{ marginTop: 12 }}>
        <Icon.Info />
        <span>La condición seleccionada se transfiere automáticamente a la Orden de Producción al confirmar.</span>
      </div>
    </div>
  )
}

// =========================================================
// Section 6 — Acciones
// =========================================================
export function SectionAcciones({ d, calc, onSave, onCreateDocCliente, onDelete, saving }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isConvertida = d.estado === 'convertida'
  const canDelete = !!d.id && !isConvertida

  return (
    <div>
      {isConvertida && (
        <div className="banner-readonly" style={{ marginBottom: 14 }}>
          <Icon.Lock />
          <span>Esta cotización fue convertida a una Orden de Producción. Modo solo lectura.</span>
        </div>
      )}
      <div className="actions-row">
        <button className="btn" onClick={onSave} disabled={saving || isConvertida}>
          <Icon.Save /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="btn accent" onClick={onCreateDocCliente} disabled={saving || isConvertida}>
          <Icon.Send /> Guardar y enviar al cliente
        </button>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 11.5 }}>
          Total cotización: <strong className="mono" style={{ color: 'var(--ink)' }}>{fmtCOP(calc.valorTotal)}</strong>
        </span>
      </div>
      {canDelete && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          {!confirmDelete ? (
            <button
              className="btn"
              style={{ color: 'var(--danger, #c0392b)', borderColor: 'var(--danger, #c0392b)' }}
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
            >
              <Icon.Trash /> Eliminar cotización
            </button>
          ) : (
            <>
              <span style={{ fontSize: 13, color: 'var(--danger, #c0392b)', fontWeight: 500 }}>
                ¿Eliminar permanentemente?
              </span>
              <button
                className="btn"
                style={{ background: 'var(--danger, #c0392b)', color: '#fff', borderColor: 'var(--danger, #c0392b)' }}
                onClick={onDelete}
                disabled={saving}
              >
                Sí, eliminar
              </button>
              <button className="btn" onClick={() => setConfirmDelete(false)} disabled={saving}>
                Cancelar
              </button>
            </>
          )}
        </div>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon.Info />
        Puedes seguir guardando como borrador todas las veces que necesites. El cambio de estado y la conversión a OP se hacen desde el listado de cotizaciones.
      </div>
    </div>
  )
}
