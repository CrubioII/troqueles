from django.contrib import admin

from .models import CorreoProcesado


@admin.register(CorreoProcesado)
class CorreoProcesadoAdmin(admin.ModelAdmin):
    list_display = ["message_id", "remitente", "asunto", "resultado", "ordenes", "procesado_en"]
    list_filter = ["resultado"]
    search_fields = ["message_id", "remitente", "asunto"]
    readonly_fields = [f.name for f in CorreoProcesado._meta.fields]

    def has_add_permission(self, request):
        return False
