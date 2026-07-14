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
  getOrdenes, deleteOrden, getFormatosCuchillas, getFormatosCuchillasTodos, getOrdenesPendientes,
  getOrdenProduccion, getTroquelModelo,
  updateFormatoCuchillas, getFormatosPendientes, cancelarEnvioFormato,
  enviarRemisionOperador, pdfRemisionOperador, getRemisionesSolicitadas,
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
  const [solicitudes, setSolicitudes] = useState([])     // envíos de remisión bloqueados por falta de precios
  const [confirmDelete, setConfirmDelete] = useState(null)

  const loadPendientes = () =>
    getFormatosPendientes()
      .then(d => setPendientes(asList(d)))
      .catch(() => setPendientes([]))

  const loadSolicitudes = () =>
    getRemisionesSolicitadas()
      .then(d => setSolicitudes(asList(d)))
      .catch(() => setSolicitudes([]))

  useEffect(() => { loadPendientes(); loadSolicitudes() }, [])
  usePolling(() => { loadPendientes(); loadSolicitudes() }, { enabled: true })

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

  const handleDelete = (e, ord) => {
    e.stopPropagation()
    if (confirmDelete === ord.id) {
      setOrdenes(prev => prev.filter(o => o.id !== ord.id))
      setConfirmDelete(null)
      if (sel?.id === ord.id) setSel(null)
      deleteOrden(ord.id).catch(() => {
        setOrdenes(prev => [ord, ...prev].sort(byEntrega))
      })
    } else {
      setConfirmDelete(ord.id)
    }
  }

  // Abre la sección de costos de la OP solicitada (o la cola de revisión si no está en la lista)
  const irAPrecios = (s) => {
    const row = ordenes.find(o => o.id === s.id)
    if (row) selectOrden(row)
    else navigate('/produccion/troqueles/revision')
  }

  return (
    <div onClick={() => setConfirmDelete(null)}>
      {solicitudes.length > 0 && (
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--danger-soft, #fdecea)', border: '1px solid var(--danger, #c0392b)', fontSize: 13, color: 'var(--ink-2)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            🔔 Remisiones esperando precios de troquel ({solicitudes.length})
          </div>
          {solicitudes.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '6px 0', borderTop: '1px solid var(--danger, #c0392b22)' }}>
              <span style={{ flex: 1, minWidth: 220 }}>
                El operador {s.solicitada_por && <strong>{s.solicitada_por}</strong>} solicitó enviar la remisión de{' '}
                <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{s.numero}</strong>
                {s.cliente_nombre && <> ({s.cliente_nombre})</>} — faltan los precios del troquel.
              </span>
              <button className="btn sm primary" onClick={() => irAPrecios(s)}>Poner precios</button>
            </div>
          ))}
        </div>
      )}

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
                  <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn sm" onClick={() => navigate(`/ordenes/${ord.id}`)}>Abrir OP</button>
                      <button
                        className={'btn sm' + (confirmDelete === ord.id ? ' danger' : '')}
                        onClick={e => handleDelete(e, ord)}
                      >
                        {confirmDelete === ord.id ? '¿Eliminar?' : 'Eliminar'}
                      </button>
                    </div>
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

          <Section title="Costos (del formato de cuchillas)">
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
    </div>
  )
}

// ─────────────── Vista Operador ───────────────

