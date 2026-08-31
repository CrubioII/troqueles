// Lógica compartida entre Cotización y Orden de Producción (OP directa).
// Ambos documentos comparten el mismo shape de estado, calculadora de pliegos
// y conversión API <-> estado; difieren solo en campos propios (estado de COT,
// abono/cotizacionId de OP).
import { PROCESS_GROUPS, fmtCOP, fmtNum } from '../components/core'

// Modos de cobro por proceso: fijo (monto plano) o tarifa × unidades,
// redondeando SIEMPRE hacia arriba (107.896 uds → 108 millares).
export const CHARGE_MODES = [
  { id: 'fijo',     label: 'Fijo' },
  { id: 'unitario', label: 'Por unidad',   divisor: 1,    unidad: 'unidades' },
  { id: 'centenar', label: 'Por centenar', divisor: 100,  unidad: 'centenares' },
  { id: 'millar',   label: 'Por millar',   divisor: 1000, unidad: 'millares' },
]

// null para 'fijo' → el caller conserva el comportamiento de monto plano
export function applyChargeMode(mode, rate, cantidadProduccion) {
  const def = CHARGE_MODES.find(m => m.id === mode)
  if (!def || def.id === 'fijo') return null
  const qty = Math.max(0, cantidadProduccion || 0)
  const unidades = Math.ceil(qty / def.divisor)
  const tarifa = rate || 0
  return {
    modo: def.id, tarifa, unidades,
    costo: Math.round(unidades * tarifa),
    detalle: `${fmtNum(unidades)} ${def.unidad} × ${fmtCOP(tarifa)}`,
    detalleUnidades: `${fmtNum(unidades)} ${def.unidad}`,
  }
}

// Build blank process state from PROCESS_GROUPS definitions
export function buildDefaultProcesos() {
  const init = {}
  PROCESS_GROUPS.forEach(g => g.procesos.forEach(p => {
    init[p.id] = {
      active: false,
      costo: p.defaultCost || 0,
      costoOverride: null,
      chargeMode: 'fijo',
      valorBase: 0,
      ...(p.extras || {}),
    }
  }))
  return init
}

// Seed procesos state from API rows (CotizacionProceso / OpProceso share shape)
export function seedProcesosFromApi(apiProcesos) {
  const fromApi = buildDefaultProcesos()
  ;(apiProcesos || []).forEach(p => {
    if (fromApi[p.proceso_id]) {
      fromApi[p.proceso_id] = {
        ...fromApi[p.proceso_id],
        active: p.active,
        costo: parseFloat(p.costo) || 0,
        costoOverride: p.costo_override != null ? parseFloat(p.costo_override) : null,
        ...p.extras,
      }
    }
  })
  return fromApi
}

// Blank state. kind: 'cot' | 'op'
export function buildBlankState(kind = 'cot') {
  const today = new Date().toISOString().slice(0, 10)
  const base = {
    id: null,
    numero: kind === 'op' ? 'OP-????' : 'COT-????',
    fecha: today,
    fechaEntrega: '',
    cliente: '',
    clienteId: null,
    clienteEmail: '',
    clienteTelefono: '',
    clienteNit: '',
    referencia: '',
    cantidad: 0,
    sobrante: 0,
    tipoCliente: 'final',

    moldeAncho: 0,
    moldeAlto: 0,
    pliegoTipo: '70x100',
    pliegoW: 70,
    pliegoH: 100,
    papelId: '',
    papelManualNombre: '',
    precioPliego: 0,
    costoPapelOverride: null,
    corteInicialActive: false,
    corteInicialPrecio: 15000,
    corteFinalActive: false,
    corteFinalPrecio: 15000,

    valorUnitarioOverride: null,
    valorTotalOverride: null,
    totalCostosOverride: null,
    subtotalOverride: null,

    margen: 80,

    condicionPago: kind === 'op' ? 'mismo' : '30',
    condicionCustom: '',
    tipoFacturacion: 'factura',
    observaciones: '',
  }
  if (kind === 'op') {
    return { ...base, abono: 0, cotizacionId: null, cotizacionNumero: '' }
  }
  return { ...base, estado: 'borrador', opciones: { baseTitulo: '', alternativas: [] } }
}

