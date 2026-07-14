from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ClienteViewSet, PapelViewSet, CotizacionViewSet, DocumentoClienteViewSet,
    OrdenProduccionViewSet, RegistroMaquinaViewSet,
    TroquelModeloViewSet, FormatoCuchillasViewSet,
    RemisionViewSet,
)
from .dashboard_views import DashboardStatsView
from .sync_views import SyncView

router = DefaultRouter()
router.register("clientes", ClienteViewSet, basename="cliente")
router.register("papel", PapelViewSet, basename="papel")
router.register("cotizaciones", CotizacionViewSet, basename="cotizacion")
router.register("documentos", DocumentoClienteViewSet, basename="documento")
router.register("ordenes", OrdenProduccionViewSet, basename="orden")
router.register("remisiones", RemisionViewSet, basename="remision")
router.register("registros-maquina", RegistroMaquinaViewSet, basename="registro-maquina")
router.register("troquel-modelos", TroquelModeloViewSet, basename="troquel-modelo")
router.register("formatos-cuchillas", FormatoCuchillasViewSet, basename="formato-cuchillas")

urlpatterns = [
    path("dashboard/stats/", DashboardStatsView.as_view(), name="dashboard-stats"),
    path("sync/", SyncView.as_view(), name="sync"),
    path("", include(router.urls)),
]
