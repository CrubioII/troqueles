import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import GroupedIntegerInput from '../components/GroupedIntegerInput'
import {
  ESTADOS_FACTURA as ESTADOS, ESTADO_FACTURA_POR_ID as ESTADO_POR_ID, TRABAJOS, NOMBRE_TRABAJO,
  hoyISO, fmtFecha, money, descargar,
} from '../lib/facturacion'
import {
  getFacturacionPendientes, getFacturas, getSiguienteNumeroFactura, createFactura,
  updateFactura, pdfRemisionFacturacion,
} from '../api'

// Módulo de la contadora. Pendientes = remisiones ya emitidas (con su número
// REM-, sin esperar la liquidación del Admin) que no tienen factura;
// al registrar el N° de factura y su total pasan al Historial, donde lleva el
// estado (por cobrar / pagada / cancelada). Ver back/cotizaciones/facturacion_views.py.

const TABS = [
  { id: 'pendientes', label: 'Pendientes' },
  { id: 'historial', label: 'Historial' },
]

const FECHA_MODOS = [
  { id: '', label: 'Cualquier fecha' },
  { id: 'dia', label: 'El día' },
  { id: 'desde', label: 'Desde (en adelante)' },
  { id: 'hasta', label: 'Hasta (y antes)' },
  { id: 'entre', label: 'Entre' },
]

const FILTROS_VACIOS = { cliente: '', trabajo: '', fechaModo: '', fechaA: '', fechaB: '', estado: '', numero: '' }

// Traduce el estado de la barra de filtros a los query params del backend.
function filtrosAParams(f, tab) {
  // Pendientes no lleva filtros de servidor: solo el buscador local.
  if (tab !== 'historial') return {}
  const p = { cliente: f.cliente.trim(), trabajo: f.trabajo }
  if (f.fechaModo === 'dia' && f.fechaA) p.fecha = f.fechaA
  if ((f.fechaModo === 'desde' || f.fechaModo === 'entre') && f.fechaA) p.fecha_after = f.fechaA
  if (f.fechaModo === 'hasta' && f.fechaA) p.fecha_before = f.fechaA
  if (f.fechaModo === 'entre' && f.fechaB) p.fecha_before = f.fechaB
  if (tab === 'historial') {
    if (f.estado) p.estado = f.estado
    if (f.numero.trim()) p.numero = f.numero.trim()
  }
  return p
}

const th = (align = 'left') => ({
  padding: '10px 14px', textAlign: align, fontWeight: 600, fontSize: 11, color: 'var(--ink-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
})
const td = { padding: '11px 14px', verticalAlign: 'top' }

// ─────────────── Orden de las columnas ───────────────

// Número del consecutivo como entero (REM-0757 → 757) para que el orden no
// dependa del texto (REM-9999 < REM-10000).
const numDe = (v) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d ? Number(d) : null
}
const textoDe = (v) => (v || '').toString().trim()
const cmpTexto = (a, b) => textoDe(a).localeCompare(textoDe(b), 'es', { sensitivity: 'base', numeric: true })
const cmpNum = (a, b) => (a ?? -Infinity) - (b ?? -Infinity)

// Por columna: cómo se compara (ascendente). El desempate siempre es el consecutivo.
const ORDEN_PENDIENTES = {
  fecha: (a, b) => cmpTexto(a.fecha, b.fecha),
  numero: (a, b) => cmpNum(numDe(a.numero), numDe(b.numero)),
  cliente: (a, b) => cmpTexto(a.cliente_nombre, b.cliente_nombre),
  referencia: (a, b) => cmpTexto(a.referencias?.[0], b.referencias?.[0]),
  trabajo: (a, b) => cmpTexto(a.trabajos?.map(t => NOMBRE_TRABAJO[t] || t).join(), b.trabajos?.map(t => NOMBRE_TRABAJO[t] || t).join()),
  valor: (a, b) => Number(a.total || 0) - Number(b.total || 0),
}
const ORDEN_HISTORIAL = {
  numero: (a, b) => cmpNum(a.numero, b.numero),
  fecha: (a, b) => cmpTexto(a.fecha, b.fecha),
  cliente: (a, b) => cmpTexto(a.cliente_nombre, b.cliente_nombre),
  referencia: (a, b) => cmpTexto(a.referencias?.[0], b.referencias?.[0]),
  trabajo: (a, b) => cmpTexto(a.trabajos?.map(t => NOMBRE_TRABAJO[t] || t).join(), b.trabajos?.map(t => NOMBRE_TRABAJO[t] || t).join()),
  remisiones: (a, b) => cmpNum(numDe(a.remisiones?.[0]?.numero), numDe(b.remisiones?.[0]?.numero)),
  total: (a, b) => Number(a.total || 0) - Number(b.total || 0),
  estado: (a, b) => cmpTexto(ESTADO_POR_ID[a.estado]?.label, ESTADO_POR_ID[b.estado]?.label),
}
// Lo más reciente arriba por defecto.
const ORDEN_DEFECTO = { campo: 'numero', dir: 'desc' }

