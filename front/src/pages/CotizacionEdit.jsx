import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, PROCESS_GROUPS, CONDICIONES_PAGO, STATUS_DEFS, Section } from '../components/core'
import { SectionGenerales, SectionPapel, SectionProcesos, SectionCondiciones, SectionAcciones } from '../components/sections'
import LiquidationPanel from '../components/LiquidationPanel'
import { getCotizacion, getPapeles, createCotizacion, updateCotizacion, cambiarEstado, createCliente, updateCliente, deleteCotizacion } from '../api'
import { useAuth } from '../context/AuthContext'

// Build blank process state from PROCESS_GROUPS definitions
function buildDefaultProcesos() {
  const init = {}
  PROCESS_GROUPS.forEach(g => g.procesos.forEach(p => {
    init[p.id] = {
      active: false,
      costo: p.defaultCost || 0,
      costoOverride: null,
      ...(p.extras || {}),
    }
  }))
  return init
}

// Convert snake_case API response to camelCase app state
function apiToState(cot, papelCatalog) {
  const papelId = cot.papel ? String(cot.papel) : 'manual'
  const papelObj = papelCatalog.find(p => String(p.id) === papelId)

  return {
    id: cot.id,
    numero: cot.numero || 'COT-????',
    fecha: cot.fecha || '',
    cliente: cot.cliente_nombre || '',
    clienteId: cot.cliente || null,
    clienteEmail: cot.cliente_email || '',
    clienteTelefono: cot.cliente_telefono || '',
    clienteNit: cot.cliente_nit || '',
    referencia: cot.referencia || '',
    cantidad: cot.cantidad || 0,
    sobrante: cot.sobrante || 0,
    tipoCliente: cot.tipo_cliente || 'final',
    estado: cot.estado || 'borrador',

    moldeAncho: parseFloat(cot.molde_ancho) || 0,
    moldeAlto: parseFloat(cot.molde_alto) || 0,
    pliegoTipo: cot.pliego_tipo || '70x100',
    pliegoW: parseFloat(cot.pliego_w) || 70,
    pliegoH: parseFloat(cot.pliego_h) || 100,
    papelId,
    precioPliego: parseFloat(cot.precio_pliego) || (papelObj ? parseFloat(papelObj.precio) : 0),
    costoPapelOverride: cot.costo_papel_override != null ? parseFloat(cot.costo_papel_override) : null,
    corteInicialActive: !!cot.corte_inicial_active,
    corteInicialPrecio: parseFloat(cot.corte_inicial_precio) || 15000,
    corteFinalActive: !!cot.corte_final_active,
    corteFinalPrecio: parseFloat(cot.corte_final_precio) || 15000,

    valorUnitarioOverride: cot.valor_unitario_override != null ? parseFloat(cot.valor_unitario_override) : null,
    valorTotalOverride: cot.valor_total_override != null ? parseFloat(cot.valor_total_override) : null,
    totalCostosOverride: cot.total_costos_override != null ? parseFloat(cot.total_costos_override) : null,
    subtotalOverride: cot.subtotal_override != null ? parseFloat(cot.subtotal_override) : null,

    margen: cot.margen != null ? parseFloat(cot.margen) : 80,

    condicionPago: cot.condicion_pago || '30',
    condicionCustom: cot.condicion_custom || '',
    observaciones: cot.observaciones || '',
  }
}

// Convert app state to snake_case API payload
function stateToApi(d, procesos) {
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

  return {
    fecha: d.fecha,
    cliente: d.clienteId,
    referencia: d.referencia,
    cantidad: d.cantidad,
    sobrante: d.sobrante,
    tipo_cliente: d.tipoCliente,
    estado: d.estado,

    molde_ancho: d.moldeAncho,
    molde_alto: d.moldeAlto,
    pliego_tipo: d.pliegoTipo,
    pliego_w: d.pliegoW,
    pliego_h: d.pliegoH,
    papel: d.papelId !== 'manual' ? parseInt(d.papelId) : null,
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
    observaciones: d.observaciones,

    procesos: procesosArr,
  }
}

// Blank state for new cotización
function buildBlankState() {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: null,
    numero: 'COT-????',
    fecha: today,
    cliente: '',
    clienteId: null,
    clienteEmail: '',
    clienteTelefono: '',
    clienteNit: '',
    referencia: '',
    cantidad: 0,
    sobrante: 0,
    tipoCliente: 'final',
    estado: 'borrador',

    moldeAncho: 0,
    moldeAlto: 0,
    pliegoTipo: '70x100',
    pliegoW: 70,
    pliegoH: 100,
    papelId: '',
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

    condicionPago: '30',
    condicionCustom: '',
    observaciones: '',
  }
}

