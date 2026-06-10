# 🐛 Solución: Cotización aprobada no llega automáticamente a Producción

## Descripción del problema

Cuando una cotización cambia su estado a **"aprobada"**, esta **no genera automáticamente una Orden de Producción (OP)**. El sistema actual requiere un flujo 100% manual:

1. El admin cambia el estado de la cotización a "aprobada" (`PATCH /api/cotizaciones/{id}/estado/`)
2. El admin tiene que **ir manualmente** al editor de cotización
3. Hacer clic en el botón **"+ Crear OP"** (que solo aparece si `estado === 'aprobada'`)
4. Este botón navega a `/ordenes/nuevo` pasando datos por `location.state` (React Router)
5. El admin tiene que **guardar manualmente** la OP en esa pantalla

**Además**, los procesos activos de la cotización (`CotizacionProceso`) **no se transfieren** a los procesos de la OP (`OpProceso`). La OP nueva se crea con todos los procesos en blanco (`buildBlankProcesos()`), sin respetar qué procesos estaban marcados como activos en la cotización original.

---

## Análisis de causa raíz

### Archivos involucrados

| Archivo | Rol | Problema |
|---------|-----|----------|
| [`views.py`](back/cotizaciones/views.py) L162-173 | Endpoint `cambiar_estado` de cotización | Solo cambia el campo `estado`. **No crea la OP ni sincroniza procesos.** |
| [`CotizacionEdit.jsx`](front/src/pages/CotizacionEdit.jsx) L422-449 | Botón "+ Crear OP" | Navegación manual a `/ordenes/nuevo`. **No pasa procesos activos**, solo datos generales. |
| [`OrdenEdit.jsx`](front/src/pages/OrdenEdit.jsx) L267-275 | Pre-fill desde cotización | Recibe `location.state.fromCotizacion` pero **no incluye procesos**. |
| [`OrdenEdit.jsx`](front/src/pages/OrdenEdit.jsx) L294-320 | `handleSave` al crear OP | Crea la OP y marca la cotización como "convertida", pero **los procesos se envían en blanco**. |
| [`serializers.py`](back/cotizaciones/serializers.py) L287-292 | `OrdenSerializer.create()` | Crea `OpProceso` con lo que recibe del payload, que llega todo en `active: false`. |

### Resumen del bug

El endpoint `cambiar_estado` en el backend (`views.py:162-173`) es un endpoint simple que **solo actualiza un campo texto** en la BD:

```python
@action(detail=True, methods=["patch"], url_path="estado")
def cambiar_estado(self, request, pk=None):
    cotizacion = self.get_object()
    nuevo = request.data.get("estado")
    # ... validación ...
    cotizacion.estado = nuevo
    cotizacion.save(update_fields=["estado", "modificado"])
    return Response(CotizacionSerializer(cotizacion).data)
```

No hay ninguna lógica que diga: *"si el nuevo estado es 'aprobada', crear una OrdenProduccion automáticamente con los procesos activos de esta cotización"*.

En el frontend, el botón `+ Crear OP` pasa los datos generales como estado de navegación:

```jsx
navigate('/ordenes/nuevo', {
  state: {
    fromCotizacion: {
      cotizacion: d.id,
      cliente: d.clienteId,
      referencia: d.referencia,
      cantidad: d.cantidad,
      // ... datos generales
      // ❌ NO incluye: procesos activos de la cotización
    }
  }
})
```

Y en `OrdenEdit.jsx`, el prefill solo aplica campos escalares, dejando `procesos` en el estado por defecto (`buildBlankProcesos()` → todo `active: false`).

---

## Plan de corrección

### Opción recomendada: Creación automática server-side (Backend)

Esta es la solución más robusta y confiable. El backend debe encargarse de crear la OP automáticamente cuando una cotización se aprueba.

#### 1. Modificar `cambiar_estado` en `views.py` (L162-173)

Cuando el nuevo estado sea `"aprobada"`, el endpoint debe:

1. Crear una `OrdenProduccion` vinculada a la cotización
2. Copiar los `CotizacionProceso` activos como `OpProceso` activos
3. Cambiar el estado de la cotización a `"convertida"` (no solo "aprobada")
4. Retornar los datos de la cotización actualizada junto con el ID de la OP creada