// Convert snake_case API response to camelCase app state. kind: 'cot' | 'op'
export function docToState(doc, papelCatalog, kind = 'cot') {
  const papelId = doc.papel ? String(doc.papel) : 'manual'
  const papelObj = papelCatalog.find(p => String(p.id) === papelId)

  const base = {
    id: doc.id,
    numero: doc.numero || (kind === 'op' ? 'OP-????' : 'COT-????'),
    fecha: doc.fecha || '',
    fechaEntrega: doc.fecha_entrega || '',
    cliente: doc.cliente_nombre || '',
    clienteId: doc.cliente || null,
    clienteEmail: doc.cliente_email || '',
    clienteTelefono: doc.cliente_telefono || '',
    clienteNit: doc.cliente_nit || '',
    referencia: doc.referencia || '',
    cantidad: doc.cantidad || 0,
    sobrante: doc.sobrante || 0,
    tipoCliente: doc.tipo_cliente || 'final',

    moldeAncho: parseFloat(doc.molde_ancho) || 0,
    moldeAlto: parseFloat(doc.molde_alto) || 0,
    pliegoTipo: doc.pliego_tipo || '70x100',
    pliegoW: parseFloat(doc.pliego_w) || 70,
    pliegoH: parseFloat(doc.pliego_h) || 100,
    papelId,
    papelManualNombre: doc.papel_manual_nombre || '',
    precioPliego: parseFloat(doc.precio_pliego) || (papelObj ? parseFloat(papelObj.precio) : 0),
    costoPapelOverride: doc.costo_papel_override != null ? parseFloat(doc.costo_papel_override) : null,
    corteInicialActive: !!doc.corte_inicial_active,
    corteInicialPrecio: parseFloat(doc.corte_inicial_precio) || 15000,
    corteFinalActive: !!doc.corte_final_active,
    corteFinalPrecio: parseFloat(doc.corte_final_precio) || 15000,

    valorUnitarioOverride: doc.valor_unitario_override != null ? parseFloat(doc.valor_unitario_override) : null,
    valorTotalOverride: doc.valor_total_override != null ? parseFloat(doc.valor_total_override) : null,
    totalCostosOverride: doc.total_costos_override != null ? parseFloat(doc.total_costos_override) : null,
    subtotalOverride: doc.subtotal_override != null ? parseFloat(doc.subtotal_override) : null,

    margen: doc.margen != null ? parseFloat(doc.margen) : 80,

    condicionPago: doc.condicion_pago || (kind === 'op' ? 'mismo' : '30'),
    condicionCustom: doc.condicion_custom || '',
    tipoFacturacion: doc.tipo_facturacion || 'factura',
    observaciones: doc.observaciones || '',
  }
  if (kind === 'op') {
    return {
      ...base,
      abono: doc.abono != null ? parseFloat(doc.abono) : 0,
      cotizacionId: doc.cotizacion || null,
      cotizacionNumero: doc.cotizacion_numero || '',
    }
  }
  return {
    ...base,
    estado: doc.estado || 'borrador',
    opciones: doc.opciones && Array.isArray(doc.opciones.alternativas)
      ? { baseTitulo: doc.opciones.baseTitulo || '', alternativas: doc.opciones.alternativas }
      : { baseTitulo: '', alternativas: [] },
  }
}

