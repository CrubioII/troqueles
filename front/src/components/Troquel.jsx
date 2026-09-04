import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { fmtCOP, fmtNum, NumField, MoneyInput, SaveStatus } from './core'
import { useAutosave } from '../hooks/useAutosave'
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
const PERFO_SIZES = ['1x1', '2x1', '2x2', '3x1', '3x2', '3x3', '4x1', '4x2', '4x3', '4x4', '6x6', '10x10', 'GLUE']
const CAUCHO_TIPOS = [
  { value: 'verde', label: 'Caucho Verde' },
  { value: 'profigumi', label: 'Profigumi' },
  { value: 'blucolan', label: 'Blucolan' },
]
const CAUCHO_TIPO_LABELS = Object.fromEntries(CAUCHO_TIPOS.map(t => [t.value, t.label]))
// Tipo de cuchilla: independiente de los puntos y con precio propio por cliente
const CUCHILLA_TIPOS = [
  { value: 'doble_bisel', label: 'Doble bisel' },
  { value: 'bohler', label: 'Bohler' },
]
const CUCHILLA_TIPO_LABELS = Object.fromEntries(CUCHILLA_TIPOS.map(t => [t.value, t.label]))
const GAN_TIPOS = [
  { value: 'ojo_pescado', label: 'Ojo de pescado' },
  { value: 'gancho', label: 'Gancho' },
  { value: 'ventanera', label: 'Ventanera' },
]
const GAN_TIPO_LABELS = Object.fromEntries(GAN_TIPOS.map(t => [t.value, t.label]))
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
  cuchilla_cm: 0, cuchilla_tipo: '', cuchilla_puntos: '',
  grafa_cm: 0, grafa_puntos: '', grafa_altura: '',
  ch_cm: 0, ch_medida: '',
  perfo_cm: 0, perfo_medida: '',
  observaciones: '',
  cauchos: [{ tipo: 'verde', cm: 0 }],
  sacabocados: [{ medida: '', cantidad: 0 }],
  gan: [{ tipo: '', cantidad: 0 }],
  desperdicio_cm: 0,
  madera: '',
  tiempo_encalado_min: 0, tiempo_encuchillado_min: 0, tiempo_encauchado_min: 0,
}

// Payload explícito: los campos legacy (ch, sac, perfo, desperdicio…) que llegan
// al cargar un formato existente son de solo lectura y no deben reenviarse.
const formatoPayload = (form) => {
  const data = Object.fromEntries(Object.keys(EMPTY_FORMATO).map(k => [k, form[k]]))
  // Una fila de sacabocados sin medida (o de gan sin tipo) es solo el placeholder
  // del formulario: no se envía, para no chocar con la validación de tipo requerido.
  data.sacabocados = (data.sacabocados || []).filter(f => f.medida !== '')
  data.gan = (data.gan || []).filter(f => f.tipo !== '')
  return data
}