```python
@action(detail=True, methods=["patch"], url_path="estado")
def cambiar_estado(self, request, pk=None):
    _require_admin(request)
    cotizacion = self.get_object()
    nuevo = request.data.get("estado")
    opciones = [c[0] for c in Cotizacion.ESTADO_CHOICES]
    if nuevo not in opciones:
        return Response({"error": f"Estado inválido. Opciones: {opciones}"}, status=400)

    orden_id = None

    # ── Auto-crear OP cuando se aprueba ──
    if nuevo == "aprobada":
        # Verificar que no exista ya una OP para esta cotización
        if OrdenProduccion.objects.filter(cotizacion=cotizacion).exists():
            return Response(
                {"error": "Ya existe una Orden de Producción para esta cotización."},
                status=400
            )

        # Mapeo de proceso_id de cotización → proceso_id de OP
        # (los IDs coinciden en la mayoría de casos, pero algunos requieren mapeo)
        COTIZACION_TO_OP_MAP = {
            'impresion':  'impresion',
            'laminado':   None,         # Se desglosa en laminado_mate / laminado_brillante
            'uvTotal':    'uv_total',
            'uvParcial':  'uv_parcial',
            'uvReserva':  None,         # No existe en OP, se ignora
            'estampado':  'estampado',
            'troquel':    'troquel',
            'troquelado': 'troquelado',
            'positivo':   'positivo',
            'muestra':    'muestra',
            'terminado':  'terminado',
            'diseno':     'diseno',
            'pegante':    'pegante',
            'tinta':      'tinta',
            'cajas':      'cajas',
            'envio':      'envio',
            'recogida':   'recogida',
        }

        # Calcular valores efectivos (usando la lógica del serializer)
        serializer = CotizacionSerializer(cotizacion)
        valor_unitario = serializer.get_valor_unitario_efectivo(cotizacion) or 0
        valor_total = serializer.get_valor_total_efectivo(cotizacion) or 0
        total_costos = serializer._total_costos(cotizacion) or 0

        # Mapear condición de pago
        COND_MAP = {'mismo': 'mismo_dia', '8': '8_dias', '30': '30_dias'}
        cond_pago_op = COND_MAP.get(cotizacion.condicion_pago, 'mismo_dia')

        # Crear la Orden de Producción
        orden = OrdenProduccion.objects.create(
            fecha=cotizacion.fecha,
            cliente=cotizacion.cliente,
            cotizacion=cotizacion,
            referencia=cotizacion.referencia,
            estado='borrador',
            tipo_cliente_op=cotizacion.tipo_cliente,
            cantidad=cotizacion.cantidad,
            valor_unitario=valor_unitario,
            total_costos=total_costos,
            valor_total=valor_total,
            subtotal=valor_total - total_costos,
            condicion_pago=cond_pago_op,
            observaciones=cotizacion.observaciones,
            # Datos de papel
            papel_referencia=str(cotizacion.papel) if cotizacion.papel else '',
            medida_producto=f"{cotizacion.molde_ancho}x{cotizacion.molde_alto} cm",
        )
        orden_id = orden.id

        # Copiar procesos activos de la cotización a la OP
        procesos_activos = cotizacion.procesos.filter(active=True)
        from .constants import PROCESO_MAQUINA

        for cot_proc in procesos_activos:
            op_proc_id = COTIZACION_TO_OP_MAP.get(cot_proc.proceso_id)
            if op_proc_id is None:
                # Manejar caso especial de laminado (extras tienen tipo)
                if cot_proc.proceso_id == 'laminado':
                    extras = cot_proc.extras or {}
                    if extras.get('tiroActive'):
                        tipo = extras.get('tiroTipoLaminado', 'Mate')
                        lid = 'laminado_mate' if 'mate' in tipo.lower() else 'laminado_brillante'
                        OpProceso.objects.create(
                            orden=orden,
                            proceso_id=lid,
                            active=True,
                            costo=cot_proc.costo,
                            maquina_id=PROCESO_MAQUINA.get(lid, 'laminado'),
                        )
                    if extras.get('retiroActive'):
                        tipo = extras.get('retiroTipoLaminado', 'Mate')
                        lid = 'laminado_mate' if 'mate' in tipo.lower() else 'laminado_brillante'
                        # Evitar duplicado si ya se creó el mismo tipo
                        if not OpProceso.objects.filter(orden=orden, proceso_id=lid).exists():
                            OpProceso.objects.create(
                                orden=orden,
                                proceso_id=lid,
                                active=True,
                                costo=cot_proc.costo,
                                maquina_id=PROCESO_MAQUINA.get(lid, 'laminado'),
                            )
                continue

            maquina = PROCESO_MAQUINA.get(op_proc_id, '')
            OpProceso.objects.create(
                orden=orden,
                proceso_id=op_proc_id,
                active=True,
                costo=cot_proc.costo,
                maquina_id=maquina,
            )

        # Agregar corte inicial/final si estaban activos
        if cotizacion.corte_inicial_active:
            OpProceso.objects.get_or_create(
                orden=orden,
                proceso_id='corte',
                defaults={
                    'active': True,
                    'costo': cotizacion.corte_inicial_precio,
                    'maquina_id': PROCESO_MAQUINA.get('corte', 'corte'),
                }
            )

        # Cambiar estado a "convertida" directamente (no solo "aprobada")
        nuevo = "convertida"

    cotizacion.estado = nuevo
    cotizacion.save(update_fields=["estado", "modificado"])

    data = CotizacionSerializer(cotizacion).data
    if orden_id:
        data["orden_produccion_id"] = orden_id
    return Response(data)
```

