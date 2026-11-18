import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icons'
import GroupedIntegerInput from '../components/GroupedIntegerInput'
import { fmtNum } from '../components/core'
import { getFactura, updateFactura, deleteFactura, pdfRemisionFacturacion } from '../api'
import { DesgloseTroqueles, DesgloseProcesos } from './RemisionEdit'
import {
  ESTADOS_FACTURA, ESTADO_FACTURA_POR_ID, NOMBRE_TRABAJO, EstadoPill,
  fmtFecha, fmtFechaHora, money, descargar,
} from '../lib/facturacion'

// Detalle de una factura (Facturación › Historial › fila). Misma estructura que
// la remisión (RemisionEdit): cliente, ítems, desglose del troquel y producción
// por OP — una sección por cada remisión facturada — más los datos de la
// factura, que la contadora puede corregir (fecha, total, estado, notas).

const sectionStyle = { marginBottom: 16, padding: 18 }
const titleStyle = { fontWeight: 700, fontSize: 14, marginBottom: 12 }
const labelStyle = { color: 'var(--ink-3)', marginBottom: 4, fontSize: 12 }

function Dato({ label, children }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--ink)' }}>{children || '—'}</div>
    </div>
  )
}

function RemisionFacturada({ rem, onPdf, generando }) {
  const desgloseTroquel = { troqueles: rem.troqueles, total_general: rem.total_troqueles }
  const conProcesos = rem.procesos?.length > 0
  return (
    <div className="section open" style={{ ...sectionStyle, padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '14px 18px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Remisión</span>
            <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{rem.numero}</span>
            {rem.orden_numero && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>· OP {rem.orden_numero}</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
            {fmtFecha(rem.fecha)}
            {rem.liquidada_en && ` · liquidada ${fmtFechaHora(rem.liquidada_en)}`}
            {rem.consolidadas?.length > 0 && ` · agrupa ${rem.consolidadas.join(', ')}`}
          </div>
        </div>
        <button className="btn" onClick={() => onPdf(rem)} disabled={generando} title="Vuelve a generar el PDF de la remisión, con precios">
          {generando ? <Icon.Spinner /> : <Icon.Print />} {generando ? 'Generando…' : 'Descargar remisión (PDF)'}
        </button>
      </div>

      <div style={{ padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
          <Dato label="Referencia">{rem.referencias?.join(' · ')}</Dato>
          <Dato label="Trabajo realizado">{rem.trabajos?.map(t => NOMBRE_TRABAJO[t] || t).join(' · ')}</Dato>
          <Dato label="Dirección de entrega">{[rem.direccion, rem.ciudad].filter(Boolean).join(', ')}</Dato>
          {rem.generada_por && <Dato label="Remisión generada por">{rem.generada_por}</Dato>}
        </div>

        <div style={titleStyle}>Ítems</div>
        <div className="table-scroll" style={{ marginBottom: 18 }}>
          <table className="cot-doc-table" style={{ minWidth: 420 }}>
            <thead>
              <tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Vr. Total</th></tr>
            </thead>
            <tbody>
              {rem.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.descripcion || '—'}</td>
                  <td className="num">{fmtNum(it.cantidad)}</td>
                  <td className="num">{money(it.valor_total)}</td>
                </tr>
              ))}
              {!conProcesos && (
                <tr><td>Total entregado</td><td className="num">{fmtNum(rem.total_cantidad)}</td><td /></tr>
              )}
              <tr className="cot-doc-total"><td colSpan={2}>Total a pagar</td><td className="num">{money(rem.total)}</td></tr>
            </tbody>
          </table>
        </div>

        {rem.troqueles?.length > 0 && (
          <>
            <div style={titleStyle}>Desglose del troquel</div>
            <div className="table-scroll" style={{ marginBottom: 18 }}>
              <DesgloseTroqueles desglose={desgloseTroquel} />
            </div>
          </>
        )}

        {conProcesos && (
          <>
            <div style={titleStyle}>Producción entregada por OP</div>
            <DesgloseProcesos desglose={{ procesos: rem.procesos }} />
          </>
        )}

        {rem.observaciones && (
          <>
            <div style={titleStyle}>Observaciones de la remisión</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{rem.observaciones}</div>
          </>
        )}
      </div>
    </div>
  )
}

export default function FacturaDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [factura, setFactura] = useState(null)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [form, setForm] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [pdfId, setPdfId] = useState(null)

  const aplicar = (f) => {
    setFactura(f)
    setForm({ fecha: f.fecha, total: Number(f.total), observaciones: f.observaciones || '' })
  }

  useEffect(() => {
    getFactura(id).then(aplicar).catch(e => setError(e.message))
  }, [id])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 4000)
    return () => clearTimeout(t)
  }, [aviso])

  if (error && !factura) {
    return (
      <div className="app">
        <div style={{ maxWidth: 920, margin: '0 auto', padding: 24 }}>
          <div className="note" style={{ color: 'var(--danger, #c0392b)' }}><Icon.Info /> {error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/facturacion')}><Icon.ArrowLeft /> Facturación</button>
        </div>
      </div>
    )
  }
  if (!factura || !form) {
    return <div className="app"><div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)' }}><Icon.Spinner /> Cargando…</div></div>
  }

  const cambios = form.fecha !== factura.fecha
    || Number(form.total) !== Number(factura.total)
    || form.observaciones !== (factura.observaciones || '')
  const sumaRemisiones = factura.remisiones.reduce((s, r) => s + Number(r.total || 0), 0)
  const c = factura.cliente_datos || {}

  const guardar = async () => {
    if (form.total === '' || form.total == null) { setError('Escribe el total de la factura.'); return }
    setGuardando(true)
    setError(null)
    try {
      aplicar(await updateFactura(factura.id, form))
      setAviso('Cambios guardados')
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  const cambiarEstado = async (estado) => {
    if (estado === factura.estado) return
    if (estado === 'cancelada' && !window.confirm(
      `¿Cancelar la factura ${factura.codigo}? Conserva su número en el consecutivo y sus remisiones vuelven a Pendientes para facturarlas de nuevo.`,
    )) return
    setGuardando(true)
    setError(null)
    try {
      const f = await updateFactura(factura.id, { estado })
      // Conserva lo que la contadora tenga escrito sin guardar.
      setFactura(f)
      setAviso(`Estado: ${ESTADO_FACTURA_POR_ID[estado].label}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  const eliminar = async () => {
    if (!window.confirm(`¿Eliminar la factura ${factura.codigo}? Sus remisiones vuelven a Pendientes y el número ${factura.codigo} queda libre para la próxima factura.`)) return
    setGuardando(true)
    try {
      await deleteFactura(factura.id)
      navigate('/facturacion', { replace: true })
    } catch (e) {
      setError(e.message)
      setGuardando(false)
    }
  }

  const bajarPdf = async (rem) => {
    setPdfId(rem.id)
    setError(null)
    try {
      await descargar(pdfRemisionFacturacion(rem.id), `Remision_${rem.numero}.pdf`)
    } catch (e) {
      setError(`No se pudo generar el PDF: ${e.message}`)
    } finally {
      setPdfId(null)
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn" style={{ padding: '4px 10px' }} onClick={() => navigate('/facturacion')}>
            <Icon.ArrowLeft /> Facturación
          </button>
          <div className="mod mono">{factura.codigo}</div>
          <EstadoPill estado={factura.estado} />
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: '0 auto', padding: 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)' }}>
        {factura.estado === 'cancelada' && (
          <div className="note" style={{ marginBottom: 16 }}>
            <Icon.Info /> Esta factura está cancelada. Conserva su número en el consecutivo y sus remisiones volvieron a Pendientes.
          </div>
        )}
        {error && (
          <div className="note" style={{ marginBottom: 16, color: 'var(--danger, #c0392b)' }}><Icon.Info /> {error}</div>
        )}
        {aviso && <div className="note" style={{ marginBottom: 16 }}><Icon.Check /> {aviso}</div>}

        {/* Factura */}
        <div className="section open" style={sectionStyle}>
          <div style={titleStyle}>Factura</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            <label style={{ fontSize: 12 }}>
              <div style={labelStyle}>Fecha</div>
              <input type="date" className="input" value={form.fecha}
                onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </label>
            <label style={{ fontSize: 12 }}>
              <div style={labelStyle}>Total de la factura</div>
              <div className="input-affix">
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>$</span>
                <GroupedIntegerInput className="input mono" style={{ paddingLeft: 24 }} value={form.total}
                  onChange={total => setForm(f => ({ ...f, total }))} />
              </div>
              {Number(form.total) !== sumaRemisiones && (
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                  Valor remisionado: {money(sumaRemisiones)}
                </div>
              )}
            </label>
          </div>

          <div style={labelStyle}>Estado</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
            {ESTADOS_FACTURA.map(e => {
              const activo = factura.estado === e.id
              return (
                <button
                  key={e.id} type="button" disabled={guardando} onClick={() => cambiarEstado(e.id)} aria-pressed={activo}
                  style={{
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    border: `1.5px solid ${activo ? e.color : 'var(--line)'}`,
                    background: activo ? e.soft : 'var(--surface)', color: activo ? e.color : 'var(--ink-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {activo && <Icon.Check />} {e.label}
                </button>
              )
            })}
          </div>

          <label style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
            <div style={labelStyle}>Observaciones</div>
            <textarea className="input" rows={2} value={form.observaciones} style={{ resize: 'vertical' }}
              onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} placeholder="Notas de la factura…" />
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Registrada{factura.creada_por ? ` por ${factura.creada_por}` : ''} · {fmtFechaHora(factura.creada)}
              {factura.estado_cambiado_en && ` · último cambio de estado ${fmtFechaHora(factura.estado_cambiado_en)}`}
            </div>
            {cambios && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => aplicar(factura)} disabled={guardando}>Descartar</button>
                <button className="btn primary" onClick={guardar} disabled={guardando}>
                  {guardando ? <Icon.Spinner /> : <Icon.Check />} Guardar cambios
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Cliente */}
        <div className="section open" style={sectionStyle}>
          <div style={titleStyle}>Cliente</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{c.nombre}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Dato label="NIT">{c.nit}</Dato>
            <Dato label="Teléfono">{c.telefono}</Dato>
            <Dato label="Correo">{c.email}</Dato>
            <Dato label="Dirección">{[c.direccion, c.ciudad].filter(Boolean).join(', ')}</Dato>
          </div>
        </div>

        {/* Remisiones facturadas */}
        <div style={{ fontWeight: 700, fontSize: 15, margin: '24px 0 12px' }}>
          {factura.remisiones.length === 1 ? 'Remisión facturada' : `Remisiones facturadas (${factura.remisiones.length})`}
        </div>
        {factura.remisiones.map(rem => (
          <RemisionFacturada key={rem.id} rem={rem} onPdf={bajarPdf} generando={pdfId === rem.id} />
        ))}

        {factura.es_ultima && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 8 }}>
            <button className="btn" style={{ color: 'var(--danger)' }} onClick={eliminar} disabled={guardando}
              title="Solo la última factura se puede eliminar, para que el consecutivo no salte">
              <Icon.Trash /> Eliminar factura
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
