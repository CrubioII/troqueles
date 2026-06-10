# Descripción de Errores Lógicos — Troqueles INK

---

## Problema 1: Bloqueo al Cambiar Estado a "Convertida a OP"

### Descripción del Error

Cuando intentas cambiar el estado de una cotización a **"Convertida a OP"** desde la página de edición, el botón **Guardar se deshabilita inmediatamente**, impidiendo que el cambio de estado se persista en la base de datos. Esto crea un **ciclo imposible**: no puedes guardar porque el estado es "convertida", pero el estado nunca se persiste porque no puedes guardar.

### Causa Raíz

La verificación de "solo lectura" en `SectionAcciones` y `LiquidationPanel` usa el **estado local actual** (`d.estado`) en lugar del **estado guardado en el servidor**. Cuando el usuario cambia el `StatusPicker` a `convertida`, la UI reacciona inmediatamente como si YA estuviera convertida y bloquea los botones.

Adicionalmente, el `StatusPicker` permite seleccionar manualmente el estado "Convertida a OP", cuando en realidad esa transición solo debería ocurrir **automáticamente** cuando se crea la OP desde `OrdenEdit.jsx`.

### Archivos que Causan el Problema

#### 1. `front/src/components/core.jsx` — StatusPicker (Líneas 270-285)

**Problema:** Permite hacer clic en "Convertida a OP" como cualquier otro estado.

**Solución:** Modificar el `StatusPicker` para que `convertida` no sea clickeable. Si la cotización ya está convertida, se muestra como badge informativo; si no, no aparece como opción.

```jsx
// ANTES (línea 270-285):
export function StatusPicker({ value, onChange }) {
  return (
    <div className="badge-status-picker">
      {STATUS_DEFS.map(s => (
        <span key={s.id} className={'badge ' + s.cls + (value === s.id ? ' active' : '')}
          onClick={() => onChange(s.id)}>
          <span className="dot"></span>
          {s.label}
        </span>
      ))}
    </div>
  )
}

// DESPUÉS:
export function StatusPicker({ value, onChange }) {
  return (
    <div className="badge-status-picker">
      {STATUS_DEFS.map(s => {
        const isConvertida = s.id === 'convertida'
        // 'convertida' solo se muestra si ya es el estado actual
        if (isConvertida && value !== 'convertida') return null
        return (
          <span key={s.id}
            className={'badge ' + s.cls + (value === s.id ? ' active' : '') + (isConvertida ? ' readonly' : '')}
            onClick={() => !isConvertida && onChange(s.id)}
            style={isConvertida ? { cursor: 'default', opacity: 0.8 } : undefined}>
            <span className="dot"></span>
            {s.label}
          </span>
        )
      })}
    </div>
  )
}
```

#### 2. `front/src/pages/CotizacionEdit.jsx` — Estado original (Líneas 171, 196, 535, 554)

**Problema:** No existe seguimiento del estado original cargado del servidor. El bloqueo se basa en el estado local que cambia al instante.

**Solución:** Agregar un estado `originalEstado` y pasarlo a los componentes que necesitan verificar el bloqueo.

```jsx
// Agregar después de la línea 171:
const [originalEstado, setOriginalEstado] = useState('borrador')

// En el useEffect de carga, después de setData(apiToState(cot, catalog)) (línea ~196):
setOriginalEstado(cot.estado || 'borrador')

// Pasar a SectionAcciones (línea ~535):
<SectionAcciones d={d} calc={calc} saving={saving} originalEstado={originalEstado} ... />

// Pasar a LiquidationPanel (línea ~554):
<LiquidationPanel d={d} set={set} calc={calc} saving={saving} originalEstado={originalEstado} ... />
```

#### 3. `front/src/components/sections.jsx` — SectionAcciones (Líneas 611-613)

**Problema:** `isConvertida` se calcula con `d.estado` (el estado local editable).

**Solución:** Usar `originalEstado` para el bloqueo.

```jsx
// ANTES:
export function SectionAcciones({ d, calc, onSave, onDelete, onSaveAndSend, saving }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isConvertida = d.estado === 'convertida'

// DESPUÉS:
export function SectionAcciones({ d, calc, onSave, onDelete, onSaveAndSend, saving, originalEstado }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isConvertida = (originalEstado || d.estado) === 'convertida'
```

#### 4. `front/src/components/LiquidationPanel.jsx` — Bloqueo (Líneas 29-30)

**Problema:** Mismo que SectionAcciones.

**Solución:**

```jsx
// ANTES:
export default function LiquidationPanel({ d, set, calc, onSave, onSaveAndSend, saving }) {
  const isConvertida = d.estado === 'convertida'

// DESPUÉS:
export default function LiquidationPanel({ d, set, calc, onSave, onSaveAndSend, saving, originalEstado }) {
  const isConvertida = (originalEstado || d.estado) === 'convertida'
```

---

## Problema 2: La OP Creada No Aparece con sus Procesos en el Menú de Producción

### Descripción del Error

Cuando se convierte una cotización a OP usando el botón "Crear OP", la OP se crea **sin procesos activos**. Esto hace que en el listado de producción (`/ordenes`) la OP aparezca con 0% de progreso y sin información útil sobre qué trabajo se necesita realizar.