// Convert app state to snake_case API payload. kind: 'cot' | 'op'
export function stateToDoc(d, procesos, kind = 'cot') {
  const procesosArr = Object.entries(procesos).map(([proceso_id, p]) => ({
    proceso_id,
    active: !!p.active,
    costo: p.costo || 0,
    costo_override: p.costoOverride ?? null,
    extras: (() => {
      const { active, costo, costoOverride, ...rest } = p
      return rest
    })(),
  }))
  // Corte inicial/final no viven en PROCESS_GROUPS (tienen su propio campo de
  // precio en "Papel"), pero sí necesitan una fila de proceso para que la
  // cadena de Guillotina los pueda bloquear/completar. costo:0 a propósito —
  // ya se suman aparte vía corte_inicial_precio/corte_final_precio, sumar
  // también acá duplicaría el costo.
  procesosArr.push({ proceso_id: 'corteInicial', active: !!d.corteInicialActive, costo: 0, costo_override: null, extras: {} })
  procesosArr.push({ proceso_id: 'corteFinal', active: !!d.corteFinalActive, costo: 0, costo_override: null, extras: {} })

  const base = {
    fecha: d.fecha,
    fecha_entrega: d.fechaEntrega || null,
    cliente: d.clienteId,
    referencia: d.referencia,
    cantidad: d.cantidad,
    sobrante: d.sobrante,
    tipo_cliente: d.tipoCliente,

    molde_ancho: d.moldeAncho,
    molde_alto: d.moldeAlto,
    pliego_tipo: d.pliegoTipo,
    pliego_w: d.pliegoW,
    pliego_h: d.pliegoH,
    papel: d.papelId !== 'manual' ? parseInt(d.papelId) : null,
    papel_manual_nombre: d.papelId === 'manual' ? (d.papelManualNombre || '').trim() : '',
    precio_pliego: d.precioPliego,
    costo_papel_override: d.costoPapelOverride,
    corte_inicial_active: d.corteInicialActive,
    corte_inicial_precio: d.corteInicialPrecio,
    corte_final_active: d.corteFinalActive,
    corte_final_precio: d.corteFinalPrecio,

    valor_unitario_override: d.valorUnitarioOverride,
    valor_total_override: d.valorTotalOverride,
    total_costos_override: d.totalCostosOverride,
    subtotal_override: d.subtotalOverride,

    margen: d.margen,

    condicion_pago: d.condicionPago,
    condicion_custom: d.condicionCustom,
    tipo_facturacion: d.tipoFacturacion,
    observaciones: d.observaciones,

    procesos: procesosArr,
  }
  if (kind === 'op') {
    return { ...base, abono: d.abono || 0 }
  }
  return { ...base, estado: d.estado, opciones: d.opciones || { baseTitulo: '', alternativas: [] } }
}

