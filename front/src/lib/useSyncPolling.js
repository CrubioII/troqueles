import { useEffect, useRef } from 'react'
import { getSync } from '../api'

const INTERVAL = 10000
const FULL_REFRESH_EVERY = 6 // ticks: refresh completo ~cada 60s como red de seguridad

// Polling barato: cada tick pide GET /api/sync/ (~200 B de versiones por
// recurso) y solo llama al loader de una lista cuando su versión cambió.
// Cada FULL_REFRESH_EVERY ticks recarga todo igualmente (cubre escrituras
// que no cambian la firma, p.ej. queryset.update()), y también al volver
// la pestaña a primer plano.
//
// `loaders` es { claveDeSync: fnRecarga }, p.ej.:
//   useSyncPolling({ ordenes: () => load() }, { enabled: !sel })
//
// Los loaders deben ser "refresh silencioso": no resetear spinners ni pisar
// lo que el usuario está escribiendo/seleccionando.
export function useSyncPolling(loaders, { enabled = true } = {}) {
  const loadersRef = useRef(loaders)
  loadersRef.current = loaders

  useEffect(() => {
    if (!enabled) return undefined
    let versions = null // se llena en el primer tick sin disparar recargas
    let ticks = 0

    const reloadAll = () => {
      Object.values(loadersRef.current).forEach(fn => fn())
    }

    const tick = async () => {
      if (document.hidden) return
      ticks += 1
      if (ticks % FULL_REFRESH_EVERY === 0) {
        versions = null
        reloadAll()
        return
      }
      try {
        const data = await getSync()
        if (versions) {
          Object.entries(loadersRef.current).forEach(([key, fn]) => {
            if (data[key] !== versions[key]) fn()
          })
        }
        versions = data
      } catch {
        // sin red o sesión vencida: reintenta en el próximo tick
      }
    }

    const id = setInterval(tick, INTERVAL)
    const onVisible = () => {
      if (!document.hidden) { versions = null; reloadAll() }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}
