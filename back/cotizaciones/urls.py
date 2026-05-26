from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ClienteViewSet, PapelViewSet, CotizacionViewSet, DocumentoClienteViewSet, OrdenProduccionViewSet

router = DefaultRouter()
router.register("clientes", ClienteViewSet, basename="cliente")
router.register("papel", PapelViewSet, basename="papel")
router.register("cotizaciones", CotizacionViewSet, basename="cotizacion")
router.register("documentos", DocumentoClienteViewSet, basename="documento")
router.register("ordenes", OrdenProduccionViewSet, basename="orden")

urlpatterns = [path("", include(router.urls))]
