const { useState: useStateApp, useMemo: useMemoApp, useEffect: useEffectApp } = React;

function App() {
  // ============ State ============
  const [d, setData] = useStateApp({
    numero: "COT-0042",
    fecha: "19 May 2026",
    cliente: "Laboratorios Esencia S.A.S.",
    referencia: "Caja plegadiza Eau de Parfum 100ml — línea Aurora",
    cantidad: 2500,
    tipoCliente: "terciario",
    estado: "borrador",

    // Papel
    moldeAncho: 18.5,
    moldeAlto: 24.0,
    pliegoTipo: "70x100",
    pliegoW: 70,
    pliegoH: 100,
    papelId: "p2",
    precioPliego: 2480,
    costoPapelOverride: null,

    // Liquidación
    valorUnitarioOverride: null,
    valorTotalOverride: null,
    totalCostosOverride: null,
    subtotalOverride: null,

    // Condiciones
    condicionPago: "30",
    condicionCustom: "",

    observaciones: "Entrega en bodega del cliente en Bogotá. Aprobación de prueba de color antes de tiraje."
  });

  const set = (patch) => setData((prev) => ({ ...prev, ...patch }));

  // ============ Processes state ============
  const [procesos, setProcesos] = useStateApp(() => {
    const init = {};
    PROCESS_GROUPS.forEach((g) => g.procesos.forEach((p) => {
      init[p.id] = {
        active: ["impresion", "laminado", "troquel", "troquelado", "terminado", "diseno", "cajas", "envio"].includes(p.id),
        costo: p.defaultCost || 0,
        costoOverride: null,
        ...(p.extras || {})
      };
    }));
    return init;
  });
  const setProc = (id, patch) => setProcesos((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // ============ Open sections ============
  const [open, setOpen] = useStateApp({ s1: true, s2: true, s3: true, s5: true, s6: true });
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const isAdmin = true; // demo: always admin for the prototype

  // ============ Calculations ============
  const calc = useMemoApp(() => {
    const w = d.moldeAncho,h = d.moldeAlto;
    const pw = d.pliegoW,ph = d.pliegoH;
    // Two orientations of the molde on the pliego — pick the one that maximizes
    const o1 = w > 0 && h > 0 ? Math.floor(pw / w) * Math.floor(ph / h) : 0;
    const o2 = w > 0 && h > 0 ? Math.floor(pw / h) * Math.floor(ph / w) : 0;
    let cols = 0,rows = 0,total = 0,unitW = w,unitH = h;
    if (o1 >= o2) {
      cols = Math.floor(pw / w);rows = Math.floor(ph / h);total = cols * rows;unitW = w;unitH = h;
    } else {
      cols = Math.floor(pw / h);rows = Math.floor(ph / w);total = cols * rows;unitW = h;unitH = w;
    }
    const unidadesPorPliego = total;
    const cantidadConMargen = d.cantidad;
    const pliegosNecesarios = unidadesPorPliego > 0 ? Math.ceil(cantidadConMargen / unidadesPorPliego) : 0;
    const areaPliego = pw * ph;
    const areaUsada = unidadesPorPliego * w * h;
    const desperdicio = areaPliego > 0 ? Math.max(0, (areaPliego - areaUsada) / areaPliego * 100) : 0;
    const costoPapelAuto = pliegosNecesarios * d.precioPliego;
    const costoPapel = d.costoPapelOverride !== null ? d.costoPapelOverride : costoPapelAuto;

    // Per-process auto-calc values
    const lamP = procesos.laminado || {};
    const areaM2 = w * h / 10000; // cm² → m²
    const laminadoAuto = Math.round(areaM2 * pliegosNecesarios * (lamP.precioM2 || 0));
    const cajasP = procesos.cajas || {};
    const cajasAuto = Math.round((cajasP.cantidad || 0) * (cajasP.precioUnit || 0));
    const autoValues = { laminado: laminadoAuto, cajas: cajasAuto };

    // Cost per active process
    let totalProcesos = 0;
    const procRows = [];
    PROCESS_GROUPS.forEach((g) => g.procesos.forEach((pdef) => {
      const p = procesos[pdef.id];
      if (!p?.active) return;
      // Impresión se divide en tiro y retiro
      if (pdef.id === "impresion") {
        if (p.tiroActive) {
          const c = p.costoTiro || 0;
          totalProcesos += c;
          procRows.push({ id: "impresion-tiro", nombre: `Impresión · Tiro (${p.tiroTipo})`, costo: c });
        }
        if (p.retiroActive) {
          const c = p.costoRetiro || 0;
          totalProcesos += c;
          procRows.push({ id: "impresion-retiro", nombre: `Impresión · Retiro (${p.retiroTipo})`, costo: c });
        }
        return;
      }
      let costo;
      if (p.costoOverride !== null && p.costoOverride !== undefined) costo = p.costoOverride;else
      if (pdef.autoCalc) costo = autoValues[pdef.id] || 0;else
      costo = p.costo || 0;
      totalProcesos += costo;
      procRows.push({ id: pdef.id, nombre: pdef.nombre, costo });
    }));

    // Total Costos OP = papel + procesos
    const totalCostosOPAuto = costoPapel + totalProcesos;
    const totalCostosOP = d.totalCostosOverride !== null ? d.totalCostosOverride : totalCostosOPAuto;

    // Valor unitario — default markup
    const valorUnitarioAuto = d.cantidad > 0 ? Math.round(totalCostosOPAuto / d.cantidad * 1.8 / 10) * 10 : 0;
    const valorUnitario = d.valorUnitarioOverride !== null ? d.valorUnitarioOverride : valorUnitarioAuto;

    const valorTotalAuto = d.cantidad * valorUnitario;
    const valorTotal = d.valorTotalOverride !== null ? d.valorTotalOverride : valorTotalAuto;

    const subtotalAuto = valorTotal - totalCostosOP;
    const subtotal = d.subtotalOverride !== null ? d.subtotalOverride : subtotalAuto;

    const comision = d.tipoCliente === "terciario" ? subtotal / 2 : 0;

    return {
      cols, rows, unitW, unitH,
      unidadesPorPliego, pliegosNecesarios, desperdicio,
      costoPapel, costoPapelAuto,
      autoValues,
      totalProcesos, procRows,
      totalCostosOP, totalCostosOPAuto,
      valorUnitario, valorUnitarioAuto,
      valorTotal, valorTotalAuto,
      subtotal, subtotalAuto,
      comision
    };
  }, [d, procesos]);

  // ============ Render ============
  const { SectionGenerales, SectionPapel, SectionProcesos, SectionCondiciones, SectionAcciones } = window.Sections;

  const condicionLabel = (() => {
    if (d.condicionPago === "custom") return d.condicionCustom || "Personalizado";
    const c = window.CONDICIONES_PAGO.find((x) => x.id === d.condicionPago);
    return c?.lbl;
  })();

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <div className="mark">TI</div>
          <div className="biz">Troqueles INK</div>
          <span className="div">/</span>
          <div className="mod">Cotizaciones</div>
          <span className="div">/</span>
          <div className="mod mono">{d.numero}</div>
        </div>
        <div className="topbar-right">
          <span className="kbd">⌘K</span>
          <span>Buscar cotización</span>
          <div className="userchip">
            <div className="av">JR</div>
            <div>
              <div style={{ color: "var(--ink)", fontWeight: 500 }}>Jessica </div>
              <div className="role">Atención al cliente · Admin</div>
            </div>
          </div>
        </div>
      </div>

      {/* Phase stepper */}
      <div className="stepper">
        <div className="step active">
          <div className="num">1</div>
          <div>Cotización <span className="sub">· en edición</span></div>
        </div>
        <div className="step disabled">
          <div className="num">2</div>
          <div>Producción <span className="sub">· se habilita al confirmar</span></div>
        </div>
        <div className="step disabled">
          <div className="num">3</div>
          <div>Remisión <span className="sub">· al cierre de la OP</span></div>
        </div>
      </div>

      {/* Workspace */}
      <div className="workspace">
        <div className="column-main">
          <Section
            num="1"
            title="Datos generales"
            desc="Información básica de la cotización"
            open={open.s1}
            onToggle={() => toggle("s1")}
            summary={!open.s1 &&
            <>
                <span>Cliente:</span> <span className="v">{d.cliente || "—"}</span>
                <span>· Cantidad:</span> <span className="v mono">{fmtNum(d.cantidad)}</span>
              </>
            }>
            
            <SectionGenerales d={d} set={set} />
          </Section>

          <Section
            num="2"
            title="Calculadora de papel y pliegos"
            desc="Cuántos pliegos necesitas comprar"
            open={open.s2}
            onToggle={() => toggle("s2")}
            summary={!open.s2 &&
            <>
                <span>Pliegos:</span> <span className="v mono">{calc.pliegosNecesarios}</span>
                <span>· Costo papel:</span> <span className="v mono">{fmtCOP(calc.costoPapel)}</span>
              </>
            }>
            
            <SectionPapel d={d} set={set} calc={calc} />
          </Section>

          <Section
            num="3"
            title="Procesos de producción"
            desc="Marca los procesos que requiere esta orden"
            open={open.s3}
            onToggle={() => toggle("s3")}
            summary={!open.s3 &&
            <>
                <span>Procesos activos:</span> <span className="v">{calc.procRows.length}</span>
                <span>· Costo procesos:</span> <span className="v mono">{fmtCOP(calc.totalProcesos)}</span>
              </>
            }>
            
            <SectionProcesos d={d} set={set} procesos={procesos} setProc={setProc} autoValues={calc.autoValues} />
            <div className="note" style={{ marginTop: 14 }}>
              <Icon.Info />
              <span>Los procesos marcados aquí se convertirán automáticamente en las tareas activas de la Orden de Producción al confirmar la cotización. Asegúrate de marcar todos los necesarios.</span>
            </div>
          </Section>

          {/* Sección 4 está en el panel derecho (sticky). Aquí dejamos el ancla informativa */}
          <Section
            num="4"
            title="Observaciones y notas"
            desc="Texto libre al pie de la cotización"
            open={true}
            locked={true}>
            
            <div className="obs-card">
              <label className="field-label" style={{ marginBottom: 6 }}>Observaciones de la cotización</label>
              <textarea
                className="textarea"
                placeholder="Notas internas, condiciones especiales, requerimientos del cliente, etc."
                value={d.observaciones}
                onChange={(e) => set({ observaciones: e.target.value })} />
              
            </div>
          </Section>

          <Section
            num="5"
            title="Condiciones comerciales"
            desc="Cómo se pacta el pago con el cliente"
            open={open.s5}
            onToggle={() => toggle("s5")}
            summary={!open.s5 && <><span>Pago:</span> <span className="v">{condicionLabel}</span></>}>
            
            <SectionCondiciones d={d} set={set} />
          </Section>

          <Section
            num="6"
            title="Acciones"
            desc="Guardar borrador o enviar al cliente"
            open={open.s6}
            onToggle={() => toggle("s6")}>
            
            <SectionAcciones d={d} set={set} calc={calc} isAdmin={isAdmin} />
          </Section>
        </div>

        {/* Sticky right column — Sección 4: Liquidación */}
        <div className="column-side">
          <LiquidationPanel d={d} set={set} calc={calc} procesos={procesos} />
        </div>
      </div>
    </div>);

}

// =========================================================
// Liquidation panel (Section 4 — always visible / sticky)
// =========================================================
function LiquidationPanel({ d, set, calc, procesos }) {
  const LiqInput = ({ value, onChange, isOverridden, onReset, big }) => {
    const display = Number(Math.round(value || 0)).toLocaleString("es-CO");
    return (
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
        {isOverridden &&
        <span
          onClick={onReset}
          title="Restaurar al cálculo automático"
          style={{ cursor: "pointer", color: "var(--accent)", fontSize: 11, fontWeight: 600 }}>
          ↺</span>
        }
        <span className="mono" style={{ color: "var(--ink-3)", fontSize: 11, marginRight: -2 }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          className={"liq-input mono" + (big ? " big" : "") + (isOverridden ? " overridden" : "")}
          value={display}
          onChange={(e) => {
            const v = parseInt(e.target.value.replace(/[^\d]/g, "")) || 0;
            onChange(v);
          }} />
        
      </div>);

  };

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
            {calc.procRows.map((p) =>
            <tr key={p.id} className="indent">
                <td>{p.nombre}</td>
                <td className="mono">{fmtCOP(p.costo)}</td>
              </tr>
            )}
            <tr className="subtotal">
              <td>Total Costos OP <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>· suma de procesos</span></td>
              <td>
                <LiqInput
                  value={calc.totalCostosOP}
                  onChange={(v) => set({ totalCostosOverride: v })}
                  isOverridden={d.totalCostosOverride !== null}
                  onReset={() => set({ totalCostosOverride: null })} />
                
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
                  onReset={() => set({ valorUnitarioOverride: null })} />
                
              </td>
            </tr>
            <tr className="subtotal">
              <td>Valor Total</td>
              <td>
                <LiqInput
                  value={calc.valorTotal}
                  onChange={(v) => set({ valorTotalOverride: v })}
                  isOverridden={d.valorTotalOverride !== null}
                  onReset={() => set({ valorTotalOverride: null })} />
                
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
                  onReset={() => set({ subtotalOverride: null })} />
                
              </td>
            </tr>
            <tr className="total">
              <td>Total cliente</td>
              <td>{fmtCOP(calc.valorTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: 14, padding: 10, background: "var(--surface-2)", borderRadius: 6, fontSize: 11, color: "var(--ink-3)", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Icon.Calc />
          <div>
            Todos los valores son editables: escribe directamente el número que deseas. El ↺ restaura el cálculo automático.
          </div>
        </div>
      </div>
      <div className="liq-footer">
        <button className="btn accent" style={{ width: "100%", justifyContent: "center" }}>
          <Icon.Send /> Guardar y enviar al cliente
        </button>
        <button className="btn" style={{ width: "100%", justifyContent: "center" }}>
          <Icon.Save /> Guardar borrador
        </button>
      </div>
    </div>);

}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);