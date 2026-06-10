import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, CONDICIONES_PAGO, Section } from '../components/core'
import { SectionGenerales, SectionPapel, SectionProcesos, SectionCondiciones, SectionAcciones } from '../components/sections'
import LiquidationPanel from '../components/LiquidationPanel'
import { getCotizacion, getPapeles, createCotizacion, updateCotizacion, cambiarEstado, createCliente, updateCliente, deleteCotizacion, crearOpDesdeCotizacion } from '../api'
import { useAuth } from '../context/AuthContext'
import { buildDefaultProcesos, buildBlankState, docToState, stateToDoc, seedProcesosFromApi, computeCalc } from '../lib/opQuoteShared'

const apiToState = (cot, papelCatalog) => docToState(cot, papelCatalog, 'cot')
const stateToApi = (d, procesos) => stateToDoc(d, procesos, 'cot')

export default function CotizacionEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isNew = id === 'nuevo'

  const [d, setData] = useState(() => buildBlankState('cot'))
  const [procesos, setProcesos] = useState(buildDefaultProcesos)
  const [originalEstado, setOriginalEstado] = useState('borrador')
  const [papelCatalog, setPapelCatalog] = useState([])
  const [open, setOpen] = useState({ s1: true, s2: true, s3: true, s5: true, s6: true })
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [toast, setToast] = useState(null)
  const [creatingOp, setCreatingOp] = useState(false)
  const [ordenId, setOrdenId] = useState(null)
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
          setOriginalEstado(cot.estado || 'borrador')
          setOrdenId(cot.orden_id || null)

          // Seed procesos from API data if present
          if (cot.procesos && cot.procesos.length > 0) {
            setProcesos(seedProcesosFromApi(cot.procesos))
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
  const calc = useMemo(() => computeCalc(d, procesos), [d, procesos])

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
      setOriginalEstado(result.estado || 'borrador')
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
    navigate('/cotizaciones')
    deleteCotizacion(d.id).catch(() => {})
  }

  // Convierte la COT aprobada en OP (backend copia campos + marca convertida)
  const handleCrearOp = async () => {
    if (!d.id || creatingOp) return
    setCreatingOp(true)
    setSaveError(null)
    try {
      const op = await crearOpDesdeCotizacion(d.id, {
        valor_unitario: Math.round(calc.valorUnitario || 0),
        valor_total: Math.round(calc.valorTotal || 0),
        total_costos: Math.round(calc.totalCostosOP || 0),
        costo_papel: Math.round(calc.costoPapel || 0),
      })
      navigate(`/ordenes/${op.id}`)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setCreatingOp(false)
    }
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
          <button
            className="btn"
            style={{ padding: '2px 8px', fontSize: 12, gap: 4 }}
            onClick={() => navigate('/cotizaciones')}
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
                disabled={creatingOp}
                onClick={handleCrearOp}
              >
                {creatingOp ? 'Creando…' : '+ Crear OP'}
              </button>
            )}
            {d.estado === 'convertida' && (
              <span className="sub" style={{ marginLeft: 8 }}>
                · OP creada
                {ordenId && (
                  <button
                    className="btn"
                    style={{ marginLeft: 8, fontSize: 11, padding: '2px 10px' }}
                    onClick={() => navigate(`/ordenes/${ordenId}`)}
                  >
                    Ver OP →
                  </button>
                )}
              </span>
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
              originalEstado={originalEstado}
              onSave={() => save()}
              onDelete={handleDelete}
              onSaveAndSend={async () => {
                const savedId = await save()
                if (!savedId) return
                const vu = Math.round(calc.valorUnitario || 0)
                const vt = Math.round(calc.valorTotal || 0)
                navigate(`/documentos/nuevo?cotizacion=${savedId}&vu=${vu}&vt=${vt}`)
              }}
            />
          </Section>
        </div>

        {/* Sticky right column — Liquidación (admin only) */}
        {isAdmin && (
          <div className="column-side">
            <LiquidationPanel
                d={d} set={set} calc={calc}
                saving={saving}
                originalEstado={originalEstado}
                onSave={() => save()}
                onSaveAndSend={async () => {
                  const savedId = await save()
                  if (!savedId) return
                  const vu = Math.round(calc.valorUnitario || 0)
                  const vt = Math.round(calc.valorTotal || 0)
                  navigate(`/documentos/nuevo?cotizacion=${savedId}&vu=${vu}&vt=${vt}`)
                }}
              />
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
