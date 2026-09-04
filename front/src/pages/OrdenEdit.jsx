import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, CONDICIONES_PAGO_OP, TIPOS_FACTURACION, Section, SaveStatus } from '../components/core'
import { SectionGenerales, SectionPapel, SectionCortes, SectionProcesos, SectionCondicionesOP } from '../components/sections'
import LiquidationPanel from '../components/LiquidationPanel'
import { ModeloTroquelGestion } from '../components/Troquel'
import { useAutosave } from '../hooks/useAutosave'
import {
  getOrden, getPapeles, createOrden, updateOrden,
  getNextNumeroOrden, createCliente, updateCliente,
  pdfOpAdmin, pdfOpProduccion,
} from '../api'
import { useAuth } from '../context/AuthContext'
import { useGuardedNavigate, useUnsavedGuard } from '../context/UnsavedChangesContext'
import { buildDefaultProcesos, buildBlankState, docToState, stateToDoc, seedProcesosFromApi, computeCalc } from '../lib/opQuoteShared'

// Resumen estático para OP creada desde cotización (datos bloqueados)
function OrdenResumenLocked({ d, calc, papelCatalog, showMoney = true }) {
  const papelObj = papelCatalog.find(p => String(p.id) === d.papelId)
  const papelLabel = papelObj
    ? `${papelObj.nombre} ${papelObj.gramaje}g · ${papelObj.material}`
    : (d.papelManualNombre || 'Manual')
  const rows = [
    ['Cliente', d.cliente],
    ['NIT / Cédula', d.clienteNit || '—'],
    ['Teléfono', d.clienteTelefono || '—'],
    ['Referencia', d.referencia],
    ['Cantidad', `${fmtNum(d.cantidad)} uds` + (d.sobrante ? ` (+${fmtNum(d.sobrante)} sobrante)` : '')],
    ['Papel', papelLabel],
    ['Medida molde', `${d.moldeAncho} × ${d.moldeAlto} cm`],
    ['Pliego', `${d.pliegoW} × ${d.pliegoH} cm (${d.pliegoTipo})`],
    ['Unidades / pliego', fmtNum(calc.unidadesPorPliego)],
    ['Pliegos necesarios', fmtNum(calc.pliegosNecesarios)],
    ['Corte inicial', d.corteInicialActive ? (showMoney ? `Sí · ${fmtCOP(d.corteInicialPrecio)}` : 'Sí') : 'No'],
    ['Corte final', d.corteFinalActive ? (showMoney ? `Sí · ${fmtCOP(d.corteFinalPrecio)}` : 'Sí') : 'No'],
  ]
  return (
    <div>
      <div className="grid grid-2" style={{ gap: '8px 24px' }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{value}</span>
          </div>
        ))}
      </div>

      <label className="field-label" style={{ margin: '18px 0 8px', display: 'block' }}>Procesos pactados</label>
      <table className="liq-table" style={{ width: '100%' }}>
        <tbody>
          {calc.procRows.length === 0 && (
            <tr><td style={{ color: 'var(--ink-3)', fontSize: 12 }}>Sin procesos activos</td><td></td></tr>
          )}
          {calc.procRows.map(p => (
            <tr key={p.id}>
              <td style={{ padding: '5px 0', fontSize: 13 }}>{p.nombre}</td>
              {showMoney && <td className="mono" style={{ textAlign: 'right', fontSize: 13 }}>{fmtCOP(p.costo)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {d.observaciones && (
        <>
          <label className="field-label" style={{ margin: '18px 0 6px', display: 'block' }}>Observaciones</label>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{d.observaciones}</div>
        </>
      )}
    </div>
  )
}

export default function OrdenEdit() {
  const { id } = useParams()
  const navigate = useGuardedNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isNew = id === 'nuevo'

  const [d, setData] = useState(() => buildBlankState('op'))
  const [procesos, setProcesos] = useState(buildDefaultProcesos)
  const [papelCatalog, setPapelCatalog] = useState([])
  const [open, setOpen] = useState({ s1: true, s2: true, s3: true, s5: true })
  const [loading, setLoading] = useState(!isNew)
  // La OP nueva no muestra spinner (loading queda en false), pero igual siembra
  // estado al llegar el catálogo de papel: esto marca el fin de ese arranque.
  const [bootstrapped, setBootstrapped] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const locked = !!d.cotizacionId

  const set = (patch) => setData(prev => ({ ...prev, ...patch }))
  const setProc = (pid, patch) => setProcesos(prev => ({ ...prev, [pid]: { ...prev[pid], ...patch } }))
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))

  // El Operador General no elige tipo de cliente (el campo va oculto para él):
  // toda OP directa que crea queda fija como Cliente Terciario.
  useEffect(() => {
    if (isNew && !isAdmin) set({ tipoCliente: 'terciario' })
  }, [isNew, isAdmin])

  // Load papers + orden (if editing) + next number (if new)
  useEffect(() => {
    const tasks = [getPapeles()]
    if (!isNew) tasks.push(getOrden(id))

    Promise.all(tasks)
      .then(([papeles, orden]) => {
        const catalog = papeles.results || papeles
        setPapelCatalog(catalog)

        if (orden) {
          setData(docToState(orden, catalog, 'op'))
          if (orden.procesos && orden.procesos.length > 0) {
            setProcesos(seedProcesosFromApi(orden.procesos))
          }
        } else if (catalog.length > 0) {
          const first = catalog[0]
          set({ papelId: String(first.id), precioPliego: parseFloat(first.precio) })
        }
      })
      .catch(console.error)
      .finally(() => { setLoading(false); setBootstrapped(true) })

    if (isNew) {
      // Número estimado en tiempo real; el definitivo lo asigna el guardado
      getNextNumeroOrden()
        .then(r => {
          setData(prev => prev.id ? prev : { ...prev, numero: `${r.next} · estimado` })
        })
        .catch(() => {})
    }
  }, [id])

  const calc = useMemo(() => computeCalc(d, procesos), [d, procesos])

  // ============ Save ============
  const save = async () => {
    setSaveError(null)
    try {
      let result
      if (locked) {
        // OP desde COT: backend solo acepta abono/observaciones/fecha
        result = await updateOrden(d.id, {
          ...stateToDoc(d, procesos, 'op'),
          abono: d.abono || 0,
        })
      } else {
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
        const payload = stateToDoc({ ...d, clienteId }, procesos, 'op')
        // Persistir valores efectivos para que la OP quede congelada
        if (payload.valor_unitario_override == null && calc.valorUnitario > 0)
          payload.valor_unitario_override = Math.round(calc.valorUnitario)
        if (payload.valor_total_override == null && calc.valorTotal > 0)
          payload.valor_total_override = Math.round(calc.valorTotal)

        if (!d.id) {
          result = await createOrden(payload)
          window.history.replaceState(null, '', `/ordenes/${result.id}`)
        } else {
          result = await updateOrden(d.id, payload)
        }
      }

      setData(prev => ({
        ...prev,
        id: result.id,
        numero: result.numero || prev.numero,
      }))
      return result.id
    } catch (e) {
      setSaveError(e.message)
      throw e
    }
  }

  // Una OP desde cotización solo la puede tocar el admin (abono/fecha); una OP
  // directa exige al menos cliente y referencia para poder persistirse.
  const puedeGuardar = (isAdmin || !locked)
    && (locked || (!!d.cliente.trim() && !!d.referencia.trim()))

  const { status: saveStatus, retry: retrySave, dirty, markPristine } = useAutosave(
    useMemo(() => {
      const { id, numero, ...dComparable } = d
      return { d: dComparable, procesos }
    }, [d, procesos]),
    () => save(),
    { enabled: false, isValid: () => puedeGuardar }
  )

  // La carga inicial (orden, catálogo de papel, tipo de cliente por defecto)
  // también mueve el estado: esa siembra es la línea base, no una edición.
  const baselineRef = useRef(false)
  useEffect(() => {
    if (!bootstrapped || baselineRef.current) return
    baselineRef.current = true
    markPristine()
  }, [bootstrapped, markPristine])

  // Salir con la orden a medio llenar la pierde: este guard intercepta la
  // navegación (menú, "Volver", cerrar sesión) y ofrece guardar antes.
  useUnsavedGuard({
    active: bootstrapped,
    dirty,
    canSave: puedeGuardar,
    save: async () => { await save(); markPristine() },
    hint: 'Para guardar la orden necesitas al menos el cliente y la referencia.',
    texts: {
      title: d.id ? 'Tienes cambios sin guardar' : 'La orden aún no se ha guardado',
      message: !d.id
        ? 'Todavía no has guardado esta orden. Si sales ahora, los datos que ingresaste se pierden y no queda ningún registro.'
        : 'Los cambios que hiciste en esta orden aún no se han guardado. Si sales ahora, la orden queda como estaba antes.',
    },
  })

  // ============ PDFs ============
  const papelReferencia = (() => {
    const papel = papelCatalog.find(p => String(p.id) === d.papelId)
    return papel ? `${papel.nombre} ${papel.gramaje}g · ${papel.material}` : (d.papelManualNombre || 'Manual')
  })()

  const downloadBlob = async (resp, filename) => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const handlePdfAdmin = async () => {
    if (!d.id) return
    try {
      await downloadBlob(await pdfOpAdmin(d.id, calc, d), `${d.numero}_admin.pdf`)
    } catch (e) { console.error(e) }
  }

  const handlePdfProduccion = async () => {
    if (!d.id) return
    try {
      await downloadBlob(await pdfOpProduccion(d.id, calc, papelReferencia), `${d.numero}_produccion.pdf`)
    } catch (e) { console.error(e) }
  }

  if (loading) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <div className="mod">Órdenes de Producción</div>
          </div>
        </div>
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando orden…</div>
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
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/ordenes'))}
          >
            <Icon.ArrowLeft /> Volver
          </button>
          <span className="div">/</span>
          <div className="mod mono">{d.numero}</div>
          {locked && (
            <span className="badge converted" style={{ marginLeft: 10 }}>
              <span className="dot"></span>Desde {d.cotizacionNumero}
            </span>
          )}
          {!locked && !isNew && (
            <span className="badge draft" style={{ marginLeft: 10 }}>
              <span className="dot"></span>OP directa
            </span>
          )}
        </div>
        <div className="topbar-right">
          {saveError && (
            <span style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>
              Error: {saveError}
            </span>
          )}
        </div>
      </div>

      {locked && (
        <div className="banner-readonly" style={{ margin: '14px 24px 0' }}>
          <Icon.Lock />
          <span>
            Generada desde la cotización <strong>{d.cotizacionNumero}</strong> — datos generales, procesos y
            condiciones bloqueados.{' '}
            {isAdmin
              ? 'Solo la liquidación (abono) es editable.'
              : 'Esta OP la administra el administrador; acá es solo de consulta.'}
          </span>
        </div>
      )}

      {/* Workspace */}
      <div className="workspace">
        <div className="column-main">
          {locked ? (
            <>
              <Section num="1" title="Resumen de la orden" desc="Datos pactados en la cotización" open={true} locked={true}>
                <OrdenResumenLocked d={d} calc={calc} papelCatalog={papelCatalog} showMoney={isAdmin} />
              </Section>
              <Section num="2" title="Condiciones" desc="Pactadas en la cotización" open={true} locked={true}>
                <SectionCondicionesOP d={d} set={set} readOnly={true} />
              </Section>
              <Section num="3" title="Programación" desc="Fecha de entrega para ordenar la producción" open={true}>
                <div className="field" style={{ maxWidth: 220, padding: '4px 0' }}>
                  <label className="field-label">
                    Fecha de entrega{' '}
                    {isAdmin
                      ? <span className="editable-flag" title="Editable por admin"><Icon.Pencil /></span>
                      : <Icon.Lock />}
                  </label>
                  <input
                    className={'input mono' + (isAdmin ? ' admin-editable' : ' readonly')}
                    type="date" value={d.fechaEntrega || ''} readOnly={!isAdmin}
                    onChange={e => set({ fechaEntrega: e.target.value })}
                  />
                </div>
              </Section>
            </>
          ) : (
            <>
              <Section
                num="1" title="Datos generales"
                desc="Información básica de la orden"
                open={open.s1} onToggle={() => toggle('s1')}
                summary={!open.s1 && <>
                  <span>Cliente:</span> <span className="v">{d.cliente || '—'}</span>
                  <span>· Cantidad:</span> <span className="v mono">{fmtNum(d.cantidad)}</span>
                </>}
              >
                <SectionGenerales d={d} set={set} showEstado={false} numeroLabel="N° OP" showFechaEntrega={isAdmin} showClientDetails={isAdmin} />
              </Section>

              {isAdmin && (
                <Section
                  num="2" title="Calculadora de papel y pliegos"
                  desc="Cuántos pliegos necesitas comprar"
                  open={open.s2} onToggle={() => toggle('s2')}
                  summary={!open.s2 && <>
                    <span>Pliegos:</span> <span className="v mono">{calc.pliegosNecesarios}</span>
                    {isAdmin && <><span>· Costo papel:</span> <span className="v mono">{fmtCOP(calc.costoPapel)}</span></>}
                  </>}
                >
                  <SectionPapel d={d} set={set} calc={calc} papelCatalog={papelCatalog} showMoney={isAdmin} />
                </Section>
              )}

              {!isAdmin && (
                <Section
                  num="2" title="Cortes"
                  desc="¿Esta orden requiere corte inicial o corte final?"
                  open={true}
                >
                  <SectionCortes d={d} set={set} showMoney={false} />
                </Section>
              )}

              <Section
                num="3" title="Procesos de producción"
                desc="Marca los procesos que requiere esta orden"
                open={open.s3} onToggle={() => toggle('s3')}
                summary={!open.s3 && <>
                  <span>Procesos activos:</span> <span className="v">{calc.procRows.length}</span>
                  {isAdmin && <><span>· Costo procesos:</span> <span className="v mono">{fmtCOP(calc.totalProcesos)}</span></>}
                </>}
              >
                <SectionProcesos procesos={procesos} setProc={setProc} autoValues={calc.autoValues} cantidadProduccion={calc.cantidadProduccion} showMoney={isAdmin} />
              </Section>

              <Section
                num="4" title="Observaciones y notas"
                desc="Texto libre al pie de la orden"
                open={true} locked={true}
              >
                <div className="obs-card">
                  <label className="field-label" style={{ marginBottom: 6 }}>Observaciones de la orden</label>
                  <textarea
                    className="textarea"
                    placeholder="Notas internas, instrucciones para el taller, etc."
                    value={d.observaciones}
                    onChange={e => set({ observaciones: e.target.value })}
                  />
                </div>
              </Section>

              {isAdmin && (
                <Section
                  num="5" title="Condiciones"
                  desc="Tipo de cliente, facturación y pago"
                  open={open.s5} onToggle={() => toggle('s5')}
                  summary={!open.s5 && <>
                    <span>Pago:</span> <span className="v">{CONDICIONES_PAGO_OP.find(c => c.id === d.condicionPago)?.lbl || d.condicionCustom}</span>
                    <span>· Facturación:</span> <span className="v">{TIPOS_FACTURACION.find(t => t.id === d.tipoFacturacion)?.lbl}</span>
                  </>}
                >
                  <SectionCondicionesOP d={d} set={set} />
                </Section>
              )}

              {!isAdmin && (
                <div className="section" style={{ marginTop: 16, padding: '14px 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
                  <SaveStatus status={saveStatus} onRetry={retrySave} />
                  <button className="btn primary" onClick={retrySave} disabled={saveStatus === 'saving'}>
                    {saveStatus === 'saving' ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Modelo del troquel — cliente tercerizado, o cliente final con proceso Troquel marcado */}
          {isAdmin && (d.tipoCliente === 'terciario' || procesos['troquel']?.active) && (
            <Section
              num="6" title="Modelo del troquel"
              desc="¿Tienes el modelo del troquel para esta OP? Súbelo y queda asignado."
              open={true} locked={true}
            >
              {d.id ? (
                <ModeloTroquelGestion ordenId={d.id} />
              ) : (
                <div style={{ padding: 16, fontSize: 13, color: 'var(--ink-3)' }}>
                  Guarda la orden primero para poder subir y asignar el modelo del troquel.
                </div>
              )}
            </Section>
          )}
        </div>

        {/* Sticky right column — Liquidación (admin only) */}
        {isAdmin && (
          <div className="column-side">
            <LiquidationPanel
              d={d} set={set} calc={calc}
              saveStatus={saveStatus} onRetrySave={retrySave}
              mode="op"
              locked={locked}
              onPdfAdmin={handlePdfAdmin}
              onPdfProduccion={handlePdfProduccion}
            />
          </div>
        )}
      </div>
    </div>
  )
}
