import { useState, useMemo, useEffect, useRef } from 'react'
import { Icon } from './Icons'

export { useState, useMemo, useEffect, useRef }

// ============ Formatting helpers ============
export const fmtCOP = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '$ 0'
  return '$ ' + Math.round(n).toLocaleString('es-CO')
}
export const fmtNum = (n, d = 0) => {
  if (n === null || n === undefined || isNaN(n)) return '0'
  return Number(n).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })
}

// ============ Static catalogs (UI logic, not DB data) ============
export const PLIEGO_SIZES = [
  { id: '70x100', w: 70, h: 100, label: '70 × 100 cm  (Estándar)' },
  { id: '61x86',  w: 61, h: 86,  label: '61 × 86 cm  (Medio pliego)' },
  { id: '50x70',  w: 50, h: 70,  label: '50 × 70 cm  (Cuarto)' },
  { id: 'custom', w: 0,  h: 0,   label: 'Personalizado…' },
]
export const DISENADORES = ['Oscar', 'Camilo', 'Laura', 'Diana']

// ============ Process definitions ============
export const PROCESS_GROUPS = [
  {
    id: 'impresion',
    titulo: 'Impresión / Planchas',
    procesos: [
      {
        id: 'impresion',
        nombre: 'Impresión por colores',
        desc: 'Planchas + máquina · Tiro y retiro se cobran por separado',
        defaultCost: 0,
        customLayout: true,
        extras: {
          tiroActive: true,
          tiroTipo: 'Full Color',
          tiroColores: 'CMYK',
          costoTiro: 280000,
          retiroActive: false,
          retiroTipo: '1 color',
          retiroColores: 'Negro',
          costoRetiro: 120000,
        },
      },
    ],
  },
  {
    id: 'acabados',
    titulo: 'Acabados superficiales',
    procesos: [
      { id: 'laminado',   nombre: 'Laminado',   desc: 'Costo por m²', defaultCost: 0, extras: { tipoLaminado: 'Mate', precioM2: 4200 }, autoCalc: true },
      { id: 'uvTotal',    nombre: 'UV total',    defaultCost: 95000 },
      { id: 'uvParcial',  nombre: 'UV parcial',  defaultCost: 145000 },
      { id: 'estampado',  nombre: 'Estampado',   desc: 'Gestionar cliset con terceros', defaultCost: 220000, note: 'Implica gestionar un cliset con terceros — incluir tiempos.' },
      { id: 'cliset',     nombre: 'Cliset',      defaultCost: 110000 },
    ],
  },
  {
    id: 'corte',
    titulo: 'Corte y forma',
    procesos: [
      { id: 'troquel',    nombre: 'Troquel',    desc: 'Fabricación del molde', defaultCost: 320000 },
      { id: 'troquelado', nombre: 'Troquelado', desc: 'Corte con el molde',    defaultCost: 180000 },
      { id: 'positivo',   nombre: 'Positivo',   defaultCost: 45000 },
      { id: 'muestra',    nombre: 'Muestra',    defaultCost: 25000 },
    ],
  },
  {
    id: 'terminado',
    titulo: 'Terminado y entrega',
    procesos: [
      { id: 'terminado', nombre: 'Terminado', desc: 'Pegado, plegado, conteo', defaultCost: 120000 },
      { id: 'diseno',    nombre: 'Diseño',    defaultCost: 180000, extras: { disenador: 'Oscar' } },
      { id: 'pegante',   nombre: 'Pegante',   defaultCost: 35000 },
      { id: 'tinta',     nombre: 'Tinta',     defaultCost: 65000 },
      { id: 'cajas',     nombre: 'Cajas de empaque', defaultCost: 0, extras: { cantidad: 4, precioUnit: 8500 }, autoCalc: true },
      { id: 'envio',     nombre: 'Envío',     defaultCost: 45000 },
      { id: 'recogida',  nombre: 'Recogida',  defaultCost: 25000 },
      { id: 'otros',     nombre: 'Otros',     defaultCost: 0, extras: { descripcion: '' } },
    ],
  },
]

