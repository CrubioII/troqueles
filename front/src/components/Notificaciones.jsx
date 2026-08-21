import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icons'
import { getNotificaciones, leerNotificacion, marcarNotificacionesLeidas } from '../api'
import { useSyncPolling } from '../lib/useSyncPolling'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))

const POPUP_MS = 8000

// "hace 5 min" / "hace 2 h" / fecha corta
function fmtRelativo(iso) {
  const d = new Date(iso)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

/**
 * Campana de notificaciones del Admin.
 *
 * Monta en el Layout, así que su polling cubre toda la aplicación: cuando entra
 * un aviso nuevo salta un popup, y si el Admin lo cierra el aviso queda en la
 * campana con el contador de pendientes.
 */
export function CampanaNotificaciones({ compact = false }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [abierto, setAbierto] = useState(false)
  const [popup, setPopup] = useState(null)
  const wrapRef = useRef(null)
  const popupTimer = useRef(null)
  // null hasta la primera carga: al abrir sesión con avisos viejos no debe
  // saltar el popup, solo cuando entra uno nuevo estando la pantalla abierta.
  const conocidosRef = useRef(null)

  const load = () => {
    getNotificaciones('?no_leidas=1')
      .then(d => {
        const lista = asList(d)
        setItems(lista)
        const ids = new Set(lista.map(n => n.id))
        if (conocidosRef.current !== null) {
          const nueva = lista.find(n => !conocidosRef.current.has(n.id))
          if (nueva) mostrarPopup(nueva)
        }
        conocidosRef.current = ids
      })
      .catch(() => {})
  }

  const mostrarPopup = (noti) => {
    setPopup(noti)
    clearTimeout(popupTimer.current)
    popupTimer.current = setTimeout(() => setPopup(null), POPUP_MS)
  }

  useEffect(() => {
    load()
    return () => clearTimeout(popupTimer.current)
  }, [])

  useSyncPolling({ notificaciones: load })

  // Cerrar el panel al hacer clic fuera
  useEffect(() => {
    if (!abierto) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setAbierto(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [abierto])

  const abrirNoti = async (noti) => {
    // Optimista: se marca leída al instante y se navega a la OP.
    setItems(prev => prev.filter(n => n.id !== noti.id))
    setPopup(p => (p && p.id === noti.id ? null : p))
    setAbierto(false)
    leerNotificacion(noti.id).catch(() => load())
    if (noti.orden) navigate(`/ordenes/${noti.orden}`)
  }

  const marcarTodas = async () => {
    setItems([])
    setPopup(null)
    try { await marcarNotificacionesLeidas() } catch { load() }
  }

  const n = items.length

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setAbierto(o => !o)}
        aria-label={n ? `${n} notificaciones sin leer` : 'Notificaciones'}
        style={{
          position: 'relative', background: 'transparent',
          border: compact ? 'none' : '1px solid var(--line)',
          borderRadius: compact ? 6 : 8,
          cursor: 'pointer', color: n ? 'var(--ink)' : 'var(--ink-3)',
          padding: compact ? 6 : '6px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          width: compact ? 'auto' : '100%', fontSize: 12,
        }}
      >
        <Icon.Bell width={compact ? 17 : 15} height={compact ? 17 : 15} />
        {!compact && <span>Notificaciones</span>}
        {n > 0 && (
          <span style={{
            position: 'absolute', top: compact ? 2 : 3, right: compact ? 2 : 6,
            minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8,
            background: 'var(--danger, #c0392b)', color: '#fff',
            fontSize: 9, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
          }}>
            {n > 9 ? '9+' : n}
          </span>
        )}
      </button>

      {abierto && (
        <div className="notif-panel" style={{
          position: 'absolute', zIndex: 500,
          [compact ? 'right' : 'left']: 0,
          [compact ? 'top' : 'bottom']: compact ? 'calc(100% + 6px)' : 'calc(100% + 6px)',
          width: 'min(320px, calc(100vw - 32px))',
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--line)',
            fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 8,
          }}>
            <span>Notificaciones</span>
            {n > 0 && (
              <button
                type="button"
                onClick={marcarTodas}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-3)' }}
              >
                Marcar todas como leídas
              </button>
            )}
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {n === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
                Sin notificaciones pendientes
              </div>
            ) : items.map(noti => (
              <button
                key={noti.id}
                type="button"
                onClick={() => abrirNoti(noti)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: 'transparent', border: 'none',
                  borderBottom: '1px solid var(--line)', padding: '10px 14px',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger, #c0392b)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{noti.titulo}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.4 }}>
                  {noti.mensaje}
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4 }}>
                  {fmtRelativo(noti.creada)}
                  {noti.creada_por_username ? ` · ${noti.creada_por_username}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Popup de llegada: interrumpe una vez; al cerrarlo el aviso sigue en la
          campana. `.floating-bar` ya centra abajo y respeta la barra inferior
          en móvil, así que no se le fija posición aquí. */}
      {popup && (
        <div className="floating-bar" style={{
          width: 'min(380px, calc(100vw - 24px))',
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderLeft: '4px solid var(--danger, #c0392b)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>⚠ {popup.titulo}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>{popup.mensaje}</div>
            {popup.orden && (
              <button
                type="button"
                onClick={() => abrirNoti(popup)}
                style={{ background: 'none', border: 'none', padding: 0, marginTop: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}
              >
                Ver {popup.orden_numero || 'la orden'} →
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPopup(null)}
            aria-label="Cerrar"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 2 }}
          >
            <Icon.X />
          </button>
        </div>
      )}
    </div>
  )
}
