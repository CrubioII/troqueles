const { useState, useMemo, useEffect } = React;
const { fmtCOP, fmtNum, PAPEL_CATALOG, PLIEGO_SIZES, DISENADORES, PROCESS_GROUPS, SheetDiagram, Section, StatusPicker, Checkbox, STATUS_DEFS } = window.Cotizacion;

// =========================================================
// Section 1 — Datos Generales
// =========================================================
function SectionGenerales({ d, set }) {
  return (
    <div className="grid grid-6" style={{ gap: 14 }}>
      <div className="field">
        <label className="field-label">N° cotización <Icon.Lock /></label>
        <input className="input readonly mono" value={d.numero} readOnly />
      </div>
      <div className="field">
        <label className="field-label">Fecha <span className="editable-flag" title="Editable por admin"><Icon.Pencil /></span></label>
        <input className="input admin-editable mono" value={d.fecha} onChange={e => set({ fecha: e.target.value })}/>
      </div>
      <div className="field col-span-2">
        <label className="field-label">Cliente <span className="req">*</span></label>
        <input className="input" placeholder="Nombre del cliente o empresa" value={d.cliente} onChange={e => set({ cliente: e.target.value })}/>
      </div>
      <div className="field col-span-2">
        <label className="field-label">Tipo de cliente</label>
        <div className="seg">
          <button className={d.tipoCliente === "final" ? "active" : ""} onClick={() => set({ tipoCliente: "final" })}>Cliente Final</button>
          <button className={d.tipoCliente === "terciario" ? "active" : ""} onClick={() => set({ tipoCliente: "terciario" })}>Cliente Terciario</button>
        </div>
      </div>

      <div className="field col-span-3">
        <label className="field-label">Referencia / descripción del producto <span className="req">*</span></label>
        <input className="input" placeholder="Ej. Caja plegadiza para fragancia 100ml" value={d.referencia} onChange={e => set({ referencia: e.target.value })}/>
      </div>
      <div className="field col-span-2">
        <label className="field-label">Cantidad solicitada <span className="req">*</span></label>
        <div className="input-affix">
          <input type="number" className="input mono" value={d.cantidad} onChange={e => set({ cantidad: parseInt(e.target.value) || 0 })}/>
          <span className="suffix">unidades</span>
        </div>
      </div>
      <div className="field">
        <label className="field-label">Estado</label>
        <span className={"badge " + (STATUS_DEFS.find(s => s.id === d.estado)?.cls || "draft")} style={{ alignSelf: "flex-start", marginTop: 4 }}>
          <span className="dot"></span>
          {STATUS_DEFS.find(s => s.id === d.estado)?.label}
        </span>
      </div>
    </div>
  );
}