export default function CotizacionEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isNew = id === 'nuevo'

  const [d, setData] = useState(buildBlankState)
  const [procesos, setProcesos] = useState(buildDefaultProcesos)
  const [papelCatalog, setPapelCatalog] = useState([])
  const [open, setOpen] = useState({ s1: true, s2: true, s3: true, s5: true, s6: true })
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [toast, setToast] = useState(null)
  const toastRef = useRef(null)

  const set = (patch) => setData(prev => ({ ...prev, ...patch }))
  const setProc = (pid, patch) => setProcesos(prev => ({ ...prev, [pid]: { ...prev[pid], ...patch } }))
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))

  // Load papers + cotización (if editing)
  useEffect(() => {
    const tasks = [getPapeles()]
    if (!isNew) tasks.push(getCotizacion(id))

    Promise.all(tasks)
      .then(([papeles, cot]) => {
        setPapelCatalog(papeles.results || papeles)

        if (cot) {
          const catalog = papeles.results || papeles
          setData(apiToState(cot, catalog))

          // Seed procesos from API data if present
          if (cot.procesos && cot.procesos.length > 0) {
            const fromApi = buildDefaultProcesos()
            cot.procesos.forEach(p => {
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
            setProcesos(fromApi)
          }
        } else if (papeles.results || papeles) {
          // For new cotización: default to first paper in catalog
          const catalog = papeles.results || papeles
          if (catalog.length > 0) {
            const first = catalog[0]
            set({ papelId: String(first.id), precioPliego: parseFloat(first.precio) })
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  // ============ Calculations ============
  const calc = useMemo(() => {
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
    const cajasP = procesos.cajas || {}
    const cajasAuto = Math.round((cajasP.cantidad || 0) * (cajasP.precioUnit || 0))
    const autoValues = { laminado: { tiro: laminadoTiroAuto, retiro: laminadoRetiroAuto }, cajas: cajasAuto }

    const costoCorteInicial = d.corteInicialActive ? (d.corteInicialPrecio || 0) : 0
    const costoCorteFinal = d.corteFinalActive ? (d.corteFinalPrecio || 0) : 0
    let totalProcesos = costoCorteInicial + costoCorteFinal
    const procRows = []
    if (d.corteInicialActive) procRows.push({ id: 'corteInicial', nombre: 'Corte inicial', costo: costoCorteInicial })
    if (d.corteFinalActive)   procRows.push({ id: 'corteFinal',   nombre: 'Corte final',   costo: costoCorteFinal })
    PROCESS_GROUPS.forEach(g => g.procesos.forEach(pdef => {
      const p = procesos[pdef.id]
      if (!p?.active) return
      if (pdef.id === 'impresion') {
        if (p.tiroActive) { const c = p.costoTiro || 0; totalProcesos += c; procRows.push({ id: 'impresion-tiro', nombre: `Impresión · Tiro (${p.tiroTipo})`, costo: c }) }
        if (p.retiroActive) { const c = p.costoRetiro || 0; totalProcesos += c; procRows.push({ id: 'impresion-retiro', nombre: `Impresión · Retiro (${p.retiroTipo})`, costo: c }) }
        return
      }
      if (pdef.id === 'laminado') {
        if (p.tiroActive) { const c = laminadoTiroAuto; totalProcesos += c; procRows.push({ id: 'laminado-tiro', nombre: `Laminado · Tiro (${p.tiroTipoLaminado || 'Mate'})`, costo: c }) }
        if (p.retiroActive) { const c = laminadoRetiroAuto; totalProcesos += c; procRows.push({ id: 'laminado-retiro', nombre: `Laminado · Retiro (${p.retiroTipoLaminado || 'Mate'})`, costo: c }) }
        return
      }
      let costo
      if (p.costoOverride != null) costo = p.costoOverride
      else if (pdef.autoCalc) costo = autoValues[pdef.id] || 0
      else costo = p.costo || 0
      totalProcesos += costo
      procRows.push({ id: pdef.id, nombre: pdef.nombre, costo })
    }))
    const totalCostosOPAuto = costoPapel + totalProcesos
    const totalCostosOP = d.totalCostosOverride !== null ? d.totalCostosOverride : totalCostosOPAuto
    const valorUnitarioAuto = d.cantidad > 0 ? Math.round(totalCostosOPAuto / d.cantidad * (1 + (d.margen || 80) / 100)) : 0
    const valorUnitario = d.valorUnitarioOverride !== null ? d.valorUnitarioOverride : valorUnitarioAuto
    const valorTotalAuto = d.cantidad * valorUnitario
    const valorTotal = d.valorTotalOverride !== null ? d.valorTotalOverride : valorTotalAuto
    const subtotalAuto = valorTotal - totalCostosOP
    const subtotal = d.subtotalOverride !== null ? d.subtotalOverride : subtotalAuto
    const comision = d.tipoCliente === 'terciario' ? subtotal / 2 : 0

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
      comision,
    }
  }, [d, procesos])

  // ============ Save handlers ============
  const save = async (estadoOverride = null) => {
    setSaving(true)
    setSaveError(null)
    try {
      let clienteId = d.clienteId
      if (!clienteId) {
        if (!d.cliente.trim()) throw new Error('El campo Cliente es obligatorio')
        const newCliente = await createCliente({
          nombre: d.cliente.trim(),
          tipo: d.tipoCliente,
          email: d.clienteEmail || '',
          telefono: d.clienteTelefono || '',
          nit: d.clienteNit || '',
        })
        clienteId = newCliente.id
        set({ clienteId: newCliente.id })
      } else {
        await updateCliente(clienteId, {
          email: d.clienteEmail || '',
          telefono: d.clienteTelefono || '',
          nit: d.clienteNit || '',
        })
      }

      const payload = stateToApi({ ...d, clienteId }, procesos)
      if (estadoOverride) payload.estado = estadoOverride
      // Persist effective prices so DC import always has values
      if (payload.valor_unitario_override == null && calc.valorUnitario > 0)
        payload.valor_unitario_override = Math.round(calc.valorUnitario)
      if (payload.valor_total_override == null && calc.valorTotal > 0)
        payload.valor_total_override = Math.round(calc.valorTotal)

      let result
      if (!d.id) {
        result = await createCotizacion(payload)
        // Update URL to reflect new id without full navigation
        window.history.replaceState(null, '', `/cotizaciones/${result.id}`)
      } else {
        result = await updateCotizacion(d.id, payload)
      }

      // Refresh state from response
      setData(prev => ({
        ...prev,
        id: result.id,
        numero: result.numero || prev.numero,
        estado: result.estado || prev.estado,
      }))
      clearTimeout(toastRef.current)
      setToast('Cotización guardada correctamente')
      toastRef.current = setTimeout(() => setToast(null), 3000)
      return result.id
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    navigate('/')
    deleteCotizacion(d.id).catch(() => {})
  }

  const condicionLabel = (() => {
    if (d.condicionPago === 'custom') return d.condicionCustom || 'Personalizado'
    return CONDICIONES_PAGO.find(x => x.id === d.condicionPago)?.lbl
  })()

  if (loading) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <div className="mark">TI</div>
            <div className="biz">Troqueles INK</div>
            <span className="div">/</span>
            <div className="mod">Cotizaciones</div>
          </div>
        </div>
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando cotización…</div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <div className="mark">TI</div>
          <div className="biz">Troqueles INK</div>
          <span className="div">/</span>
          <button
            className="btn"
            style={{ padding: '2px 8px', fontSize: 12, gap: 4 }}
            onClick={() => navigate('/')}
          >
            <Icon.ArrowLeft /> Cotizaciones
          </button>
          <span className="div">/</span>
          <div className="mod mono">{d.numero}</div>
        </div>
        <div className="topbar-right">
          {saveError && (
            <span style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>
              Error: {saveError}
            </span>
          )}
          <div className="userchip">
            <div className="av">{user?.username?.slice(0, 2).toUpperCase()}</div>
            <div>
              <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{user?.username}</div>
              <div className="role">{isAdmin ? 'Administrador' : 'Operador'}</div>
            </div>
          </div>
          <button
            className="btn"
            style={{ padding: '4px 10px', fontSize: 11 }}
            onClick={logout}
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </div>

      {/* Phase stepper */}
      <div className="stepper">
        <div className="step active">
          <div className="num">1</div>
          <div>Cotización <span className="sub">· en edición</span></div>
        </div>
        <div className={'step' + (d.estado === 'aprobada' || d.estado === 'convertida' ? '' : ' disabled')}>
          <div className="num">2</div>
          <div>
            Producción
            {d.estado === 'aprobada' && isAdmin && (
              <button
                className="btn accent"
                style={{ marginLeft: 12, fontSize: 11, padding: '2px 10px' }}
                onClick={() => {
                  navigate('/ordenes/nuevo', {
                    state: {
                      fromCotizacion: {
                        cotizacion: d.id,
                        cotizacionNumero: d.numero,
                        cliente: d.clienteId,
                        clienteNombre: d.cliente,
                        referencia: d.referencia,
                        cantidad: d.cantidad,
                        tipoClienteOp: d.tipoCliente,
                        valorUnitario: Math.round(calc.valorUnitario || 0),
                        valorTotal: Math.round(calc.valorTotal || 0),
                        totalCostos: Math.round(calc.totalCostosOP || 0),
                        condicionPago: d.condicionPago === '8' ? '8_dias' : d.condicionPago === '30' ? '30_dias' : 'mismo_dia',
                        observaciones: d.observaciones,
                      }
                    }
                  })
                }}
              >
                + Crear OP
              </button>
            )}
            {d.estado === 'convertida' && (
              <span className="sub" style={{ marginLeft: 8 }}>· OP creada</span>
            )}
          </div>
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
            num="1" title="Datos generales"
            desc="Información básica de la cotización"
            open={open.s1} onToggle={() => toggle('s1')}
            summary={!open.s1 && <>
              <span>Cliente:</span> <span className="v">{d.cliente || '—'}</span>
              <span>· Cantidad:</span> <span className="v mono">{fmtNum(d.cantidad)}</span>
            </>}
          >
            <SectionGenerales d={d} set={set} />
          </Section>

          <Section
            num="2" title="Calculadora de papel y pliegos"
            desc="Cuántos pliegos necesitas comprar"
            open={open.s2} onToggle={() => toggle('s2')}
            summary={!open.s2 && <>
              <span>Pliegos:</span> <span className="v mono">{calc.pliegosNecesarios}</span>
              <span>· Costo papel:</span> <span className="v mono">{fmtCOP(calc.costoPapel)}</span>
            </>}
          >
            <SectionPapel d={d} set={set} calc={calc} papelCatalog={papelCatalog} />
          </Section>

          <Section
            num="3" title="Procesos de producción"
            desc="Marca los procesos que requiere esta orden"
            open={open.s3} onToggle={() => toggle('s3')}
            summary={!open.s3 && <>
              <span>Procesos activos:</span> <span className="v">{calc.procRows.length}</span>
              <span>· Costo procesos:</span> <span className="v mono">{fmtCOP(calc.totalProcesos)}</span>
            </>}
          >
            <SectionProcesos procesos={procesos} setProc={setProc} autoValues={calc.autoValues} />
            <div className="note" style={{ marginTop: 14 }}>
              <Icon.Info />
              <span>Los procesos marcados aquí se convertirán automáticamente en las tareas activas de la Orden de Producción al confirmar la cotización.</span>
            </div>
          </Section>

          <Section
            num="4" title="Observaciones y notas"
            desc="Texto libre al pie de la cotización"
            open={true} locked={true}
          >
            <div className="obs-card">
              <label className="field-label" style={{ marginBottom: 6 }}>Observaciones de la cotización</label>
              <textarea
                className="textarea"
                placeholder="Notas internas, condiciones especiales, requerimientos del cliente, etc."
                value={d.observaciones}
                onChange={e => set({ observaciones: e.target.value })}
              />
            </div>
          </Section>

          <Section
            num="5" title="Condiciones comerciales"
            desc="Cómo se pacta el pago con el cliente"
            open={open.s5} onToggle={() => toggle('s5')}
            summary={!open.s5 && <><span>Pago:</span> <span className="v">{condicionLabel}</span></>}
          >
            <SectionCondiciones d={d} set={set} />
          </Section>

          <Section
            num="6" title="Acciones"
            desc="Guardar borrador o enviar al cliente"
            open={open.s6} onToggle={() => toggle('s6')}
          >
            <SectionAcciones
              d={d} calc={calc}
              saving={saving}
              onSave={() => save()}
              onDelete={handleDelete}
            />
          </Section>
        </div>

        {/* Sticky right column — Liquidación (admin only) */}
        {isAdmin && (
          <div className="column-side">
            <LiquidationPanel d={d} set={set} calc={calc} onSave={() => save()} saving={saving} />
          </div>
        )}
      </div>

      {/* Save toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#1a4a2e', color: '#fff', padding: '10px 22px',
          borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
        }}>
          ✓ {toast}
        </div>
      )}
    </div>
  )
}