function ordenar(rows, orden, comparadores) {
  const cmp = comparadores[orden.campo] || comparadores.numero
  const signo = orden.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => (cmp(a, b) || comparadores.numero(a, b)) * signo)
}

// La contadora elige el orden y se recuerda en este navegador (por pestaña).
function useOrden(clave) {
  const [orden, setOrden] = useState(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(clave))
      if (guardado?.campo && (guardado.dir === 'asc' || guardado.dir === 'desc')) return guardado
    } catch { /* sin almacenamiento: orden por defecto */ }
    return ORDEN_DEFECTO
  })
  const cambiar = (campo) => setOrden(prev => {
    // Misma columna: invierte. Otra: textos A→Z, números/fechas lo más reciente o mayor primero.
    const dirInicial = ['cliente', 'referencia', 'trabajo', 'estado'].includes(campo) ? 'asc' : 'desc'
    const next = prev.campo === campo
      ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { campo, dir: dirInicial }
    try { localStorage.setItem(clave, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })
  return [orden, cambiar]
}

function ThOrden({ campo, orden, onOrden, align = 'left', children }) {
  const activo = orden.campo === campo
  const flecha = activo ? (orden.dir === 'asc' ? '▲' : '▼') : '↕'
  return (
    <th style={th(align)} aria-sort={activo ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button" onClick={() => onOrden(campo)}
        title={activo ? (orden.dir === 'asc' ? 'Orden ascendente · clic para invertir' : 'Orden descendente · clic para invertir') : 'Ordenar por esta columna'}
        style={{
          all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
          color: activo ? 'var(--ink)' : 'inherit', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit',
        }}
      >
        {children}
        <span aria-hidden="true" style={{ fontSize: 9, opacity: activo ? 1 : 0.45 }}>{flecha}</span>
      </button>
    </th>
  )
}

function Referencias({ refs }) {
  if (!refs?.length) return <span style={{ color: 'var(--ink-3)' }}>—</span>
  return (
    <div title={refs.join('\n')} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
      {refs.join(' · ')}
    </div>
  )
}

function Trabajo({ trabajos }) {
  if (!trabajos?.length) return <span style={{ color: 'var(--ink-3)' }}>—</span>
  const items = trabajos.map(t => NOMBRE_TRABAJO[t] || t)
  return (
    <div title={items.join('\n')} style={{
      fontSize: 12, color: 'var(--ink-2)', maxWidth: 260,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {items.join(' · ')}
    </div>
  )
}

// ─────────────── Barra de filtros ───────────────

// Solo Historial: Pendientes tiene un buscador de texto simple.
function FiltrosBar({ filtros, setFiltros, clientes, onLimpiar }) {
  const set = (k) => (e) => setFiltros(f => ({ ...f, [k]: e.target.value }))
  const hayFiltros = Object.values(filtros).some(Boolean)
  const label = { fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 4, display: 'block' }
  return (
    <div className="section open" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <label style={label}>Cliente</label>
          <input className="input" list="facturacion-clientes" placeholder="Buscar cliente por nombre" value={filtros.cliente} onChange={set('cliente')} />
          <datalist id="facturacion-clientes">
            {clientes.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label style={label}>Trabajo realizado</label>
          <select className="input" value={filtros.trabajo} onChange={set('trabajo')}>
            <option value="">Todos</option>
            {TRABAJOS.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Fecha de factura</label>
          <select className="input" value={filtros.fechaModo} onChange={set('fechaModo')}>
            {FECHA_MODOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        {filtros.fechaModo && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" className="input" value={filtros.fechaA} onChange={set('fechaA')} aria-label="Fecha" />
            {filtros.fechaModo === 'entre' && (
              <>
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>y</span>
                <input type="date" className="input" value={filtros.fechaB} onChange={set('fechaB')} aria-label="Fecha final" />
              </>
            )}
          </div>
        )}
        <div>
          <label style={label}>Estado</label>
          <select className="input" value={filtros.estado} onChange={set('estado')}>
            <option value="">Todos</option>
            {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>N° factura</label>
          <input className="input mono" placeholder="Ej. FAC-0012" value={filtros.numero} onChange={set('numero')} />
        </div>
        {hayFiltros && (
          <div>
            <button type="button" className="btn ghost sm" onClick={onLimpiar}>
              <Icon.X width="11" height="11" /> Limpiar filtros
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────── Modal registrar / editar factura ───────────────

function FacturaModal({ modo, remisiones, factura, onClose, onSaved }) {
  const esNueva = modo === 'nueva'
  const sugerido = useMemo(
    () => (esNueva ? remisiones.reduce((s, r) => s + Number(r.total || 0), 0) : Number(factura.total)),
    [esNueva, remisiones, factura],
  )
  // El consecutivo lo asigna el servidor (FAC-0001, FAC-0002…): solo se muestra.
  const [codigo, setCodigo] = useState(esNueva ? '' : factura.codigo)
  const [fecha, setFecha] = useState(esNueva ? hoyISO() : factura.fecha)
  const [total, setTotal] = useState(sugerido)
  const [obs, setObs] = useState(esNueva ? '' : factura.observaciones || '')
  // Al registrar ya está facturada: la contadora dice de una vez si quedó
  // por cobrar o pagada (sin valor por defecto, para que lo elija).
  const [estado, setEstado] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!esNueva) return
    getSiguienteNumeroFactura()
      .then(d => setCodigo(d.siguiente_codigo))
      .catch(() => {})
  }, [esNueva])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const guardar = async () => {
    setError(null)
    if (total === '' || total == null) { setError('Escribe el total de la factura.'); return }
    if (esNueva && !estado) { setError('Elige el estado de la factura: por cobrar o pagada.'); return }
    setSaving(true)
    try {
      const saved = esNueva
        ? await createFactura({
          remision_ids: remisiones.map(r => r.id), fecha, total, estado, observaciones: obs,
        })
        : await updateFactura(factura.id, { fecha, total, observaciones: obs })
      onSaved(saved)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const label = { fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 5, display: 'block' }
  const cliente = esNueva ? remisiones[0]?.cliente_nombre : factura.cliente_nombre

  return (
    <div className="cot-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div className="cot-modal" style={{ maxWidth: 520 }} role="dialog" aria-modal="true">
        <div className="cot-modal-header">
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {esNueva ? 'Registrar factura' : `Factura ${factura.codigo}`}
          </div>
          <button className="btn ghost sm" onClick={onClose} disabled={saving} aria-label="Cerrar"><Icon.X /></button>
        </div>
        <div className="cot-modal-body" style={{ padding: 24, display: 'grid', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            <div><strong>{cliente}</strong></div>
            {esNueva && (
              <div style={{ marginTop: 4, color: 'var(--ink-3)', fontSize: 12 }}>
                {remisiones.length === 1 ? 'Remisión ' : 'Remisiones '}
                {remisiones.map(r => r.numero || `OP ${r.orden_numero}`).join(', ')} · valor remisionado {money(sugerido)}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={label}>N° de factura</label>
              <div className="mono" style={{
                height: 32, display: 'flex', alignItems: 'center', padding: '0 10px', borderRadius: 6,
                background: 'var(--surface-2)', fontWeight: 700, fontSize: 14, color: 'var(--ink)',
              }}>
                {codigo || '…'}
              </div>
              {esNueva && (
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>Consecutivo automático.</div>
              )}
            </div>
            <div>
              <label style={label}>Fecha</label>
              <input type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
          </div>

          <div>
            <label style={label}>Total de la factura</label>
            <div className="input-affix">
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>$</span>
              <GroupedIntegerInput className="input mono" style={{ paddingLeft: 24 }} value={total} onChange={setTotal} />
            </div>
            {esNueva && Number(total) !== sugerido && total !== '' && (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                Difiere del valor remisionado ({money(sugerido)}).{' '}
                <button type="button" className="btn ghost sm" style={{ padding: '0 4px' }} onClick={() => setTotal(sugerido)}>Usar ese</button>
              </div>
            )}
          </div>

          {esNueva && (
            <div>
              <label style={label}>Estado de la factura</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {ESTADOS.filter(e => e.id !== 'cancelada').map(e => {
                  const activo = estado === e.id
                  return (
                    <button
                      key={e.id} type="button" onClick={() => setEstado(e.id)} aria-pressed={activo}
                      style={{
                        padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
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
            </div>
          )}

          <div>
            <label style={label}>Observaciones <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(opcional)</span></label>
            <textarea className="input" rows={2} value={obs} onChange={e => setObs(e.target.value)} />
          </div>

          {error && (
            <div className="note" style={{ color: 'var(--danger, #c0392b)' }}><Icon.Info /> {error}</div>
          )}
        </div>
        <div className="cot-modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving}>
            {saving ? <Icon.Spinner /> : <Icon.Check />} {esNueva ? 'Marcar como facturada' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────── Pendientes ───────────────

function PendientesTabla({ rows, seleccion, setSeleccion, onPdf, pdfId, orden, onOrden }) {
  const clienteSel = rows.find(r => seleccion.has(r.id))?.cliente_id
  const toggle = (r) => setSeleccion(prev => {
    const next = new Set(prev)
    if (next.has(r.id)) next.delete(r.id)
    else next.add(r.id)
    return next
  })
  return (
    <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <th style={{ ...th(), width: 1 }} />
          <ThOrden campo="fecha" orden={orden} onOrden={onOrden}>Fecha</ThOrden>
          <ThOrden campo="numero" orden={orden} onOrden={onOrden}>Remisión</ThOrden>
          <ThOrden campo="cliente" orden={orden} onOrden={onOrden}>Cliente</ThOrden>
          <ThOrden campo="referencia" orden={orden} onOrden={onOrden}>Referencia</ThOrden>
          <ThOrden campo="trabajo" orden={orden} onOrden={onOrden}>Trabajo realizado</ThOrden>
          <ThOrden campo="valor" orden={orden} onOrden={onOrden} align="right">Valor</ThOrden>
          <th style={{ ...th(), width: 1 }} />
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const checked = seleccion.has(r.id)
          const bloqueada = clienteSel != null && clienteSel !== r.cliente_id
          return (
            <tr
              key={r.id}
              onClick={() => { if (!bloqueada) toggle(r) }}
              title={bloqueada ? 'Solo puedes facturar juntas remisiones del mismo cliente' : undefined}
              style={{
                borderBottom: '1px solid var(--border)', cursor: bloqueada ? 'not-allowed' : 'pointer',
                background: checked ? 'var(--accent-soft)' : 'transparent', opacity: bloqueada ? 0.45 : 1,
              }}
            >
              <td style={td}>
                <input type="checkbox" checked={checked} disabled={bloqueada} onChange={() => toggle(r)} onClick={e => e.stopPropagation()} aria-label={`Seleccionar ${r.numero || r.orden_numero}`} />
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--ink-3)', fontSize: 12 }}>{fmtFecha(r.fecha)}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <span className="mono" style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 12 }}>{r.numero}</span>
                {r.orden_numero && <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.orden_numero}</div>}
              </td>
              <td style={{ ...td, fontWeight: 500 }}>{r.cliente_nombre}</td>
              <td style={td}><Referencias refs={r.referencias} /></td>
              <td style={td}><Trabajo trabajos={r.trabajos} /></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} className="mono">{money(r.total)}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button className="btn sm" title="Descargar la remisión con precios" onClick={e => { e.stopPropagation(); onPdf(r) }} disabled={pdfId === r.id}>
                  {pdfId === r.id ? <Icon.Spinner /> : <Icon.Print />} PDF
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ─────────────── Historial ───────────────

// Como en Remisiones: toda la fila abre la factura (/facturacion/:id), donde
// se ve el desglose completo y se edita. El estado se cambia también aquí.
function HistorialTabla({ rows, onEstado, onAbrir, busyId, orden, onOrden }) {
  return (
    <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <ThOrden campo="numero" orden={orden} onOrden={onOrden}>Factura</ThOrden>
          <ThOrden campo="fecha" orden={orden} onOrden={onOrden}>Fecha</ThOrden>
          <ThOrden campo="cliente" orden={orden} onOrden={onOrden}>Cliente</ThOrden>
          <ThOrden campo="referencia" orden={orden} onOrden={onOrden}>Referencia</ThOrden>
          <ThOrden campo="trabajo" orden={orden} onOrden={onOrden}>Trabajo realizado</ThOrden>
          <ThOrden campo="remisiones" orden={orden} onOrden={onOrden}>Remisiones</ThOrden>
          <ThOrden campo="total" orden={orden} onOrden={onOrden} align="right">Total</ThOrden>
          <ThOrden campo="estado" orden={orden} onOrden={onOrden}>Estado</ThOrden>
          <th style={{ ...th(), width: 1 }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((f, idx) => {
          const est = ESTADO_POR_ID[f.estado]
          const fondo = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.012)'
          return (
            <tr
              key={f.id}
              onClick={() => onAbrir(f)}
              style={{
                borderBottom: '1px solid var(--border)', cursor: 'pointer', background: fondo,
                opacity: f.estado === 'cancelada' ? 0.65 : 1, transition: 'background 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = fondo }}
            >
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <span className="mono" style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)', textDecoration: f.estado === 'cancelada' ? 'line-through' : 'none' }}>{f.codigo}</span>
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--ink-3)', fontSize: 12 }}>{fmtFecha(f.fecha)}</td>
              <td style={{ ...td, fontWeight: 500 }}>{f.cliente_nombre}</td>
              <td style={td}><Referencias refs={f.referencias} /></td>
              <td style={td}><Trabajo trabajos={f.trabajos} /></td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  {f.remisiones.map(r => r.numero).join(', ')}
                </span>
              </td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }} className="mono">{money(f.total)}</td>
              <td style={td} onClick={e => e.stopPropagation()}>
                <select
                  value={f.estado}
                  disabled={busyId === f.id}
                  onChange={e => onEstado(f, e.target.value)}
                  aria-label={`Estado de la factura ${f.codigo}`}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${est?.color || 'var(--line)'}33`, background: est?.soft, color: est?.color,
                  }}
                >
                  {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button className="btn" style={{ padding: '4px 10px', fontSize: 11 }} onClick={e => { e.stopPropagation(); onAbrir(f) }}>
                  Ver
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ResumenEstados({ totales, filtroEstado, onFiltrar }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
      {ESTADOS.map(e => {
        const activo = filtroEstado === e.id
        return (
          <button
            key={e.id} type="button" onClick={() => onFiltrar(activo ? '' : e.id)}
            style={{
              textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${activo ? e.color : 'var(--line)'}`, background: activo ? e.soft : 'var(--surface)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: e.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{e.label}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>{money(totales?.[e.id])}</div>
          </button>
        )
      })}
    </div>
  )
}

// ─────────────── Página ───────────────

export default function Facturacion() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('pendientes')
  const [filtros, setFiltros] = useState(FILTROS_VACIOS)
  const [params, setParams] = useState({ __tab: 'pendientes' })
  const [busqueda, setBusqueda] = useState('')
  const [data, setData] = useState({ pendientes: null, historial: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [seleccion, setSeleccion] = useState(() => new Set())
  const [modal, setModal] = useState(null)
  const [pdfId, setPdfId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [clientes, setClientes] = useState([])
  const debounceRef = useRef(null)
  const reqRef = useRef(0)
  const [ordenPend, setOrdenPend] = useOrden('facturacion.orden.pendientes')
  const [ordenHist, setOrdenHist] = useOrden('facturacion.orden.historial')

  // Texto con debounce; selects y fechas aplican igual de rápido (350 ms).
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const next = { ...filtrosAParams(filtros, tab), __tab: tab }
      // Same params → keep the object so the list is not reloaded for nothing.
      setParams(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [filtros, tab])

  const cargar = () => {
    const req = ++reqRef.current
    setLoading(true)
    setError(null)
    const fetcher = tab === 'pendientes' ? getFacturacionPendientes : getFacturas
    const { __tab, ...query } = params
    fetcher(query)
      .then(d => {
        if (req !== reqRef.current) return
        setData(prev => ({ ...prev, [tab]: d }))
        const nombres = (d.results || []).map(r => r.cliente_nombre)
        setClientes(prev => [...new Set([...prev, ...nombres])].sort((a, b) => a.localeCompare(b, 'es')))
      })
      .catch(e => { if (req === reqRef.current) setError(e.message) })
      .finally(() => { if (req === reqRef.current) setLoading(false) })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargar, [params])

  useEffect(() => { setSeleccion(new Set()) }, [tab, params])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 4000)
    return () => clearTimeout(t)
  }, [aviso])

  const cambiarTab = (id) => { if (id !== tab) setTab(id) }

  const actual = data[tab]
  const texto = busqueda.trim().toLowerCase()
  const filtradas = (actual?.results || []).filter(r => tab !== 'pendientes' || !texto || [
    r.cliente_nombre, r.numero, r.orden_numero, ...(r.referencias || []),
  ].some(v => (v || '').toLowerCase().includes(texto)))
  const rows = tab === 'pendientes'
    ? ordenar(filtradas, ordenPend, ORDEN_PENDIENTES)
    : ordenar(filtradas, ordenHist, ORDEN_HISTORIAL)
  const seleccionadas = (data.pendientes?.results || []).filter(r => seleccion.has(r.id))
  const totalSel = seleccionadas.reduce((s, r) => s + Number(r.total || 0), 0)

  const bajarPdf = async (rem) => {
    setPdfId(rem.id)
    try {
      await descargar(pdfRemisionFacturacion(rem.id), `Remision_${rem.numero}.pdf`)
    } catch (e) {
      setError(`No se pudo generar el PDF: ${e.message}`)
    } finally {
      setPdfId(null)
    }
  }

  const cambiarEstado = async (f, estado) => {
    if (estado === f.estado) return
    if (estado === 'cancelada' && !window.confirm(
      `¿Cancelar la factura ${f.codigo}? Conserva su número en el consecutivo y sus remisiones vuelven a Pendientes para facturarlas de nuevo.`,
    )) return
    setBusyId(f.id)
    try {
      await updateFactura(f.id, { estado })
      setAviso(`Factura ${f.codigo} → ${ESTADO_POR_ID[estado].label}`)
      cargar()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const count = rows.length

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><div className="mod">Facturación</div></div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(12px, 4vw, 28px) clamp(12px, 4vw, 24px)' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {TABS.map(t => (
            <button
              key={t.id} type="button" onClick={() => cambiarTab(t.id)}
              style={{
                padding: '7px 16px', fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
                color: tab === t.id ? 'var(--accent)' : 'var(--ink-3)', background: 'none', border: 'none',
                borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer', marginBottom: -1,
              }}
            >{t.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
              {tab === 'pendientes' ? 'Remisiones por facturar' : 'Historial de facturas'}
            </h1>
            {actual && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                {tab === 'historial'
                  ? `${count} ${count === 1 ? 'factura' : 'facturas'}`
                  : `${count} ${count === 1 ? 'remisión' : 'remisiones'}`}
                {tab === 'pendientes' && actual.sin_emitir > 0 && (
                  <span title="Producción aún no ha generado estas remisiones, así que no tienen consecutivo. Aparecen aquí con su número REM- en cuanto se generen.">
                    {' · '}{actual.sin_emitir} {actual.sin_emitir === 1 ? 'espera' : 'esperan'} que producción la{actual.sin_emitir === 1 ? '' : 's'} emita
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {tab === 'pendientes' ? (
          <div className="input-affix" style={{ marginBottom: 16, maxWidth: 420 }}>
            <input
              className="input" style={{ paddingLeft: 34 }} value={busqueda}
              placeholder="Buscar por cliente o referencia"
              onChange={e => setBusqueda(e.target.value)}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', pointerEvents: 'none' }}>
              <Icon.Search />
            </span>
          </div>
        ) : (
          <FiltrosBar
            filtros={filtros} setFiltros={setFiltros} clientes={clientes}
            onLimpiar={() => setFiltros(FILTROS_VACIOS)}
          />
        )}

        {tab === 'historial' && actual && (
          <ResumenEstados
            totales={actual.totales} filtroEstado={filtros.estado}
            onFiltrar={estado => setFiltros(f => ({ ...f, estado }))}
          />
        )}

        {error && (
          <div className="note" style={{ marginBottom: 16, color: 'var(--danger, #c0392b)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span><Icon.Info /> {error}</span>
            <button className="btn ghost sm" onClick={() => setError(null)} aria-label="Cerrar"><Icon.X /></button>
          </div>
        )}
        {aviso && (
          <div className="note" style={{ marginBottom: 16 }}><Icon.Check /> {aviso}</div>
        )}

        {tab === 'pendientes' && seleccionadas.length > 0 && (
          <div style={{
            position: 'sticky', top: 8, zIndex: 5, marginBottom: 12, padding: '10px 14px', borderRadius: 10,
            background: 'var(--ink)', color: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 13 }}>
              {seleccionadas.length} {seleccionadas.length === 1 ? 'remisión' : 'remisiones'} de <strong>{seleccionadas[0].cliente_nombre}</strong> · {money(totalSel)}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn sm ghost" style={{ color: 'inherit' }} onClick={() => setSeleccion(new Set())}>Quitar selección</button>
            <button className="btn sm accent" onClick={() => setModal({ modo: 'nueva', remisiones: seleccionadas })}>
              <Icon.Check /> Registrar factura
            </button>
          </div>
        )}

        <div className="section open" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
          {loading && actual && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--accent)', zIndex: 2 }} />
          )}
          {!actual && loading ? (
            <div style={{ padding: 32, color: 'var(--ink-3)', textAlign: 'center' }}><Icon.Spinner /> Cargando…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {tab === 'pendientes' ? (texto ? 'Sin resultados' : 'Nada pendiente por facturar') : 'Sin facturas'}
              </div>
              <div style={{ fontSize: 12 }}>
                {tab === 'pendientes'
                  ? (texto ? 'Ninguna remisión pendiente coincide con la búsqueda.' : 'Las remisiones aparecen aquí en cuanto producción las emite (con su número REM-).')
                  : 'Las facturas que registres en Pendientes quedan aquí.'}
              </div>
            </div>
          ) : (
            <div className="table-scroll">
              {tab === 'pendientes' ? (
                <PendientesTabla
                  rows={rows} seleccion={seleccion} setSeleccion={setSeleccion} onPdf={bajarPdf} pdfId={pdfId}
                  orden={ordenPend} onOrden={setOrdenPend}
                />
              ) : (
                <HistorialTabla
                  rows={rows} onEstado={cambiarEstado} onAbrir={f => navigate(`/facturacion/${f.id}`)} busyId={busyId}
                  orden={ordenHist} onOrden={setOrdenHist}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {modal && (
        <FacturaModal
          modo={modal.modo} remisiones={modal.remisiones || []} factura={modal.factura}
          onClose={() => setModal(null)}
          onSaved={saved => {
            setModal(null)
            setSeleccion(new Set())
            setAviso(modal.modo === 'nueva' ? `Factura ${saved.codigo} registrada · pasó al Historial` : `Factura ${saved.codigo} actualizada`)
            cargar()
          }}
        />
      )}
    </div>
  )
}
