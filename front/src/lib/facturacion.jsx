import { fmtCOP } from '../components/core'
import { saveBlob } from './download'

// Compartido entre Facturación (listas) y FacturaDetalle.

export const ESTADOS_FACTURA = [
  { id: 'por_cobrar', label: 'Por cobrar', color: '#9A5B00', soft: '#FFF3DC' },
  { id: 'pagada', label: 'Pagada', color: '#1F6B3A', soft: '#E3F4E8' },
  { id: 'cancelada', label: 'Cancelada', color: '#8A2B2B', soft: '#F8E3E3' },
]
export const ESTADO_FACTURA_POR_ID = Object.fromEntries(ESTADOS_FACTURA.map(e => [e.id, e]))

// "Trabajo realizado": solo los trabajos que se registran en el sistema
// (troquel + cadena). Espejo de TRABAJOS en back/cotizaciones/facturacion_views.py;
// el detalle de cada proceso está en la remisión.
export const TRABAJOS = [
  { id: 'troquel', nombre: 'Troquel' },
  { id: 'impresion', nombre: 'Impresión' },
  { id: 'laminado', nombre: 'Laminado' },
  { id: 'barnizado', nombre: 'Barnizado' },
  { id: 'troquelado', nombre: 'Troquelado' },
]
export const NOMBRE_TRABAJO = Object.fromEntries(TRABAJOS.map(t => [t.id, t.nombre]))

export const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const fmtFecha = (str) => {
  if (!str) return '—'
  // Fecha plana (YYYY-MM-DD): parsear local, no UTC, o sale el día anterior.
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const fmtFechaHora = (iso) => (iso
  ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '')

export const money = (v) => fmtCOP(Number(v || 0))

export async function descargar(responsePromise, fallbackName) {
  const r = await responsePromise
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(body?.error || `HTTP ${r.status}`)
  }
  const blob = await r.blob()
  const filename = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1]
  saveBlob(blob, filename || fallbackName)
}

export function EstadoPill({ estado }) {
  const e = ESTADO_FACTURA_POR_ID[estado]
  if (!e) return null
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
      background: e.soft, color: e.color, whiteSpace: 'nowrap',
    }}>{e.label}</span>
  )
}
