from collections import defaultdict
from datetime import date

from django.db.models import Avg, Count
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Cotizacion, FormatoCuchillas, OrdenProduccion, RegistroMaquina
from .serializers import _orden_valor_total_efectivo


class DashboardStatsView(APIView):
    """Agregados para el Dashboard. No-financiero visible a cualquier
    usuario autenticado; financiero solo si request.user.is_staff."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = {
            "embudo_cotizaciones": self._embudo(),
            "utilizacion_maquinas": self._utilizacion(),
        }
        if request.user.is_staff:
            meses = int(request.query_params.get("meses", 12))
            data["financiero"] = {
                "ingresos_por_periodo": self._ingresos_periodo(meses),
                "top_clientes": self._top_clientes(),
                "ops_atrasadas": self._ops_atrasadas(),
            }
        return Response(data)

    def _embudo(self):
        counts = dict(
            Cotizacion.objects.values_list("estado").annotate(n=Count("id"))
        )
        labels = dict(Cotizacion.ESTADO_CHOICES)
        orden = ["borrador", "enviada", "aprobada", "convertida", "rechazada"]
        return [
            {"estado": e, "label": labels.get(e, e), "count": counts.get(e, 0)}
            for e in orden
        ]

    def _utilizacion(self):
        troquel = FormatoCuchillas.objects.aggregate(
            encalado=Avg("tiempo_encalado_min"),
            encuchillado=Avg("tiempo_encuchillado_min"),
            encauchado=Avg("tiempo_encauchado_min"),
        )
        return {
            "troquel_tiempos_prom_min": {
                "encalado": round(troquel["encalado"] or 0, 1),
                "encuchillado": round(troquel["encuchillado"] or 0, 1),
                "encauchado": round(troquel["encauchado"] or 0, 1),
            },
            "registros_count": {
                "troquel": RegistroMaquina.objects.filter(maquina="troquel").count(),
                "guillotina": RegistroMaquina.objects.filter(maquina="guillotina").count(),
            },
        }

    def _ops_queryset(self):
        return OrdenProduccion.objects.select_related("cliente", "cotizacion").prefetch_related("procesos")

    def _ingresos_periodo(self, meses=12):
        hoy = timezone.localdate()
        total_meses = hoy.year * 12 + (hoy.month - 1) - (meses - 1)
        desde = date(total_meses // 12, total_meses % 12 + 1, 1)
        buckets = defaultdict(float)
        for op in self._ops_queryset().filter(fecha__gte=desde):
            total = _orden_valor_total_efectivo(op)
            if total is None:
                continue
            buckets[op.fecha.strftime("%Y-%m")] += total
        return [{"periodo": k, "valor": round(v)} for k, v in sorted(buckets.items())]

    def _top_clientes(self, limit=10):
        buckets = defaultdict(float)
        for op in self._ops_queryset():
            total = _orden_valor_total_efectivo(op)
            if total is None:
                continue
            buckets[op.cliente.nombre] += total
        top = sorted(buckets.items(), key=lambda kv: -kv[1])[:limit]
        return [{"cliente": nombre, "valor": round(v)} for nombre, v in top]

    def _ops_atrasadas(self):
        hoy = timezone.localdate()
        qs = self._ops_queryset().filter(fecha_entrega__lt=hoy, remision__isnull=True)
        rows = []
        for op in qs:
            total = _orden_valor_total_efectivo(op)
            saldo = (total - float(op.abono or 0)) if total is not None else None
            rows.append({
                "id": op.id,
                "numero": op.numero,
                "cliente": op.cliente.nombre,
                "fecha_entrega": op.fecha_entrega,
                "saldo": saldo,
            })
        rows.sort(key=lambda r: r["fecha_entrega"])
        return rows