// ============ Status definitions ============
export const STATUS_DEFS = [
  { id: 'borrador',   label: 'Borrador',        cls: 'draft' },
  { id: 'enviada',    label: 'Enviada',          cls: 'sent' },
  { id: 'aprobada',   label: 'Aprobada',         cls: 'approved' },
  { id: 'rechazada',  label: 'Rechazada',        cls: 'rejected' },
  { id: 'convertida', label: 'Convertida a OP',  cls: 'converted' },
]

// ============ Payment conditions ============
export const CONDICIONES_PAGO = [
  { id: 'mismo',  lbl: 'Pago el mismo día', sub: 'Contra entrega' },
  { id: '8',      lbl: 'Pago en 8 días',    sub: 'Crédito corto' },
  { id: '30',     lbl: 'Pago en 30 días',   sub: 'Crédito estándar' },
  { id: 'custom', lbl: 'Personalizado',     sub: 'Otra condición' },
]

// ============ Sheet diagram (SVG) ============
export function SheetDiagram({ pliegoW, pliegoH, unitW, unitH, cols, rows, total }) {
  if (!pliegoW || !pliegoH || !unitW || !unitH || cols === 0 || rows === 0) {
    return (
      <div style={{
        aspectRatio: `${pliegoW || 1} / ${pliegoH || 1}`,
        background: 'white', border: '1px dashed var(--calc-line)',
        borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--ink-3)', fontSize: 11, padding: 24, textAlign: 'center',
      }}>
        Ingresa medidas válidas para ver el diagrama
      </div>
    )
  }
  const usedW = cols * unitW
  const usedH = rows * unitH
  const wastePctX = (pliegoW - usedW) / pliegoW
  const wastePctY = (pliegoH - usedH) / pliegoH
  const cells = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push({ r, c })

  return (
    <div style={{ position: 'relative', paddingTop: 22, paddingLeft: 24 }}>
      <div style={{
        position: 'absolute', top: 0, left: 24, right: 4, height: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 600,
        color: 'var(--calc-ink)',
      }}>
        <span style={{ color: 'var(--ink-3)', marginRight: 6 }}>↔</span>
        {pliegoW} cm
      </div>
      <div style={{
        position: 'absolute', top: 22, left: 0, bottom: 0, width: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 600,
        color: 'var(--calc-ink)',
        writingMode: 'vertical-rl',
        transform: 'rotate(180deg)',
      }}>
        <span style={{ color: 'var(--ink-3)', marginRight: 6 }}>↔</span>
        {pliegoH} cm
      </div>
      <svg viewBox={`0 0 ${pliegoW} ${pliegoH}`} style={{ width: '100%', display: 'block' }}>
        <rect x="0" y="0" width={pliegoW} height={pliegoH} fill="#FFFFFF" stroke="#2B4D5C" strokeWidth="0.4"/>
        <rect x="0" y="0" width={usedW} height={usedH} fill="rgba(184,84,28,0.04)" />
        {wastePctX > 0.01 && <rect x={usedW} y="0" width={pliegoW - usedW} height={pliegoH} fill="url(#stripes)" opacity="0.5"/>}
        {wastePctY > 0.01 && <rect x="0" y={usedH} width={usedW} height={pliegoH - usedH} fill="url(#stripes)" opacity="0.5"/>}
        <defs>
          <pattern id="stripes" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)">
            <line x1="0" y="0" x2="0" y2="3" stroke="#807A6E" strokeWidth="0.8"/>
          </pattern>
        </defs>
        {cells.map(({ r, c }, i) => (
          <g key={i}>
            <rect
              x={c * unitW} y={r * unitH}
              width={unitW} height={unitH}
              fill="rgba(184,84,28,0.12)"
              stroke="#B8541C" strokeWidth="0.3"
            />
            {unitW > 6 && unitH > 4 && (
              <text
                x={c * unitW + unitW / 2} y={r * unitH + unitH / 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize={Math.min(unitW, unitH) * 0.25}
                fill="#B8541C" fontFamily="JetBrains Mono, monospace" fontWeight="600"
              >{i + 1}</text>
            )}
          </g>
        ))}
      </svg>
      <div style={{
        position: 'absolute', top: 26, right: 4,
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid var(--calc-line)',
        borderRadius: 4, padding: '3px 7px',
        fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
        color: 'var(--calc-ink)', fontWeight: 600,
      }}>
        {cols} × {rows} = {total} u/pliego
      </div>
    </div>
  )
}

