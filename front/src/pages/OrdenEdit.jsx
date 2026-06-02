import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { PROCESOS_OP, OP_STATUS_DEFS } from '../components/core'
import {
  SectionOpGenerales, SectionOpEspecificaciones, SectionOpProcesos,
  SectionOpLiquidacion, SectionOpCondiciones, SectionOpEstado,
} from '../components/OrdenSections'
import OpProgressPanel from '../components/OpProgressPanel'
import MaquinaBoard from '../components/MaquinaBoard'
import { Section } from '../components/core'
import {
  getOrden, createOrden, updateOrden, cambiarEstadoOrden,
  getOperarios, updateProcesoProgreso, cambiarEstado,
} from '../api'
import { useAuth } from '../context/AuthContext'

// ─── State helpers ─────────────────────────────────────────────────────────────

function buildBlankState() {
  return {
    id: null,
    numero: '',
    fecha: new Date().toISOString().slice(0, 10),
    cliente: null,
    clienteNombre: '',
    cotizacion: null,
    cotizacionNumero: '',
    referencia: '',
    descripcion: '',
    estado: 'borrador',
    tipoClienteOp: 'final',
    condicionCobroTerciario: '',
    cantidad: 0,
    valorUnitario: 0,
    cantidadPliegos: 0,
    papelReferencia: '',
    corteInicial: '',
    corteFinal: '',
    medidaProducto: '',
    cantidadImpresion: 0,
    totalCostos: 0,
    valorTotal: 0,
    subtotal: 0,
    abono: 0,
    condicionPago: 'mismo_dia',
    observaciones: '',
  }
}

function buildBlankProcesos() {
  const init = {}
  PROCESOS_OP.forEach(([pid, , mid]) => {
    init[pid] = {
      active: false,
      costo: 0,
      maquinaId: mid,
      operario: null,
      operarioNombre: '',
      estado: 'pendiente',
      unidadesCompletadas: 0,
      iniciadoEn: null,
      completadoEn: null,
      notas: '',
    }
  })
  return init
}

function apiToState(orden) {
  return {
    id: orden.id,
    numero: orden.numero || '',
    fecha: orden.fecha || new Date().toISOString().slice(0, 10),
    cliente: orden.cliente || null,
    clienteNombre: orden.cliente_nombre || '',
    cotizacion: orden.cotizacion || null,
    cotizacionNumero: orden.cotizacion_numero || '',
    referencia: orden.referencia || '',
    descripcion: orden.descripcion || '',
    estado: orden.estado || 'borrador',
    tipoClienteOp: orden.tipo_cliente_op || 'final',
    condicionCobroTerciario: orden.condicion_cobro_terciario || '',
    cantidad: orden.cantidad || 0,
    valorUnitario: parseFloat(orden.valor_unitario) || 0,
    cantidadPliegos: orden.cantidad_pliegos || 0,
    papelReferencia: orden.papel_referencia || '',
    corteInicial: orden.corte_inicial || '',
    corteFinal: orden.corte_final || '',
    medidaProducto: orden.medida_producto || '',
    cantidadImpresion: orden.cantidad_impresion || 0,
    totalCostos: parseFloat(orden.total_costos) || 0,
    valorTotal: parseFloat(orden.valor_total) || 0,
    subtotal: parseFloat(orden.subtotal) || 0,
    abono: parseFloat(orden.abono) || 0,
    condicionPago: orden.condicion_pago || 'mismo_dia',
    observaciones: orden.observaciones || '',
  }
}

function procesosFromApi(apiProcesos) {
  const result = buildBlankProcesos()
  ;(apiProcesos || []).forEach(p => {
    if (result[p.proceso_id]) {
      result[p.proceso_id] = {
        active: !!p.active,
        costo: parseFloat(p.costo) || 0,
        maquinaId: p.maquina_id || result[p.proceso_id].maquinaId,
        operario: p.operario || null,
        operarioNombre: p.operario_username || '',
        estado: p.estado || 'pendiente',
        unidadesCompletadas: p.unidades_completadas || 0,
        iniciadoEn: p.iniciado_en || null,
        completadoEn: p.completado_en || null,
        notas: p.notas || '',
      }
    }
  })
  return result
}

