from django.contrib import admin
from .models import (
    Cliente, Papel, Cotizacion, CotizacionProceso, OrdenProduccion, OpProceso,
    OrdenCambio, TroquelModelo, FormatoCuchillas, Remision, RemisionItem,
    RegistroProceso, Notificacion,
)


@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = ["nombre", "tipo", "ciudad", "creado"]
    search_fields = ["nombre", "nombre_normalizado"]
    list_filter = ["tipo"]
    fields = ["nombre", "nombre_normalizado", "email", "telefono", "nit", "direccion", "ciudad", "tipo"]
    readonly_fields = ["nombre_normalizado"]


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
        ("Condiciones", {"fields": ["condicion_pago", "condicion_custom", "tipo_facturacion", "observaciones"]}),
        ("Auditoría", {"fields": ["creado", "modificado"], "classes": ["collapse"]}),
    ]


class OpProcesoInline(admin.TabularInline):
    model = OpProceso
    extra = 0
    fields = ["proceso_id", "active", "costo", "costo_override", "extras"]


@admin.register(OrdenProduccion)
class OrdenProduccionAdmin(admin.ModelAdmin):
    list_display = ["numero", "cliente", "referencia", "cantidad", "abono", "creado"]
    list_filter = ["tipo_cliente", "condicion_pago", "tipo_facturacion"]
    search_fields = ["numero", "cliente__nombre", "referencia"]
    readonly_fields = ["numero", "creado", "modificado"]
    inlines = [OpProcesoInline]
    fieldsets = [
        ("General", {"fields": ["numero", "fecha", "cliente", "cotizacion", "referencia", "cantidad", "sobrante", "tipo_cliente"]}),
        ("Papel", {"fields": ["molde_ancho", "molde_alto", "pliego_tipo", "pliego_w", "pliego_h", "papel", "precio_pliego", "costo_papel_override", "corte_inicial_active", "corte_inicial_precio", "corte_final_active", "corte_final_precio"]}),
        ("Liquidación", {"fields": ["margen", "abono", "valor_unitario_override", "valor_total_override", "total_costos_override", "subtotal_override"]}),
        ("Condiciones", {"fields": ["condicion_pago", "condicion_custom", "tipo_facturacion", "observaciones"]}),
        ("Auditoría", {"fields": ["creado", "modificado"], "classes": ["collapse"]}),
    ]


@admin.register(OrdenCambio)
class OrdenCambioAdmin(admin.ModelAdmin):
    list_display = ["orden", "campo", "valor_anterior", "valor_nuevo", "usuario", "fecha_hora"]
    list_filter = ["campo"]
    search_fields = ["orden__numero", "usuario__username"]
    readonly_fields = ["orden", "campo", "valor_anterior", "valor_nuevo", "usuario", "fecha_hora"]

    def has_add_permission(self, request):
        return False


@admin.register(TroquelModelo)
class TroquelModeloAdmin(admin.ModelAdmin):
    list_display = ["troquel_numero", "orden", "material", "creado"]
    search_fields = ["troquel_numero", "orden__numero"]
    readonly_fields = ["creado", "modificado"]


@admin.register(FormatoCuchillas)
class FormatoCuchillasAdmin(admin.ModelAdmin):
    list_display = ["orden", "operador", "estado", "fecha_hora"]
    search_fields = ["orden__numero"]
    readonly_fields = ["fecha_hora"]


class RemisionItemInline(admin.TabularInline):
    model = RemisionItem
    extra = 0
    fields = ["orden", "descripcion", "cantidad", "valor_total"]


@admin.register(Remision)
class RemisionAdmin(admin.ModelAdmin):
    list_display = ["numero", "cliente", "orden", "estado", "fecha", "creado"]
    list_filter = ["estado"]
    search_fields = ["numero", "cliente__nombre", "orden__numero"]
    readonly_fields = ["numero", "enviada_en", "liquidada_en", "creado", "modificado"]
    inlines = [RemisionItemInline]


@admin.register(RegistroProceso)
class RegistroProcesoAdmin(admin.ModelAdmin):
    list_display = [
        "orden", "estacion", "proceso_id", "cantidad_realizada",
        "cantidad_esperada", "faltante", "operador", "fecha_hora",
    ]
    list_filter = ["estacion", "faltante", "tamano"]
    search_fields = ["orden__numero", "orden__cliente__nombre", "operador__username"]
    readonly_fields = ["fecha_hora"]


@admin.register(Notificacion)
class NotificacionAdmin(admin.ModelAdmin):
    list_display = ["tipo", "titulo", "orden", "creada_por", "leida_en", "creada"]
    list_filter = ["tipo"]
    search_fields = ["titulo", "mensaje", "orden__numero"]
    readonly_fields = ["creada"]
