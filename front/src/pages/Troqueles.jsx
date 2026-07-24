import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ProgressBar } from '../components/core'
import { Icon } from '../components/Icons'
import {
  FormatosCuchillasHistory, FormatoCuchillasForm, ModeloViewer,
  NuevaTareaTroquelModal,
} from '../components/Troquel'
import {
  getOrdenes, deleteOrden, getFormatosCuchillas, getFormatosCuchillasTodos, getOrdenesPendientes,
  getOrdenProduccion, getTroquelModelo, toggleProcesoVisibleOperador,
  updateFormatoCuchillas, getFormatosPendientes, cancelarEnvioFormato,
  getRemisionablesOperador, consolidarRemisionOperador, pdfRemisionOperadorConsolidada,
  cancelarRemisionOperador,
  getRemisionesSolicitadas, setProcesoPrioridades,
  getClientes, editarCamposOrden,
} from '../api'
import { useSyncPolling } from '../lib/useSyncPolling'

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

// Búsqueda sin distinguir mayúsculas ni tildes
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

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
  const [showNueva, setShowNueva] = useState(false)      // modal Nueva tarea de troquel
  const [pendientes, setPendientes] = useState([])       // formatos esperando aprobación (contador)
  const [solicitudes, setSolicitudes] = useState([])     // envíos de remisión bloqueados por falta de precios
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busqueda, setBusqueda] = useState('')           // filtro de la tabla de OPs en troquel
  const [prioridadError, setPrioridadError] = useState(null)

  const loadPendientes = () =>
    getFormatosPendientes()
      .then(d => setPendientes(asList(d)))
      .catch(() => setPendientes([]))

  const loadSolicitudes = () =>
    getRemisionesSolicitadas()
      .then(d => setSolicitudes(asList(d)))
      .catch(() => setSolicitudes([]))

  useEffect(() => { loadPendientes(); loadSolicitudes() }, [])
  useSyncPolling({
    ordenes: () => loadOrdenes(),
    formatos_pendientes: loadPendientes,
    remisiones_solicitadas: loadSolicitudes,
  })

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

  const ordenesFiltradas = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return ordenes
    return ordenes.filter(o => [o.numero, o.cliente_nombre, o.referencia].some(v => norm(v).includes(t)))
  }, [ordenes, busqueda])

  const abrirGestion = (ord) => navigate(`/produccion/troqueles/${ord.id}`)

  const handleDelete = (e, ord) => {
    e.stopPropagation()
    if (confirmDelete === ord.id) {
      setOrdenes(prev => prev.filter(o => o.id !== ord.id))
      setConfirmDelete(null)
      deleteOrden(ord.id).catch(() => {
        setOrdenes(prev => [ord, ...prev].sort(byEntrega))
      })
    } else {
      setConfirmDelete(ord.id)
    }
  }

  // Marca/desmarca si la OP aparece en la pantalla del Operador (optimista + rollback).
  // El backend asigna la prioridad al final de la cola al marcar, y la libera al desmarcar.
  const toggleVisible = (e, ord) => {
    e.stopPropagation()
    const next = !ord.visible_operador_troquel
    const antes = ord.prioridad_troquel
    const prioridadOptimista = next ? (Math.max(0, ...seleccionados.map(o => o.prioridad_troquel || 0)) + 1) : null
    setOrdenes(prev => prev.map(o => o.id === ord.id
      ? { ...o, visible_operador_troquel: next, prioridad_troquel: prioridadOptimista } : o))
    toggleProcesoVisibleOperador(ord.id, 'troquel', next)
      .then(p => setOrdenes(prev => prev.map(o => o.id === ord.id ? { ...o, prioridad_troquel: p.prioridad } : o)))
      .catch(() => {
        setOrdenes(prev => prev.map(o => o.id === ord.id
          ? { ...o, visible_operador_troquel: !next, prioridad_troquel: antes } : o))
      })
  }

  // Cola del Operador: las OPs marcadas como visibles, en el orden que verá el operador.
  // Sin prioridad asignada van al final, por fecha de entrega.
  const seleccionados = useMemo(() => (
    ordenes
      .filter(o => o.visible_operador_troquel)
      .sort((a, b) => {
        const pa = a.prioridad_troquel ?? Infinity
        const pb = b.prioridad_troquel ?? Infinity
        return pa !== pb ? pa - pb : byEntrega(a, b)
      })
  ), [ordenes])

  // Reordena la cola y persiste la numeración 1..N (optimista + rollback)
  const reordenar = (nuevaCola) => {
    const snapshot = ordenes
    const prioridadPorId = new Map(nuevaCola.map((o, i) => [o.id, i + 1]))
    setOrdenes(prev => prev.map(o => (
      prioridadPorId.has(o.id) ? { ...o, prioridad_troquel: prioridadPorId.get(o.id) } : o
    )))
    setPrioridadError(null)
    setProcesoPrioridades('troquel', nuevaCola.map(o => o.id)).catch(() => {
      setOrdenes(snapshot)
      setPrioridadError('No se pudo guardar el orden. Intenta de nuevo.')
    })
  }

  const mover = (idx, dir) => {
    const destino = idx + dir
    if (destino < 0 || destino >= seleccionados.length) return
    const cola = [...seleccionados]
    ;[cola[idx], cola[destino]] = [cola[destino], cola[idx]]
    reordenar(cola)
  }

  // Abre la gestión de la OP solicitada (o la cola de revisión si no está en la lista)
  const irAPrecios = (s) => {
    const row = ordenes.find(o => o.id === s.id)
    if (row) abrirGestion(row)
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

      <Section title={`Cola del Operador${seleccionados.length ? ` (${seleccionados.length})` : ''}`}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)' }}>
          Estos son los troqueles que el operador ve en su pantalla, en este orden.
          Marca o desmarca OPs en la tabla de abajo y usa las flechas para dar prioridad.
        </div>
        {prioridadError && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--danger, #c0392b)' }}>
            ✗ {prioridadError}
          </div>
        )}
        {seleccionados.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
            Ningún troquel seleccionado — la pantalla del operador está vacía.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)' }}>
                {['#', 'OP #', 'Entrega', 'Cliente', 'Referencia', 'Prioridad', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seleccionados.map((ord, idx) => {
                const ent = fmtEntrega(ord.fecha_entrega)
                return (
                  <tr key={ord.id}
                    style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                    onClick={() => abrirGestion(ord)}>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: 'var(--ink-3)', width: 40 }}>{idx + 1}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12 }}>{ord.numero}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: ent.color }}>{ent.txt}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{ord.cliente_nombre}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--ink-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ord.referencia}</td>
                    <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn sm" title="Subir prioridad" disabled={idx === 0} onClick={() => mover(idx, -1)}>↑</button>
                        <button className="btn sm" title="Bajar prioridad" disabled={idx === seleccionados.length - 1} onClick={() => mover(idx, 1)}>↓</button>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <button className="btn sm" onClick={e => toggleVisible(e, ord)}>Quitar</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
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
          <>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ position: 'relative', maxWidth: 420 }}>
              <input
                className="input"
                placeholder="Buscar por número, cliente, referencia…"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                style={{ paddingLeft: 32 }}
              />
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                <Icon.Search />
              </span>
            </div>
          </div>
          {ordenesFiltradas.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin resultados para «{busqueda.trim()}»</div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)' }}>
                {['OP #', 'Entrega', 'Cliente', 'Referencia', 'Progreso', 'Operador', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenesFiltradas.map((ord, idx) => (
                <tr key={ord.id}
                  style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                  onClick={() => abrirGestion(ord)}>
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
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: ord.visible_operador_troquel ? 'var(--ink-1)' : 'var(--ink-3)' }}>
                      <input type="checkbox" checked={!!ord.visible_operador_troquel} onChange={e => toggleVisible(e, ord)} />
                      {ord.visible_operador_troquel
                        ? `Visible${ord.prioridad_troquel ? ` · #${ord.prioridad_troquel}` : ''}`
                        : 'Oculto'}
                    </label>
                  </td>
                  <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                    <button
                      className={'btn sm' + (confirmDelete === ord.id ? ' danger' : '')}
                      onClick={e => handleDelete(e, ord)}
                    >
                      {confirmDelete === ord.id ? '¿Eliminar?' : 'Eliminar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          </>
        )}
      </Section>

      {showNueva && (
        <NuevaTareaTroquelModal
          onClose={() => setShowNueva(false)}
          onCreated={(orden) => {
            setShowNueva(false)
            abrirGestion(orden)
          }}
        />
      )}
    </div>
  )
}

