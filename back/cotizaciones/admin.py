from django.contrib import admin
from .models import Cliente, Papel, Cotizacion, CotizacionProceso


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
