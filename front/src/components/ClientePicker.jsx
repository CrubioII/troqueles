import { useRef, useState } from 'react'
import { getClientes, createCliente } from '../api'
import { exactClientMatch } from '../lib/clienteDedup'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))

const ROW = { padding: '9px 12px', cursor: 'pointer', fontSize: 13 }
const hoverOn = (e) => { e.currentTarget.style.background = 'var(--surface-2)' }
const hoverOff = (e) => { e.currentTarget.style.background = 'transparent' }

// Search existing clients, or create a new one when it isn't registered.
// `value` is { id, nombre } or null; typing clears the selection until a
// suggestion is chosen, the text matches one client exactly, or a new client
// is created. Creating goes through the backend's near-duplicate guard
// (409 cliente_similar): the worker either picks the existing one or confirms.
export default function ClientePicker({ value, onChange, placeholder = 'Buscar o crear cliente…' }) {
  const [texto, setTexto] = useState(value?.nombre || '')
  const [sugerencias, setSugerencias] = useState([])
  const [abierto, setAbierto] = useState(false)
  const [similares, setSimilares] = useState(null)   // candidates from a 409
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState(null)
  const version = useRef(0)

  const nombre = texto.trim()
  const puedeBuscar = nombre.length >= 2

  const elegir = (c) => {
    version.current += 1
    setTexto(c.nombre)
    setAbierto(false)
    setSimilares(null)
    setError(null)
    onChange({ id: c.id, nombre: c.nombre })
  }

  const buscar = (q) => {
    setTexto(q)
    setSimilares(null)
    setError(null)
    onChange(null)
    const v = ++version.current
    if (!q || q.trim().length < 2) { setSugerencias([]); setAbierto(false); return }
    getClientes(q)
      .then(d => {
        if (v !== version.current) return
        const list = asList(d)
        const exacto = exactClientMatch(q, list)
        if (exacto) { elegir(exacto); return }
        setSugerencias(list)
        setAbierto(true)
      })
      .catch(() => { if (v === version.current) { setSugerencias([]); setAbierto(true) } })
  }

  const crear = async (confirmar = false) => {
    if (!puedeBuscar || creando) return
    setCreando(true)
    setError(null)
    try {
      const c = await createCliente({ nombre, confirmar_nuevo: confirmar })
      elegir(c)
    } catch (e) {
      const candidatos = e.body?.candidatos
      if (e.code === 'cliente_similar' && candidatos?.length) {
        setAbierto(false)
        setSimilares(candidatos)
      } else {
        setError(e.message || 'No se pudo crear el cliente.')
      }
    } finally {
      setCreando(false)
    }
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
        onFocus={() => puedeBuscar && !value && !similares && setAbierto(true)}
      />
      {abierto && puedeBuscar && !value && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, marginTop: 2,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto',
        }}>
          {sugerencias.map(c => (
            <div key={c.id} onMouseDown={() => elegir(c)} style={ROW} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
              {c.nombre}
            </div>
          ))}
          <div
            onMouseDown={() => crear(false)}
            style={{ ...ROW, fontWeight: 600, color: 'var(--accent, #B8541C)', borderTop: sugerencias.length ? '1px solid var(--line)' : 'none' }}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff}
          >
            {creando ? 'Creando…' : `+ Crear cliente nuevo «${nombre}»`}
          </div>
        </div>
      )}
      {similares && (
        <div style={{
          marginTop: 6, padding: '8px 10px', borderRadius: 6, fontSize: 12,
          background: 'var(--warn-soft, #fef6e7)', color: 'var(--ink-2)',
        }}>
          <div style={{ marginBottom: 6 }}>Ya existe un cliente con un nombre parecido. ¿Es alguno de estos?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {similares.map(c => (
              <button key={c.id} type="button" className="btn" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => elegir(c)}>
                {c.nombre}
              </button>
            ))}
            <button type="button" className="btn accent" style={{ fontSize: 12, padding: '3px 8px' }} disabled={creando} onClick={() => crear(true)}>
              {creando ? 'Creando…' : `No, crear «${nombre}»`}
            </button>
          </div>
        </div>
      )}
      {value && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>✓ Cliente seleccionado</div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--danger, #c0392b)', marginTop: 4 }}>{error}</div>}
    </div>
  )
}
