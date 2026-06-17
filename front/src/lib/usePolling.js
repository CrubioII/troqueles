import { useEffect, useRef } from 'react'

const DEFAULT_INTERVAL = 5000

// Llama a `fn` periódicamente mientras la pestaña está visible, y una vez de
// inmediato cuando la pestaña vuelve a primer plano. Salta los ticks si la
// pestaña está oculta para no golpear la API en segundo plano.
//
// `fn` debe ser un "refresh silencioso": no resetea spinners de carga ni pisa
// lo que el usuario está escribiendo/seleccionando.
export function usePolling(fn, { interval = DEFAULT_INTERVAL, enabled = true } = {}) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return undefined
    const tick = () => { if (!document.hidden) fnRef.current() }
    const id = setInterval(tick, interval)
    const onVisible = () => { if (!document.hidden) fnRef.current() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [interval, enabled])
}
