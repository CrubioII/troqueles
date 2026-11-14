import { useRef, useState } from 'react'
import { getClientes } from '../api'
import { exactClientMatch } from '../lib/clienteDedup'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))

// Picks an existing client only — no "create new" path. `value` is
// { id, nombre } or null; typing clears the selection until a suggestion is
// chosen (or the text matches one client exactly).
export default function ClientePicker({ value, onChange, placeholder = 'Buscar cliente registrado…' }) {
  const [texto, setTexto] = useState(value?.nombre || '')
  const [sugerencias, setSugerencias] = useState([])
  const [abierto, setAbierto] = useState(false)
  const [sinResultados, setSinResultados] = useState(false)
  const version = useRef(0)

  const elegir = (c) => {
    version.current += 1
    setTexto(c.nombre)
    setAbierto(false)
    setSinResultados(false)
    onChange({ id: c.id, nombre: c.nombre })
  }

  const buscar = (q) => {
    setTexto(q)
    onChange(null)
    const v = ++version.current
    if (!q || q.trim().length < 2) { setSugerencias([]); setAbierto(false); setSinResultados(false); return }
    getClientes(q)
      .then(d => {
        if (v !== version.current) return
        const list = asList(d)
        const exacto = exactClientMatch(q, list)
        if (exacto) { elegir(exacto); return }
        setSugerencias(list)
        setAbierto(list.length > 0)
        setSinResultados(list.length === 0)
      })
      .catch(() => { if (v === version.current) { setSugerencias([]); setAbierto(false) } })
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        style={{ width: '100%' }}
        placeholder={placeholder}
        value={texto}
        onChange={e => buscar(e.target.value)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onFocus={() => sugerencias.length > 0 && !value && setAbierto(true)}
      />
      {abierto && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, marginTop: 2,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto',
        }}>
          {sugerencias.map(c => (
            <div
              key={c.id}
              onMouseDown={() => elegir(c)}
              style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >{c.nombre}</div>
          ))}
        </div>
      )}
      {sinResultados && !value && (
        <div style={{ fontSize: 11, color: 'var(--danger, #c0392b)', marginTop: 4 }}>
          No hay clientes con ese nombre. Pide al administrador que lo registre.
        </div>
      )}
    </div>
  )
}