// Calculadora de pliegos + costos + liquidación (compartida COT/OP)
export function computeCalc(d, procesos) {
  const w = d.moldeAncho, h = d.moldeAlto
  const pw = d.pliegoW, ph = d.pliegoH
  const o1 = w > 0 && h > 0 ? Math.floor(pw / w) * Math.floor(ph / h) : 0
  const o2 = w > 0 && h > 0 ? Math.floor(pw / h) * Math.floor(ph / w) : 0
  let cols = 0, rows = 0, total = 0, unitW = w, unitH = h
  if (o1 >= o2) {
    cols = Math.floor(pw / w); rows = Math.floor(ph / h); total = cols * rows; unitW = w; unitH = h
  } else {
    cols = Math.floor(pw / h); rows = Math.floor(ph / w); total = cols * rows; unitW = h; unitH = w
  }
  const unidadesPorPliego = total
  const cantidadProduccion = d.cantidad + (d.sobrante || 0)
  const pliegosNecesarios = unidadesPorPliego > 0 ? Math.ceil(cantidadProduccion / unidadesPorPliego) : 0
  const areaPliego = pw * ph
  const areaUsada = unidadesPorPliego * w * h
  const desperdicio = areaPliego > 0 ? Math.max(0, (areaPliego - areaUsada) / areaPliego * 100) : 0
  const costoPapelAuto = pliegosNecesarios * d.precioPliego
  const costoPapel = d.costoPapelOverride !== null ? d.costoPapelOverride : costoPapelAuto

  const lamP = procesos.laminado || {}
  const areaM2 = w * h / 10000
  const laminadoTiroAuto = Math.round(areaM2 * pliegosNecesarios * (lamP.tiroPrecioM2 || 0))
  const laminadoRetiroAuto = Math.round(areaM2 * pliegosNecesarios * (lamP.retiroPrecioM2 || 0))
  const lamTiroCm = applyChargeMode(lamP.tiroChargeMode, lamP.tiroValorBase, cantidadProduccion)
  const lamRetiroCm = applyChargeMode(lamP.retiroChargeMode, lamP.retiroValorBase, cantidadProduccion)
  const laminadoTiro = lamTiroCm ? lamTiroCm.costo : laminadoTiroAuto
  const laminadoRetiro = lamRetiroCm ? lamRetiroCm.costo : laminadoRetiroAuto
  const cajasP = procesos.cajas || {}
  const cajasAuto = Math.round((cajasP.cantidad || 0) * (cajasP.precioUnit || 0))
  const autoValues = { laminado: { tiro: laminadoTiro, retiro: laminadoRetiro }, cajas: cajasAuto }

  const costoCorteInicial = d.corteInicialActive ? (d.corteInicialPrecio || 0) : 0
  const costoCorteFinal = d.corteFinalActive ? (d.corteFinalPrecio || 0) : 0
  let totalProcesos = costoCorteInicial + costoCorteFinal
  // Líneas por millar/centenar/unidad son cobros directos al cliente: la tarifa
  // ya incluye el margen, así que no entran a costos ni al cálculo de margen.
  let totalCobrosDirectos = 0
  const procRows = []
  if (d.corteInicialActive) procRows.push({ id: 'corteInicial', nombre: 'Corte inicial', costo: costoCorteInicial })
  if (d.corteFinalActive)   procRows.push({ id: 'corteFinal',   nombre: 'Corte final',   costo: costoCorteFinal })
  PROCESS_GROUPS.forEach(g => g.procesos.forEach(pdef => {
    const p = procesos[pdef.id]
    if (!p?.active) return
    const addRow = (row, cm) => {
      if (cm) { totalCobrosDirectos += row.costo; row.directo = true }
      else totalProcesos += row.costo
      procRows.push(row)
    }
    if (pdef.id === 'impresion') {
      if (p.tiroActive) {
        const cm = applyChargeMode(p.tiroChargeMode, p.tiroValorBase, cantidadProduccion)
        const c = cm ? cm.costo : (p.costoTiro || 0)
        addRow({ id: 'impresion-tiro', nombre: `Impresión · Tiro (${p.tiroTipo})`, ...(cm || {}), costo: c }, cm)
      }
      if (p.retiroActive) {
        const cm = applyChargeMode(p.retiroChargeMode, p.retiroValorBase, cantidadProduccion)
        const c = cm ? cm.costo : (p.costoRetiro || 0)
        addRow({ id: 'impresion-retiro', nombre: `Impresión · Retiro (${p.retiroTipo})`, ...(cm || {}), costo: c }, cm)
      }
      return
    }
    if (pdef.id === 'laminado') {
      if (p.tiroActive) addRow({ id: 'laminado-tiro', nombre: `Laminado · Tiro (${p.tiroTipoLaminado || 'Mate'})`, ...(lamTiroCm || {}), costo: laminadoTiro }, lamTiroCm)
      if (p.retiroActive) addRow({ id: 'laminado-retiro', nombre: `Laminado · Retiro (${p.retiroTipoLaminado || 'Mate'})`, ...(lamRetiroCm || {}), costo: laminadoRetiro }, lamRetiroCm)
      return
    }
    const cm = p.costoOverride == null ? applyChargeMode(p.chargeMode, p.valorBase, cantidadProduccion) : null
    let costo
    if (p.costoOverride != null) costo = p.costoOverride
    else if (cm) costo = cm.costo
    else if (pdef.autoCalc) costo = autoValues[pdef.id] || 0
    else costo = p.costo || 0
    addRow({ id: pdef.id, nombre: pdef.nombre, ...(cm || {}), costo }, cm)
  }))
  const totalCostosOPAuto = costoPapel + totalProcesos
  const totalCostosOP = d.totalCostosOverride !== null ? d.totalCostosOverride : totalCostosOPAuto
  const valorUnitarioAuto = d.cantidad > 0 ? Math.round(totalCostosOPAuto / d.cantidad * (1 + (d.margen || 80) / 100)) : 0
  const valorUnitario = d.valorUnitarioOverride !== null ? d.valorUnitarioOverride : valorUnitarioAuto
  const valorTotalAuto = d.cantidad * valorUnitario + totalCobrosDirectos
  const valorTotal = d.valorTotalOverride !== null ? d.valorTotalOverride : valorTotalAuto
  const subtotalAuto = valorTotal - totalCostosOP
  const subtotal = d.subtotalOverride !== null ? d.subtotalOverride : subtotalAuto
  const comision = d.tipoCliente === 'terciario' ? subtotal / 2 : 0

  // Fila "Valor unitario" en los documentos generados: si todo el valor viene
  // de cobros por cantidad con una única tarifa, se muestra esa tarifa
  // ("Valor millar · $ 50.000") en lugar del valor unitario clásico.
  let valorUnitarioLabel = 'Valor unitario'
  let valorUnitarioDoc = valorUnitario
  const directRows = procRows.filter(r => r.directo)
  if (directRows.length > 0 && costoPapel + totalProcesos === 0) {
    const modos = [...new Set(directRows.map(r => r.modo))]
    const tarifas = [...new Set(directRows.map(r => r.tarifa))]
    if (modos.length === 1 && tarifas.length === 1) {
      valorUnitarioLabel = { unitario: 'Valor unidad', centenar: 'Valor centenar', millar: 'Valor millar' }[modos[0]]
      valorUnitarioDoc = tarifas[0]
    }
  }

  return {
    cols, rows, unitW, unitH,
    unidadesPorPliego, pliegosNecesarios, desperdicio, cantidadProduccion,
    costoPapel, costoPapelAuto,
    autoValues,
    totalProcesos, totalCobrosDirectos, procRows,
    totalCostosOP, totalCostosOPAuto,
    valorUnitario, valorUnitarioAuto,
    valorUnitarioLabel, valorUnitarioDoc,
    valorTotal, valorTotalAuto,
    subtotal, subtotalAuto,
    comision,
  }
}

