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
    if (snapshot === savedSnapshotRef.current) return inFlightRef.current || Promise.resolve()
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

  return { status, flush, retry }
}
