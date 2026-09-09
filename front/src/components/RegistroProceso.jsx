import { useState, useEffect, useMemo } from 'react'
import {
  fmtNum, NumField, ChipToggle,
  ESTACIONES_CONFIG, TAMANOS_REGISTRO, TIPOS_LAMINADO_REGISTRO, TIPOS_METALIZADO_REGISTRO,
} from './core'
import { createRegistroProceso, anularRegistroProceso } from '../api'

const fmtFecha = (iso) => new Date(iso).toLocaleString('es-CO', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

// ────────── helpers de presentación (mismo idioma que Troquel.jsx) ──────────

function Field({ label, children, full, w }) {
  const flex = full ? '1 1 100%' : (w ? '0 0 auto' : '1 1 160px')
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex, width: w, minWidth: 0 }}>
      {label ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{label}</span> : null}
      {children}
    </label>
  )
}

function FieldGroup({ title, children }) {
  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px 10px', margin: 0, display: 'flex', flexWrap: 'wrap', gap: 10, rowGap: 8, minInlineSize: 0, maxWidth: '100%' }}>
      <legend style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', padding: '0 4px' }}>{title}</legend>
      {children}
    </fieldset>
  )
}

const EMPTY = {
  cantidad_realizada: 0,
  tamano: '', tamano_otro: '',
  tiro_active: false, tiro_colores_num: 0, tiro_colores_desc: '',
  retiro_active: false, retiro_colores_num: 0, retiro_colores_desc: '',
  tipo_laminado: '', tipo_metalizado: '', tipo_metalizado_otro: '',
  observaciones: '',
}