// ─────────────── Vista Operador ───────────────

// El Operador puede corregir referencia / fecha de entrega / cliente de la OP.
// Cada cambio queda auditado server-side (quién / cuándo). El cliente se bloquea
// cuando la OP proviene de una cotización (coherente con el backend).
function OperadorOpDatos({ orden, onSaved }) {
  const locked = !!orden.desde_cotizacion
  const [referencia, setReferencia] = useState(orden.referencia || '')
  const [fechaEntrega, setFechaEntrega] = useState(orden.fecha_entrega || '')
  const [clienteId, setClienteId] = useState(orden.cliente || null)
  const [clienteNombre, setClienteNombre] = useState(orden.cliente_nombre || '')
  const [suggestions, setSuggestions] = useState([])
  const [showSugg, setShowSugg] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    setReferencia(orden.referencia || '')
    setFechaEntrega(orden.fecha_entrega || '')
    setClienteId(orden.cliente || null)
    setClienteNombre(orden.cliente_nombre || '')
    setSuggestions([]); setShowSugg(false); setError(null); setOk(false)
  }, [orden.id])

  const dirty =
    referencia !== (orden.referencia || '') ||
    fechaEntrega !== (orden.fecha_entrega || '') ||
    clienteId !== (orden.cliente || null)

  const buscarClientes = (q) => {
    setClienteNombre(q)
    setClienteId(null)   // sin sugerencia elegida no hay cliente válido
    setOk(false)
    if (!q || q.trim().length < 2) { setSuggestions([]); setShowSugg(false); return }
    getClientes(q)
      .then(d => { const l = asList(d); setSuggestions(l); setShowSugg(l.length > 0) })
      .catch(() => { setSuggestions([]); setShowSugg(false) })
  }

  const elegirCliente = (c) => { setClienteId(c.id); setClienteNombre(c.nombre); setShowSugg(false) }

  const guardar = () => {
    setError(null); setOk(false)
    const payload = { referencia: referencia.trim(), fecha_entrega: fechaEntrega || null }
    if (!locked) {
      if (!clienteId) { setError('Selecciona un cliente de la lista.'); return }
      payload.cliente = clienteId
    }
    setSaving(true)
    editarCamposOrden(orden.id, payload)
      .then(full => { setOk(true); onSaved && onSaved(full) })
      .catch(e => setError(e?.message || 'No se pudieron guardar los cambios'))
      .finally(() => setSaving(false))
  }

  const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }
  return (
    <div style={{ marginTop: 16, overflow: 'visible' }} className="section">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span><span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{orden.numero}</span> — Datos de la OP</span>
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--ink-3)' }}>Cantidad: {orden.cantidad}</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div style={lbl}>Cliente{locked && ' (bloqueado — OP de cotización)'}</div>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              style={{ width: '100%' }}
              placeholder="Buscar cliente…"
              value={clienteNombre}
              disabled={locked}
              onChange={e => buscarClientes(e.target.value)}
              onBlur={() => setTimeout(() => setShowSugg(false), 150)}
              onFocus={() => suggestions.length > 0 && setShowSugg(true)}
            />
            {showSugg && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, maxHeight: 240, overflowY: 'auto' }}>
                {suggestions.map(c => (
                  <div
                    key={c.id}
                    onMouseDown={() => elegirCliente(c)}
                    style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >{c.nombre}</div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div style={lbl}>Referencia</div>
          <input className="input" style={{ width: '100%' }} value={referencia} onChange={e => { setReferencia(e.target.value); setOk(false) }} />
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <div style={lbl}>Fecha de entrega</div>
          <input className="input" type="date" value={fechaEntrega || ''} onChange={e => { setFechaEntrega(e.target.value); setOk(false) }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn sm primary" disabled={!dirty || saving} onClick={guardar}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {ok && <span style={{ fontSize: 12, color: 'var(--ok, #2e8b57)' }}>✓ Guardado</span>}
          {error && <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>{error}</span>}
        </div>
      </div>
    </div>
  )
}

function OperadorTroqueles() {
  const { user } = useAuth()
  const [tab, setTab] = useState('pendientes')
  const [lista, setLista] = useState([])
  const [busqueda, setBusqueda] = useState('')
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
  const [busquedaHist, setBusquedaHist] = useState('')
  // Tab de remisiones del Operador (consolidar varias OP de un cliente en un PDF)
  const [remisionables, setRemisionables] = useState([])
  const [loadingRem, setLoadingRem] = useState(false)
  const [busquedaRem, setBusquedaRem] = useState('')
  const [selRem, setSelRem] = useState([])          // ids de OP seleccionadas
  const [selCliente, setSelCliente] = useState(null) // cliente_id de la selección
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState(null)
  const [cancelRemBusy, setCancelRemBusy] = useState(null) // id de OP cuya remisión se está cancelando

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

  const loadRemisionables = () => {
    setLoadingRem(true)
    getRemisionablesOperador()
      .then(d => setRemisionables(asList(d)))
      .catch(() => setRemisionables([]))
      .finally(() => setLoadingRem(false))
  }

  useEffect(() => { if (tab === 'remisiones') loadRemisionables() }, [tab])

  // Tiempo real: refrescar la lista de pendientes solo cuando se está viendo
  useSyncPolling({ ordenes: () => loadLista(true) }, { enabled: !orden && tab === 'pendientes' })

  // Remisionables filtradas por búsqueda y agrupadas por cliente
  const remisionablesFiltradas = useMemo(() => {
    const t = norm(busquedaRem.trim())
    if (!t) return remisionables
    return remisionables.filter(op => [op.numero, op.cliente_nombre, op.referencia].some(v => norm(v).includes(t)))
  }, [remisionables, busquedaRem])

  const gruposRem = useMemo(() => {
    const map = new Map()
    for (const op of remisionablesFiltradas) {
      const key = op.cliente_id
      if (!map.has(key)) map.set(key, { cliente_id: key, cliente_nombre: op.cliente_nombre, ops: [] })
      map.get(key).ops.push(op)
    }
    return [...map.values()]
  }, [remisionablesFiltradas])

  // Al marcar una OP: si es de otro cliente, reinicia la selección a ese cliente.
  const toggleRem = (op) => {
    setGenError(null)
    if (selCliente !== null && op.cliente_id !== selCliente) {
      setSelCliente(op.cliente_id)
      setSelRem([op.id])
      return
    }
    setSelCliente(op.cliente_id)
    setSelRem(prev => {
      const next = prev.includes(op.id) ? prev.filter(x => x !== op.id) : [...prev, op.id]
      if (next.length === 0) setSelCliente(null)
      return next
    })
  }

  const generarRemision = async () => {
    if (!selRem.length) return
    setGenBusy(true)
    setGenError(null)
    try {
      const { remision_id } = await consolidarRemisionOperador(selRem)
      const r = await pdfRemisionOperadorConsolidada(remision_id)
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        throw new Error(body?.error || `HTTP ${r.status}`)
      }
      const nombre = (r.headers.get('Content-Disposition') || '').match(/filename="(.+?)"/)?.[1]
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre || 'Remision.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setSelRem([]); setSelCliente(null)
      loadRemisionables()
    } catch (e) {
      setGenError(e.message || 'No se pudo generar la remisión')
    } finally {
      setGenBusy(false)
    }
  }

  const cancelarRemision = async (op) => {
    if (!window.confirm(`¿Eliminar la remisión ${op.remision_numero} de ${op.numero}? Se puede volver a generar más adelante.`)) return
    setCancelRemBusy(op.id)
    setGenError(null)
    try {
      await cancelarRemisionOperador(op.id)
      setSelRem(prev => prev.filter(id => id !== op.id))
      loadRemisionables()
    } catch (e) {
      setGenError(e?.message || 'No se pudo cancelar la remisión')
    } finally {
      setCancelRemBusy(null)
    }
  }

  const listaFiltrada = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return lista
    return lista.filter(op => [op.numero, op.cliente_nombre, op.referencia].some(v => norm(v).includes(t)))
  }, [lista, busqueda])

  const historialFiltrado = useMemo(() => {
    const t = norm(busquedaHist.trim())
    if (!t) return historial
    return historial.filter(f => [f.orden_numero, f.cliente_nombre, f.referencia].some(v => norm(v).includes(t)))
  }, [historial, busquedaHist])

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
    const puedeEditar = (f) =>
      f.estado !== 'aprobado' && !!user?.username && f.operador_username === user.username
    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className={`btn sm${tab === 'pendientes' ? ' primary' : ''}`} onClick={() => { setTab('pendientes'); setEditHist(null) }}>Pendientes</button>
          <button className={`btn sm${tab === 'remisiones' ? ' primary' : ''}`} onClick={() => { setTab('remisiones'); setEditHist(null) }}>Remisiones</button>
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
            {!loadingHistorial && historial.length > 0 && (
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ position: 'relative', maxWidth: 420 }}>
                  <input
                    className="input"
                    placeholder="Buscar por OP, cliente, referencia…"
                    value={busquedaHist}
                    onChange={e => setBusquedaHist(e.target.value)}
                    style={{ paddingLeft: 32 }}
                  />
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                    <Icon.Search />
                  </span>
                </div>
              </div>
            )}
            {!loadingHistorial && historial.length > 0 && historialFiltrado.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin resultados para «{busquedaHist.trim()}»</div>
            ) : (
              <FormatosCuchillasHistory
                formatos={historialFiltrado}
                loading={loadingHistorial}
                compact
                onEdit={setEditHist}
                canEdit={puedeEditar}
              />
            )}
          </Section>
        )}

        {tab === 'pendientes' && (
          <Section title="Troqueles del día — selecciona una OP">
            {loadingLista ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
            ) : lista.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>No hay troqueles pendientes 🎉</div>
            ) : (
              <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ position: 'relative', maxWidth: 420 }}>
                  <input
                    className="input"
                    placeholder="Buscar por número, cliente, referencia…"
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    style={{ paddingLeft: 32 }}
                  />
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                    <Icon.Search />
                  </span>
                </div>
              </div>
              {listaFiltrada.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin resultados para «{busqueda.trim()}»</div>
              ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)' }}>
                    {['#', 'OP #', 'Entrega', 'Cliente', 'Referencia', 'Cantidad', ''].map((h, i) => (
                      <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listaFiltrada.map((op, idx) => {
                    const ent = fmtEntrega(op.fecha_entrega)
                    return (
                      <tr key={op.id}
                        style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                        onClick={() => !opening && abrir(op)}>
                        <td style={{ padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: 'var(--ink-3)', width: 40 }}>{idx + 1}</td>
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
              </>
            )}
          </Section>
        )}

        {tab === 'remisiones' && (
          <Section
            title="Remisiones — selecciona troqueles de un cliente"
            actions={
              <button className="btn sm primary" disabled={genBusy || !selRem.length} onClick={generarRemision}>
                {genBusy ? 'Generando…' : `Generar remisión${selRem.length ? ` (${selRem.length})` : ''}`}
              </button>
            }
          >
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)' }}>
              Marca varios troqueles del <strong>mismo cliente</strong> para reunirlos en una sola remisión. El PDF muestra el consumo en cm y la firma del cliente (sin precios, salvo que el administrador los habilite).
            </div>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ position: 'relative', maxWidth: 420 }}>
                <input
                  className="input"
                  placeholder="Buscar por número, cliente, referencia…"
                  value={busquedaRem}
                  onChange={e => setBusquedaRem(e.target.value)}
                  style={{ paddingLeft: 32 }}
                />
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>
                  <Icon.Search />
                </span>
              </div>
              {genError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger, #c0392b)' }}>✗ {genError}</div>}
            </div>
            {loadingRem ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
            ) : gruposRem.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
                {busquedaRem.trim() ? `Sin resultados para «${busquedaRem.trim()}»` : 'No hay troqueles pendientes de remisión.'}
              </div>
            ) : (
              gruposRem.map(g => {
                const bloqueado = selCliente !== null && g.cliente_id !== selCliente
                return (
                  <div key={g.cliente_id} style={{ opacity: bloqueado ? 0.5 : 1 }}>
                    <div style={{ padding: '8px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13 }}>
                      {g.cliente_nombre || '—'}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                      <tbody>
                        {g.ops.map((op, idx) => {
                          const checked = selRem.includes(op.id)
                          return (
                            <tr key={op.id}
                              style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                              onClick={() => toggleRem(op)}>
                              <td style={{ padding: '10px 12px', width: 36 }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleRem(op)} onClick={e => e.stopPropagation()} />
                              </td>
                              <td style={{ padding: '10px 12px', width: 90, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13 }}>{op.numero}</td>
                              <td style={{ padding: '10px 12px', color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.referencia}</td>
                              <td style={{ padding: '10px 12px', width: 70, fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink-2)' }}>{op.cantidad}</td>
                              <td style={{ padding: '10px 12px', width: 110, fontSize: 12, color: 'var(--ink-3)' }}>{op.remision_numero || 'nueva'}</td>
                              <td style={{ padding: '10px 12px', width: 40, textAlign: 'center' }}>
                                {op.remision_numero && (
                                  <button
                                    className="btn"
                                    style={{ padding: '4px 6px', color: 'var(--danger)', borderColor: 'transparent' }}
                                    title="Eliminar remisión pendiente"
                                    disabled={cancelRemBusy === op.id}
                                    onClick={e => { e.stopPropagation(); cancelarRemision(op) }}
                                  >
                                    <Icon.Trash />
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })
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
          <OperadorOpDatos orden={orden} onSaved={setOrden} />

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