function stateToApi(d, procesos) {
  const procesosArr = PROCESOS_OP.map(([pid, , mid]) => {
    const p = procesos[pid] || {}
    return {
      proceso_id: pid,
      active: !!p.active,
      costo: p.costo || 0,
      maquina_id: p.maquinaId || mid,
      operario: p.operario || null,
      estado: p.estado || 'pendiente',
      unidades_completadas: p.unidadesCompletadas || 0,
      notas: p.notas || '',
    }
  })

  return {
    fecha: d.fecha,
    cliente: d.cliente,
    cotizacion: d.cotizacion || null,
    referencia: d.referencia,
    descripcion: d.descripcion,
    estado: d.estado,
    tipo_cliente_op: d.tipoClienteOp,
    condicion_cobro_terciario: d.condicionCobroTerciario || '',
    cantidad: d.cantidad,
    valor_unitario: d.valorUnitario,
    cantidad_pliegos: d.cantidadPliegos,
    papel_referencia: d.papelReferencia,
    corte_inicial: d.corteInicial,
    corte_final: d.corteFinal,
    medida_producto: d.medidaProducto,
    cantidad_impresion: d.cantidadImpresion,
    total_costos: d.totalCostos,
    valor_total: d.valorTotal,
    subtotal: d.subtotal,
    abono: d.abono,
    condicion_pago: d.condicionPago,
    observaciones: d.observaciones,
    procesos: procesosArr,
  }
}

// ─── Operator task card (needs own state per process) ─────────────────────────

function TareaCard({ pid, label, mid, p, onProgreso }) {
  const [localUnidades, setLocalUnidades] = useState(p.unidadesCompletadas || 0)
  const [localNotas, setLocalNotas] = useState(p.notas || '')

  return (
    <div className="task-card">
      <div className="task-card-header">
        <div className={`semaforo ${p.estado || 'pendiente'}`} />
        <div>
          <div className="task-card-proc">{label}</div>
          <div className="task-card-machine">{mid}</div>
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 8 }}>
        <div className="field">
          <div className="field-label">Unidades completadas</div>
          <input
            type="number"
            className="input"
            value={localUnidades}
            onChange={e => setLocalUnidades(Number(e.target.value))}
            min={0}
          />
        </div>
        <div className="field">
          <div className="field-label">Notas</div>
          <input
            className="input"
            value={localNotas}
            onChange={e => setLocalNotas(e.target.value)}
            placeholder="Observaciones del proceso…"
          />
        </div>
      </div>
      <div className="task-actions">
        {p.estado === 'pendiente' && (
          <button className="btn accent" onClick={() => onProgreso(pid, { estado: 'en_proceso' })}>
            ▶ Iniciar
          </button>
        )}
        {p.estado === 'en_proceso' && (
          <>
            <button className="btn" onClick={() => onProgreso(pid, { unidades_completadas: localUnidades, notas: localNotas })}>
              Guardar progreso
            </button>
            <button className="btn accent" onClick={() => onProgreso(pid, { estado: 'completado', unidades_completadas: localUnidades, notas: localNotas })}>
              ✓ Completar
            </button>
          </>
        )}
        {p.estado === 'completado' && (
          <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>✓ Completado</span>
        )}
      </div>
    </div>
  )
}

