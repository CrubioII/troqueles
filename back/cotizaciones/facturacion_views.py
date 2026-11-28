"""Facturación module: the accountant's pending list and invoice history.

Flow:
  Remission exists (OP ready to be delivered; the Admin's liquidation is
  not required — in practice it is often never done)
    → shows up in Facturación › Pendientes
    → accountant registers the invoice (number + grand total only)
    → it moves to Facturación › Historial, where she tracks its state:
      por_cobrar (owed) / pagada (paid) / cancelada (voided).

A voided invoice keeps its number (the sequence never skips) and its
remissions return to Pendientes so they can be invoiced again. While a
remission is on an active invoice it cannot be deleted, merged or undone
(views._error_facturada).

Access: roles.puede_facturacion (Admin or PerfilOperador.es_contadora).
"""
import traceback
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Exists, Max, OuterRef, Prefetch, Q
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from . import roles
from .models import Factura, Remision, codigo_factura


def _require_facturacion(request):
    if not roles.puede_facturacion(request.user):
        raise PermissionDenied("No tienes acceso al módulo de Facturación.")


def _remision_ops(rem):
    """The remission's own OP plus the ones merged into it (prefetched)."""
    ops = [rem.orden] if rem.orden_id else []
    ops += [src.orden for src in rem.remisiones_consolidadas.all() if src.orden_id]
    return ops


def _remision_total(rem):
    # "Total a pagar" of the remission document = sum of its line items.
    return sum((it.valor_total or 0) for it in rem.items.all())


def _remision_referencias(rem):
    return [op.referencia for op in _remision_ops(rem) if op.referencia]


# "Trabajo realizado" for the accountant: only the jobs the system records
# (die fabrication + the production chain). Barnizado groups the three
# Barnizadora processes. The detail of each process is on the remission.
TRABAJOS = {
    "troquel": ["troquel"],
    "impresion": ["impresion"],
    "laminado": ["laminado"],
    "barnizado": ["uvTotal", "uvParcial", "uvReserva"],
    "troquelado": ["troquelado"],
}
TRABAJO_POR_PROCESO = {p: t for t, procesos in TRABAJOS.items() for p in procesos}


def _remision_trabajos(rem):
    """TRABAJOS keys the remission's OPs have active, in TRABAJOS order."""
    activos = {
        TRABAJO_POR_PROCESO.get(p.proceso_id)
        for op in _remision_ops(rem) for p in op.procesos.all() if p.active
    }
    return [t for t in TRABAJOS if t in activos]


REMISION_PREFETCH = [
    "items",
    "orden__procesos",
    "remisiones_consolidadas__orden__procesos",
]


def _active_invoice_exists():
    return Exists(
        Factura.objects.filter(remisiones=OuterRef("pk")).exclude(estado="cancelada")
    )


def _sin_facturar_qs():
    # Merged ones are billed inside their target remission.
    return (
        Remision.objects.filter(estado__in=("pendiente", "liquidada"))
        .annotate(facturada=_active_invoice_exists())
        .filter(facturada=False)
    )


def _pendientes_qs():
    """Billable remissions: only issued ones (with their REM- number). A
    remission auto-created when its OP hits 100% has no number until
    production generates it, and it may still be merged into another one or
    undone — billing it then would invoice a document that does not exist yet
    and break the order of the consecutive. Newest number first."""
    return (
        _sin_facturar_qs()
        .exclude(numero__isnull=True).exclude(numero="")
        .select_related("cliente", "orden")
        .prefetch_related(*REMISION_PREFETCH)
        .order_by("-numero", "-id")
    )


def _trabajo_q(prefix, trabajo):
    """'Trabajo realizado' filter: an OP of the remission (own or merged) has
    one of the trabajo's processes active."""
    q = Q()
    for path in ("orden__procesos", "remisiones_consolidadas__orden__procesos"):
        q |= Q(**{
            f"{prefix}{path}__active": True,
            f"{prefix}{path}__proceso_id__in": TRABAJOS[trabajo],
        })
    return q


def _apply_common_filters(qs, params, date_field, remision_prefix):
    cliente = (params.get("cliente") or "").strip()
    if cliente:
        qs = qs.filter(cliente__nombre__icontains=cliente)
    for key, lookup in (("fecha", ""), ("fecha_after", "__gte"), ("fecha_before", "__lte")):
        value = parse_date(params.get(key) or "")
        if value:
            qs = qs.filter(**{f"{date_field}{lookup}": value})
    trabajo = (params.get("trabajo") or "").strip()
    if trabajo in TRABAJOS:
        qs = qs.filter(_trabajo_q(remision_prefix, trabajo)).distinct()
    return qs


