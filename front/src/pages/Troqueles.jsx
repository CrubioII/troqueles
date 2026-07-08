import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ProgressBar } from '../components/core'
import { Icon } from '../components/Icons'
import {
  TroquelCostos, ModeloTroquelGestion,
  FormatosCuchillasHistory, FormatoCuchillasForm, ModeloViewer,
  NuevaTareaTroquelModal,
} from '../components/Troquel'
import {
  getOrdenes, getFormatosCuchillas, getOrdenesPendientes, getOrdenProduccion, getTroquelModelo,
  updateFormatoCuchillas, getFormatosPendientes, cancelarEnvioFormato,
} from '../api'
import { usePolling } from '../lib/usePolling'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))

// Fecha de entrega formateada + color según urgencia (vencido / próximo)
function fmtEntrega(s) {
  if (!s) return { txt: 'Sin fecha', color: 'var(--ink-3)' }
  const d = new Date(s + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  const txt = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  let color = 'var(--ink-2)'
  if (diff < 0) color = 'var(--danger, #c0392b)'
  else if (diff <= 2) color = 'var(--warn, #e0a800)'
  return { txt: diff < 0 ? `${txt} · vencido` : txt, color }
}

// Orden por fecha de entrega ascendente; las OPs sin fecha quedan al final
const byEntrega = (a, b) => {
  if (!a.fecha_entrega && !b.fecha_entrega) return 0
  if (!a.fecha_entrega) return 1
  if (!b.fecha_entrega) return -1
  return a.fecha_entrega < b.fecha_entrega ? -1 : (a.fecha_entrega > b.fecha_entrega ? 1 : 0)
}

function Section({ title, children, style, actions }) {
  return (
    <div className="section" style={{ marginTop: 16, ...style }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  )
}

// ─────────────── Vista Admin ───────────────

function AdminTroqueles() {
  const navigate = useNavigate()
  const [ordenes, setOrdenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)         // OP seleccionada para gestionar troquel
  const [formatos, setFormatos] = useState([])
  const [loadingFormatos, setLoadingFormatos] = useState(false)
  const [costRefresh, setCostRefresh] = useState(0)
  const [editFormato, setEditFormato] = useState(null)   // formato en edición (Admin)
  const [showNueva, setShowNueva] = useState(false)      // modal Nueva tarea de troquel
  const [pendientes, setPendientes] = useState([])       // formatos esperando aprobación (contador)

  const loadPendientes = () =>
    getFormatosPendientes()
      .then(d => setPendientes(asList(d)))
      .catch(() => setPendientes([]))

  useEffect(() => { loadPendientes() }, [])
  usePolling(loadPendientes, { enabled: true })

  const loadOrdenes = () => {
    setLoading(true)
    return getOrdenes('?proceso=troquel')
      .then(d => {
        const list = asList(d).sort(byEntrega)
        setOrdenes(list)
        return list
      })
      .catch(() => [])
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadOrdenes() }, [])

  const loadFormatos = (ordenId) => {
    setLoadingFormatos(true)
    getFormatosCuchillas(ordenId)
      .then(d => setFormatos(asList(d)))
      .catch(() => setFormatos([]))
      .finally(() => setLoadingFormatos(false))
  }

  const selectOrden = (ord) => {
    setSel(ord)
    setEditFormato(null)
    loadFormatos(ord.id)
    setCostRefresh(k => k + 1)
  }

  return (
    <>
      <Section
        title={`Troqueles por aprobar${pendientes.length ? ` (${pendientes.length})` : ''}`}
        actions={
          <button className="btn sm primary" onClick={() => navigate('/produccion/troqueles/revision')}>
            Revisar troqueles
          </button>
        }
      >
        <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--ink-2)' }}>
          {pendientes.length === 0
            ? 'No hay troqueles esperando aprobación.'
            : <>Hay <strong>{pendientes.length}</strong> {pendientes.length === 1 ? 'troquel terminado esperando' : 'troqueles terminados esperando'} tu aprobación antes de pasar a remisión.</>}
        </div>
      </Section>

      <Section
        title="OPs en Troquel"
        actions={<button className="btn sm primary" onClick={() => setShowNueva(true)}>+ Nueva tarea de troquel</button>}
      >
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
        ) : ordenes.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>No hay OPs con troquel activo</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)' }}>
                {['OP #', 'Entrega', 'Cliente', 'Referencia', 'Progreso', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenes.map((ord, idx) => (
                <tr key={ord.id}
                  style={{ borderBottom: '1px solid var(--line)', background: sel?.id === ord.id ? 'var(--accent-soft, #fdf0e6)' : (idx % 2 ? 'var(--surface-2)' : 'var(--surface)'), cursor: 'pointer' }}
                  onClick={() => selectOrden(ord)}>
                  <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12 }}>{ord.numero}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: fmtEntrega(ord.fecha_entrega).color }}>{fmtEntrega(ord.fecha_entrega).txt}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{ord.cliente_nombre}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ord.referencia}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {ord.progreso ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ProgressBar pct={ord.progreso.porcentaje} />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'JetBrains Mono, monospace' }}>{ord.progreso.completados}/{ord.progreso.total}</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <button className="btn sm" onClick={e => { e.stopPropagation(); navigate(`/ordenes/${ord.id}`) }}>Abrir OP</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {sel && (
        <>
          <div style={{ marginTop: 20, fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>
            Gestión de troquel · <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{sel.numero}</span> — {sel.referencia}
          </div>

          <Section title="Modelo del troquel">
            <ModeloTroquelGestion ordenId={sel.id} onSaved={() => setCostRefresh(k => k + 1)} />
          </Section>

          <Section title="Costos (subtotales + total)">
            <TroquelCostos ordenId={sel.id} refreshKey={costRefresh} />
          </Section>

          <Section title="Auditoría — Formato de cuchillas registrado">
            {editFormato ? (
              <FormatoCuchillasForm
                formato={editFormato}
                onUpdated={() => { setEditFormato(null); loadFormatos(sel.id); setCostRefresh(k => k + 1) }}
                onCancel={() => setEditFormato(null)}
              />
            ) : (
              <FormatosCuchillasHistory formatos={formatos} loading={loadingFormatos} onEdit={setEditFormato} />
            )}
          </Section>
        </>
      )}

      {showNueva && (
        <NuevaTareaTroquelModal
          onClose={() => setShowNueva(false)}
          onCreated={(orden) => {
            setShowNueva(false)
            loadOrdenes().then(list => {
              const row = list.find(o => o.id === orden.id)
              if (row) selectOrden(row)
            })
          }}
        />
      )}
    </>
  )
}

