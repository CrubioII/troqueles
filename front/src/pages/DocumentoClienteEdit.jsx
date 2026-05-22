import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { fmtCOP, fmtNum, CONDICIONES_PAGO } from '../components/core'
import {
  getClientes, createCliente,
  getCotizacion, getCotizaciones,
  getDocumento, createDocumento, updateDocumento, deleteDocumento,
  pdfDocumento, enviarDocumento,
} from '../api'

const DEFAULT_NOTA = 'En la presente cotización No incluye el impuesto del IVA, el cliente debe suministrar el diseño de logotipo e impresión.'

function buildBlank() {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: null,
    numero: 'DC-????',
    fecha: today,
    cliente: '',
    clienteId: null,
    clienteEmail: '',
    clienteTelefono: '',
    clienteNit: '',
    tiempoEntrega: '8 días hábiles',
    condicionPago: '30',
    condicionCustom: '',
    nota: DEFAULT_NOTA,
    estado: 'borrador',
    items: [],
  }
}

function newItem(overrides = {}) {
  return {
    _key: Math.random().toString(36).slice(2),
    cotizacion: null,
    cotizacionNumero: '',
    referencia: '',
    descripcion: '',
    tamanoDisplay: '',
    cantidad: 0,
    valorUnitario: 0,
    valorTotal: 0,
    ...overrides,
  }
}

function apiToState(doc) {
  return {
    id: doc.id,
    numero: doc.numero || 'DC-????',
    fecha: doc.fecha || '',
    cliente: doc.cliente_nombre || '',
    clienteId: doc.cliente || null,
    clienteEmail: doc.cliente_email || '',
    clienteTelefono: doc.cliente_telefono || '',
    clienteNit: doc.cliente_nit || '',
    tiempoEntrega: doc.tiempo_entrega || '8 días hábiles',
    condicionPago: doc.condicion_pago || '30',
    condicionCustom: doc.condicion_custom || '',
    nota: doc.nota || DEFAULT_NOTA,
    estado: doc.estado || 'borrador',
    items: (doc.items || []).map(item => ({
      _key: Math.random().toString(36).slice(2),
      id: item.id,
      cotizacion: item.cotizacion,
      cotizacionNumero: '',
      referencia: item.referencia || '',
      descripcion: item.descripcion || '',
      tamanoDisplay: item.tamano_display || '',
      cantidad: item.cantidad || 0,
      valorUnitario: parseFloat(item.valor_unitario) || 0,
      valorTotal: parseFloat(item.valor_total) || 0,
    })),
  }
}