#### 2. Modificar la respuesta del frontend en `CotizacionEdit.jsx`

Donde se llama a `cambiarEstado()`, el frontend debe manejar la nueva respuesta que incluye `orden_produccion_id`:

**Archivo:** `front/src/pages/CotizacionEdit.jsx`

En la sección del botón "+ Crear OP" (L422-449), ya no se necesitaría un botón manual. El flujo de aprobar la cotización automáticamente creará la OP. El botón podría cambiar a un enlace "Ver OP" que lleva a `/ordenes/{orden_produccion_id}`.

Si se quiere mantener el stepper visual (L413-460), al aprobar la cotización:

```jsx
// En el handler que cambia estado a "aprobada":
const handleAprobar = async () => {
  const result = await cambiarEstado(d.id, 'aprobada')
  set({ estado: result.estado }) // será "convertida"
  if (result.orden_produccion_id) {
    // Mostrar toast con link a la OP
    showToast(`OP creada automáticamente`)
    // Opcionalmente navegar:
    // navigate(`/ordenes/${result.orden_produccion_id}`)
  }
}
```

#### 3. Agregar endpoint para cambiar estado de cotización desde CotizacionList

Actualmente en `CotizacionList.jsx` **no hay botones para cambiar estado**. El admin tiene que abrir cada cotización individualmente. Se recomienda agregar botones de acción rápida (aprobar/rechazar) en el listado.

---

### Correcciones adicionales necesarias

#### 4. Los procesos de cotización no mapean a procesos de OP (FALTA MAPEO)

**Problema:** Los IDs de proceso en la cotización (`PROCESS_GROUPS` en `core.jsx` L26-85) y los IDs en la OP (`PROCESOS_OP` en `core.jsx` L113-134) **no coinciden** en todos los casos:

| Cotización (`proceso_id`) | OP (`proceso_id`) | Coinciden? |
|--------------------------|-------------------|-----------|
| `impresion` | `impresion` | ✅ Sí |
| `laminado` | `laminado_mate` / `laminado_brillante` | ❌ No — se debe descomponer según el tipo |
| `uvTotal` | `uv_total` | ❌ No — camelCase vs snake_case |
| `uvParcial` | `uv_parcial` | ❌ No — camelCase vs snake_case |
| `uvReserva` | *(no existe)* | ❌ No existe en OP |
| `estampado` | `estampado` | ✅ Sí |
| `troquel` | `troquel` | ✅ Sí |
| `troquelado` | `troquelado` | ✅ Sí |
| `positivo` | `positivo` | ✅ Sí |
| `muestra` | `muestra` | ✅ Sí |
| `terminado` | `terminado` | ✅ Sí |
| `diseno` | `diseno` | ✅ Sí |
| `pegante` | `pegante` | ✅ Sí |
| `tinta` | `tinta` | ✅ Sí |
| `cajas` | `cajas` | ✅ Sí |
| `envio` | `envio` | ✅ Sí |
| `recogida` | `recogida` | ✅ Sí |
| `otros` | *(no existe)* | ❌ No existe en OP |

