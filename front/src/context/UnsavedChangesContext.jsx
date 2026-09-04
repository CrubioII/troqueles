import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Evita perder un formulario a medio llenar cuando el usuario se va a otra
// pantalla. Una pantalla declara su estado con useUnsavedGuard(); toda
// navegación interna pasa por useGuardedNavigate()/useGuardedAction(), que
// primero le pregunta al guard activo y, si hay cambios sin guardar, abre el
// diálogo de confirmación en vez de salir de una vez.
const UnsavedChangesContext = createContext(null)

const DEFAULT_TEXTS = {
  title: 'Tienes cambios sin guardar',
  message: 'Si sales ahora, lo que ingresaste se perderá.',
  saveLabel: 'Guardar y salir',
  discardLabel: 'Salir sin guardar',
  cancelLabel: 'Seguir editando',
}

function UnsavedChangesDialog({ prompt, saving, error, onSave, onDiscard, onCancel }) {
  const { texts, canSave, hint } = prompt

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onCancel])

  return (
    <div
      className="cot-modal-backdrop"
      style={{ alignItems: 'center' }}
      onMouseDown={e => { if (e.target === e.currentTarget && !saving) onCancel() }}
    >
      <div className="cot-modal" style={{ maxWidth: 460, marginBottom: 0 }} role="dialog" aria-modal="true">
        <div className="cot-modal-header">
          <div style={{ fontSize: 14, fontWeight: 700 }}>{texts.title}</div>
        </div>

        <div className="cot-modal-body" style={{ padding: '20px 24px' }}>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', margin: 0 }}>
            {texts.message}
          </p>
          {!canSave && hint && (
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3)', margin: '12px 0 0' }}>
              {hint}
            </p>
          )}
          {error && (
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--danger)', margin: '12px 0 0' }}>
              No se pudo guardar: {error}
            </p>
          )}
        </div>

        <div className="cot-modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={saving}>
            {texts.cancelLabel}
          </button>
          <button
            className="btn"
            style={{ color: 'var(--danger)', borderColor: 'var(--danger-soft)' }}
            onClick={onDiscard}
            disabled={saving}
          >
            {texts.discardLabel}
          </button>
          <button className="btn primary" onClick={onSave} disabled={saving || !canSave}>
            {saving ? 'Guardando…' : texts.saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UnsavedChangesProvider({ children }) {
  const guardRef = useRef(null)
  const [prompt, setPrompt] = useState(null)   // { guard, proceed, texts, canSave, hint }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Solo hay un guard activo a la vez: el de la pantalla montada.
  const registerGuard = useCallback(guard => {
    guardRef.current = guard
    return () => { if (guardRef.current === guard) guardRef.current = null }
  }, [])

  const runGuarded = useCallback(action => {
    const guard = guardRef.current
    if (!guard || !guard.isDirty()) { action(); return }
    setSaving(false)
    setError(null)
    setPrompt({ guard, proceed: action, ...guard.describe() })
  }, [])

  const cancel = useCallback(() => { if (!saving) setPrompt(null) }, [saving])

  const discard = useCallback(() => {
    setPrompt(null)
    prompt?.proceed()
  }, [prompt])

  const saveAndLeave = useCallback(async () => {
    if (!prompt) return
    setSaving(true)
    setError(null)
    try {
      await prompt.guard.save()
    } catch (e) {
      setError(e?.message || 'inténtalo de nuevo.')
      setSaving(false)
      return
    }
    setSaving(false)
    setPrompt(null)
    prompt.proceed()
  }, [prompt])

  const value = useMemo(() => ({ registerGuard, runGuarded }), [registerGuard, runGuarded])

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      {prompt && (
        <UnsavedChangesDialog
          prompt={prompt}
          saving={saving}
          error={error}
          onSave={saveAndLeave}
          onDiscard={discard}
          onCancel={cancel}
        />
      )}
    </UnsavedChangesContext.Provider>
  )
}

// Declara que esta pantalla tiene cambios sin guardar.
//   active   — si el guard aplica (p. ej. formulario editable)
//   dirty    — hay cambios pendientes de guardar
//   canSave  — el formulario tiene lo mínimo para poder guardarse
//   save     — persiste; debe lanzar si falla, para no salir perdiendo datos
//   hint     — por qué no se puede guardar todavía
//   texts    — sobreescribe los textos del diálogo
export function useUnsavedGuard(config) {
  const ctx = useContext(UnsavedChangesContext)
  const registerGuard = ctx?.registerGuard
  const configRef = useRef(config)
  configRef.current = config

  useEffect(() => {
    if (!registerGuard) return
    return registerGuard({
      isDirty: () => {
        const c = configRef.current
        return c.active !== false && !!c.dirty
      },
      describe: () => {
        const c = configRef.current
        return {
          texts: { ...DEFAULT_TEXTS, ...(c.texts || {}) },
          canSave: c.canSave !== false && typeof c.save === 'function',
          hint: c.hint || null,
        }
      },
      save: () => configRef.current.save(),
    })
  }, [registerGuard])

  // Cerrar la pestaña o recargar no pasa por el router: ahí lo único
  // disponible es el diálogo nativo del navegador.
  useEffect(() => {
    const onBeforeUnload = e => {
      const c = configRef.current
      if (c.active === false || !c.dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
}

// Reemplazo de useNavigate que respeta el guard activo.
export function useGuardedNavigate() {
  const ctx = useContext(UnsavedChangesContext)
  const navigate = useNavigate()
  return useCallback((to, options) => {
    if (!ctx) { navigate(to, options); return }
    ctx.runGuarded(() => navigate(to, options))
  }, [ctx, navigate])
}

// Para acciones que también sacan al usuario de la pantalla (cerrar sesión).
export function useGuardedAction() {
  const ctx = useContext(UnsavedChangesContext)
  return useCallback(action => {
    if (!ctx) { action(); return }
    ctx.runGuarded(action)
  }, [ctx])
}
