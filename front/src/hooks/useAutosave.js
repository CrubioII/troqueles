import { useEffect, useRef, useState, useCallback } from 'react'

// Debounced autosave: waits for `delay` ms of inactivity, then persists `value`
// via `saveFn`. Writes are serialized — a change that arrives while a save is
// still in flight is queued and fires immediately once that save settles,
// rather than starting a second overlapping request (the backend recreates
// nested line-item collections on every update, so two concurrent updates for
// the same record could interleave and corrupt them).
export function useAutosave(value, saveFn, options = {}) {
  const { delay = 1200, isValid, enabled = true } = options
  const [status, setStatus] = useState('idle')
  // `dirty` se expone para las pantallas de guardado manual (enabled: false),
  // que necesitan saber si hay cambios sin persistir antes de dejar salir.
  const [dirty, setDirty] = useState(false)

  const valueRef = useRef(value)
  valueRef.current = value
  const saveFnRef = useRef(saveFn)
  saveFnRef.current = saveFn
  const isValidRef = useRef(isValid)
  isValidRef.current = isValid

  const savedSnapshotRef = useRef(null)
  const initializedRef = useRef(false)
  const timerRef = useRef(null)
  const fadeTimerRef = useRef(null)
  const inFlightRef = useRef(null)
  const retryQueuedRef = useRef(false)

  const attemptSave = useCallback(() => {
    const snapshot = JSON.stringify(valueRef.current)
    if (snapshot === savedSnapshotRef.current) {
      setDirty(false)
      return inFlightRef.current || Promise.resolve()
    }
    if (isValidRef.current && !isValidRef.current(valueRef.current)) return Promise.resolve()
    if (inFlightRef.current) {
      retryQueuedRef.current = true
      return inFlightRef.current
    }
    clearTimeout(fadeTimerRef.current)
    setStatus('saving')
    const p = (async () => {
      try {
        await saveFnRef.current(valueRef.current)
        savedSnapshotRef.current = snapshot
        // Lo que haya cambiado mientras el save estaba en vuelo sigue pendiente
        setDirty(JSON.stringify(valueRef.current) !== snapshot)
        setStatus('saved')
        fadeTimerRef.current = setTimeout(() => setStatus('idle'), 2500)
      } catch (e) {
        setStatus('error')
      } finally {
        inFlightRef.current = null
        if (retryQueuedRef.current) {
          retryQueuedRef.current = false
          attemptSave()
        }
      }
    })()
    inFlightRef.current = p
    return p
  }, [])

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      savedSnapshotRef.current = JSON.stringify(value)
      return
    }
    setDirty(JSON.stringify(value) !== savedSnapshotRef.current)
    if (!enabled) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(attemptSave, delay)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value), enabled, delay, attemptSave])

  useEffect(() => () => { clearTimeout(timerRef.current); clearTimeout(fadeTimerRef.current) }, [])

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current)
    await attemptSave()
    while (inFlightRef.current) await inFlightRef.current
  }, [attemptSave])

  const retry = useCallback(() => { attemptSave() }, [attemptSave])

  // Toma el valor actual como la línea base "sin cambios". Lo usan las
  // pantallas que terminan de cargar/sembrar defaults después del montaje,
  // para que esos valores no cuenten como edición del usuario.
  const markPristine = useCallback(() => {
    savedSnapshotRef.current = JSON.stringify(valueRef.current)
    setDirty(false)
  }, [])

  return { status, flush, retry, dirty, markPristine }
}
