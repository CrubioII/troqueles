import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { fmtCOP, fmtNum, NumField, Checkbox, MoneyInput } from './core'
import {
  getTroquelModelo, saveTroquelModelo, getTroquelCostos, saveTroquelCostos,
  getFormatosCuchillas, createFormatoCuchillas, updateFormatoCuchillas,
  getClientes, createCliente, createOrden, patchOrden,
} from '../api'

const asList = (data) => (Array.isArray(data) ? data : (data?.results || []))
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

// Tamaños disponibles en el formato de cuchillas (deben coincidir con el backend)
const CH_SIZES = ['3x3', '4x4', '6x6', '8x8', '10x10']
const SAC_SIZES = [
  ...Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} (expulsor)` })),
  ...Array.from({ length: 5 }, (_, i) => ({ value: String(i + 11), label: `${i + 11} (tubo)` })),
]
const PERFO_SIZES = ['1x1', '2x1', '2x2', '3x1', '3x2', '3x3', '4x1', '4x2', '4x3', '4x4', '6x6', '10x10']
const CAUCHO_TIPOS = [
  { value: 'verde', label: 'Caucho Verde' },
  { value: 'profigumi', label: 'Profigumi' },
  { value: 'blucolan', label: 'Blucolan' },
]
const CAUCHO_TIPO_LABELS = Object.fromEntries(CAUCHO_TIPOS.map(t => [t.value, t.label]))
const SAC_SIZE_LABELS = Object.fromEntries(SAC_SIZES.map(s => [s.value, s.label]))
// Medidas fijas por tipo de puntos (mm); solo la altura de grafa 2pt es elegible
const PUNTOS_SPECS = {
  '2': { altura: '23,8', espesor: '0,71' },
  '3': { altura: '23,8', espesor: '1,05' },
}
const GRAFA_ALTURAS = ['23.4', '23.3']
const GRAFA_3PT_ALTURA = '23,0' // la grafa 3pt es más baja que la cuchilla 3pt

// ────────── helpers de presentación ──────────

// `w`: ancho fijo compacto (campos numéricos/selects cortos); sin `w` el campo crece.
function Field({ label, children, full, w }) {
  const flex = full ? '1 1 100%' : (w ? '0 0 auto' : '1 1 160px')
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex, width: w, minWidth: 0 }}>
      {label ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{label}</span> : null}
      {children}
    </label>
  )
}

// Grupo visual de campos relacionados (p.ej. cm + tamaño de un mismo concepto).
// minInlineSize/flexWrap: los fieldset no se encogen por defecto y desbordaban en móvil.
function FieldGroup({ title, children }) {
  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px 10px', margin: 0, display: 'flex', flexWrap: 'wrap', gap: 10, rowGap: 8, minInlineSize: 0, maxWidth: '100%' }}>
      <legend style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', padding: '0 4px' }}>{title}</legend>
      {children}
    </fieldset>
  )
}

// Medidas fijas informativas dentro de un FieldGroup (no editables)
function SpecHint({ children }) {
  return (
    <span style={{ fontSize: 11, color: 'var(--ink-3)', alignSelf: 'flex-end', paddingBottom: 8, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}


function SectionHeader({ children }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13 }}>
      {children}
    </div>
  )
}

// ────────── Modelo del troquel (Admin) ──────────

const EMPTY_MODELO = {
  instrucciones: '',
  corte_cm: 0, score_cm: 0, hendido_cm: 0,
}

// `orden` (opcional): fila de la OP para editar referencia/fecha_entrega desde
// aquí mismo; se omite donde la OP ya tiene su propio editor (OrdenEdit).
export function TroquelModeloForm({ ordenId, orden, onSaved, onOrdenSaved, onLoaded }) {
  const [modelo, setModelo] = useState(null)   // registro existente (con id)
  const [form, setForm] = useState(EMPTY_MODELO)
  const [opForm, setOpForm] = useState({ referencia: '', fechaEntrega: '' })
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState(null)  // object URL del archivo recién elegido
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [okMsg, setOkMsg] = useState(false)

  const load = () => {
    setLoading(true)
    getTroquelModelo(ordenId)
      .then(data => {
        const m = asList(data)[0] || null
        setModelo(m)
        if (m) setForm({ ...EMPTY_MODELO, ...m })
        else setForm(EMPTY_MODELO)
        onLoaded && onLoaded(m)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { if (ordenId) load() }, [ordenId])

  useEffect(() => {
    setOpForm({ referencia: orden?.referencia || '', fechaEntrega: orden?.fecha_entrega || '' })
  }, [orden?.id])

  // Previsualización del archivo recién seleccionado (solo imágenes)
  useEffect(() => {
    if (archivo && archivo.type?.startsWith('image/')) {
      const url = URL.createObjectURL(archivo)
      setPreview(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreview(null)
  }, [archivo])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = () => {
    setSaving(true); setError(null); setOkMsg(false)
    const fd = new FormData()
    fd.append('orden', ordenId)
    fd.append('instrucciones', form.instrucciones ?? '')
    ;['corte_cm', 'score_cm', 'hendido_cm'].forEach(k => fd.append(k, form[k] ?? 0))
    if (archivo) fd.append('archivo', archivo)
    const opCambio = orden && (
      opForm.referencia !== (orden.referencia || '') ||
      opForm.fechaEntrega !== (orden.fecha_entrega || '')
    )
    Promise.all([
      saveTroquelModelo(modelo?.id, fd),
      opCambio
        ? patchOrden(ordenId, { referencia: opForm.referencia, fecha_entrega: opForm.fechaEntrega || null })
        : Promise.resolve(null),
    ])
      .then(([saved, opSaved]) => {
        setModelo(saved)
        setForm({ ...EMPTY_MODELO, ...saved })
        setArchivo(null)
        setOkMsg(true)
        onSaved && onSaved(saved)
        if (opSaved) onOrdenSaved && onOrdenSaved(opSaved)
      })
      .catch(() => setError('No se pudo guardar el modelo'))
      .finally(() => setSaving(false))
  }

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando modelo…</div>

  const archivoEsImagen = modelo?.archivo && IMG_RE.test(modelo.archivo)

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {orden && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Field label="Referencia">
            <input className="input" value={opForm.referencia} onChange={e => setOpForm(f => ({ ...f, referencia: e.target.value }))} />
          </Field>
          <Field label="Fecha de entrega" w={160}>
            <input className="input" type="date" value={opForm.fechaEntrega} onChange={e => setOpForm(f => ({ ...f, fechaEntrega: e.target.value }))} />
          </Field>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Field label="Anotaciones técnicas (visibles al operador)" full><textarea className="input" rows={5} value={form.instrucciones} onChange={e => set('instrucciones', e.target.value)} /></Field>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          CM lineales del modelo (informativo)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Field label="Corte (cm)" w={110}><NumField value={form.corte_cm} onChange={v => set('corte_cm', v)} /></Field>
          <Field label="Score (cm)" w={110}><NumField value={form.score_cm} onChange={v => set('score_cm', v)} /></Field>
          <Field label="C. Hendido (cm)" w={110}><NumField value={form.hendido_cm} onChange={v => set('hendido_cm', v)} /></Field>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Archivo del modelo (imagen / PDF)" full>
          <input type="file" accept="image/*,application/pdf" onChange={e => setArchivo(e.target.files[0] || null)} />
        </Field>
        {/* Previsualización: archivo recién elegido tiene prioridad sobre el guardado */}
        {preview ? (
          <img src={preview} alt="Vista previa" style={{ maxWidth: 360, maxHeight: 260, borderRadius: 8, border: '1px solid var(--line)' }} />
        ) : archivo ? (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>📄 {archivo.name} (se previsualiza al guardar)</span>
        ) : archivoEsImagen ? (
          <img src={modelo.archivo} alt="Modelo del troquel" style={{ maxWidth: 360, maxHeight: 260, borderRadius: 8, border: '1px solid var(--line)' }} />
        ) : modelo?.archivo ? (
          <a href={modelo.archivo} target="_blank" rel="noreferrer" className="btn" style={{ alignSelf: 'flex-start' }}>Abrir archivo actual</a>
        ) : null}
      </div>

      {error && <div style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>{error}</div>}
      {okMsg && <div style={{ color: 'var(--accent)', fontSize: 12 }}>Modelo guardado ✓</div>}

      <div>
        <button className="btn primary" onClick={submit} disabled={saving}>
          {saving ? 'Guardando…' : (modelo ? 'Actualizar modelo' : 'Guardar modelo')}
        </button>
      </div>
    </div>
  )
}

// ────────── Visor del modelo (Operador, sanitizado) ──────────

export function ModeloViewer({ modelo }) {
  if (!modelo) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Esta OP no tiene modelo cargado.</div>
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {modelo.instrucciones && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase' }}>Anotaciones técnicas</div>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{modelo.instrucciones}</div>
        </div>
      )}
      {modelo.archivo && (
        IMG_RE.test(modelo.archivo)
          ? <img src={modelo.archivo} alt="Modelo del troquel" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
          : <a href={modelo.archivo} target="_blank" rel="noreferrer" className="btn">Abrir archivo del modelo</a>
      )}
      {!modelo.instrucciones && !modelo.archivo && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Sin anotaciones ni archivo cargados.</div>
      )}
    </div>
  )
}

// ────────── Gestión del modelo con colapso (Admin) ──────────
// Si la OP ya tiene modelo, muestra un resumen read-only + botón
// "Editar gestión del troquel"; si no, muestra el formulario directamente.

export function ModeloTroquelGestion({ ordenId, orden, onSaved, onOrdenSaved }) {
  const [modelo, setModelo] = useState(undefined)  // undefined = cargando, null = sin modelo
  const [editing, setEditing] = useState(false)
  const initRef = useRef(false)

  useEffect(() => { initRef.current = false; setModelo(undefined); setEditing(false) }, [ordenId])

  // El default (colapsado vs formulario) se decide solo en la primera carga.
  const handleLoaded = (m) => {
    setModelo(m)
    if (!initRef.current) { initRef.current = true; setEditing(!m) }
  }
  const handleSaved = (m) => { setModelo(m); setEditing(false); onSaved && onSaved(m) }

  if (modelo && !editing) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <button className="btn" onClick={() => setEditing(true)}>Editar gestión del troquel</button>
        </div>
        <ModeloViewer modelo={modelo} />
      </div>
    )
  }
  return <TroquelModeloForm ordenId={ordenId} orden={orden} onLoaded={handleLoaded} onSaved={handleSaved} onOrdenSaved={onOrdenSaved} />
}

// ────────── Formato de cuchillas (Operador) ──────────

const EMPTY_FORMATO = {
  cuchilla_cm: 0, cuchilla_puntos: '',
  grafa_cm: 0, grafa_puntos: '', grafa_altura: '',
  ch_cm: 0, ch_medida: '',
  sac_medida: '', sac_cantidad: 0,
  perfo_cm: 0, perfo_medida: '',
  gan: '',
  cauchos: [{ tipo: 'verde', cm: 0 }],
  desperdicio_cm: 0,
  tiempo_encalado_min: 0, tiempo_encuchillado_min: 0, tiempo_encauchado_min: 0,
}

// Payload explícito: los campos legacy (ch, sac, perfo, desperdicio…) que llegan
// al cargar un formato existente son de solo lectura y no deben reenviarse.
const formatoPayload = (form) =>
  Object.fromEntries(Object.keys(EMPTY_FORMATO).map(k => [k, form[k]]))

const initFormato = (formato) => {
  if (!formato) return EMPTY_FORMATO
  const f = { ...EMPTY_FORMATO }
  Object.keys(EMPTY_FORMATO).forEach(k => { if (formato[k] != null) f[k] = formato[k] })
  if (!Array.isArray(f.cauchos) || !f.cauchos.length) f.cauchos = [{ tipo: 'verde', cm: 0 }]
  return f
}

// Entrada de duración: horas + minutos → guarda minutos enteros (analizable)
function HourMinField({ minutes, onChange }) {
  const total = Number(minutes) || 0
  const h = Math.floor(total / 60)
  const min = total % 60
  const update = (nh, nm) => onChange(Math.max(0, (Number(nh) || 0) * 60 + (Number(nm) || 0)))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input className="input" type="number" min="0" placeholder="0" style={{ width: 60 }} value={h || ''} onChange={e => update(e.target.value, min)} />
      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>h</span>
      <input className="input" type="number" min="0" max="59" placeholder="0" style={{ width: 60 }} value={min || ''} onChange={e => update(h, e.target.value)} />
      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>min</span>
    </div>
  )
}

// Minutos → "1h 20m" / "45m" para mostrar en historial
const fmtMin = (m) => {
  const n = Number(m) || 0
  if (!n) return '0m'
  const h = Math.floor(n / 60), min = n % 60
  return h ? `${h}h ${min}m` : `${min}m`
}

export function FormatoCuchillasForm({ ordenId, onCreated, formato, onUpdated, onCancel, onDraftSaved, resubmit = false }) {
  const isEdit = !!formato && !resubmit
  // "Reenviar" solo si el formato ya pasó por la cola (devuelto/pendiente);
  // un borrador que nunca se envió se "envía" por primera vez.
  const reenvio = resubmit && (formato?.estado === 'devuelto' || formato?.estado === 'pendiente')
  const [form, setForm] = useState(() => initFormato(formato))
  // Id del formato ya persistido (borrador o existente): los guardados
  // siguientes hacen PATCH en vez de POST (una sola fila por OP).
  const [draftId, setDraftId] = useState(formato?.id || null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [okMsg, setOkMsg] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setCaucho = (idx, k, v) =>
    setForm(f => ({ ...f, cauchos: f.cauchos.map((row, i) => (i === idx ? { ...row, [k]: v } : row)) }))
  const addCaucho = () => setForm(f => ({ ...f, cauchos: [...f.cauchos, { tipo: 'verde', cm: 0 }] }))
  const removeCaucho = (idx) => setForm(f => ({ ...f, cauchos: f.cauchos.filter((_, i) => i !== idx) }))

  // Edición (Admin): PATCH directo, sin popup de irreversibilidad.
  const submitEdit = () => {
    setSaving(true); setError(null); setOkMsg(null)
    updateFormatoCuchillas(formato.id, formatoPayload(form))
      .then(() => { setOkMsg('Formato actualizado ✓'); onUpdated && onUpdated() })
      .catch(() => setError('No se pudo actualizar el formato'))
      .finally(() => setSaving(false))
  }

  // Guardar avance (Operador): persiste como borrador sin enviarlo a revisión.
  // El formulario conserva los valores para seguir trabajando.
  const saveDraft = () => {
    setSaving(true); setError(null); setOkMsg(null)
    const req = draftId
      ? updateFormatoCuchillas(draftId, formatoPayload(form))
      : createFormatoCuchillas({ orden: ordenId, ...formatoPayload(form) })
    req
      .then((f) => {
        if (f?.id) setDraftId(f.id)
        setOkMsg('Avance guardado ✓')
        onDraftSaved && onDraftSaved(f)
      })
      .catch((e) => setError(e?.message || 'No se pudo guardar el avance'))
      .finally(() => setSaving(false))
  }

  // Enviar (Operador): se confirma en el modal y queda pendiente de aprobación.
  const submitSend = () => {
    setSaving(true); setError(null); setOkMsg(null)
    const req = draftId
      ? updateFormatoCuchillas(draftId, { ...formatoPayload(form), enviar: true })
      : createFormatoCuchillas({ orden: ordenId, ...formatoPayload(form), enviar: true })
    req
      .then(() => {
        setForm(EMPTY_FORMATO)
        setConfirming(false)
        setOkMsg('Formato enviado ✓')
        onCreated && onCreated()
      })
      .catch((e) => {
        setConfirming(false)
        setError(e?.message || 'No se pudo enviar el formato')
      })
      .finally(() => setSaving(false))
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Cuchilla y grafa: cm usados + tipo de puntos; las medidas fijas se muestran solas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, rowGap: 14 }}>
        <FieldGroup title="Cuchilla">
          <Field label="cm" w={90}><NumField placeholder="0" value={form.cuchilla_cm} onChange={v => set('cuchilla_cm', v)} /></Field>
          <Field label="Tipo" w={110}>
            <select className="input" value={form.cuchilla_puntos} onChange={e => set('cuchilla_puntos', e.target.value)}>
              <option value="">—</option>
              <option value="2">2 puntos</option>
              <option value="3">3 puntos</option>
            </select>
          </Field>
          {form.cuchilla_puntos && (
            <SpecHint>
              Altura {PUNTOS_SPECS[form.cuchilla_puntos].altura} mm · Espesor {PUNTOS_SPECS[form.cuchilla_puntos].espesor} mm
            </SpecHint>
          )}
          <Field label="Desperdicio (cm)" w={110}><NumField placeholder="0" value={form.desperdicio_cm} onChange={v => set('desperdicio_cm', v)} /></Field>
          <span style={{ fontSize: 12, fontWeight: 700, alignSelf: 'flex-end', paddingBottom: 8, whiteSpace: 'nowrap' }}>
            Total {fmtNum((Number(form.cuchilla_cm) || 0) + (Number(form.desperdicio_cm) || 0), 2)} cm
          </span>
        </FieldGroup>
        <FieldGroup title="Grafa">
          <Field label="cm" w={90}><NumField placeholder="0" value={form.grafa_cm} onChange={v => set('grafa_cm', v)} /></Field>
          <Field label="Tipo" w={110}>
            <select
              className="input" value={form.grafa_puntos}
              onChange={e => setForm(f => ({
                ...f, grafa_puntos: e.target.value,
                grafa_altura: e.target.value === '2' ? f.grafa_altura : '',
              }))}
            >
              <option value="">—</option>
              <option value="2">2 puntos</option>
              <option value="3">3 puntos</option>
            </select>
          </Field>
          {form.grafa_puntos === '2' && (
            <>
              <Field label="Altura" w={110}>
                <select className="input" value={form.grafa_altura} onChange={e => set('grafa_altura', e.target.value)}>
                  <option value="">—</option>
                  {GRAFA_ALTURAS.map(a => <option key={a} value={a}>{a.replace('.', ',')} mm</option>)}
                </select>
              </Field>
              <SpecHint>Espesor {PUNTOS_SPECS['2'].espesor} mm</SpecHint>
            </>
          )}
          {form.grafa_puntos === '3' && (
            <SpecHint>
              Altura {GRAFA_3PT_ALTURA} mm · Espesor {PUNTOS_SPECS['3'].espesor} mm
            </SpecHint>
          )}
        </FieldGroup>
      </div>

      {/* Pares cm + tamaño agrupados por concepto */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, rowGap: 14 }}>
        <FieldGroup title="CH">
          <Field label="cm" w={90}><NumField placeholder="0" value={form.ch_cm} onChange={v => set('ch_cm', v)} /></Field>
          <Field label="Tamaño" w={100}>
            <select className="input" value={form.ch_medida} onChange={e => set('ch_medida', e.target.value)}>
              <option value="">—</option>
              {CH_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </FieldGroup>
        <FieldGroup title="Sacabocados">
          <Field label="Cantidad" w={90}><NumField step={1} placeholder="0" value={form.sac_cantidad} onChange={v => set('sac_cantidad', v)} /></Field>
          <Field label="Tipo" w={130}>
            <select className="input" value={form.sac_medida} onChange={e => set('sac_medida', e.target.value)}>
              <option value="">—</option>
              {SAC_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        </FieldGroup>
        <FieldGroup title="Perforado">
          <Field label="cm" w={90}><NumField placeholder="0" value={form.perfo_cm} onChange={v => set('perfo_cm', v)} /></Field>
          <Field label="Tamaño" w={100}>
            <select className="input" value={form.perfo_medida} onChange={e => set('perfo_medida', e.target.value)}>
              <option value="">—</option>
              {PERFO_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </FieldGroup>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Field label="gan" w={140}><input className="input" value={form.gan} onChange={e => set('gan', e.target.value)} /></Field>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          Caucho — tipo(s) usados y cm de cada uno
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.cauchos.map((row, idx) => (
            <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <Field label={idx === 0 ? 'Tipo de caucho' : ''} w={170}>
                <select className="input" value={row.tipo} onChange={e => setCaucho(idx, 'tipo', e.target.value)}>
                  {CAUCHO_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label={idx === 0 ? 'Cantidad (cm)' : ''} w={110}><NumField placeholder="0" value={row.cm} onChange={v => setCaucho(idx, 'cm', v)} /></Field>
              <button
                className="btn sm" onClick={() => removeCaucho(idx)}
                disabled={form.cauchos.length === 1}
                style={{ marginBottom: 4 }}
              >
                Quitar
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={addCaucho} style={{ alignSelf: 'flex-start', marginTop: 2 }}>+ Agregar caucho</button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          Tiempos
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Field label="Encalado"><HourMinField minutes={form.tiempo_encalado_min} onChange={v => set('tiempo_encalado_min', v)} /></Field>
          <Field label="Encuchillado"><HourMinField minutes={form.tiempo_encuchillado_min} onChange={v => set('tiempo_encuchillado_min', v)} /></Field>
          <Field label="Encauchado"><HourMinField minutes={form.tiempo_encauchado_min} onChange={v => set('tiempo_encauchado_min', v)} /></Field>
        </div>
      </div>

      {error && <div style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>{error}</div>}
      {okMsg && <div style={{ color: 'var(--accent)', fontSize: 12 }}>{okMsg}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        {isEdit ? (
          <>
            <button className="btn primary" onClick={submitEdit} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
            {onCancel && <button className="btn" onClick={onCancel} disabled={saving}>Cancelar</button>}
          </>
        ) : (
          <>
            <button className="btn" onClick={saveDraft} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar avance'}
            </button>
            <button className="btn primary" onClick={() => { setError(null); setConfirming(true) }} disabled={saving}>
              {reenvio ? 'Reenviar formato' : 'Enviar formato'}
            </button>
          </>
        )}
      </div>

      {confirming && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, maxWidth: 420, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
              {reenvio ? '⚠ Confirmar reenvío del formato' : '⚠ Confirmar envío del formato'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
              ¿La información registrada es correcta? El formato quedará <strong>pendiente de
              aprobación del administrador</strong> y no podrás modificarlo mientras se revisa.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirming(false)} disabled={saving}>Cancelar</button>
              <button className="btn primary" onClick={submitSend} disabled={saving}>
                {saving ? 'Enviando…' : (reenvio ? 'Sí, reenviar' : 'Sí, enviar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────── Historial de formatos (auditoría Admin / propio Operador) ──────────

const fmtFecha = (s) => {
  try { return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

const ESTADO_BADGE = {
  pendiente: { label: 'Pendiente', bg: 'var(--warn-soft, #fef6e7)', color: 'var(--warn, #e0a800)' },
  aprobado: { label: 'Aprobado', bg: 'var(--ok-soft, #e8f6ec)', color: 'var(--ok, #2e8b57)' },
  devuelto: { label: 'Devuelto', bg: 'var(--danger-soft, #fdecea)', color: 'var(--danger, #c0392b)' },
  borrador: { label: 'Borrador', bg: 'var(--surface-2, #f2f2f2)', color: 'var(--ink-3, #777)' },
}

export function EstadoFormatoBadge({ estado }) {
  const b = ESTADO_BADGE[estado] || ESTADO_BADGE.pendiente
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: b.bg, color: b.color, border: `1px solid ${b.color}` }}>
      {b.label}
    </span>
  )
}

export function FormatosCuchillasHistory({ formatos, loading, onEdit, showOrden = false, canEdit = () => true }) {
  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
  if (!formatos.length) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin formatos registrados.</div>
  const headers = ['Fecha / Hora', 'Estado', 'Operador', 'Cuchilla', 'Desperdicio', 'Total', 'Grafa', 'Caucho', 'Puntos', 'ch / sac / perfo / gan', 'Tiempos (enc/cuch/cauch)']
  if (showOrden) headers.unshift('OP #', 'Cliente')
  if (onEdit) headers.push('')

  // Nuevo formato: "12,50cm 4x4" — legacy: texto libre
  const medidaCell = (cm, medida, legacy) => {
    if (Number(cm) > 0 || medida) return `${fmtNum(cm, 2)}cm${medida ? ` ${medida}` : ''}`
    return legacy || ''
  }

  // Sacabocados: cantidad × tipo; los registros viejos conservan sus cm
  const sacCell = (f) => {
    if (Number(f.sac_cm) > 0) return medidaCell(f.sac_cm, f.sac_medida, f.sac)
    if (f.sac_medida) {
      const tipo = SAC_SIZE_LABELS[f.sac_medida] || f.sac_medida
      return Number(f.sac_cantidad) > 0 ? `${f.sac_cantidad} × ${tipo}` : tipo
    }
    return f.sac || ''
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--line)' }}>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {formatos.map((f, idx) => {
            // Nuevo formato: puntos por material — legacy: booleanos compartidos
            const puntosNuevo = [
              f.cuchilla_puntos && `C ${f.cuchilla_puntos}pt`,
              f.grafa_puntos && `G ${f.grafa_puntos}pt${f.grafa_altura ? ` (${f.grafa_altura.replace('.', ',')})` : ''}`,
            ].filter(Boolean).join(' · ')
            const puntos = puntosNuevo
              || [f.dos_puntos && '2pt', f.tres_puntos && '3pt', f.perfo && 'perfo'].filter(Boolean).join(', ')
              || '—'
            const caucho = (f.cauchos || []).length
              ? f.cauchos.map(r => `${CAUCHO_TIPO_LABELS[r.tipo] || r.tipo}: ${fmtNum(r.cm, 2)}`).join(' · ')
              : '—'
            const chSacGan = [
              medidaCell(f.ch_cm, f.ch_medida, f.ch),
              sacCell(f),
              medidaCell(f.perfo_cm, f.perfo_medida, ''),
              f.gan,
            ].filter(Boolean).join(' / ') || '—'
            const desperdicio = Number(f.desperdicio_cm) > 0
              ? `${fmtNum(f.desperdicio_cm, 2)} cm`
              : (f.desperdicio || '—')
            const totalCuchilla = (Number(f.cuchilla_cm) || 0) + (Number(f.desperdicio_cm) || 0)
            const editable = !!onEdit && canEdit(f)
            const zebra = idx % 2 ? 'var(--surface-2)' : 'var(--surface)'
            return (
              <tr
                key={f.id}
                title={editable ? 'Clic para editar' : undefined}
                onClick={editable ? () => onEdit(f) : undefined}
                onMouseEnter={editable ? (e) => { e.currentTarget.style.background = 'var(--accent-soft, #eef4fd)' } : undefined}
                onMouseLeave={editable ? (e) => { e.currentTarget.style.background = zebra } : undefined}
                style={{ borderBottom: '1px solid var(--line)', background: zebra, cursor: editable ? 'pointer' : 'default' }}
              >
                {showOrden && (
                  <>
                    <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{f.orden_numero || '—'}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12 }}>{f.cliente_nombre || '—'}</td>
                  </>
                )}
                <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtFecha(f.fecha_hora)}</td>
                <td style={{ padding: '8px 12px' }}><EstadoFormatoBadge estado={f.estado} /></td>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{f.operador_username || '—'}</td>
                <td style={{ padding: '8px 12px' }}>{fmtNum(f.cuchilla_cm, 2)}</td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>{desperdicio}</td>
                <td style={{ padding: '8px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{totalCuchilla > 0 ? `${fmtNum(totalCuchilla, 2)} cm` : '—'}</td>
                <td style={{ padding: '8px 12px' }}>{fmtNum(f.grafa_cm, 2)}</td>
                <td style={{ padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>{caucho}</td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>{puntos}</td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>{chSacGan}</td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>{[f.tiempo_encalado_min, f.tiempo_encuchillado_min, f.tiempo_encauchado_min].map(fmtMin).join(' / ')}</td>
                {onEdit && (
                  <td style={{ padding: '8px 12px' }}>
                    {canEdit(f) && <button className="btn sm" onClick={(e) => { e.stopPropagation(); onEdit(f) }}>Editar</button>}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ────────── Historial de cambios de la OP (referencia / entrega / cliente) ──────────

export function OrdenCambiosHistory({ cambios, loading }) {
  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
  if (!cambios || !cambios.length) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin cambios registrados.</div>
  const headers = ['Fecha / Hora', 'Usuario', 'Campo', 'Antes', 'Después']
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--line)' }}>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cambios.map((c, idx) => (
            <tr key={c.id} style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)' }}>
              <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtFecha(c.fecha_hora)}</td>
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{c.usuario_username || '—'}</td>
              <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12 }}>{c.campo_label || c.campo}</td>
              <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--ink-3)' }}>{c.valor_anterior || '—'}</td>
              <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>{c.valor_nuevo || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ────────── Costos de troquel (Admin) ──────────

export function TroquelCostos({ ordenId, refreshKey, onDirtyChange }) {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [okMsg, setOkMsg] = useState(false)
  const [dirty, setDirty] = useState(false)

  // El padre (p.ej. la revisión) necesita saber si hay costos sin guardar
  useEffect(() => { onDirtyChange && onDirtyChange(dirty) }, [dirty])

  useEffect(() => {
    setLoading(true)
    setError(null)
    getTroquelCostos(ordenId)
      .then(data => { setItems(data.items || []); setDirty(false) })
      .catch(() => setItems(null))
      .finally(() => setLoading(false))
  }, [ordenId, refreshKey])

  const setItem = (idx, k, v) => {
    setItems(list => list.map((it, i) => (i === idx ? { ...it, [k]: v } : it)))
    setDirty(true)
    setOkMsg(false)
  }

  const save = () => {
    setSaving(true); setError(null); setOkMsg(false)
    saveTroquelCostos(ordenId, items.map(({ total, ...it }) => it))
      .then(data => { setItems(data.items || []); setDirty(false); setOkMsg(true) })
      .catch(() => setError('No se pudieron guardar los costos'))
      .finally(() => setSaving(false))
  }

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Calculando…</div>
  if (!items) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin datos de costos.</div>
  if (!items.length) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
        Sin formato de cuchillas registrado — los costos se generan del formato del operador.
      </div>
    )
  }

  const total = items.reduce((acc, it) => acc + (Number(it.cantidad) || 0) * (Number(it.precio) || 0), 0)
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--line)' }}>
              {['Concepto', 'Detalle', 'Cantidad', 'Precio unit.', 'Total'].map((h, i) => (
                <th key={i} style={{ padding: '10px 12px', textAlign: i > 1 ? 'right' : 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)', background: 'var(--surface-2)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.key || idx} style={{ borderBottom: '1px solid var(--line)', background: idx % 2 ? 'var(--surface-2)' : 'var(--surface)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{it.concepto}</td>
                <td style={{ padding: '8px 12px', color: 'var(--ink-3)', fontSize: 12 }}>{it.detalle}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 90, display: 'inline-block' }}>
                      <NumField value={it.cantidad} onChange={v => setItem(idx, 'cantidad', v)} placeholder="0" />
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)', width: 24 }}>{it.unidad}</span>
                  </span>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <span style={{ width: 120, display: 'inline-block' }}>
                    <MoneyInput value={Number(it.precio) || 0} onChange={v => setItem(idx, 'precio', v)} suffix="" placeholder="0" />
                  </span>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                  {fmtCOP((Number(it.cantidad) || 0) * (Number(it.precio) || 0))}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--line)' }}>
              <td colSpan={4} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>Total</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>{fmtCOP(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: '1px solid var(--line)' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Guardando…' : 'Guardar costos'}
        </button>
        {okMsg && <span style={{ fontSize: 12, color: 'var(--ok, #2e9e5b)' }}>Costos guardados ✓</span>}
        {error && <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>{error}</span>}
      </div>
    </div>
  )
}

// ────────── Nueva tarea de troquel (Admin) ──────────
// Crea una OP directa (sin cotización) con el proceso "troquel" activo y le
// adjunta el modelo (PDF/imagen + campos técnicos) en un solo flujo.

const EMPTY_TAREA_MODELO = {
  troquel_numero: '', pinza: '', madera: '', cuchilla_puntos: '', material: '',
  espejo: false, instrucciones: '',
  corte_cm: 0, score_cm: 0, hendido_cm: 0,
}

export function NuevaTareaTroquelModal({ onClose, onCreated }) {
  const [op, setOp] = useState({ cliente: '', clienteId: null, referencia: '', cantidad: 0, fechaEntrega: '' })
  const [modelo, setModelo] = useState(EMPTY_TAREA_MODELO)
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [showSugg, setShowSugg] = useState(false)
  const searchRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [createdOrden, setCreatedOrden] = useState(null)  // OP ya creada: el reintento solo re-envía el modelo

  const setM = (k, v) => setModelo(m => ({ ...m, [k]: v }))

  useEffect(() => {
    if (archivo && archivo.type?.startsWith('image/')) {
      const url = URL.createObjectURL(archivo)
      setPreview(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreview(null)
  }, [archivo])

  const handleClienteChange = (v) => {
    setOp(o => ({ ...o, cliente: v, clienteId: null }))
    clearTimeout(searchRef.current)
    if (!v.trim()) { setSuggestions([]); setShowSugg(false); return }
    searchRef.current = setTimeout(() => {
      getClientes(v).then(data => {
        const results = data.results || data
        setSuggestions(results)
        setShowSugg(results.length > 0)
      }).catch(() => {})
    }, 250)
  }

  const selectCliente = (c) => {
    setOp(o => ({ ...o, cliente: c.nombre, clienteId: c.id }))
    setSuggestions([])
    setShowSugg(false)
  }

  const hasModeloData = () =>
    ['troquel_numero', 'pinza', 'madera', 'cuchilla_puntos', 'material', 'instrucciones'].some(k => String(modelo[k] || '').trim())
    || modelo.espejo
    || ['corte_cm', 'score_cm', 'hendido_cm'].some(k => Number(modelo[k]) > 0)

  // El visor del operador solo muestra instrucciones + archivo: si no se
  // escribieron instrucciones, se componen desde los campos técnicos.
  const composedInstrucciones = () => {
    if (modelo.instrucciones.trim()) return modelo.instrucciones
    const campos = [
      ['Troquel', modelo.troquel_numero],
      ['Pinza', modelo.pinza],
      ['Madera', modelo.madera],
      ['Cuchilla', modelo.cuchilla_puntos],
      ['Material', modelo.material],
    ].filter(([, v]) => String(v || '').trim())
    if (!campos.length) return ''
    return campos.map(([k, v]) => `${k}: ${v}`).join('\n') + (modelo.espejo ? '' : '\n(NO Hacer espejo)')
  }

  const submit = async () => {
    setError(null)
    if (!createdOrden) {
      if (!op.cliente.trim()) { setError('El campo Cliente es obligatorio'); return }
      if (!op.referencia.trim()) { setError('El campo Referencia es obligatorio'); return }
      if (!(Number(op.cantidad) > 0)) { setError('La cantidad debe ser mayor a 0'); return }
    }
    setSaving(true)
    try {
      let orden = createdOrden
      if (!orden) {
        let clienteId = op.clienteId
        if (!clienteId) {
          const nuevo = await createCliente({ nombre: op.cliente.trim(), tipo: 'final' })
          clienteId = nuevo.id
          setOp(o => ({ ...o, clienteId }))
        }
        orden = await createOrden({
          fecha: new Date().toISOString().slice(0, 10),
          fecha_entrega: op.fechaEntrega || null,
          cliente: clienteId,
          referencia: op.referencia.trim(),
          cantidad: Number(op.cantidad),
          procesos: [{ proceso_id: 'troquel', active: true }],
        })
        setCreatedOrden(orden)
      }
      if (archivo || hasModeloData()) {
        const fd = new FormData()
        fd.append('orden', orden.id)
        ;['troquel_numero', 'pinza', 'madera', 'cuchilla_puntos', 'material'].forEach(k => fd.append(k, modelo[k] ?? ''))
        fd.append('instrucciones', composedInstrucciones())
        fd.append('espejo', modelo.espejo ? 'true' : 'false')
        ;['corte_cm', 'score_cm', 'hendido_cm'].forEach(k => fd.append(k, modelo[k] ?? 0))
        if (archivo) fd.append('archivo', archivo)
        await saveTroquelModelo(null, fd)
      }
      onCreated(orden)
    } catch (e) {
      setError(createdOrden
        ? `La OP ${createdOrden.numero} se creó, pero el modelo no se pudo guardar. Reintenta o adjúntalo después desde la lista.`
        : (e?.message || 'No se pudo crear la tarea'))
    } finally {
      setSaving(false)
    }
  }

  const opLocked = !!createdOrden

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 12, maxWidth: 680, width: '100%',
        padding: 24, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Nueva tarea de troquel</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="Archivo del modelo (imagen / PDF)" full>
            <input type="file" accept="image/*,application/pdf" onChange={e => setArchivo(e.target.files[0] || null)} />
          </Field>
          {preview ? (
            <img src={preview} alt="Vista previa" style={{ maxWidth: 360, maxHeight: 220, borderRadius: 8, border: '1px solid var(--line)' }} />
          ) : archivo ? (
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>📄 {archivo.name}</span>
          ) : null}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Datos del troquel
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Field label="N° troquel"><input className="input" value={modelo.troquel_numero} onChange={e => setM('troquel_numero', e.target.value)} /></Field>
            <Field label="Pinza"><input className="input" value={modelo.pinza} onChange={e => setM('pinza', e.target.value)} /></Field>
            <Field label="Madera"><input className="input" value={modelo.madera} onChange={e => setM('madera', e.target.value)} /></Field>
            <Field label="Cuchilla (puntos)"><input className="input" value={modelo.cuchilla_puntos} onChange={e => setM('cuchilla_puntos', e.target.value)} /></Field>
            <Field label="Material"><input className="input" value={modelo.material} onChange={e => setM('material', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <Checkbox checked={modelo.espejo} onChange={() => setM('espejo', !modelo.espejo)} />
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Hacer espejo <span style={{ color: 'var(--ink-3)' }}>(sin marcar = NO hacer espejo)</span></span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            <Field label="Corte (cm)" w={110}><NumField value={modelo.corte_cm} onChange={v => setM('corte_cm', v)} /></Field>
            <Field label="Score (cm)" w={110}><NumField value={modelo.score_cm} onChange={v => setM('score_cm', v)} /></Field>
            <Field label="C. Hendido (cm)" w={110}><NumField value={modelo.hendido_cm} onChange={v => setM('hendido_cm', v)} /></Field>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            <Field label="Instrucciones adicionales (visibles al operador)" full>
              <textarea className="input" rows={3} value={modelo.instrucciones} onChange={e => setM('instrucciones', e.target.value)} />
            </Field>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Datos de la OP
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Field label={
              <>Cliente *
                {op.clienteId && <span style={{ marginLeft: 6, color: 'var(--ok, #27ae60)' }}>✓ vinculado</span>}
                {!op.clienteId && op.cliente && <span style={{ marginLeft: 6, color: 'var(--ink-3)' }}>· se creará nuevo</span>}
              </>
            } full>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  placeholder="Buscar cliente existente o escribir nuevo…"
                  value={op.cliente}
                  disabled={opLocked}
                  onChange={e => handleClienteChange(e.target.value)}
                  onBlur={() => setTimeout(() => setShowSugg(false), 150)}
                  onFocus={() => suggestions.length > 0 && setShowSugg(true)}
                />
                {showSugg && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2,
                  }}>
                    {suggestions.map(c => (
                      <div
                        key={c.id}
                        onMouseDown={() => selectCliente(c)}
                        style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{ flex: 1 }}>{c.nombre}</span>
                        {c.tipo === 'terciario' && <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Terciario</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Field label="Referencia *">
              <input className="input" value={op.referencia} disabled={opLocked} onChange={e => setOp(o => ({ ...o, referencia: e.target.value }))} />
            </Field>
            <Field label="Cantidad *" w={100}>
              <input className="input" type="number" min="1" value={op.cantidad || ''} disabled={opLocked} onChange={e => setOp(o => ({ ...o, cantidad: e.target.value }))} />
            </Field>
            <Field label="Fecha de entrega" w={150}>
              <input className="input" type="date" value={op.fechaEntrega} disabled={opLocked} onChange={e => setOp(o => ({ ...o, fechaEntrega: e.target.value }))} />
            </Field>
          </div>
        </div>

        {error && <div style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? 'Creando…' : (opLocked ? 'Reintentar modelo' : 'Crear tarea')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