function OperadorTroqueles() {
  const { user } = useAuth()
  const [tab, setTab] = useState('pendientes')
  const [lista, setLista] = useState([])
  const [loadingLista, setLoadingLista] = useState(true)
  const [orden, setOrden] = useState(null)
  const [opening, setOpening] = useState(false)
  const [formatos, setFormatos] = useState([])
  const [loadingFormatos, setLoadingFormatos] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [cancelError, setCancelError] = useState(null)
  // Historial de formatos (todas las OPs / operadores) y formato en edición
  const [historial, setHistorial] = useState([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)
  const [editHist, setEditHist] = useState(null)
  // Envío de remisión: null | 'confirm' | 'blocked' | 'done' | 'ya_enviada'
  const [remModal, setRemModal] = useState(null)
  const [remBusy, setRemBusy] = useState(false)
  const [remError, setRemError] = useState(null)
  const [remNumero, setRemNumero] = useState('')
  const [remEmail, setRemEmail] = useState('')
  const [dlBusy, setDlBusy] = useState(false)

  const loadLista = (silent = false) => {
    if (!silent) setLoadingLista(true)
    getOrdenesPendientes('troquel')
      .then(d => setLista(asList(d)))
      .catch(() => setLista([]))
      .finally(() => setLoadingLista(false))
  }

  useEffect(() => { loadLista() }, [])

  const loadHistorial = () => {
    setLoadingHistorial(true)
    getFormatosCuchillasTodos()
      .then(d => setHistorial(asList(d)))
      .catch(() => setHistorial([]))
      .finally(() => setLoadingHistorial(false))
  }

  useEffect(() => { if (tab === 'historial') loadHistorial() }, [tab])

  // Tiempo real: refrescar la lista de pendientes solo cuando se está viendo
  usePolling(() => loadLista(true), { enabled: !orden && tab === 'pendientes' })

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

  const enviarRemision = () => {
    setRemBusy(true)
    setRemError(null)
    enviarRemisionOperador(orden.id, remEmail.trim())
      .then(d => { setRemNumero(d.remision_numero || ''); setRemModal('done') })
      .catch(e => {
        if (e.code === 'precios_pendientes') setRemModal('blocked')
        else if (e.code === 'ya_enviada') setRemModal('ya_enviada')
        else { setRemModal(null); setRemError(e.message || 'No se pudo enviar la remisión') }
      })
      .finally(() => setRemBusy(false))
  }

  // Descarga el PDF cliente de la remisión para imprimirlo (mismo bloqueo por precios)
  const descargarPdf = async () => {
    setDlBusy(true)
    setRemError(null)
    try {
      const r = await pdfRemisionOperador(orden.id)
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        if (body?.code === 'precios_pendientes') { setRemModal('blocked'); return }
        throw new Error(body?.error || `HTTP ${r.status}`)
      }
      const nombre = (r.headers.get('Content-Disposition') || '').match(/filename="(.+?)"/)?.[1]
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre || `Remision_${orden.numero}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setRemError(e.message || 'No se pudo generar el PDF')
    } finally {
      setDlBusy(false)
    }
  }

  // Al cerrar 'done'/'ya_enviada' se refresca la OP para que el botón cambie de estado
  const cerrarRemModal = () => {
    const refrescar = remModal === 'done' || remModal === 'ya_enviada'
    setRemModal(null)
    if (refrescar) getOrdenProduccion(orden.id).then(setOrden).catch(() => {})
  }

  if (!orden) {
    const puedeEditar = (f) =>
      f.estado !== 'aprobado' && !!user?.username && f.operador_username === user.username
    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className={`btn sm${tab === 'pendientes' ? ' primary' : ''}`} onClick={() => { setTab('pendientes'); setEditHist(null) }}>Pendientes</button>
          <button className={`btn sm${tab === 'historial' ? ' primary' : ''}`} onClick={() => setTab('historial')}>Historial</button>
        </div>

        {tab === 'historial' && editHist && (
          <>
            <button className="btn" style={{ marginTop: 16 }} onClick={() => setEditHist(null)}><Icon.ArrowLeft /> Volver al historial</button>
            {editHist.estado === 'pendiente' && (
              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--warn-soft, #fef6e7)', border: '1px solid var(--warn, #e0a800)', fontSize: 13, color: 'var(--ink-2)' }}>
                ⏳ Este formato sigue <strong>pendiente de aprobación</strong>; al guardar los cambios seguirá en la cola del administrador.
              </div>
            )}
            <Section title={`Editar formato — OP ${editHist.orden_numero || ''}${editHist.cliente_nombre ? ` · ${editHist.cliente_nombre}` : ''}`}>
              <FormatoCuchillasForm
                resubmit
                formato={editHist}
                ordenId={editHist.orden}
                onCreated={() => { setEditHist(null); loadHistorial() }}
              />
            </Section>
          </>
        )}

        {tab === 'historial' && !editHist && (
          <Section title="Historial de formatos de cuchillas">
            <FormatosCuchillasHistory
              formatos={historial}
              loading={loadingHistorial}
              showOrden
              onEdit={setEditHist}
              canEdit={puedeEditar}
            />
          </Section>
        )}

        {tab === 'pendientes' && (
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
        )}
      </>
    )
  }

  return (
    <>
      <button className="btn" style={{ marginBottom: 4 }} onClick={volver}><Icon.ArrowLeft /> Volver a la lista</button>
      {orden && (
        <>
          <div style={{ marginTop: 16, fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{orden.numero}</span> — {orden.referencia}
              {orden.cliente_nombre && <span style={{ marginLeft: 12 }}>Cliente: {orden.cliente_nombre}</span>}
              <span style={{ marginLeft: 12, fontWeight: 400, color: 'var(--ink-3)' }}>Cantidad: {orden.cantidad}</span>
            </span>
            {orden.remision_enviada ? (
              <span style={{ padding: '4px 12px', borderRadius: 999, background: 'var(--surface-2, #f2f2f2)', border: '1px solid var(--line)', fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>
                ✓ Remisión enviada
              </span>
            ) : (
              <button className="btn sm primary" onClick={() => { setRemError(null); setRemModal('confirm') }}>
                Enviar remisión
              </button>
            )}
            <button className="btn sm" disabled={dlBusy} onClick={descargarPdf} title="Descarga el PDF de la remisión para imprimirlo">
              {dlBusy ? 'Generando…' : '⬇ Descargar PDF'}
            </button>
            {remError && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--danger, #c0392b)' }}>{remError}</span>}
          </div>

          <Section title="Modelo del troquel">
            <ModeloViewer modelo={orden.troquel_modelo} />
          </Section>

          {!loadingFormatos && formatos.length === 0 && (
            <Section title="Formato de cuchillas + tiempos">
              <FormatoCuchillasForm
                ordenId={orden.id}
                onCreated={() => loadFormatos(orden.id)}
                onDraftSaved={() => loadFormatos(orden.id)}
              />
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
                ✏️ Formato guardado como <strong>borrador</strong> — el administrador no lo verá hasta que lo envíes.
              </div>
              <Section title="Editar y enviar formato de cuchillas">
                <FormatoCuchillasForm
                  resubmit
                  formato={formatos[0]}
                  ordenId={orden.id}
                  onCreated={() => loadFormatos(orden.id)}
                  onDraftSaved={() => loadFormatos(orden.id)}
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
                  onDraftSaved={() => loadFormatos(orden.id)}
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

          {remModal === 'confirm' && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}>
              <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Enviar remisión</div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 14 }}>
                  Se enviará la remisión de <strong>{orden.numero}</strong> por correo al cliente y a contaduría.
                </div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
                  Correo del cliente
                </label>
                <input
                  className="input" type="email" placeholder="correo@cliente.com"
                  value={remEmail} onChange={e => setRemEmail(e.target.value)}
                  disabled={remBusy} style={{ width: '100%' }}
                />
                <div style={{ fontSize: 11, color: 'var(--ink-3)', margin: '4px 0 16px' }}>
                  Si lo dejas vacío se usa el correo registrado del cliente.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn" onClick={() => setRemModal(null)} disabled={remBusy}>Cancelar</button>
                  <button className="btn primary" onClick={enviarRemision} disabled={remBusy}>
                    {remBusy ? 'Enviando…' : 'Sí, enviar'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {remModal === 'blocked' && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}>
              <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>⚠️ Faltan precios del troquel</div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
                  El administrador aún no ha completado los precios de este troquel, así que la remisión
                  no se puede enviar todavía. Ya le llegó el aviso en su pantalla; por favor notifícale.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn primary" onClick={() => setRemModal(null)}>Entendido</button>
                </div>
              </div>
            </div>
          )}

          {(remModal === 'done' || remModal === 'ya_enviada') && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}>
              <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                  {remModal === 'done' ? '✓ Remisión enviada' : 'Remisión ya enviada'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
                  {remModal === 'done'
                    ? <>Remisión {remNumero && <strong>{remNumero}</strong>} enviada al cliente por correo.</>
                    : 'La remisión de esta OP ya fue enviada o consolidada anteriormente.'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn primary" onClick={cerrarRemModal}>Entendido</button>
                </div>
              </div>
            </div>
          )}
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