// ─────────────── Vista Operador ───────────────

function OperadorTroqueles() {
  const [lista, setLista] = useState([])
  const [loadingLista, setLoadingLista] = useState(true)
  const [orden, setOrden] = useState(null)
  const [opening, setOpening] = useState(false)
  const [formatos, setFormatos] = useState([])
  const [loadingFormatos, setLoadingFormatos] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [cancelError, setCancelError] = useState(null)

  const loadLista = (silent = false) => {
    if (!silent) setLoadingLista(true)
    getOrdenesPendientes('troquel')
      .then(d => setLista(asList(d)))
      .catch(() => setLista([]))
      .finally(() => setLoadingLista(false))
  }

  useEffect(() => { loadLista() }, [])

  // Tiempo real: refrescar la lista de pendientes solo cuando se está viendo
  usePolling(() => loadLista(true), { enabled: !orden })

  const loadFormatos = (ordenId) => {
    setLoadingFormatos(true)
    getFormatosCuchillas(ordenId)
      .then(d => setFormatos(asList(d)))
      .catch(() => setFormatos([]))
      .finally(() => setLoadingFormatos(false))
  }

  const abrir = (op) => {
    setOpening(true)
    setCancelError(null)
    getOrdenProduccion(op.id)
      .then(full => { setOrden(full); loadFormatos(full.id) })
      .catch(() => {})
      .finally(() => setOpening(false))
  }

  // Cancelar el envío del formato pendiente para volver a editarlo (→ borrador).
  // Si el Admin ya lo revisó (409), se muestra el motivo y se refresca el estado real.
  const cancelarEnvio = (formatoId) => {
    if (!window.confirm('¿Cancelar el envío del formato para volver a editarlo?')) return
    setCancelando(true)
    setCancelError(null)
    cancelarEnvioFormato(formatoId)
      .catch(e => setCancelError(e?.message || 'No se pudo cancelar el envío'))
      .finally(() => {
        setCancelando(false)
        loadFormatos(orden.id)
      })
  }

  const volver = () => { setOrden(null); setFormatos([]); loadLista() }

  if (!orden) {
    return (
      <Section title="Troqueles del día — selecciona una OP">
        {loadingLista ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
        ) : lista.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>No hay troqueles pendientes 🎉</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)' }}>
                {['OP #', 'Entrega', 'Cliente', 'Referencia', 'Cantidad', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((op, idx) => {
                const ent = fmtEntrega(op.fecha_entrega)
                return (
                  <tr key={op.id}
                    style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                    onClick={() => !opening && abrir(op)}>
                    <td style={{ padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13 }}>{op.numero}</td>
                    <td style={{ padding: '12px', fontSize: 12, fontWeight: 600, color: ent.color }}>{ent.txt}</td>
                    <td style={{ padding: '12px', fontWeight: 600 }}>{op.cliente_nombre || '—'}</td>
                    <td style={{ padding: '12px', color: 'var(--ink-2)' }}>{op.referencia}</td>
                    <td style={{ padding: '12px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink-2)' }}>{op.cantidad}</td>
                    <td style={{ padding: '12px' }}>
                      <button className="btn sm primary" disabled={opening} onClick={e => { e.stopPropagation(); abrir(op) }}>Abrir</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>
    )
  }

  return (
    <>
      <button className="btn" style={{ marginBottom: 4 }} onClick={volver}><Icon.ArrowLeft /> Volver a la lista</button>
      {orden && (
        <>
          <div style={{ marginTop: 16, fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{orden.numero}</span> — {orden.referencia}
            {orden.cliente_nombre && <span style={{ marginLeft: 12 }}>Cliente: {orden.cliente_nombre}</span>}
            <span style={{ marginLeft: 12, fontWeight: 400, color: 'var(--ink-3)' }}>Cantidad: {orden.cantidad}</span>
          </div>

          <Section title="Modelo del troquel">
            <ModeloViewer modelo={orden.troquel_modelo} />
          </Section>

          {!loadingFormatos && formatos.length === 0 && (
            <Section title="Formato de cuchillas + tiempos">
              <FormatoCuchillasForm ordenId={orden.id} onCreated={() => loadFormatos(orden.id)} />
            </Section>
          )}

          {formatos.length > 0 && formatos[0].estado === 'pendiente' && (
            <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--warn-soft, #fef6e7)', border: '1px solid var(--warn, #e0a800)', fontSize: 13, color: 'var(--ink-2)' }}>
              <div>
                ⏳ El formato de cuchillas fue enviado y está <strong>esperando aprobación del administrador</strong>.
                Si necesitas corregirlo, cancela el envío para volver a editarlo.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <button className="btn sm" disabled={cancelando} onClick={() => cancelarEnvio(formatos[0].id)}>
                  {cancelando ? 'Cancelando…' : 'Cancelar envío'}
                </button>
                {cancelError && <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>{cancelError}</span>}
              </div>
            </div>
          )}

          {formatos.length > 0 && formatos[0].estado === 'borrador' && (
            <>
              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--surface-2, #f2f2f2)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink-2)' }}>
                ✏️ Cancelaste el envío del formato de cuchillas. Edítalo y reenvíalo cuando esté listo.
              </div>
              <Section title="Editar y reenviar formato de cuchillas">
                <FormatoCuchillasForm
                  resubmit
                  formato={formatos[0]}
                  ordenId={orden.id}
                  onCreated={() => loadFormatos(orden.id)}
                />
              </Section>
            </>
          )}

          {formatos.length > 0 && formatos[0].estado === 'devuelto' && (
            <>
              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--danger-soft, #fdecea)', border: '1px solid var(--danger, #c0392b)', fontSize: 13, color: 'var(--ink-2)' }}>
                ↩ El administrador <strong>devolvió</strong> el formato de cuchillas.
                {formatos[0].devolucion_motivo && <> Motivo: <strong>{formatos[0].devolucion_motivo}</strong>.</>}
                {' '}Corrige los datos y reenvíalo.
              </div>
              <Section title="Corregir y reenviar formato de cuchillas">
                <FormatoCuchillasForm
                  resubmit
                  formato={formatos[0]}
                  ordenId={orden.id}
                  onCreated={() => loadFormatos(orden.id)}
                />
              </Section>
            </>
          )}

          {formatos.length > 0 && formatos[0].estado === 'aprobado' && (
            <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--warn-soft, #fef6e7)', border: '1px solid var(--warn, #e0a800)', fontSize: 13, color: 'var(--ink-2)' }}>
              🔒 El formato de cuchillas de esta OP ya fue registrado y aprobado.
              Si necesitas un cambio, contacta al administrador.
            </div>
          )}

          <Section title="Formato registrado en esta OP">
            <FormatosCuchillasHistory formatos={formatos} loading={loadingFormatos} />
          </Section>
        </>
      )}
    </>
  )
}

// ─────────────── Página ───────────────

export default function Troqueles() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><div className="mod">Troqueles</div></div>
        <div className="topbar-right">
          <button className="btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/produccion'))}><Icon.ArrowLeft /> Volver</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px', width: '100%' }}>
        {isAdmin ? <AdminTroqueles /> : <OperadorTroqueles />}
      </div>
    </div>
  )
}
