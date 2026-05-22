from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ClienteViewSet, PapelViewSet, CotizacionViewSet, DocumentoClienteViewSet

router = DefaultRouter()
router.register("clientes", ClienteViewSet, basename="cliente")
router.register("papel", PapelViewSet, basename="papel")
router.register("cotizaciones", CotizacionViewSet, basename="cotizacion")
router.register("documentos", DocumentoClienteViewSet, basename="documento")

urlpatterns = [path("", include(router.urls))]