function stateToApi(d) {
  return {
    fecha: d.fecha,
    cliente: d.clienteId,
    tiempo_entrega: d.tiempoEntrega,
    condicion_pago: d.condicionPago,
    condicion_custom: d.condicionCustom,
    nota: d.nota,
    estado: d.estado,
    items: d.items.map((item, idx) => ({
      ...(item.id ? { id: item.id } : {}),
      ...(item.cotizacion ? { cotizacion: item.cotizacion } : {}),
      referencia: item.referencia,
      descripcion: item.descripcion,
      tamano_display: item.tamanoDisplay,
      cantidad: item.cantidad,
      valor_unitario: item.valorUnitario,
      valor_total: item.valorTotal,
      orden: idx,
    })),
  }
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Client autocomplete ──
function ClienteField({ value, clienteId, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!value || value.length < 1) { setSuggestions([]); return }
    const t = setTimeout(() => {
      getClientes(value).then(r => {
        const list = r.results || r
        setSuggestions(list)
        setOpen(list.length > 0)
      }).catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input
        className="input"
        placeholder="Nombre del cliente"
        value={value}
        onChange={e => { onChange(e.target.value); onSelect(null, '', '', '', '') }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {clienteId && (
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>
          ✓
        </span>
      )}
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto',
        }}>
          {suggestions.map(c => (
            <div
              key={c.id}
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
              onMouseDown={() => { onSelect(c.id, c.nombre, c.email || '', c.telefono || '', c.nit || ''); setOpen(false) }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <strong>{c.nombre}</strong>
              {c.nit && <span style={{ color: 'var(--ink-3)', fontSize: 11, marginLeft: 6 }}>NIT {c.nit}</span>}
              {c.email && <span style={{ color: 'var(--ink-3)', fontSize: 11, marginLeft: 6 }}>{c.email}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Import-from-cotizacion modal ──
function ImportCotizacionModal({ clienteId, onImport, onClose }) {
  const [cotizaciones, setCotizaciones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clienteId) { setLoading(false); return }
    getCotizaciones(`?cliente=${clienteId}`)
      .then(r => setCotizaciones(r.results || r))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clienteId])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 10, padding: 20, width: 520, maxHeight: '70vh',
        overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 14 }}>Importar cotización</strong>
          <button className="btn" style={{ padding: '3px 8px' }} onClick={onClose}><Icon.X /></button>
        </div>
        {!clienteId ? (
          <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>
            Selecciona un cliente primero.
          </div>
        ) : loading ? (
          <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>Cargando…</div>
        ) : cotizaciones.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>
            Este cliente no tiene cotizaciones.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {['N°', 'Referencia', 'Cant.', 'Estado', ''].map((h, i) => (
                  <th key={i} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cotizaciones.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px' }}>
                    <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 11 }}>{c.numero}</span>
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--ink-2)' }}>{c.referencia || '—'}</td>
                  <td style={{ padding: '7px 10px' }} className="mono">{fmtNum(c.cantidad)}</td>
                  <td style={{ padding: '7px 10px', color: 'var(--ink-3)', fontSize: 11 }}>{c.estado}</td>
                  <td style={{ padding: '7px 10px' }}>
                    <button
                      className="btn accent"
                      style={{ padding: '3px 10px', fontSize: 11 }}
                      onClick={() => onImport(c.id)}
                    >
                      Importar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Send email modal ──
function SendModal({ doc, onSend, onClose }) {
  const [email, setEmail] = useState(doc.clienteEmail || '')
  const [extraEmails, setExtraEmails] = useState([])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  const handleSend = async () => {
    setSending(true)
    try {
      const res = await onSend(email.trim(), extraEmails.filter(e => e.trim()))
      setResult({ ok: true, msg: `Enviado a: ${res.enviado_a.join(', ')}` })
    } catch (e) {
      setResult({ ok: false, msg: e.message })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 10, padding: 24, width: 420,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <strong style={{ fontSize: 14 }}>Enviar cotización al cliente</strong>
          <button className="btn" style={{ padding: '3px 8px' }} onClick={onClose}><Icon.X /></button>
        </div>
        {result ? (
          <div style={{
            padding: 14, borderRadius: 6,
            background: result.ok ? '#e8f5e9' : '#fdecea',
            color: result.ok ? '#2e7d32' : '#c62828',
            fontSize: 13, marginBottom: 12,
          }}>
            {result.msg}
          </div>
        ) : (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Email principal</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            {extraEmails.map((em, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  className="input"
                  type="email"
                  placeholder="CC destinatario"
                  value={em}
                  onChange={e => setExtraEmails(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                  style={{ flex: 1 }}
                />
                <button className="btn" style={{ padding: '4px 8px' }}
                  onClick={() => setExtraEmails(prev => prev.filter((_, j) => j !== i))}>
                  <Icon.X />
                </button>
              </div>
            ))}
            <button className="btn" style={{ fontSize: 11, marginBottom: 14 }}
              onClick={() => setExtraEmails(prev => [...prev, ''])}>
              + Agregar destinatario
            </button>
            <button className="btn accent" style={{ width: '100%', justifyContent: 'center' }}
              onClick={handleSend} disabled={sending || !email.trim()}>
              <Icon.Send /> {sending ? 'Enviando…' : 'Enviar correo'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Money input ──
function MoneyInput({ value, onChange, style }) {
  const display = Number(Math.round(value || 0)).toLocaleString('es-CO')
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3, ...style }}>
      <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>$</span>
      <input
        type="text"
        inputMode="numeric"
        className="liq-input mono"
        value={display}
        onChange={e => onChange(parseInt(e.target.value.replace(/[^\d]/g, '')) || 0)}
      />
    </div>
  )
}

export default function DocumentoClienteEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isNew = !id

  const [d, setData] = useState(buildBlank)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [toast, setToast] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [importTarget, setImportTarget] = useState(null)
  const [showSend, setShowSend] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toastRef = useRef(null)

  const set = (patch) => setData(prev => ({ ...prev, ...patch }))

  useEffect(() => {
    if (!isNew) {
      getDocumento(id)
        .then(doc => setData(apiToState(doc)))
        .catch(console.error)
        .finally(() => setLoading(false))
      return
    }
    const cotId = searchParams.get('cotizacion')
    if (cotId) {
      const vuParam = parseFloat(searchParams.get('vu')) || 0
      const vtParam = parseFloat(searchParams.get('vt')) || 0
      getCotizacion(cotId).then(cot => {
        const ancho = parseFloat(cot.molde_ancho) || 0
        const alto = parseFloat(cot.molde_alto) || 0
        set({
          cliente: cot.cliente_nombre || '',
          clienteId: cot.cliente || null,
          clienteEmail: cot.cliente_email || '',
          clienteTelefono: cot.cliente_telefono || '',
          clienteNit: cot.cliente_nit || '',
          condicionPago: cot.condicion_pago || '30',
          condicionCustom: cot.condicion_custom || '',
          items: [newItem({
            cotizacion: cot.id,
            cotizacionNumero: cot.numero || '',
            referencia: cot.referencia || '',
            descripcion: cot.observaciones || '',
            tamanoDisplay: ancho > 0 && alto > 0 ? `${ancho} × ${alto} cm` : '',
            cantidad: cot.cantidad || 0,
            valorUnitario: parseFloat(cot.valor_unitario_efectivo ?? cot.valor_unitario_override) || vuParam,
            valorTotal: parseFloat(cot.valor_total_efectivo ?? cot.valor_total_override) || vtParam,
          })],
        })
      }).catch(console.error)
    }
  }, [id])

  const updateItem = (idx, patch) => {
    setData(prev => {
      const items = prev.items.map((item, i) => {
        if (i !== idx) return item
        const updated = { ...item, ...patch }
        if (patch.valorUnitario !== undefined || patch.cantidad !== undefined) {
          updated.valorTotal = Math.round((updated.valorUnitario || 0) * (updated.cantidad || 0))
        }
        return updated
      })
      return { ...prev, items }
    })
  }

  const removeItem = (idx) => setData(prev => ({
    ...prev,
    items: prev.items.filter((_, i) => i !== idx),
  }))

  const handleImport = async (cotId) => {
    setShowImport(false)
    try {
      const cot = await getCotizacion(cotId)
      const ancho = parseFloat(cot.molde_ancho) || 0
      const alto = parseFloat(cot.molde_alto) || 0
      const imported = newItem({
        cotizacion: cot.id,
        cotizacionNumero: cot.numero || '',
        referencia: cot.referencia || '',
        descripcion: cot.observaciones || '',
        tamanoDisplay: ancho > 0 && alto > 0 ? `${ancho} × ${alto} cm` : '',
        cantidad: cot.cantidad || 0,
        valorUnitario: parseFloat(cot.valor_unitario_efectivo ?? cot.valor_unitario_override) || 0,
        valorTotal: parseFloat(cot.valor_total_efectivo ?? cot.valor_total_override) || 0,
      })
      if (importTarget !== null) {
        setData(prev => ({
          ...prev,
          items: prev.items.map((item, i) => i === importTarget ? imported : item),
        }))
        setImportTarget(null)
      } else {
        setData(prev => ({ ...prev, items: [...prev.items, imported] }))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      let clienteId = d.clienteId
      if (!clienteId) {
        if (!d.cliente.trim()) throw new Error('El campo Cliente es obligatorio')
        const newCliente = await createCliente({ nombre: d.cliente.trim(), tipo: 'final', email: d.clienteEmail || '' })
        clienteId = newCliente.id
        set({ clienteId })
      }
      const payload = stateToApi({ ...d, clienteId })
      let result
      if (!d.id) {
        result = await createDocumento(payload)
        window.history.replaceState(null, '', `/documentos/${result.id}`)
      } else {
        result = await updateDocumento(d.id, payload)
      }
      set({ id: result.id, numero: result.numero || d.numero, estado: result.estado || d.estado })
      clearTimeout(toastRef.current)
      setToast('Documento guardado')
      toastRef.current = setTimeout(() => setToast(null), 3000)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async () => {
    if (!d.id) { setSaveError('Guarda el documento primero'); return }
    setDownloading(true)
    try {
      const r = await pdfDocumento(d.id)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      triggerBlobDownload(blob, `Cotizacion_${d.numero}.pdf`)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  const handleDelete = async () => {
    if (!d.id) { navigate('/'); return }
    try {
      await deleteDocumento(d.id)
      navigate('/')
    } catch (e) {
      setSaveError(e.message)
    }
  }

  if (loading) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand"><div className="mark">TI</div><div className="biz">Troqueles INK</div></div>
        </div>
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando documento…</div>
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
          <button className="btn" style={{ padding: '2px 8px', fontSize: 12, gap: 4 }} onClick={() => navigate('/')}>
            <Icon.ArrowLeft /> Cotizaciones
          </button>
          <span className="div">/</span>
          <div className="mod mono">{d.numero}</div>
          {d.estado === 'enviado' && (
            <span className="badge sent" style={{ marginLeft: 8 }}><span className="dot"></span>Enviado</span>
          )}
        </div>
        <div className="topbar-right">
          {saveError && <span style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>Error: {saveError}</span>}
          <div className="userchip">
            <div className="av">JR</div>
            <div>
              <div style={{ color: 'var(--ink)', fontWeight: 500 }}>Jessica</div>
              <div className="role">Atención al cliente · Admin</div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Cotización al cliente</h1>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
            Documento sin costos ni márgenes — este es el que recibe el cliente
          </div>
        </div>

        {/* Meta section */}
        <div className="section open" style={{ marginBottom: 16 }}>
          <div className="section-header" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 12, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Información general
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label className="field-label">Cliente</label>
              <ClienteField
                value={d.cliente}
                clienteId={d.clienteId}
                onChange={v => set({ cliente: v, clienteId: null, clienteEmail: '', clienteTelefono: '', clienteNit: '' })}
                onSelect={(id, nombre, email, telefono, nit) => set({
                  clienteId: id, cliente: nombre || d.cliente,
                  clienteEmail: email, clienteTelefono: telefono, clienteNit: nit,
                })}
              />
              {/* Client detail chips */}
              {d.clienteId && (d.clienteNit || d.clienteTelefono || d.clienteEmail) && (
                <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                  {d.clienteNit && (
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>NIT/CC</span> {d.clienteNit}
                    </span>
                  )}
                  {d.clienteTelefono && (
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Tel.</span> {d.clienteTelefono}
                    </span>
                  )}
                  {d.clienteEmail && (
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Email</span> {d.clienteEmail}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div style={{ flex: '0 0 160px' }}>
              <label className="field-label">Fecha</label>
              <input className="input" type="date" value={d.fecha} onChange={e => set({ fecha: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label className="field-label">Tiempo de entrega</label>
              <input className="input" value={d.tiempoEntrega} onChange={e => set({ tiempoEntrega: e.target.value })} />
            </div>
          </div>
        </div>

        {/* Items section */}
        <div className="section open" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Productos / referencias
            </span>
            <button className="btn accent" style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => { setImportTarget(null); setShowImport(true) }}>
              <Icon.Plus /> Importar cotización
            </button>
          </div>

          {d.items.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin productos</div>
              <div style={{ fontSize: 12 }}>
                {d.clienteId
                  ? 'Importa una cotización del cliente para agregar productos.'
                  : 'Selecciona un cliente e importa sus cotizaciones para agregar productos.'}
              </div>
            </div>
          ) : (
            d.items.map((item, idx) => (
              <div key={item._key} style={{
                borderBottom: idx < d.items.length - 1 ? '1px solid var(--border)' : 'none',
                padding: '14px 16px',
                borderLeft: '3px solid var(--accent)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Producto {idx + 1}
                    {item.cotizacionNumero && (
                      <span className="mono" style={{ background: 'var(--surface-2)', padding: '1px 6px', fontSize: 10, color: 'var(--accent)', borderRadius: 3 }}>
                        {item.cotizacionNumero}
                      </span>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }}
                      onClick={() => { setImportTarget(idx); setShowImport(true) }}>
                      Reemplazar
                    </button>
                    <button className="btn" style={{ padding: '2px 7px', color: 'var(--danger, #c0392b)', borderColor: 'transparent' }}
                      onClick={() => removeItem(idx)}>
                      <Icon.Trash />
                    </button>
                  </div>
                </div>

                {/* Row 1: referencia + tamaño */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '2 1 200px' }}>
                    <label className="field-label">Referencia</label>
                    <input className="input" value={item.referencia}
                      onChange={e => updateItem(idx, { referencia: e.target.value })} />
                  </div>
                  <div style={{ flex: '1 1 160px' }}>
                    <label className="field-label">Tamaño</label>
                    <input className="input" placeholder="ej. 20×15×10 cm"
                      value={item.tamanoDisplay}
                      onChange={e => updateItem(idx, { tamanoDisplay: e.target.value })} />
                  </div>
                </div>

                {/* Row 2: descripción */}
                <div style={{ marginBottom: 10 }}>
                  <label className="field-label">Descripción del producto</label>
                  <textarea className="textarea" rows={2}
                    placeholder="ej. Elaborada en cartón M 270 gramos, impresión 1 color (CMYK) sin acabados"
                    value={item.descripcion}
                    onChange={e => updateItem(idx, { descripcion: e.target.value })} />
                </div>

                {/* Row 3: cantidad + precio */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: '0 0 120px' }}>
                    <label className="field-label">Cantidad</label>
                    <input className="input mono" type="number" min="0"
                      value={item.cantidad}
                      onChange={e => updateItem(idx, { cantidad: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div style={{ flex: '0 0 160px' }}>
                    <label className="field-label">Valor unitario</label>
                    <MoneyInput value={item.valorUnitario}
                      onChange={v => updateItem(idx, { valorUnitario: v })} />
                  </div>
                  <div style={{ flex: '0 0 180px' }}>
                    <label className="field-label">Valor total</label>
                    <MoneyInput value={item.valorTotal}
                      onChange={v => updateItem(idx, { valorTotal: v })} />
                  </div>
                  <div style={{ flex: '1 1 auto', color: 'var(--ink-3)', fontSize: 12, paddingBottom: 2 }}>
                    auto: {fmtCOP(item.cantidad * item.valorUnitario)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Payment conditions */}
        <div className="section open" style={{ marginBottom: 16 }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 12, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Condiciones comerciales
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label className="field-label">Forma de pago</label>
              <select className="input" value={d.condicionPago} onChange={e => set({ condicionPago: e.target.value })}>
                {CONDICIONES_PAGO.map(c => (
                  <option key={c.id} value={c.id}>{c.lbl}</option>
                ))}
              </select>
            </div>
            {d.condicionPago === 'custom' && (
              <div style={{ flex: '2 1 260px' }}>
                <label className="field-label">Condición personalizada</label>
                <input className="input" value={d.condicionCustom}
                  onChange={e => set({ condicionCustom: e.target.value })} />
              </div>
            )}
          </div>
        </div>

        {/* Nota */}
        <div className="section open" style={{ marginBottom: 24 }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 12, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Nota al pie
          </div>
          <div style={{ padding: '14px 16px' }}>
            <textarea className="textarea" rows={3} value={d.nota}
              onChange={e => set({ nota: e.target.value })} />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn accent" style={{ flex: '1 1 auto', justifyContent: 'center' }}
            onClick={save} disabled={saving}>
            <Icon.Save /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button className="btn" style={{ flex: '1 1 auto', justifyContent: 'center' }}
            onClick={handleDownload} disabled={downloading || !d.id}>
            <Icon.Print /> {downloading ? 'Generando…' : 'Descargar PDF'}
          </button>
          <button className="btn" style={{ flex: '1 1 auto', justifyContent: 'center' }}
            onClick={() => { if (!d.id) { setSaveError('Guarda el documento primero'); return }; setShowSend(true) }}>
            <Icon.Send /> Enviar correo
          </button>
          {d.id && (
            confirmDelete ? (
              <>
                <button className="btn" style={{ background: 'var(--danger, #c0392b)', color: '#fff', borderColor: 'var(--danger, #c0392b)' }}
                  onClick={handleDelete}>
                  Confirmar eliminar
                </button>
                <button className="btn" onClick={() => setConfirmDelete(false)}>Cancelar</button>
              </>
            ) : (
              <button className="btn" style={{ color: 'var(--danger, #c0392b)', borderColor: 'transparent' }}
                onClick={() => setConfirmDelete(true)}>
                <Icon.Trash />
              </button>
            )
          )}
        </div>
      </div>

      {/* Modals */}
      {showImport && (
        <ImportCotizacionModal
          clienteId={d.clienteId}
          onImport={handleImport}
          onClose={() => { setShowImport(false); setImportTarget(null) }}
        />
      )}
      {showSend && (
        <SendModal
          doc={d}
          onSend={(email, extras) => enviarDocumento(d.id, email, extras)}
          onClose={() => setShowSend(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#1a4a2e', color: '#fff', padding: '10px 22px',
          borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ✓ {toast}
        </div>
      )}
    </div>
  )
}