def _fmt_money(value):
    return f"{Decimal(value or 0):.0f}"


# ─────────────── Serializers ───────────────

class RemisionPendienteSerializer(serializers.ModelSerializer):
    cliente_id = serializers.IntegerField(read_only=True)
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    orden_numero = serializers.CharField(source="orden.numero", read_only=True, default="")
    referencias = serializers.SerializerMethodField()
    trabajos = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()

    class Meta:
        model = Remision
        fields = ["id", "numero", "fecha", "cliente_id", "cliente_nombre", "orden_numero",
                  "referencias", "trabajos", "total", "liquidada_en"]

    def get_referencias(self, obj):
        return _remision_referencias(obj)

    def get_trabajos(self, obj):
        return _remision_trabajos(obj)

    def get_total(self, obj):
        return _fmt_money(_remision_total(obj))


class FacturaSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    codigo = serializers.CharField(read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    remisiones = serializers.SerializerMethodField()
    referencias = serializers.SerializerMethodField()
    trabajos = serializers.SerializerMethodField()
    es_ultima = serializers.SerializerMethodField()

    class Meta:
        model = Factura
        fields = ["id", "numero", "codigo", "fecha", "cliente", "cliente_nombre", "total", "estado",
                  "estado_display", "observaciones", "remisiones", "referencias", "trabajos",
                  "es_ultima", "estado_cambiado_en", "creada", "modificada"]
        read_only_fields = ["numero", "cliente", "creada", "modificada", "estado_cambiado_en"]

    def get_remisiones(self, obj):
        return [{"id": r.id, "numero": r.numero, "fecha": r.fecha} for r in obj.remisiones.all()]

    def get_referencias(self, obj):
        refs = []
        for rem in obj.remisiones.all():
            refs += _remision_referencias(rem)
        return list(dict.fromkeys(refs))

    def get_trabajos(self, obj):
        activos = {t for rem in obj.remisiones.all() for t in _remision_trabajos(rem)}
        return [t for t in TRABAJOS if t in activos]

    def get_es_ultima(self, obj):
        return obj.numero == self.context.get("max_numero")


def _remision_detalle(rem):
    """Everything the Remisiones screen shows about a liquidated remission,
    read-only: delivery data, line items with total, troquel breakdown with
    prices and the production delivered per OP."""
    from .views import _remision_operador_pdf_ctx

    items = list(rem.items.all())
    det = _remision_operador_pdf_ctx(rem, admin=True)
    return {
        "id": rem.id,
        "numero": rem.numero,
        "fecha": rem.fecha,
        "orden_numero": rem.orden.numero if rem.orden_id else "",
        "referencias": _remision_referencias(rem),
        "trabajos": _remision_trabajos(rem),
        "direccion": rem.direccion,
        "ciudad": rem.ciudad,
        "observaciones": rem.observaciones,
        "liquidada_en": rem.liquidada_en,
        "generada_por": rem.generada_por.username if rem.generada_por_id else "",
        "consolidadas": [r.numero for r in rem.remisiones_consolidadas.all() if r.numero],
        "items": [
            {"descripcion": it.descripcion, "cantidad": it.cantidad, "valor_total": it.valor_total}
            for it in items
        ],
        "total_cantidad": sum((it.cantidad or 0) for it in items),
        "total": _fmt_money(_remision_total(rem)),
        "troqueles": det["troqueles"],
        "total_troqueles": det.get("total_general"),
        "procesos": det["procesos"],
    }


class FacturaDetalleSerializer(FacturaSerializer):
    """GET /api/facturas/{id}/ — the invoice plus client data, who registered
    it and the full breakdown of each of its remissions."""

    cliente_datos = serializers.SerializerMethodField()
    creada_por = serializers.CharField(source="creada_por.username", read_only=True, default="")
    remisiones = serializers.SerializerMethodField()

    class Meta(FacturaSerializer.Meta):
        fields = FacturaSerializer.Meta.fields + ["cliente_datos", "creada_por"]

    def get_cliente_datos(self, obj):
        c = obj.cliente
        return {"nombre": c.nombre, "nit": c.nit, "telefono": c.telefono, "email": c.email,
                "direccion": c.direccion, "ciudad": c.ciudad}

    def get_remisiones(self, obj):
        return [_remision_detalle(rem) for rem in obj.remisiones.all()]


# ─────────────── ViewSet ───────────────

class FacturaViewSet(viewsets.ModelViewSet):
    """/api/facturas/ — invoice history + the pending list (see module doc).

    History filters (all combinable; Pendientes has only a text search in the UI):
      cliente=<text>            client name contains
      fecha=YYYY-MM-DD          exact date
      fecha_after=YYYY-MM-DD    date >= (inclusive)
      fecha_before=YYYY-MM-DD   date <= (inclusive)
      trabajo=<TRABAJOS key>    troquel|impresion|laminado|barnizado|troquelado
      estado=por_cobrar|pagada|cancelada   (history only)
      numero=<FAC-0012|12>      invoice number (history only)
    """

    serializer_class = FacturaSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_facturacion(request)

    def get_queryset(self):
        rem_qs = Remision.objects.select_related("orden", "generada_por").prefetch_related(*REMISION_PREFETCH)
        qs = Factura.objects.select_related("cliente", "creada_por").prefetch_related(
            Prefetch("remisiones", queryset=rem_qs)
        )
        if self.action == "list":
            params = self.request.query_params
            qs = _apply_common_filters(qs, params, "fecha", "remisiones__")
            estado = params.get("estado")
            if estado:
                qs = qs.filter(estado__in=estado.split(","))
            numero = "".join(ch for ch in (params.get("numero") or "") if ch.isdigit())
            if numero:
                qs = qs.filter(numero=int(numero))
        return qs.order_by("-numero")

    def get_serializer_class(self):
        # Detail screen reads and edits through these; it needs the full breakdown back.
        if self.action in ("retrieve", "partial_update", "update"):
            return FacturaDetalleSerializer
        return FacturaSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["max_numero"] = Factura.objects.aggregate(m=Max("numero"))["m"]
        return ctx

    def list(self, request, *args, **kwargs):
        facturas = list(self.get_queryset())
        data = self.get_serializer(facturas, many=True).data
        # Summed in Python: the 'trabajo' filter joins processes, so a SQL SUM
        # over the filtered queryset could count an invoice more than once.
        totales = {estado: Decimal(0) for estado, _ in Factura.ESTADO_CHOICES}
        for f in facturas:
            totales[f.estado] += f.total
        return Response({
            "results": data,
            "totales": {k: _fmt_money(v) for k, v in totales.items()},
        })

    @staticmethod
    def _parse_total(raw):
        try:
            total = Decimal(str(raw).replace(",", "").strip())
        except (InvalidOperation, AttributeError):
            return None
        return total if total >= 0 else None

    def create(self, request, *args, **kwargs):
        """POST /api/facturas/ — Body:
        { remision_ids: [..], total, estado, fecha?, observaciones? }

        `estado` is required (por_cobrar | pagada): the invoice already exists
        when it is registered, so the accountant states whether it is owed.

        All remissions must be pending/liquidated (not merged), belong to the same client and not
        be on another active invoice. The number is assigned here: next
        consecutive starting at 1 (FAC-0001), never chosen by the user.
        """
        data = request.data
        ids = [int(i) for i in (data.get("remision_ids") or []) if str(i).isdigit()]
        if not ids:
            return Response({"error": "Selecciona al menos una remisión."}, status=400)
        total = self._parse_total(data.get("total"))
        if total is None:
            return Response({"error": "El total de la factura no es válido."}, status=400)
        fecha = parse_date(str(data.get("fecha") or "")) or timezone.localdate()
        estado = data.get("estado")
        if estado not in ("por_cobrar", "pagada"):
            return Response({"error": "Indica si la factura quedó por cobrar o pagada."}, status=400)

        with transaction.atomic():
            remisiones = list(
                _pendientes_qs().select_for_update(of=("self",)).filter(pk__in=ids)
            )
            if len(remisiones) != len(set(ids)):
                return Response({
                    "error": "Alguna remisión ya fue facturada, fusionada o eliminada. Recarga la lista.",
                }, status=409)
            clientes = {r.cliente_id for r in remisiones}
            if len(clientes) > 1:
                return Response({
                    "error": "Solo puedes facturar juntas remisiones del mismo cliente.",
                }, status=400)

            cliente_id = clientes.pop()
            factura = None
            # Two invoices registered at the same instant compete for the same
            # number: the unique constraint makes one retry with the next.
            for _ in range(20):
                numero = (Factura.objects.aggregate(m=Max("numero"))["m"] or 0) + 1
                try:
                    with transaction.atomic():
                        factura = Factura.objects.create(
                            numero=numero, fecha=fecha, cliente_id=cliente_id, total=total,
                            estado=estado, estado_cambiado_en=timezone.now(),
                            observaciones=(data.get("observaciones") or "").strip(),
                            creada_por=request.user,
                        )
                    break
                except IntegrityError:
                    continue
            if factura is None:
                return Response({"error": "No se pudo asignar el consecutivo. Intenta de nuevo."}, status=409)
            factura.remisiones.set(remisiones)
            # An invoiced remission is an issued document: give it its REM- number.
            for rem in remisiones:
                rem.asignar_numero()

        factura = self.get_queryset().get(pk=factura.pk)
        return Response(self.get_serializer(factura).data, status=201)

    def partial_update(self, request, *args, **kwargs):
        """PATCH /api/facturas/{id}/ — estado, total, fecha, observaciones.
        The number and the remissions are fixed once registered."""
        factura = self.get_object()
        data = request.data
        fields = []
        if "estado" in data:
            estado = data["estado"]
            if estado not in dict(Factura.ESTADO_CHOICES):
                return Response({"error": "Estado no válido."}, status=400)
            if factura.estado == "cancelada" and estado != "cancelada":
                # Reviving a voided invoice: its remissions may have been
                # invoiced again in the meantime.
                ocupada = Factura.objects.filter(
                    remisiones__in=factura.remisiones.all()
                ).exclude(pk=factura.pk).exclude(estado="cancelada").first()
                if ocupada:
                    return Response({
                        "error": (
                            f"Sus remisiones ya están en la factura {ocupada.codigo}; "
                            "no se puede reactivar."
                        ),
                    }, status=409)
            if estado != factura.estado:
                factura.estado = estado
                factura.estado_cambiado_en = timezone.now()
                fields += ["estado", "estado_cambiado_en"]
        if "total" in data:
            total = self._parse_total(data["total"])
            if total is None:
                return Response({"error": "El total de la factura no es válido."}, status=400)
            factura.total = total
            fields.append("total")
        if "fecha" in data:
            fecha = parse_date(str(data["fecha"] or ""))
            if not fecha:
                return Response({"error": "Fecha no válida."}, status=400)
            factura.fecha = fecha
            fields.append("fecha")
        if "observaciones" in data:
            factura.observaciones = (data["observaciones"] or "").strip()
            fields.append("observaciones")
        if fields:
            factura.save(update_fields=[*fields, "modificada"])
        factura = self.get_queryset().get(pk=factura.pk)
        return Response(self.get_serializer(factura).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """DELETE — only the last invoice (to undo a typo right away) so the
        sequence never ends up with a hole. Older ones: mark them cancelada."""
        factura = self.get_object()
        ultimo = Factura.objects.aggregate(m=Max("numero"))["m"]
        if factura.numero != ultimo:
            return Response({
                "error": (
                    "Solo se puede eliminar la última factura registrada, para que el "
                    "consecutivo no salte. Para anular esta, márcala como cancelada."
                ),
            }, status=409)
        codigo = factura.codigo
        factura.delete()
        return Response({"ok": True, "codigo": codigo})

    @action(detail=False, methods=["get"], url_path="pendientes")
    def pendientes(self, request):
        """GET /api/facturas/pendientes/ — issued remissions (pending or
        liquidated, not merged) with no active invoice."""
        rems = list(_pendientes_qs())
        sin_emitir = _sin_facturar_qs().filter(Q(numero__isnull=True) | Q(numero="")).count()
        return Response({
            "results": RemisionPendienteSerializer(rems, many=True).data,
            "total": _fmt_money(sum(_remision_total(r) for r in rems)),
            # Waiting for production to generate them; they show up once numbered.
            "sin_emitir": sin_emitir,
        })

    @action(detail=False, methods=["get"], url_path="siguiente_numero")
    def siguiente_numero(self, request):
        siguiente = (Factura.objects.aggregate(m=Max("numero"))["m"] or 0) + 1
        return Response({"siguiente": siguiente, "siguiente_codigo": codigo_factura(siguiente)})

    @action(detail=False, methods=["get"], url_path=r"remisiones/(?P<remision_id>\d+)/pdf")
    def remision_pdf(self, request, remision_id=None):
        """GET /api/facturas/remisiones/{id}/pdf/ — the remission document with
        prices (the same document sent to contaduría on liquidation)."""
        from weasyprint import HTML as WeasyprintHTML
        from .views import _remision_pdf_ctx

        rem = Remision.objects.filter(pk=remision_id).exclude(estado="consolidada").first()
        if not rem:
            return Response({"error": "Remisión no encontrada."}, status=404)
        try:
            html_pdf = render_to_string("cotizaciones/pdf_remision.html", _remision_pdf_ctx(rem))
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="Remision_{rem.numero}.pdf"'
        return response