const initFormato = (formato) => {
  if (!formato) return EMPTY_FORMATO
  const f = { ...EMPTY_FORMATO }
  Object.keys(EMPTY_FORMATO).forEach(k => { if (formato[k] != null) f[k] = formato[k] })
  if (!Array.isArray(f.cauchos) || !f.cauchos.length) f.cauchos = [{ tipo: 'verde', cm: 0 }]
  if (!Array.isArray(f.sacabocados) || !f.sacabocados.length) f.sacabocados = [{ medida: '', cantidad: 0 }]
  if (!Array.isArray(f.gan) || !f.gan.length) f.gan = [{ tipo: '', cantidad: 0 }]
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
  // siguientes hacen PATCH en vez de POST (una sola fila por OP). Se guarda
  // también en un ref porque submitSend necesita el valor más reciente justo
  // después de esperar a que el autosave en curso termine (el closure de
  // `draftId` puede quedar desactualizado mientras React re-renderiza).
  const draftIdRef = useRef(formato?.id || null)
  const [draftId, setDraftIdState] = useState(formato?.id || null)
  const setDraftId = (idVal) => { draftIdRef.current = idVal; setDraftIdState(idVal) }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setCaucho = (idx, k, v) =>
    setForm(f => ({ ...f, cauchos: f.cauchos.map((row, i) => (i === idx ? { ...row, [k]: v } : row)) }))
  const addCaucho = () => setForm(f => ({ ...f, cauchos: [...f.cauchos, { tipo: 'verde', cm: 0 }] }))
  const removeCaucho = (idx) => setForm(f => ({ ...f, cauchos: f.cauchos.filter((_, i) => i !== idx) }))
  const setSac = (idx, k, v) =>
    setForm(f => ({ ...f, sacabocados: f.sacabocados.map((row, i) => (i === idx ? { ...row, [k]: v } : row)) }))
  const addSac = () => setForm(f => ({ ...f, sacabocados: [...f.sacabocados, { medida: '', cantidad: 0 }] }))
  const removeSac = (idx) => setForm(f => ({ ...f, sacabocados: f.sacabocados.filter((_, i) => i !== idx) }))
  const setGan = (idx, k, v) =>
    setForm(f => ({ ...f, gan: f.gan.map((row, i) => (i === idx ? { ...row, [k]: v } : row)) }))
  const addGan = () => setForm(f => ({ ...f, gan: [...f.gan, { tipo: '', cantidad: 0 }] }))
  const removeGan = (idx) => setForm(f => ({ ...f, gan: f.gan.filter((_, i) => i !== idx) }))

  const { status: saveStatus, retry: retrySave, flush: flushSave } = useAutosave(
    form,
    async (v) => {
      if (isEdit) {
        await updateFormatoCuchillas(formato.id, formatoPayload(v))
        onUpdated && onUpdated()
      } else {
        const f = draftIdRef.current
          ? await updateFormatoCuchillas(draftIdRef.current, formatoPayload(v))
          : await createFormatoCuchillas({ orden: ordenId, ...formatoPayload(v) })
        if (f?.id) setDraftId(f.id)
        onDraftSaved && onDraftSaved(f)
      }
    },
    { enabled: false }
  )

  // Enviar (Operador): se confirma en el modal y queda pendiente de aprobación.
  const submitSend = async () => {
    // El tipo de cuchilla define el precio: sin él la remisión no se puede cotizar.
    if ((Number(form.cuchilla_cm) || 0) > 0 && !form.cuchilla_tipo) {
      setConfirming(false)
      setError('Seleccione el tipo de cuchilla (doble bisel o Bohler).')
      return
    }
    setSaving(true); setError(null)
    try {
      await flushSave()
      const req = draftIdRef.current
        ? updateFormatoCuchillas(draftIdRef.current, { ...formatoPayload(form), enviar: true })
        : createFormatoCuchillas({ orden: ordenId, ...formatoPayload(form), enviar: true })
      await req
      setForm(EMPTY_FORMATO)
      setConfirming(false)
      onCreated && onCreated()
    } catch (e) {
      setConfirming(false)
      setError(e?.message || 'No se pudo enviar el formato')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Cuchilla y grafa: cm usados + tipo de puntos; las medidas fijas se muestran solas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, rowGap: 14 }}>
        <FieldGroup title="Cuchilla">
          <Field label="cm" w={90}><NumField placeholder="0" value={form.cuchilla_cm} onChange={v => set('cuchilla_cm', v)} /></Field>
          <Field label="Cuchilla" w={130}>
            <select className="input" value={form.cuchilla_tipo} onChange={e => set('cuchilla_tipo', e.target.value)}>
              <option value="">—</option>
              {CUCHILLA_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Puntos" w={110}>
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
        <FieldGroup title="Madera">
          {/* Texto libre: medidas, tipo de bloque o cualquier nota; es informativo. */}
          <Field label="Medida" w={160}>
            <input className="input" placeholder="—" value={form.madera} onChange={e => set('madera', e.target.value)} />
          </Field>
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
          Sacabocados — tipo(s) usados y cantidad de cada uno
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.sacabocados.map((row, idx) => (
            <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <Field label={idx === 0 ? 'Tipo' : ''} w={130}>
                <select className="input" value={row.medida} onChange={e => setSac(idx, 'medida', e.target.value)}>
                  <option value="">—</option>
                  {SAC_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label={idx === 0 ? 'Cantidad' : ''} w={90}><NumField step={1} placeholder="0" value={row.cantidad} onChange={v => setSac(idx, 'cantidad', v)} /></Field>
              <button
                className="btn sm" onClick={() => removeSac(idx)}
                disabled={form.sacabocados.length === 1}
                style={{ marginBottom: 4 }}
              >
                Quitar
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={addSac} style={{ alignSelf: 'flex-start', marginTop: 2 }}>+ Agregar sacabocado</button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          Gan — tipo(s) usados y cantidad de cada uno
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.gan.map((row, idx) => (
            <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <Field label={idx === 0 ? 'Tipo' : ''} w={150}>
                <select className="input" value={row.tipo} onChange={e => setGan(idx, 'tipo', e.target.value)}>
                  <option value="">—</option>
                  {GAN_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label={idx === 0 ? 'Cantidad' : ''} w={90}><NumField step={1} placeholder="0" value={row.cantidad} onChange={v => setGan(idx, 'cantidad', v)} /></Field>
              <button
                className="btn sm" onClick={() => removeGan(idx)}
                disabled={form.gan.length === 1}
                style={{ marginBottom: 4 }}
              >
                Quitar
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={addGan} style={{ alignSelf: 'flex-start', marginTop: 2 }}>+ Agregar gan</button>
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

      {/* Nota de este troquel: sale impresa bajo su bloque en la remisión */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          Observaciones
        </div>
        <textarea
          className="input"
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
          placeholder="Notas sobre este troquel (aparecen en la remisión, bajo esta OP)…"
          value={form.observaciones}
          onChange={e => set('observaciones', e.target.value)}
        />
      </div>

      {error && <div style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {isEdit ? (
          onCancel && <button className="btn" onClick={onCancel} disabled={saving}>Cancelar</button>
        ) : (
          <button className="btn primary" onClick={() => { setError(null); setConfirming(true) }} disabled={saving}>
            {reenvio ? 'Reenviar formato' : 'Enviar formato'}
          </button>
        )}
        <button className="btn" onClick={retrySave} disabled={saveStatus === 'saving'}>Guardar</button>
        <SaveStatus status={saveStatus} onRetry={retrySave} />
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

export function FormatosCuchillasHistory({ formatos, loading, onEdit, showOrden = false, compact = false, canEdit = () => true, onUnlock, canUnlock = () => false, unlockBusyId }) {
  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Cargando…</div>
  if (!formatos.length) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>Sin formatos registrados.</div>

  // Vista compacta (historial del operador): un resumen por fila, sin todo el formulario.
  if (compact) {
    const chdrs = ['OP #', 'Referencia', 'Cliente', 'Fecha / Hora', 'Estado', 'Operador', 'Cuchilla (cm)']
    if (onEdit || onUnlock) chdrs.push('')
    return (
      <div className="table-scroll">
        <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--line)' }}>
              {chdrs.map((h, i) => (
                <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {formatos.map((f, idx) => {
              const totalCuchilla = (Number(f.cuchilla_cm) || 0) + (Number(f.desperdicio_cm) || 0)
              const editable = !!onEdit && canEdit(f)
              const unlockable = !editable && !!onUnlock && canUnlock(f)
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
                  <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{f.orden_numero || '—'}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--ink-2)', fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.referencia || '—'}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12 }}>{f.cliente_nombre || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtFecha(f.fecha_hora)}</td>
                  <td style={{ padding: '8px 12px' }}><EstadoFormatoBadge estado={f.estado} /></td>
                  <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12 }}>{f.operador_username || '—'}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{totalCuchilla > 0 ? fmtNum(totalCuchilla, 2) : '—'}</td>
                  {(onEdit || onUnlock) && (
                    <td style={{ padding: '8px 12px' }}>
                      {editable && <button className="btn sm" onClick={(e) => { e.stopPropagation(); onEdit(f) }}>Editar</button>}
                      {unlockable && (
                        <button
                          className="btn sm"
                          disabled={unlockBusyId === f.id}
                          onClick={(e) => { e.stopPropagation(); onUnlock(f) }}
                        >
                          {unlockBusyId === f.id ? 'Desbloqueando…' : 'Editar'}
                        </button>
                      )}
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

  const headers = ['Fecha / Hora', 'Estado', 'Operador', 'Cuchilla', 'Desperdicio', 'Total', 'Grafa', 'Caucho', 'Puntos', 'ch / sac / perfo / gan', 'Tiempos (enc/cuch/cauch)', 'Observaciones']
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
    <div className="table-scroll">
      <table style={{ width: '100%', minWidth: 1200, borderCollapse: 'collapse' }}>
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
              f.cuchilla_tipo && (CUCHILLA_TIPO_LABELS[f.cuchilla_tipo] || f.cuchilla_tipo),
              f.cuchilla_puntos && `C ${f.cuchilla_puntos}pt`,
              f.grafa_puntos && `G ${f.grafa_puntos}pt${f.grafa_altura ? ` (${f.grafa_altura.replace('.', ',')})` : ''}`,
            ].filter(Boolean).join(' · ')
            const puntos = puntosNuevo
              || [f.dos_puntos && '2pt', f.tres_puntos && '3pt', f.perfo && 'perfo'].filter(Boolean).join(', ')
              || '—'
            const caucho = (f.cauchos || []).length
              ? f.cauchos.map(r => `${CAUCHO_TIPO_LABELS[r.tipo] || r.tipo}: ${fmtNum(r.cm, 2)}`).join(' · ')
              : '—'
            const sac = (f.sacabocados || []).length
              ? f.sacabocados.map(r => `${SAC_SIZE_LABELS[r.medida] || r.medida}: ${r.cantidad}`).join(' · ')
              : sacCell(f)
            const gan = (f.gan || []).length
              ? f.gan.map(r => `${GAN_TIPO_LABELS[r.tipo] || r.tipo}: ${r.cantidad}`).join(' · ')
              : (f.gan_legacy || '')
            const chSacGan = [
              medidaCell(f.ch_cm, f.ch_medida, f.ch),
              sac,
              medidaCell(f.perfo_cm, f.perfo_medida, ''),
              gan,
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
                <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--ink-2)', maxWidth: 260, whiteSpace: 'pre-wrap' }} title={f.observaciones || ''}>{f.observaciones || '—'}</td>
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
    <div className="table-scroll">
      <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
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

// `onSaved` lo usa la remisión: al guardar precios el backend recalcula el valor
// cobrado del ítem, así que la pantalla que la muestra tiene que recargarse.
// El ref expone `saveIfDirty()` para que un padre (p.ej. RemisionEdit) pueda
// forzar el guardado de ediciones pendientes antes de generar un PDF o enviar.
// Sin botón propio de guardado: el único "Guardar" de la pantalla es el de
// abajo (bajo Observaciones), que guarda esto junto con todo lo demás.
export const TroquelCostos = forwardRef(function TroquelCostos(
  { ordenId, refreshKey, onDirtyChange, onSaved }, ref
) {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const savedSnapshotRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getTroquelCostos(ordenId)
      .then(data => {
        const its = data.items || []
        setItems(its)
        savedSnapshotRef.current = JSON.stringify(its.map(({ key, cantidad, precio }) => ({ key, cantidad, precio })))
      })
      .catch(() => setItems(null))
      .finally(() => setLoading(false))
  }, [ordenId, refreshKey])

  const setItem = (idx, k, v) => {
    setItems(list => list.map((it, i) => (i === idx ? { ...it, [k]: v } : it)))
  }

  // Solo los campos editables entran al guardado — el `total` que devuelve
  // el servidor se recalcula en cada guardado y no debe marcar el formulario
  // como modificado cuando `setItems(data.items)` lo refresca más abajo.
  const editableSnapshot = items ? items.map(({ key, cantidad, precio }) => ({ key, cantidad, precio })) : null

  const { status: saveStatus, flush: flushSave, retry: retrySave } = useAutosave(
    editableSnapshot,
    async () => {
      const data = await saveTroquelCostos(ordenId, items.map(({ total, ...it }) => it))
      const its = data.items || []
      setItems(its)
      savedSnapshotRef.current = JSON.stringify(its.map(({ key, cantidad, precio }) => ({ key, cantidad, precio })))
      onSaved && onSaved(data)
    },
    { enabled: false }
  )

  // Dirty de verdad (hay ediciones sin persistir), no solo "está guardando":
  // el padre lo usa para avisar antes de liquidar sin guardar.
  const isDirty = savedSnapshotRef.current !== null && JSON.stringify(editableSnapshot) !== savedSnapshotRef.current
  useEffect(() => { onDirtyChange && onDirtyChange(isDirty) }, [isDirty])

  useImperativeHandle(ref, () => ({ saveIfDirty: flushSave }), [flushSave])

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
      <div className="table-scroll">
        <table style={{ width: '100%', minWidth: 660, borderCollapse: 'collapse' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '10px 12px', borderTop: '1px solid var(--line)' }}>
        <SaveStatus status={saveStatus} onRetry={retrySave} />
        {error && <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>{error}</span>}
      </div>
    </div>
  )
})

// ────────── Nueva tarea de troquel (Admin) ──────────
// Crea una OP directa (sin cotización) con el proceso "troquel" activo y le
// adjunta el modelo (PDF/imagen + campos técnicos) en un solo flujo.

export function NuevaTareaTroquelModal({ onClose, onCreated }) {
  const [op, setOp] = useState({ cliente: '', clienteId: null, referencia: '' })
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [showSugg, setShowSugg] = useState(false)
  const searchRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [createdOrden, setCreatedOrden] = useState(null)  // OP ya creada: el reintento solo re-envía el modelo

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

  const submit = async () => {
    setError(null)
    if (!createdOrden) {
      if (!op.cliente.trim()) { setError('El campo Cliente es obligatorio'); return }
      if (!op.referencia.trim()) { setError('El campo Referencia es obligatorio'); return }
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
          cliente: clienteId,
          referencia: op.referencia.trim(),
          cantidad: 1,
          procesos: [{ proceso_id: 'troquel', active: true }],
        })
        setCreatedOrden(orden)
      }
      if (archivo) {
        const fd = new FormData()
        fd.append('orden', orden.id)
        fd.append('archivo', archivo)
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
