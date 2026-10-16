import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, CONDICIONES_PAGO, Section } from '../components/core'
import { SectionGenerales, SectionPapel, SectionProcesos, SectionCondiciones, SectionAcciones } from '../components/sections'
import LiquidationPanel from '../components/LiquidationPanel'
import { useAutosave } from '../hooks/useAutosave'
import { getCotizacion, getPapeles, createCotizacion, updateCotizacion, cambiarEstado, updateCliente, deleteCotizacion, crearOpDesdeCotizacion } from '../api'
import { crearClienteConGuard } from '../lib/clienteDedup'
import { isValidEmail } from '../lib/validation'
import { useAuth } from '../context/AuthContext'
import { buildDefaultProcesos, buildBlankState, docToState, stateToDoc, seedProcesosFromApi, computeCalc } from '../lib/opQuoteShared'

const apiToState = (cot, papelCatalog) => docToState(cot, papelCatalog, 'cot')
const stateToApi = (d, procesos) => stateToDoc(d, procesos, 'cot')
const emailErrorMessage = 'El correo necesita un dominio completo, por ejemplo nombre@empresa.com. Corrígelo o deja el campo vacío.'
const clientFields = (cot) => ({
  cliente: cot.cliente_nombre || '',
  clienteId: cot.cliente || null,
  clienteEmail: cot.cliente_email || '',
  clienteTelefono: cot.cliente_telefono || '',
  clienteNit: cot.cliente_nit || '',
  tipoCliente: cot.tipo_cliente || 'final',
})

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
  const [saveError, setSaveError] = useState(null)
  const [sending, setSending] = useState(false)
  const [creatingOp, setCreatingOp] = useState(false)
  const [ordenId, setOrdenId] = useState(null)
  const [empezandoNueva, setEmpezandoNueva] = useState(false)
  const [tabs, setTabs] = useState(() => [{ key: 0, id: isNew ? null : Number(id), data: null }])
  const [activeTab, setActiveTab] = useState(0)

  const set = (patch) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'clienteEmail') ||
        Object.prototype.hasOwnProperty.call(patch, 'cliente')) setSaveError(null)
    setData(prev => ({ ...prev, ...patch }))
  }
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
          const loadedData = apiToState(cot, catalog)
          setData(loadedData)
          setOriginalEstado(cot.estado || 'borrador')
          setOrdenId(cot.orden_id || null)

          // Seed procesos from API data if present
          const loadedProcesos = cot.procesos?.length ? seedProcesosFromApi(cot.procesos) : buildDefaultProcesos()
          setProcesos(loadedProcesos)
          setTabs([{ key: 0, id: cot.id, data: loadedData, procesos: loadedProcesos,
            originalEstado: cot.estado || 'borrador', ordenId: cot.orden_id || null }])
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
  const isConvertida = (originalEstado || d.estado) === 'convertida'
  const emailError = isValidEmail(d.clienteEmail) ? '' : emailErrorMessage

  // ============ Save handlers ============
  const save = async (estadoOverride = null) => {
    setSaveError(null)
    try {
      if (emailError) throw new Error(emailError)
      let clienteId = d.clienteId
      if (!clienteId) {
        if (!d.cliente.trim()) throw new Error('El campo Cliente es obligatorio')
        const newCliente = await crearClienteConGuard({
          nombre: d.cliente.trim(),
          tipo: d.tipoCliente,
          email: d.clienteEmail || '',
          telefono: d.clienteTelefono || '',
          nit: d.clienteNit || '',
        })
        clienteId = newCliente.id
        set({ cliente: newCliente.nombre, clienteId: newCliente.id,
          clienteEmail: newCliente.email || '', clienteTelefono: newCliente.telefono || '', clienteNit: newCliente.nit || '' })
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
      return result
    } catch (e) {
      setSaveError(e.message)
      throw e
    }
  }

  const { status: saveStatus, retry: retrySave, flush: flushSave, markPristine } = useAutosave(
    useMemo(() => {
      const { id, numero, estado, ...dComparable } = d
      return { d: dComparable, procesos }
    }, [d, procesos]),
    () => save(),
    { enabled: false, isValid: () => !isConvertida && !!d.cliente.trim() && !!d.referencia.trim() }
  )

  useEffect(() => {
    if (!loading) markPristine()
  }, [loading, activeTab, markPristine])

  const handleDelete = () => {
    navigate('/cotizaciones')
    deleteCotizacion(d.id).catch(() => {})
  }

  const saveCurrentTab = async () => {
    if (isConvertida) {
      setTabs(prev => prev.map(tab => tab.key === activeTab
        ? { ...tab, id: d.id, data: d, procesos, originalEstado, ordenId }
        : tab))
      return null
    }
    if (!d.cliente.trim() || !d.referencia.trim()) {
      const message = 'Completa Cliente y Referencia y guarda la cotización antes de abrir otra.'
      setSaveError(message)
      throw new Error(message)
    }
    const saved = await save()
    const savedData = { ...d, ...clientFields(saved), id: saved.id,
      numero: saved.numero || d.numero, estado: saved.estado || d.estado }
    setTabs(prev => prev.map(tab => tab.key === activeTab
      ? { ...tab, id: saved.id, data: savedData, procesos,
          originalEstado: saved.estado || 'borrador', ordenId }
      : tab))
    return saved
  }

  const activateTab = (tab) => {
    setData(tab.data)
    setProcesos(tab.procesos)
    setOriginalEstado(tab.originalEstado || 'borrador')
    setOrdenId(tab.ordenId || null)
    setSaveError(null)
    setActiveTab(tab.key)
    window.history.replaceState(null, '', tab.id ? `/cotizaciones/${tab.id}` : '/cotizaciones/nuevo')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSelectTab = async (key) => {
    if (key === activeTab || empezandoNueva) return
    setEmpezandoNueva(true)
    try {
      await saveCurrentTab()
      const tab = tabs.find(item => item.key === key)
      if (tab) activateTab(tab)
    } catch {
      // saveCurrentTab displays the error and keeps the current quote visible.
    } finally {
      setEmpezandoNueva(false)
    }
  }

  const handleNuevaCotizacion = async () => {
    if (empezandoNueva) return
    setEmpezandoNueva(true)
    try {
      const saved = await saveCurrentTab()
      const blank = buildBlankState('cot')
      const firstPaper = papelCatalog[0]
      const nextData = {
        ...blank,
        ...(firstPaper ? { papelId: String(firstPaper.id), precioPliego: parseFloat(firstPaper.precio) } : {}),
        ...(saved ? clientFields(saved) : {
          cliente: d.cliente, clienteId: d.clienteId, clienteEmail: d.clienteEmail,
          clienteTelefono: d.clienteTelefono, clienteNit: d.clienteNit, tipoCliente: d.tipoCliente,
        }),
      }
      const nextProcesos = buildDefaultProcesos()
      const key = Math.max(...tabs.map(tab => tab.key)) + 1
      setTabs(prev => [...prev, { key, id: null, data: nextData, procesos: nextProcesos,
        originalEstado: 'borrador', ordenId: null }])
      activateTab({ key, id: null, data: nextData, procesos: nextProcesos })
    } catch {
      // Keep the current quote open so its unsaved edits are not lost.
    } finally {
      setEmpezandoNueva(false)
    }
  }

  const handleSaveAndSend = async () => {
    setSending(true)
    try {
      await flushSave()
      const saved = await save()
      const vu = Math.round(calc.valorUnitario || 0)
      const vt = Math.round(calc.valorTotal || 0)
      navigate(`/documentos/nuevo?cotizacion=${saved.id}&vu=${vu}&vt=${vt}`)
    } catch (e) {
      // el error ya quedó reflejado en saveError vía save()
    } finally {
      setSending(false)
    }
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
          <button
            className="btn accent"
            style={{ padding: '2px 10px', fontSize: 12 }}
            disabled={empezandoNueva || saveStatus === 'saving'}
            onClick={handleNuevaCotizacion}
            title="Guarda esta cotización y abre otra para el mismo cliente"
          >
            {empezandoNueva ? 'Guardando…' : '+ Nueva cotización'}
          </button>
          {saveError && (
            <span role="alert" style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>
              No se guardó: {saveError}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto',
        padding: '8px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Cotizaciones de esta sesión</span>
        {tabs.map(tab => {
          const current = tab.key === activeTab
          const quote = current ? d : tab.data
          return (
            <button
              key={tab.key}
              type="button"
              className="btn"
              onClick={() => handleSelectTab(tab.key)}
              disabled={empezandoNueva || saveStatus === 'saving'}
              aria-current={current ? 'page' : undefined}
              style={{ whiteSpace: 'nowrap', fontSize: 11, padding: '5px 9px',
                borderColor: current ? 'var(--accent)' : 'var(--border)',
                color: current ? 'var(--accent)' : 'var(--ink)',
                fontWeight: current ? 700 : 400 }}
            >
              {quote?.id ? quote.numero : `Nueva ${tab.key + 1}`}
              {quote?.referencia ? ` · ${quote.referencia.slice(0, 28)}` : ''}
            </button>
          )
        })}
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
            <SectionGenerales d={d} set={set} emailError={emailError} />
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
            <SectionProcesos procesos={procesos} setProc={setProc} autoValues={calc.autoValues} cantidadProduccion={calc.cantidadProduccion} />
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
            desc="Guardar cambios o enviar al cliente"
            open={open.s6} onToggle={() => toggle('s6')}
          >
            <SectionAcciones
              d={d} calc={calc}
              saveStatus={saveStatus} onRetrySave={retrySave} sending={sending}
              originalEstado={originalEstado}
              onDelete={handleDelete}
              onSaveAndSend={handleSaveAndSend}
            />
          </Section>
        </div>

        {/* Sticky right column — Liquidación (admin only) */}
        {isAdmin && (
          <div className="column-side">
            <LiquidationPanel
                d={d} set={set} calc={calc} procesos={procesos}
                saveStatus={saveStatus} onRetrySave={retrySave} sending={sending}
                originalEstado={originalEstado}
                onSaveAndSend={handleSaveAndSend}
              />
          </div>
        )}
      </div>
    </div>
  )
}
