from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("cotizaciones.auth_urls")),
    path("api/", include("cotizaciones.urls")),
]
