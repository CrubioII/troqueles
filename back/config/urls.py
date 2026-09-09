from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import path, include


def healthz(_request):
    """Sonda de vida para el health check del balanceador (Lightsail exige un 200).

    Deliberadamente no toca la base de datos: un parpadeo de Supabase no debe
    hacer que el balanceador dé de baja el contenedor y lo reinicie en ciclo.
    """
    return JsonResponse({"ok": True})


urlpatterns = [
    path("healthz", healthz),
    path("admin/", admin.site.urls),
    path("api/auth/", include("cotizaciones.auth_urls")),
    path("api/", include("cotizaciones.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