**Corrección:** Implementar el diccionario `COTIZACION_TO_OP_MAP` en el backend (como se muestra en el código de arriba) para mapear correctamente los procesos.

#### 5. Prevenir duplicación de OPs

Agregar validación para que no se pueda crear más de una OP por cotización:

```python
# En views.py, dentro de cambiar_estado:
if nuevo == "aprobada":
    if OrdenProduccion.objects.filter(cotizacion=cotizacion).exists():
        return Response({"error": "Ya existe una OP para esta cotización."}, status=400)
```

#### 6. El botón "+ Crear OP" del frontend debe ser reemplazado

**Archivo:** `front/src/pages/CotizacionEdit.jsx` (L422-449)

El botón manual `+ Crear OP` ya no sería necesario si la creación es automática. Reemplazar por un enlace a la OP existente cuando el estado sea `convertida`:

```jsx
{d.estado === 'convertida' && d.ordenProduccionId && (
  <button
    className="btn accent"
    onClick={() => navigate(`/ordenes/${d.ordenProduccionId}`)}
  >
    Ver OP
  </button>
)}
```

Para obtener el `ordenProduccionId`, el serializer de cotización debería incluir este dato:

**Archivo:** `back/cotizaciones/serializers.py`

Agregar un campo calculado al `CotizacionSerializer`:

```python
orden_produccion_id = serializers.SerializerMethodField()

def get_orden_produccion_id(self, obj):
    orden = obj.ordenes.first()
    return orden.id if orden else None
```

---

## Resumen de cambios por archivo

### Backend

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `back/cotizaciones/views.py` | Modificar `cambiar_estado()` para auto-crear OP + OpProcesos al aprobar |
| 2 | `back/cotizaciones/serializers.py` | Agregar `orden_produccion_id` al `CotizacionSerializer` |
| 3 | `back/cotizaciones/views.py` | Agregar validación anti-duplicado de OP por cotización |

### Frontend

| # | Archivo | Cambio |
|---|---------|--------|
| 4 | `front/src/pages/CotizacionEdit.jsx` | Remover botón "+ Crear OP" manual, reemplazar por "Ver OP" con link |
| 5 | `front/src/pages/CotizacionEdit.jsx` | Actualizar handler de cambio de estado para manejar respuesta con `orden_produccion_id` |
| 6 | `front/src/api.js` | (Sin cambios) — `cambiarEstado` ya funciona, solo cambia la respuesta del backend |

---

## Sección de Producción — Lo que el usuario debe poder ver

Una vez implementada la corrección, el flujo completo sería:

```
Cotización (borrador) 
    → Enviada al cliente
    → Cliente aprueba 
    → Admin marca "Aprobada" 
    → ✅ AUTOMÁTICAMENTE se crea la OP con:
        • Datos del cliente
        • Referencia del producto
        • Cantidad
        • Todos los procesos que estaban activos en la cotización
        • Costos de cada proceso
        • Valores de liquidación (unitario, total, costos)
    → La cotización pasa a estado "Convertida a OP"
    → En la sección /ordenes aparece la nueva OP
    → El usuario puede:
        • Ver el progreso de cada proceso (pendiente → en proceso → completado)
        • Ver cuántas unidades lleva cada proceso
        • Ver el tiempo transcurrido desde que se inició cada proceso
        • Identificar procesos atrasados (los que llevan más tiempo del esperado)
```

---

## Prioridad de implementación

1. **🔴 Crítico:** Modificar `cambiar_estado` en `views.py` para auto-crear OP (el bug principal)
2. **🔴 Crítico:** Implementar mapeo de procesos `CotizacionProceso` → `OpProceso`
3. **🟡 Importante:** Agregar `orden_produccion_id` al serializer de cotización
4. **🟡 Importante:** Actualizar UI del stepper en `CotizacionEdit.jsx`
5. **🟢 Mejora:** Agregar botones de acción rápida en `CotizacionList.jsx`
6. **🟢 Mejora:** Agregar validación anti-duplicado