// =========================================================
// Section 2 — Calculadora de Papel
// =========================================================
function SectionPapel({ d, set, calc }) {
  const { MoneyInput } = window.Cotizacion;
  return (
    <div className="papel-layout">
      {/* Subgrupo 1: Dimensiones */}
      <div className="papel-block">
        <div className="papel-block-title">Dimensiones</div>
        <div className="grid grid-2" style={{ gap: 14 }}>
          <div className="field">
            <label className="field-label">Ancho del molde abierto</label>
            <div className="input-affix">
              <input type="number" step="0.1" className="input mono" value={d.moldeAncho} onChange={e => set({ moldeAncho: parseFloat(e.target.value) || 0 })}/>
              <span className="suffix">cm</span>
            </div>
          </div>
          <div className="field">
            <label className="field-label">Alto del molde abierto</label>
            <div className="input-affix">
              <input type="number" step="0.1" className="input mono" value={d.moldeAlto} onChange={e => set({ moldeAlto: parseFloat(e.target.value) || 0 })}/>
              <span className="suffix">cm</span>
            </div>
          </div>

          <div className={"field " + (d.pliegoTipo === "custom" ? "" : "col-span-2")}>
            <label className="field-label">Tipo de pliego</label>
            <select className="select" value={d.pliegoTipo} onChange={e => {
              const t = PLIEGO_SIZES.find(p => p.id === e.target.value);
              if (t && t.id !== "custom") set({ pliegoTipo: t.id, pliegoW: t.w, pliegoH: t.h });
              else set({ pliegoTipo: "custom" });
            }}>
              {PLIEGO_SIZES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          {d.pliegoTipo === "custom" && (
            <>
              <div className="field">
                <label className="field-label">Pliego ancho</label>
                <div className="input-affix"><input type="number" className="input mono" value={d.pliegoW} onChange={e => set({ pliegoW: parseFloat(e.target.value) || 0 })}/><span className="suffix">cm</span></div>
              </div>
              <div className="field">
                <label className="field-label">Pliego alto</label>
                <div className="input-affix"><input type="number" className="input mono" value={d.pliegoH} onChange={e => set({ pliegoH: parseFloat(e.target.value) || 0 })}/><span className="suffix">cm</span></div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Subgrupo 2: Catálogo y costo */}
      <div className="papel-block">
        <div className="papel-block-title">Catálogo de papel · costo</div>
        <div className="grid grid-3" style={{ gap: 14 }}>
          <div className="field col-span-2">
            <label className="field-label">Referencia del papel <span className="hint">— catálogo administrable</span></label>
            <select className="select" value={d.papelId} onChange={e => {
              const v = e.target.value;
              if (v === "manual") { set({ papelId: "manual" }); return; }
              const p = PAPEL_CATALOG.find(x => x.id === v);
              set({ papelId: v, precioPliego: p ? p.precio : d.precioPliego });
            }}>
              {PAPEL_CATALOG.map(p => (
                <option key={p.id} value={p.id}>{p.nombre} {p.gramaje}g · {p.material} · {fmtCOP(p.precio)} / pliego</option>
              ))}
              <option value="manual">+ Registrar papel temporal (precio manual)</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Precio / pliego <span className="editable-flag"><Icon.Pencil /></span></label>
            <MoneyInput
              className="admin-editable"
              value={d.precioPliego}
              onChange={(v) => set({ precioPliego: v, papelId: "manual" })}
            />
          </div>

          <div className="field col-span-3">
            <label className="field-label">
              <Icon.Calc /> Costo total de papel
              <span className="hint">— pliegos × precio/pliego — sobreescribible</span>
            </label>
            <div style={{ position: "relative" }}>
              <MoneyInput
                className="calc admin-editable"
                style={{ fontSize: 16, fontWeight: 600, padding: "10px 12px", paddingRight: 60 }}
                value={d.costoPapelOverride !== null ? d.costoPapelOverride : calc.costoPapel}
                onChange={(v) => set({ costoPapelOverride: v })}
              />
              {d.costoPapelOverride !== null && (
                <span style={{ position: "absolute", right: 56, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "var(--accent)", fontSize: 11, fontWeight: 600 }}
                  onClick={() => set({ costoPapelOverride: null })}
                  title="Restaurar al cálculo automático">↺ auto</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Diagrama (toma su propia fila a la derecha en desktop) */}
      <div className="papel-diagram">
        <div className="sheet-diagram-card">
          <div className="ttl"><Icon.Calc /> Diagrama del pliego — distribución óptima</div>
          <SheetDiagram
            pliegoW={d.pliegoW} pliegoH={d.pliegoH}
            unitW={d.moldeAncho} unitH={d.moldeAlto}
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
  );
}

// =========================================================
// Section 3 — Procesos
// =========================================================
function ImpresionSide({ titulo, activo, onToggle, tipo, onTipo, colores, onColores, costo, onCosto }) {
  const { MoneyInput } = window.Cotizacion;
  return (
    <div className={"impresion-side" + (activo ? " active" : " inactive")}>
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
              placeholder={
                tipo === "1 color" ? "Ej. Negro, Pantone 187C…" :
                tipo === "Full Color" ? "Ej. CMYK" :
                "Ej. Pantone 187C + dorado metalizado"
              }
              value={colores || ""}
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
  );
}

function ImpresionRow({ pdef, p, onToggle, onUpdate }) {
  const active = !!p.active;
  const { MoneyInput } = window.Cotizacion;
  const costoTotal = (active && p.tiroActive ? (p.costoTiro || 0) : 0) + (active && p.retiroActive ? (p.costoRetiro || 0) : 0);
  return (
    <div className={"proc-row impresion-row" + (active ? " active" : "")}>
      <div className="impresion-top">
        <Checkbox checked={active} onChange={onToggle} />
        <div className="proc-name">
          {pdef.nombre}
          {pdef.desc && <span className="desc">— {pdef.desc}</span>}
        </div>
        <div className="proc-cost">
          <div className="input-affix">
            <input
              type="text"
              readOnly
              className="input mono calc"
              style={{ textAlign: "right", paddingRight: 38, fontWeight: active ? 600 : 400, cursor: "default" }}
              value={Number(Math.round(costoTotal || 0)).toLocaleString("es-CO")}
            />
            <span className="suffix" style={{ fontSize: 10 }}>COP</span>
          </div>
        </div>
      </div>
      {active && (
        <div className="impresion-bottom">
          <ImpresionSide
            titulo="Tiro"
            activo={!!p.tiroActive}
            onToggle={() => onUpdate({ tiroActive: !p.tiroActive })}
            tipo={p.tiroTipo}
            onTipo={(v) => onUpdate({ tiroTipo: v })}
            colores={p.tiroColores}
            onColores={(v) => onUpdate({ tiroColores: v })}
            costo={p.costoTiro || 0}
            onCosto={(v) => onUpdate({ costoTiro: v })}
          />
          <ImpresionSide
            titulo="Retiro"
            activo={!!p.retiroActive}
            onToggle={() => onUpdate({ retiroActive: !p.retiroActive })}
            tipo={p.retiroTipo}
            onTipo={(v) => onUpdate({ retiroTipo: v })}
            colores={p.retiroColores}
            onColores={(v) => onUpdate({ retiroColores: v })}
            costo={p.costoRetiro || 0}
            onCosto={(v) => onUpdate({ costoRetiro: v })}
          />
        </div>
      )}
    </div>
  );
}

function ProcRow(props) {
  if (props.pdef.id === "impresion") return <ImpresionRow {...props} />;
  return <ProcRowDefault {...props} />;
}

function ProcRowDefault({ pdef, p, onToggle, onUpdate, autoVal }) {
  const active = !!p.active;
  const { MoneyInput } = window.Cotizacion;
  return (
    <div className={"proc-row" + (active ? " active" : "")}>
      <Checkbox checked={active} onChange={onToggle} />
      <div className="proc-name">
        {pdef.nombre}
        {pdef.desc && <span className="desc">— {pdef.desc}</span>}
      </div>
      <div className="proc-fields">
        {pdef.id === "laminado" && (
          <>
            <select className="select" value={p.tipoLaminado} onChange={e => onUpdate({ tipoLaminado: e.target.value })} style={{ flex: "0 0 130px" }}>
              <option>Mate</option>
              <option>Brillante</option>
              <option>Metalizado</option>
            </select>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>$/m²</span>
              <MoneyInput value={p.precioM2} onChange={(v) => onUpdate({ precioM2: v })} style={{ width: 130 }} suffix="" />
            </div>
          </>
        )}
        {pdef.id === "diseno" && (
          <>
            <select className="select" value={p.disenador} onChange={e => onUpdate({ disenador: e.target.value })} style={{ flex: "0 0 160px" }}>
              {DISENADORES.map(n => <option key={n}>{n}</option>)}
            </select>
          </>
        )}
        {pdef.id === "cajas" && (
          <>
            <div className="input-affix" style={{ width: 90 }}>
              <input type="number" className="input mono" value={p.cantidad} onChange={e => onUpdate({ cantidad: parseInt(e.target.value) || 0 })}/>
              <span className="suffix" style={{ fontSize: 10 }}>cajas</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>$/u</span>
              <MoneyInput value={p.precioUnit} onChange={(v) => onUpdate({ precioUnit: v })} style={{ width: 130 }} suffix="" />
            </div>
          </>
        )}
        {pdef.id === "otros" && (
          <input className="input" placeholder="Descripción del proceso adicional"
            value={p.descripcion || ""}
            onChange={e => onUpdate({ descripcion: e.target.value })}/>
        )}
        {pdef.note && active && !["impresion"].includes(pdef.id) && (
          <div className="note" style={{ flex: 1 }}>
            <Icon.Info />
            <span>{pdef.note}</span>
          </div>
        )}
      </div>
      <div className="proc-cost">
        <div style={{ position: "relative" }}>
          <MoneyInput
            className={(pdef.autoCalc ? "calc admin-editable" : "admin-editable")}
            style={{ fontWeight: active ? 600 : 400 }}
            value={p.costoOverride !== null && p.costoOverride !== undefined ? p.costoOverride : (pdef.autoCalc ? autoVal : p.costo)}
            onChange={(v) => {
              if (pdef.autoCalc) onUpdate({ costoOverride: v });
              else onUpdate({ costo: v, costoOverride: null });
            }}
          />
          {p.costoOverride !== null && p.costoOverride !== undefined && pdef.autoCalc && (
            <span style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "var(--accent)", fontSize: 11, fontWeight: 600 }}
              onClick={() => onUpdate({ costoOverride: null })}
              title="Restaurar al cálculo automático">↺</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionProcesos({ d, set, procesos, setProc, autoValues }) {
  return (
    <div>
      {PROCESS_GROUPS.map(g => {
        const activos = g.procesos.filter(p => procesos[p.id]?.active).length;
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
        );
      })}
    </div>
  );
}

// =========================================================
// Section 5 — Condiciones comerciales
// =========================================================
const CONDICIONES_PAGO = [
  { id: "mismo", lbl: "Pago el mismo día", sub: "Contra entrega" },
  { id: "8", lbl: "Pago en 8 días", sub: "Crédito corto" },
  { id: "30", lbl: "Pago en 30 días", sub: "Crédito estándar" },
  { id: "custom", lbl: "Personalizado", sub: "Otra condición" },
];
function SectionCondiciones({ d, set }) {
  return (
    <div>
      <div className="cond-pago-options">
        {CONDICIONES_PAGO.map(c => (
          <div key={c.id} className={"opt" + (d.condicionPago === c.id ? " active" : "")} onClick={() => set({ condicionPago: c.id })}>
            <div className="lbl">{c.lbl}</div>
            <div className="sub">{c.sub}</div>
          </div>
        ))}
      </div>
      {d.condicionPago === "custom" && (
        <div className="field" style={{ marginTop: 12 }}>
          <label className="field-label">Condición personalizada</label>
          <input className="input" placeholder="Ej. 50% anticipo, 50% a 15 días"
            value={d.condicionCustom || ""}
            onChange={e => set({ condicionCustom: e.target.value })}/>
        </div>
      )}
      <div className="note info" style={{ marginTop: 12 }}>
        <Icon.Info />
        <span>La condición seleccionada se transfiere automáticamente a la Orden de Producción al confirmar.</span>
      </div>
    </div>
  );
}

// =========================================================
// Section 6 — Acciones
// =========================================================
function SectionAcciones({ d, set, calc, isAdmin }) {
  const isConvertida = d.estado === "convertida";
  return (
    <div>
      {isConvertida && (
        <div className="banner-readonly" style={{ marginBottom: 14 }}>
          <Icon.Lock />
          <span>Esta cotización fue convertida a la <a href="#">Orden de Producción OP-0098</a>. Modo solo lectura.</span>
        </div>
      )}
      <div className="actions-row">
        <button className="btn"><Icon.Save /> Guardar</button>
        <button className="btn accent"><Icon.Send /> Guardar y enviar al cliente</button>
        <div className="spacer"/>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Total cotización: <strong className="mono" style={{ color: "var(--ink)" }}>{fmtCOP(calc.valorTotal)}</strong>
        </span>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon.Info />
        Puedes seguir guardando como borrador todas las veces que necesites. El cambio de estado y la conversión a OP se hacen desde el listado de cotizaciones.
      </div>
    </div>
  );
}

window.Sections = { SectionGenerales, SectionPapel, SectionProcesos, SectionCondiciones, SectionAcciones };
window.CONDICIONES_PAGO = CONDICIONES_PAGO;
