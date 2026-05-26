from django.contrib import admin
from .models import Cliente, Papel, Cotizacion, CotizacionProceso, OrdenProduccion, OpProceso


@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = ["nombre", "tipo", "creado"]
    search_fields = ["nombre"]
    list_filter = ["tipo"]


@admin.register(Papel)
class PapelAdmin(admin.ModelAdmin):
    list_display = ["nombre", "gramaje", "material", "precio", "activo"]
    list_filter = ["activo", "material"]
    list_editable = ["precio", "activo"]


class CotizacionProcesoInline(admin.TabularInline):
    model = CotizacionProceso
    extra = 0
    fields = ["proceso_id", "active", "costo", "costo_override", "extras"]


@admin.register(Cotizacion)
class CotizacionAdmin(admin.ModelAdmin):
    list_display = ["numero", "cliente", "referencia", "cantidad", "estado", "creado"]
    list_filter = ["estado", "tipo_cliente", "condicion_pago"]
    search_fields = ["numero", "cliente__nombre", "referencia"]
    readonly_fields = ["numero", "creado", "modificado"]
    inlines = [CotizacionProcesoInline]
    fieldsets = [
        ("General", {"fields": ["numero", "fecha", "cliente", "referencia", "cantidad", "tipo_cliente", "estado"]}),
        ("Papel", {"fields": ["molde_ancho", "molde_alto", "pliego_tipo", "pliego_w", "pliego_h", "papel", "precio_pliego", "costo_papel_override"]}),
        ("Liquidación overrides", {"fields": ["valor_unitario_override", "valor_total_override", "total_costos_override", "subtotal_override"], "classes": ["collapse"]}),
        ("Condiciones", {"fields": ["condicion_pago", "condicion_custom", "observaciones"]}),
        ("Auditoría", {"fields": ["creado", "modificado"], "classes": ["collapse"]}),
    ]


class OpProcesoInline(admin.TabularInline):
    model = OpProceso
    extra = 0
    fields = ["proceso_id", "active", "costo", "maquina_id", "operario", "estado", "unidades_completadas", "notas"]


@admin.register(OrdenProduccion)
class OrdenProduccionAdmin(admin.ModelAdmin):
    list_display = ["numero", "cliente", "referencia", "estado", "cantidad", "valor_total", "abono", "creado"]
    list_filter = ["estado", "tipo_cliente_op", "condicion_pago"]
    search_fields = ["numero", "cliente__nombre", "referencia"]
    readonly_fields = ["numero", "creado", "modificado"]
    inlines = [OpProcesoInline]
    fieldsets = [
        ("General", {"fields": ["numero", "fecha", "cliente", "cotizacion", "referencia", "descripcion", "estado"]}),
        ("Tipo cliente", {"fields": ["tipo_cliente_op", "condicion_cobro_terciario"]}),
        ("Especificaciones", {"fields": ["cantidad", "valor_unitario", "cantidad_pliegos", "papel_referencia", "corte_inicial", "corte_final", "medida_producto", "cantidad_impresion"]}),
        ("Liquidación", {"fields": ["total_costos", "valor_total", "subtotal", "abono"]}),
        ("Condiciones", {"fields": ["condicion_pago", "observaciones"]}),
        ("Auditoría", {"fields": ["creado", "modificado"], "classes": ["collapse"]}),
    ]