function OperadorTareas({ myProcesos, procesos, onProgreso }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Mis tareas</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {myProcesos.map(([pid, label, mid]) => (
          <TareaCard key={pid} pid={pid} label={label} mid={mid} p={procesos[pid] || {}} onProgreso={onProgreso} />
        ))}
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function OrdenEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isNew = id === 'nuevo'

  const [d, setData] = useState(buildBlankState)
  const [procesos, setProcesos] = useState(buildBlankProcesos)
  const [operarios, setOperarios] = useState([])
  const [open, setOpen] = useState({ s1: true, s2: true, s3: true, s4: true, s5: true, s6: false, sMaq: false })
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [toast, setToast] = useState(null)
  const toastRef = useRef(null)

  const set = (patch) => setData(prev => ({ ...prev, ...patch }))
  const setProc = (pid, patch) => setProcesos(prev => ({ ...prev, [pid]: { ...prev[pid], ...patch } }))

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type })
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  // Pre-fill from cotizacion state (when navigating from CotizacionEdit)
  useEffect(() => {
    const prefill = location.state?.fromCotizacion
    if (isNew && prefill) {
      setData(prev => ({
        ...prev,
        ...prefill,
      }))
    }
  }, [])

  useEffect(() => {
    if (isAdmin) {
      getOperarios().then(setOperarios).catch(() => {})
    }

    if (isNew) return

    setLoading(true)
    getOrden(id)
      .then(orden => {
        setData(apiToState(orden))
        setProcesos(procesosFromApi(orden.procesos))
      })
      .catch(e => setSaveError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async () => {
    if (!d.cliente) { showToast('Selecciona un cliente', 'warn'); return }
    if (!d.referencia.trim()) { showToast('Ingresa una referencia', 'warn'); return }

    setSaving(true)
    setSaveError(null)
    try {
      const payload = stateToApi(d, procesos)
      const result = isNew
        ? await createOrden(payload)
        : await updateOrden(d.id, payload)
      setData(apiToState(result))
      setProcesos(procesosFromApi(result.procesos))
      showToast(isNew ? 'OP creada' : 'Cambios guardados')
      if (isNew) {
        if (d.cotizacion) {
          cambiarEstado(d.cotizacion, 'convertida').catch(() => {})
        }
        navigate(`/ordenes/${result.id}`, { replace: true })
      }
    } catch (e) {
      setSaveError(e.message)
      showToast('Error al guardar: ' + e.message, 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleCambiarEstado = async (nuevo) => {
    if (!d.id) return
    setSaving(true)
    try {
      const result = await cambiarEstadoOrden(d.id, nuevo)
      setData(prev => ({ ...prev, estado: result.estado }))
      showToast('Estado actualizado')
    } catch (e) {
      showToast('Error: ' + e.message, 'danger')
    } finally {
      setSaving(false)
    }
  }

  // Operator: update process progress
  const handleProgresoUpdate = async (pid, patch) => {
    if (!d.id) return
    setSaving(true)
    try {
      const result = await updateProcesoProgreso(d.id, { proceso_id: pid, ...patch })
      setProc(pid, {
        estado: result.estado,
        unidadesCompletadas: result.unidades_completadas,
        iniciadoEn: result.iniciado_en,
        completadoEn: result.completado_en,
        notas: result.notas,
      })
      showToast('Progreso actualizado')
    } catch (e) {
      showToast('Error: ' + e.message, 'danger')
    } finally {
      setSaving(false)
    }
  }

  const myProcesos = !isAdmin
    ? PROCESOS_OP.filter(([pid]) => procesos[pid]?.operario === user?.id && procesos[pid]?.active)
    : []

  if (loading) return (
    <div className="app">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--ink-3)' }}>
        Cargando OP…
      </div>
    </div>
  )

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <button className="btn" onClick={() => navigate('/ordenes')} style={{ padding: '2px 8px', fontSize: 12, gap: 4 }}>
            <Icon.ArrowLeft /> Órdenes de Producción
          </button>
          {!isNew && (
            <>
              <span className="div">/</span>
              <div className="mod">{d.numero || `OP #${id}`}</div>
            </>
          )}
        </div>
        <div className="topbar-right" />
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          padding: '10px 16px', borderRadius: 'var(--radius)',
          background: toast.type === 'danger' ? 'var(--danger)' : toast.type === 'warn' ? 'var(--warn)' : 'var(--ok)',
          color: 'white', fontWeight: 600, fontSize: 13,
          boxShadow: 'var(--shadow-md)',
        }}>
          {toast.msg}
        </div>
      )}

      <div className="workspace">
        <div className="column-main">
          {/* Operator view: my tasks */}
          {!isAdmin && myProcesos.length > 0 && (
            <OperadorTareas
              myProcesos={myProcesos}
              procesos={procesos}
              onProgreso={handleProgresoUpdate}
            />
          )}

          {!isAdmin && myProcesos.length === 0 && !isNew && (
            <div className="note info">
              No tienes procesos asignados en esta OP. Contacta al administrador para recibir asignaciones.
            </div>
          )}

          <SectionOpGenerales
            d={d} set={set}
            open={open.s1} onToggle={() => setOpen(o => ({ ...o, s1: !o.s1 }))}
            operarios={operarios}
            isAdmin={isAdmin}
          />
          <SectionOpEspecificaciones
            d={d} set={set}
            open={open.s2} onToggle={() => setOpen(o => ({ ...o, s2: !o.s2 }))}
            isAdmin={isAdmin}
          />
          <SectionOpProcesos
            procesos={procesos} setProc={setProc}
            open={open.s3} onToggle={() => setOpen(o => ({ ...o, s3: !o.s3 }))}
            operarios={operarios}
            isAdmin={isAdmin}
          />
          <SectionOpLiquidacion
            d={d} set={set} procesos={procesos}
            open={open.s4} onToggle={() => setOpen(o => ({ ...o, s4: !o.s4 }))}
            isAdmin={isAdmin}
          />
          <SectionOpCondiciones
            d={d} set={set}
            open={open.s5} onToggle={() => setOpen(o => ({ ...o, s5: !o.s5 }))}
            isAdmin={isAdmin}
          />

          {isAdmin && !isNew && (
            <SectionOpEstado
              d={d} set={set}
              open={open.s6} onToggle={() => setOpen(o => ({ ...o, s6: !o.s6 }))}
              onCambiarEstado={handleCambiarEstado}
              saving={saving}
            />
          )}

          {/* MaquinaBoard */}
          {!isNew && (
            <Section
              num="☷"
              title="Tablero de máquinas"
              desc="estado por máquina en tiempo real"
              open={open.sMaq}
              onToggle={() => setOpen(o => ({ ...o, sMaq: !o.sMaq }))}
            >
              <MaquinaBoard procesos={procesos} currentUserId={user?.id} />
            </Section>
          )}

          {saveError && (
            <div className="note" style={{ marginTop: 8 }}>
              <Icon.Info /> {saveError}
            </div>
          )}
        </div>

        <div className="column-side">
          <OpProgressPanel
            d={d}
            procesos={procesos}
            onSave={handleSave}
            saving={saving}
            isAdmin={isAdmin}
            isNew={isNew}
          />
        </div>
      </div>
    </div>
  )
}