### Causa Raíz

El estado de navegación `fromCotizacion` que se pasa al crear la OP **no incluye los procesos activos** de la cotización. Solo se transfieren datos escalares (cliente, referencia, cantidad, etc.) pero los procesos (impresión, laminado, troquel, etc.) que estaban activos en la cotización nunca se pasan a la OP.

### Archivos que Causan el Problema

#### 1. `front/src/pages/CotizacionEdit.jsx` — Botón "Crear OP" (Líneas 427-449)

**Problema:** El `fromCotizacion` no incluye los procesos activos ni datos de especificaciones.

**Solución:** Agregar `procesosActivos` y datos de especificaciones al estado de navegación.

```jsx
// ANTES (solo datos escalares):
navigate('/ordenes/nuevo', {
  state: {
    fromCotizacion: {
      cotizacion: d.id,
      cotizacionNumero: d.numero,
      cliente: d.clienteId,
      clienteNombre: d.cliente,
      referencia: d.referencia,
      cantidad: d.cantidad,
      tipoClienteOp: d.tipoCliente,
      valorUnitario: Math.round(calc.valorUnitario || 0),
      valorTotal: Math.round(calc.valorTotal || 0),
      totalCostos: Math.round(calc.totalCostosOP || 0),
      condicionPago: ...,
      observaciones: d.observaciones,
    }
  }
})

// DESPUÉS (con procesos y especificaciones):
navigate('/ordenes/nuevo', {
  state: {
    fromCotizacion: {
      cotizacion: d.id,
      cotizacionNumero: d.numero,
      cliente: d.clienteId,
      clienteNombre: d.cliente,
      referencia: d.referencia,
      cantidad: d.cantidad,
      tipoClienteOp: d.tipoCliente,
      valorUnitario: Math.round(calc.valorUnitario || 0),
      valorTotal: Math.round(calc.valorTotal || 0),
      totalCostos: Math.round(calc.totalCostosOP || 0),
      condicionPago: ...,
      observaciones: d.observaciones,
      // NUEVO: Procesos activos para transferir a la OP
      procesosActivos: Object.entries(procesos)
        .filter(([, p]) => p.active)
        .map(([pid, p]) => ({ proceso_id: pid, costo: p.costo || 0 })),
      // NUEVO: Datos de especificaciones
      cantidadPliegos: calc.pliegosNecesarios,
      papelReferencia: (() => {
        const papel = papelCatalog.find(p => String(p.id) === d.papelId)
        return papel ? `${papel.nombre} ${papel.gramaje}g` : ''
      })(),
      medidaProducto: `${d.moldeAncho} × ${d.moldeAlto} cm`,
      corteInicial: d.corteInicialActive ? `Sí ($${d.corteInicialPrecio})` : '',
      corteFinal: d.corteFinalActive ? `Sí ($${d.corteFinalPrecio})` : '',
    }
  }
})
```

#### 2. `front/src/pages/OrdenEdit.jsx` — Prefill de OP (Líneas 267-275)

**Problema:** Solo hace merge de datos escalares, no activa procesos.

**Solución:** Separar `procesosActivos` de los datos escalares y activar los procesos coincidentes en el formulario de la OP.

```jsx
// ANTES:
useEffect(() => {
  const prefill = location.state?.fromCotizacion
  if (isNew && prefill) {
    setData(prev => ({
      ...prev,
      ...prefill,
    }))
  }
}, [])

// DESPUÉS:
useEffect(() => {
  const prefill = location.state?.fromCotizacion
  if (isNew && prefill) {
    const { procesosActivos, ...scalarData } = prefill
    setData(prev => ({
      ...prev,
      ...scalarData,
    }))
    // Activar procesos de OP que coincidan con los de la cotización
    if (procesosActivos && procesosActivos.length > 0) {
      setProcesos(prev => {
        const updated = { ...prev }
        procesosActivos.forEach(({ proceso_id, costo }) => {
          if (updated[proceso_id]) {
            updated[proceso_id] = {
              ...updated[proceso_id],
              active: true,
              costo: costo || updated[proceso_id].costo,
            }
          }
        })
        return updated
      })
    }
  }
}, [])
```

---

## Resumen de Cambios Necesarios

| # | Archivo | Líneas | Cambio | Problema |
|---|---------|--------|--------|----------|
| 1 | `front/src/components/core.jsx` | 270-285 | StatusPicker: ocultar "convertida" como opción clickeable | P1 |
| 2 | `front/src/pages/CotizacionEdit.jsx` | 171, 196, 427-449, 535, 554 | Agregar `originalEstado` + enriquecer `fromCotizacion` con procesos y especificaciones | P1 + P2 |
| 3 | `front/src/components/sections.jsx` | 611-613 | Usar `originalEstado` para `isConvertida` | P1 |
| 4 | `front/src/components/LiquidationPanel.jsx` | 29-30 | Usar `originalEstado` para `isConvertida` | P1 |
| 5 | `front/src/pages/OrdenEdit.jsx` | 267-275 | Mapear y activar procesos recibidos de la cotización | P2 |
