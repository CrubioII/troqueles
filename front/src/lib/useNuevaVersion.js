import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

/* global __APP_BUILD__ */
const BUILD_ACTUAL = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : null
const CADA_MS = 5 * 60 * 1000

async function buildPublicado() {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null          // dev server: there is no version.json
    const data = await r.json()
    return data?.build || null
  } catch {
    return null
  }
}

/**
 * Detects that a newer version of the app was deployed while this screen was
 * open (an SPA never reloads by itself: a plant tablet can run a weeks-old
 * bundle). Returns `true` once it's stale; it also reloads on the next route
 * change, where nothing typed is lost because the page is being left anyway.
 */
export function useNuevaVersion() {
  const [hayNueva, setHayNueva] = useState(false)
  const location = useLocation()
  const primeraRuta = useRef(true)

  useEffect(() => {
    if (!BUILD_ACTUAL || import.meta.env.DEV) return undefined
    let vivo = true
    const revisar = async () => {
      const publicado = await buildPublicado()
      if (vivo && publicado && publicado !== BUILD_ACTUAL) setHayNueva(true)
    }
    revisar()
    const t = setInterval(revisar, CADA_MS)
    const alVolver = () => { if (document.visibilityState === 'visible') revisar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  useEffect(() => {
    if (primeraRuta.current) { primeraRuta.current = false; return }
    if (hayNueva) window.location.reload()
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return hayNueva
}