// ============ Section wrapper ============
export function Section({ num, title, desc, open, onToggle, locked, summary, children }) {
  return (
    <div className={'section' + (open ? ' open' : '') + (locked ? ' locked' : '')}>
      <div className="section-header" onClick={locked ? undefined : onToggle}>
        <div className="num">{num}</div>
        <div className="title">{title}</div>
        <div className="desc">· {desc}</div>
        {summary && <div className="section-summary">{summary}</div>}
        {!locked && <div className="chev"><Icon.Chev /></div>}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

// ============ Status badge picker ============
export function StatusPicker({ value, onChange }) {
  return (
    <div className="badge-status-picker">
      {STATUS_DEFS.map(s => (
        <span
          key={s.id}
          className={'badge ' + s.cls + (value === s.id ? ' active' : '')}
          onClick={() => onChange(s.id)}
        >
          <span className="dot"></span>
          {s.label}
        </span>
      ))}
    </div>
  )
}

// ============ Checkbox ============
export function Checkbox({ checked, onChange }) {
  return (
    <div className={'checkbox' + (checked ? ' checked' : '')} onClick={onChange}>
      {checked && <Icon.Check />}
    </div>
  )
}

// ============ Money input ============
export function MoneyInput({ value, onChange, className = '', style = {}, suffix = 'COP' }) {
  const display = Number(Math.round(value || 0)).toLocaleString('es-CO')
  return (
    <div className="input-affix" style={{ flex: style.flex }}>
      <input
        type="text"
        inputMode="numeric"
        className={'input mono ' + className}
        style={{ textAlign: 'right', paddingRight: 38, ...style }}
        value={display}
        onChange={(e) => {
          const v = parseInt(e.target.value.replace(/[^\d]/g, '')) || 0
          onChange(v)
        }}
      />
      {suffix && <span className="suffix" style={{ fontSize: 10 }}>{suffix}</span>}
    </div>
  )
}

// ============ Chip toggle ============
export function ChipToggle({ active, onClick, children }) {
  return (
    <button type="button" className={'chip-toggle' + (active ? ' active' : '')} onClick={onClick}>
      {children}
    </button>
  )
}

// ============ Numeric input — clears to empty, commits on blur ============
export function NumField({ value, onChange, step = 'any', className = '', style = {} }) {
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState('')
  const isInt = step === 1 || step === '1'
  return (
    <input
      type="text"
      inputMode={isInt ? 'numeric' : 'decimal'}
      className={'input mono ' + className}
      style={style}
      value={focused ? raw : (value || '')}
      onFocus={() => { setFocused(true); setRaw(value ? String(value) : '') }}
      onChange={e => {
        const filtered = isInt
          ? e.target.value.replace(/[^\d]/g, '')
          : e.target.value.replace(/[^\d.,]/g, '').replace(',', '.')
        setRaw(filtered)
        const n = parseFloat(filtered)
        if (!isNaN(n)) onChange(n)
      }}
      onBlur={e => {
        setFocused(false)
        onChange(parseFloat(e.target.value.replace(',', '.')) || 0)
      }}
    />
  )
}