// Recalcula la cotización con tarifas alternativas sobre las líneas por cantidad
// (cobros directos). `tarifas` va indexado por id de fila de procRows:
// 'laminado-tiro', 'impresion-retiro', 'troquelado', etc. Los overrides de la
// liquidación pertenecen a la opción base, así que aquí se ignoran.
export function computeCalcConTarifas(d, procesos, tarifas = {}) {
  const dd = {
    ...d,
    valorUnitarioOverride: null,
    valorTotalOverride: null,
    totalCostosOverride: null,
    subtotalOverride: null,
  }
  const clone = {}
  for (const [id, p] of Object.entries(procesos)) {
    const q = { ...p }
    if (tarifas[id] != null && q.chargeMode && q.chargeMode !== 'fijo') q.valorBase = tarifas[id]
    if (tarifas[`${id}-tiro`] != null && q.tiroChargeMode && q.tiroChargeMode !== 'fijo') q.tiroValorBase = tarifas[`${id}-tiro`]
    if (tarifas[`${id}-retiro`] != null && q.retiroChargeMode && q.retiroChargeMode !== 'fijo') q.retiroValorBase = tarifas[`${id}-retiro`]
    clone[id] = q
  }
  return computeCalc(dd, clone)
}

// Arma el payload `opciones` para los PDF/correos: un bloque por opción de
// cobro (la base + cada alternativa). null cuando no hay alternativas.
export function buildOpcionesPdf(d, procesos, calc) {
  const alternativas = d.opciones?.alternativas || []
  if (alternativas.length === 0) return null
  const block = (c) => ({
    proc_rows: c.procRows.map(p => ({ nombre: p.nombre, costo: p.costo, detalle: p.detalle || '' })),
    costo_papel: c.costoPapel ?? 0,
    total_costos_op: (c.totalCostosOP ?? 0) + (c.totalCobrosDirectos ?? 0),
    valor_unitario: c.valorUnitarioDoc ?? c.valorUnitario ?? 0,
    valor_unitario_label: c.valorUnitarioLabel || 'Valor unitario',
    valor_total: c.valorTotal ?? 0,
  })
  return [
    { titulo: d.opciones?.baseTitulo || '', ...block(calc) },
    ...alternativas.map(o => ({
      titulo: o.titulo || '',
      ...block(computeCalcConTarifas(d, procesos, o.tarifas || {})),
    })),
  ]
}