// ────────── Formulario de registro de una máquina ──────────
//
// Un solo formulario para las cuatro estaciones: `cfg.campos` decide qué bloques
// se pintan. La cantidad realizada es común a todas.
//
// `orden` es la fila que devuelve la cola (?estacion=), con cantidad_esperada y
// estacion_procesos ya calculados por el backend.
export function RegistroProcesoForm({ estacion, orden, onCreated }) {
  const cfg = ESTACIONES_CONFIG[estacion]
  const pendientes = useMemo(
    () => (orden.estacion_procesos || []).filter(p => !p.completado),
    [orden.estacion_procesos],
  )

  const [form, setForm] = useState(EMPTY)
  const [procesoId, setProcesoId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Confirmación de faltante: guarda lo esperado que reportó el servidor, para
  // que el aviso diga la cifra correcta aunque el front tuviera datos viejos.
  const [confirmando, setConfirmando] = useState(null)

  // Al cambiar de OP se limpia todo y se preselecciona el único proceso pendiente.
  useEffect(() => {
    setForm(EMPTY)
    setError(null)
    setConfirmando(null)
    setProcesoId(pendientes.length === 1 ? pendientes[0].proceso_id : '')
  }, [orden.id, pendientes])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const esperada = Number(orden.cantidad_esperada || 0)
  const requerida = Number(orden.cantidad || 0)
  // El sobrante es margen de error que la empresa asume: solo por debajo de
  // (requerida - margen) se pide confirmación y se avisa al Admin.
  const margen = Number(orden.sobrante || 0)

  const enviar = async (confirmarFaltante) => {
    setSaving(true)
    setError(null)
    try {
      const data = await createRegistroProceso({
        orden: orden.id,
        estacion,
        proceso_id: procesoId,
        ...form,
        confirmar_faltante: !!confirmarFaltante,
      })
      setConfirmando(null)
      setForm(EMPTY)
      onCreated && onCreated(data)
    } catch (e) {
      if (e.code === 'cantidad_faltante') {
        // Red de seguridad: el servidor detectó el faltante que el front no vio.
        setConfirmando({ esperada: e.cantidad_requerida ?? requerida, realizada: form.cantidad_realizada })
      } else {
        setError(e.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!procesoId) { setError('Selecciona qué proceso estás registrando.'); return }
    const realizada = Number(form.cantidad_realizada || 0)
    if (!realizada) { setError('Indica la cantidad realizada.'); return }

    if (cfg.campos.includes('tamano')) {
      if (!form.tamano) { setError('Selecciona el tamaño del papel.'); return }
      if (form.tamano === 'otro' && !form.tamano_otro.trim()) { setError('Describe el tamaño del papel.'); return }
    }

    // Tiro/retiro: el único par de campos opcional, pero no ambos vacíos —
    // al menos uno tiene que quedar marcado (impresión o laminado, según la
    // estación). Si queda marcado, sus subcampos (colores) sí son obligatorios.
    if (cfg.campos.includes('colores') || cfg.campos.includes('lado')) {
      if (!form.tiro_active && !form.retiro_active) {
        setError('Indica tiro, retiro o ambos.')
        return
      }
    }

    if (cfg.campos.includes('colores')) {
      for (const key of ['tiro', 'retiro']) {
        if (!form[`${key}_active`]) continue
        const nombre = key === 'tiro' ? 'tiro' : 'retiro'
        if (!Number(form[`${key}_colores_num`])) { setError(`Indica el número de colores del ${nombre}.`); return }
        if (!form[`${key}_colores_desc`].trim()) { setError(`Indica qué colores se usaron en el ${nombre}.`); return }
      }
    }

    if (cfg.campos.includes('laminado')) {
      if (!form.tipo_laminado) { setError('Selecciona el tipo de laminado.'); return }
      if (form.tipo_laminado === 'metalizado') {
        if (!form.tipo_metalizado) { setError('Selecciona el color del metalizado.'); return }
        if (form.tipo_metalizado === 'otros' && !form.tipo_metalizado_otro.trim()) {
          setError('Especifica el color del metalizado.'); return
        }
      }
    }

    if (requerida && realizada < (requerida - margen)) {
      setConfirmando({ esperada: requerida, realizada })
      return
    }
    enviar(false)
  }

  return (
    <form className="section" onSubmit={handleSubmit} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Qué proceso se cierra — la estación cubre varios (Barnizadora): con uno
          solo pendiente se muestra fijo, con varios se elige entre ellos. */}
      {cfg.multiproceso && pendientes.length > 0 && (
        <FieldGroup title="¿Qué se barnizó?">
          {pendientes.length > 1 ? (
            pendientes.map(p => (
              <ChipToggle
                key={p.proceso_id}
                active={procesoId === p.proceso_id}
                onClick={() => setProcesoId(p.proceso_id)}
              >
                {p.label}
              </ChipToggle>
            ))
          ) : (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-1)' }}>{pendientes[0].label}</span>
          )}
        </FieldGroup>
      )}

      <FieldGroup title="Cantidad realizada">
        <Field label="Unidades que salieron" w={160}>
          <NumField
            step={1}
            value={form.cantidad_realizada}
            onChange={v => set('cantidad_realizada', v)}
            placeholder="0"
          />
        </Field>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', alignSelf: 'flex-end', paddingBottom: 8 }}>
          Esperadas: <strong style={{ color: 'var(--ink-2)' }}>{fmtNum(esperada)}</strong>
          {margen > 0 && ` (margen de error: ${fmtNum(margen)})`}
        </span>
      </FieldGroup>

      {cfg.campos.includes('tamano') && (
        <FieldGroup title="Tamaño del papel *">
          <Field label="Medida">
            <select className="input" value={form.tamano} onChange={e => set('tamano', e.target.value)}>
              <option value="">Seleccionar…</option>
              {TAMANOS_REGISTRO.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          {form.tamano === 'otro' && (
            <Field label="¿Cuál?">
              <input
                className="input"
                placeholder="Describe el tamaño"
                value={form.tamano_otro}
                onChange={e => set('tamano_otro', e.target.value)}
              />
            </Field>
          )}
        </FieldGroup>
      )}

      {cfg.campos.includes('colores') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Marca tiro, retiro o ambos — no pueden quedar los dos sin marcar.</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {[
            { key: 'tiro', label: 'Tiro (frente)' },
            { key: 'retiro', label: 'Retiro (interior)' },
          ].map(({ key, label }) => (
            <div key={key} style={{ flex: '1 1 280px', minWidth: 0 }}>
              <FieldGroup title={label}>
                {/* Fuera de <Field>: un <button> dentro de un <label> pierde su
                    nombre accesible y el clic se reenvía al control etiquetado. */}
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                  <ChipToggle
                    active={form[`${key}_active`]}
                    onClick={() => set(`${key}_active`, !form[`${key}_active`])}
                  >
                    {form[`${key}_active`] ? '✓ Impreso' : 'No impreso'}
                  </ChipToggle>
                </div>
                {form[`${key}_active`] && (
                  <>
                    <Field label="N.º de colores" w={110}>
                      <NumField
                        step={1}
                        value={form[`${key}_colores_num`]}
                        onChange={v => set(`${key}_colores_num`, v)}
                        placeholder="0"
                      />
                    </Field>
                    <Field label="¿Cuáles?">
                      <input
                        className="input"
                        placeholder="CMYK, pantone 485…"
                        value={form[`${key}_colores_desc`]}
                        onChange={e => set(`${key}_colores_desc`, e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </FieldGroup>
            </div>
          ))}
          </div>
        </div>
      )}

      {cfg.campos.includes('laminado') && (
        <FieldGroup title="Laminado *">
          <Field label="Tipo realizado">
            <select className="input" value={form.tipo_laminado} onChange={e => set('tipo_laminado', e.target.value)}>
              <option value="">Seleccionar…</option>
              {TIPOS_LAMINADO_REGISTRO.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          {/* Mate/brillante no tienen color; solo metalizado, y es un tono, no
              un número de tintas (eso es cosa de Impresora). */}
          {form.tipo_laminado === 'metalizado' && (
            <>
              <Field label="Color">
                <select className="input" value={form.tipo_metalizado} onChange={e => set('tipo_metalizado', e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {TIPOS_METALIZADO_REGISTRO.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </Field>
              {form.tipo_metalizado === 'otros' && (
                <Field label="¿Cuál?">
                  <input
                    className="input"
                    placeholder="Ej. Holográfico, Azul…"
                    value={form.tipo_metalizado_otro}
                    onChange={e => set('tipo_metalizado_otro', e.target.value)}
                  />
                </Field>
              )}
            </>
          )}
        </FieldGroup>
      )}

      {cfg.campos.includes('lado') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Marca tiro, retiro o ambos — no pueden quedar los dos sin marcar.</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {[
            { key: 'tiro', label: 'Tiro (frente)' },
            { key: 'retiro', label: 'Retiro (interior)' },
          ].map(({ key, label }) => (
            <div key={key} style={{ flex: '1 1 280px', minWidth: 0 }}>
              <FieldGroup title={label}>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                  <ChipToggle
                    active={form[`${key}_active`]}
                    onClick={() => set(`${key}_active`, !form[`${key}_active`])}
                  >
                    {form[`${key}_active`] ? '✓ Laminado' : 'No laminado'}
                  </ChipToggle>
                </div>
              </FieldGroup>
            </div>
          ))}
          </div>
        </div>
      )}

      <Field label="Observaciones (opcional)" full>
        <textarea
          className="input"
          rows={2}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
          placeholder="Novedades del trabajo, si las hubo"
          value={form.observaciones}
          onChange={e => set('observaciones', e.target.value)}
        />
      </Field>

      {error && <div style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn accent" type="submit" disabled={saving}>
          {saving ? 'Registrando…' : `Registrar en ${cfg.label}`}
        </button>
      </div>

      {confirmando && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 440, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
              ⚠ Faltan unidades
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
              Registraste <strong>{fmtNum(confirmando.realizada)}</strong> de{' '}
              <strong>{fmtNum(confirmando.esperada)}</strong> unidades requeridas.
              ¿La cantidad es correcta? Si continúas, se le notificará al administrador
              que faltan unidades en <strong>{cfg.label}</strong>.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" type="button" onClick={() => setConfirmando(null)} disabled={saving}>
                Revisar
              </button>
              <button className="btn primary" type="button" onClick={() => enviar(true)} disabled={saving}>
                {saving ? 'Registrando…' : 'Sí, continuar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}

// ────────── Historial de registros ──────────
//
// `onAnulado`: si se pasa, aparece la columna de deshacer. Bajo bloqueo duro un
// error de tecleo dejaría la OP atascada, así que el operador puede anular.
export function RegistroProcesoHistory({ registros, loading, showOrden = true, onAnulado, showCosto = false, onCostoChange }) {
  const [anulando, setAnulando] = useState(null)
  const [confirmAnular, setConfirmAnular] = useState(null)
  const [error, setError] = useState(null)
  const [montoDrafts, setMontoDrafts] = useState({})

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
  }
  if (!registros.length) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin registros todavía</div>
  }

  const anular = async (id) => {
    setAnulando(id)
    setError(null)
    try {
      await anularRegistroProceso(id)
      setConfirmAnular(null)
      onAnulado && onAnulado(id)
    } catch (e) {
      setError(e.message)
    } finally {
      setAnulando(null)
    }
  }

  const guardarMonto = (id) => {
    const raw = montoDrafts[id]
    if (raw === undefined) return
    const valor = raw === '' ? null : Number(raw)
    if (raw !== '' && Number.isNaN(valor)) return
    onCostoChange && onCostoChange(id, valor)
  }

  const headers = showCosto
    ? ['Proceso', 'Operador', 'Fecha / Hora', 'Cantidad', 'Monto']
    : [
        'Fecha / Hora',
        ...(showOrden ? ['OP #', 'Cliente'] : []),
        'Proceso', 'Cantidad', 'Tamaño', 'Detalle', 'Operador',
        ...(onAnulado ? [''] : []),
      ]

  const detalle = (r) => {
    const partes = []
    if (r.tipo_laminado) {
      // Laminado: tiro/retiro es solo el lado, nunca lleva número de tintas
      // (eso es cosa de Impresora, ver la rama de abajo).
      if (r.tiro_active) partes.push('Tiro')
      if (r.retiro_active) partes.push('Retiro')
      const tipoLabel = TIPOS_LAMINADO_REGISTRO.find(t => t.id === r.tipo_laminado)?.label || r.tipo_laminado
      if (r.tipo_laminado === 'metalizado' && r.tipo_metalizado) {
        const colorLabel = r.tipo_metalizado === 'otros'
          ? (r.tipo_metalizado_otro || 'Otros')
          : (TIPOS_METALIZADO_REGISTRO.find(t => t.id === r.tipo_metalizado)?.label || r.tipo_metalizado)
        partes.push(`${tipoLabel} (${colorLabel})`)
      } else {
        partes.push(tipoLabel)
      }
    } else {
      if (r.tiro_active) partes.push(`Tiro${r.tiro_colores_num ? ` ${r.tiro_colores_num}c` : ''}${r.tiro_colores_desc ? ` (${r.tiro_colores_desc})` : ''}`)
      if (r.retiro_active) partes.push(`Retiro${r.retiro_colores_num ? ` ${r.retiro_colores_num}c` : ''}${r.retiro_colores_desc ? ` (${r.retiro_colores_desc})` : ''}`)
    }
    if (r.observaciones) partes.push(r.observaciones)
    return partes.join(' · ') || '—'
  }

  return (
    <>
      {error && <div style={{ padding: '8px 12px', color: 'var(--danger, #c0392b)', fontSize: 12 }}>{error}</div>}
      <div className="table-scroll">
        <table style={{ width: '100%', minWidth: showOrden ? 860 : 640, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--line)' }}>
              {headers.map((h, i) => (
                <th key={i} style={{
                  padding: '10px 12px', textAlign: 'left',
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {registros.map((r, idx) => (
              <tr key={r.id} style={{
                borderBottom: '1px solid var(--line)',
                background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
              }}>
                {showCosto ? (
                  <>
                    <td style={{ padding: '10px 12px', color: 'var(--ink-2)' }}>{r.proceso_label}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--ink-2)', fontSize: 12 }}>{r.operador_username || '—'}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--ink-2)' }}>
                      {fmtFecha(r.fecha_hora)}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      {fmtNum(r.cantidad_realizada)}
                      {r.faltante && (
                        <span title={`Esperadas: ${fmtNum(r.cantidad_esperada)}`} style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                          background: 'var(--danger-soft, #fdecea)', color: 'var(--danger, #c0392b)',
                        }}>
                          −{fmtNum(r.cantidad_esperada - r.cantidad_realizada)}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        placeholder="—"
                        style={{ width: 110, fontSize: 12 }}
                        value={montoDrafts[r.id] ?? (r.monto_cobrado ?? '')}
                        onChange={e => setMontoDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                        onBlur={() => guardarMonto(r.id)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
                      />
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--ink-2)' }}>
                      {fmtFecha(r.fecha_hora)}
                    </td>
                    {showOrden && (
                      <>
                        <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12 }}>
                          {r.orden_numero}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.orden_cliente}</td>
                      </>
                    )}
                    <td style={{ padding: '10px 12px', color: 'var(--ink-2)' }}>{r.proceso_label}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      {fmtNum(r.cantidad_realizada)}
                      {r.faltante && (
                        <span title={`Esperadas: ${fmtNum(r.cantidad_esperada)}`} style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                          background: 'var(--danger-soft, #fdecea)', color: 'var(--danger, #c0392b)',
                        }}>
                          −{fmtNum(r.cantidad_esperada - r.cantidad_realizada)}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)' }}>
                      {r.tamano === 'otro' ? (r.tamano_otro || 'Otro') : (r.tamano_label || '—')}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)' }}>{detalle(r)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--ink-2)', fontSize: 12 }}>{r.operador_username || '—'}</td>
                    {onAnulado && (
                      <td style={{ padding: '10px 12px' }}>
                        <button
                          type="button"
                          className={'btn' + (confirmAnular === r.id ? ' danger' : '')}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          disabled={anulando === r.id}
                          onClick={() => (confirmAnular === r.id ? anular(r.id) : setConfirmAnular(r.id))}
                        >
                          {anulando === r.id ? '…' : (confirmAnular === r.id ? '¿Anular?' : 'Anular')}
                        </button>
                      </td>
                    )}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
