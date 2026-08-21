from django.db.models import Count, Max, Q
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Cliente, Cotizacion, FormatoCuchillas, Notificacion, OrdenProduccion,
    RegistroMaquina, RegistroProceso, Remision, TroquelModelo,
)


def _sig(*parts):
    return ":".join("" if p is None else str(p) for p in parts)


class SyncView(APIView):
    """GET /api/sync/ — versión barata por recurso para el polling del frontend.

    El frontend sondea este endpoint (~200 B) y solo recarga una lista
    completa cuando su versión cambió. Las firmas son agregados sin estado
    (count + max id/timestamp), un query indexado por recurso.

    Limitación conocida: escrituras vía queryset.update() no tocan los campos
    auto_now, así que no cambian la firma; el frontend hace un refresh
    completo periódico como red de seguridad.
    """

    def get(self, request):
        cot = Cotizacion.objects.aggregate(n=Count("id"), m=Max("modificado"))
        orden = OrdenProduccion.objects.aggregate(
            n=Count("id"), m=Max("modificado"),
            rs_n=Count("id", filter=Q(remision_solicitada_en__isnull=False)),
            rs_m=Max("remision_solicitada_en"),
        )
        rem = Remision.objects.aggregate(n=Count("id"), m=Max("modificado"))
        cli = Cliente.objects.aggregate(n=Count("id"), i=Max("id"), m=Max("creado"))
        reg = RegistroMaquina.objects.aggregate(n=Count("id"), i=Max("id"), m=Max("fecha_hora"))
        fmt = FormatoCuchillas.objects.aggregate(n=Count("id"), i=Max("id"), m=Max("revisado_en"))
        troq = TroquelModelo.objects.aggregate(m=Max("modificado"))
        regp = RegistroProceso.objects.aggregate(n=Count("id"), i=Max("id"), m=Max("fecha_hora"))
        data = {
            "cotizaciones": _sig(cot["n"], cot["m"]),
            "ordenes": _sig(orden["n"], orden["m"]),
            "remisiones": _sig(rem["n"], rem["m"]),
            "clientes": _sig(cli["n"], cli["i"], cli["m"]),
            "registros": _sig(reg["n"], reg["i"], reg["m"]),
            "formatos": _sig(fmt["n"], fmt["i"], fmt["m"]),
            "registros_proceso": _sig(regp["n"], regp["i"], regp["m"]),
            # Poner precios al troquel quita la alerta, por eso entra modificado.
            "remisiones_solicitadas": _sig(orden["rs_n"], orden["rs_m"], troq["m"]),
        }
        if request.user.is_staff:
            # Las notificaciones son del Admin: al Operador ni se le insinúa que
            # hay algo nuevo. `leida_en` se fija explícitamente al marcar leído,
            # así que la firma sí se mueve.
            noti = Notificacion.objects.aggregate(
                n=Count("id"), i=Max("id"), m=Max("leida_en")
            )
            data["notificaciones"] = _sig(noti["n"], noti["i"], noti["m"])
        return Response(data)
