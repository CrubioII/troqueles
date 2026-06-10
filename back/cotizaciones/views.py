import base64
import os
import threading
import traceback
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from django.core.mail import EmailMessage
from django.db import connection, transaction
from django.db.models import Max
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.conf import settings
from django.utils import timezone
from weasyprint import HTML as WeasyprintHTML

_LOGO_PATH = os.path.join(settings.BASE_DIR, "cotizaciones", "static", "cotizaciones", "logo.png")

# Pre-warm WeasyPrint font engine so the first real PDF request isn't slow
def _warmup_weasyprint():
    try:
        WeasyprintHTML(string="<p>warmup</p>").write_pdf()
    except Exception:
        pass

threading.Thread(target=_warmup_weasyprint, daemon=True).start()


def _logo_data_uri():
    try:
        with open(_LOGO_PATH, "rb") as f:
            return "data:image/png;base64," + base64.b64encode(f.read()).decode()
    except Exception:
        return ""


def _fmt_cop(n):
    try:
        return "$ {:,.0f}".format(float(n)).replace(",", ".")
    except Exception:
        return "$ 0"

from .models import Cliente, Papel, Cotizacion, DocumentoCliente, OrdenProduccion, OpProceso
from .serializers import (
    ClienteSerializer,
    PapelSerializer,
    CotizacionSerializer,
    CotizacionListSerializer,
    DocumentoClienteSerializer,
    DocumentoClienteListSerializer,
    OrdenSerializer,
    OrdenListSerializer,
)


def _require_admin(request):
    if not request.user.is_staff:
        raise PermissionDenied("Solo administradores pueden realizar esta acción.")


class ClienteViewSet(viewsets.ModelViewSet):
    queryset = Cliente.objects.all()
    serializer_class = ClienteSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["nombre"]


class PapelViewSet(viewsets.ModelViewSet):
    queryset = Papel.objects.filter(activo=True)
    serializer_class = PapelSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("all"):
            return Papel.objects.all()
        return qs


class CotizacionViewSet(viewsets.ModelViewSet):
    queryset = Cotizacion.objects.select_related("cliente", "papel").prefetch_related("procesos")
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["numero", "cliente__nombre", "referencia"]
    ordering_fields = ["creado", "fecha", "estado"]

    def get_queryset(self):
        qs = super().get_queryset()
        estado = self.request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)
        cliente_id = self.request.query_params.get("cliente")
        if cliente_id:
            qs = qs.filter(cliente_id=cliente_id)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return CotizacionListSerializer
        return CotizacionSerializer

    def create(self, request, *args, **kwargs):
        _require_admin(request)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        _require_admin(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        _require_admin(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        _require_admin(request)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="enviar")
    def enviar_correo(self, request, pk=None):
        """POST /api/cotizaciones/{id}/enviar/ — envía cotización por correo con PDF adjunto."""
        _require_admin(request)
        cot = self.get_object()
        email_destino = request.data.get("email") or (cot.cliente.email if cot.cliente.email else None)
        if not email_destino:
            return Response({"error": "No hay email de destino configurado."}, status=400)

        extra_emails = [e for e in request.data.get("extra_emails", []) if e and e.strip()]
        all_recipients = [email_destino] + extra_emails

        raw_rows = request.data.get("proc_rows", [])
        ctx = {
            "cot": cot,
            "proc_rows": [{"nombre": p.get("nombre", ""), "costo": _fmt_cop(p.get("costo", 0))} for p in raw_rows],
            "costo_papel": _fmt_cop(request.data.get("costo_papel", 0)),
            "total_costos_op": _fmt_cop(request.data.get("total_costos_op", 0)),
            "valor_unitario": _fmt_cop(request.data.get("valor_unitario", 0)),
            "valor_total": _fmt_cop(request.data.get("valor_total", 0)),
            "logo_uri": _logo_data_uri(),
        }

        try:
            html_email = render_to_string("cotizaciones/email_cotizacion.html", ctx)
            html_pdf = render_to_string("cotizaciones/pdf_cotizacion.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()

            msg = EmailMessage(
                subject=f"Cotización {cot.numero} — Troqueles INK",
                body=html_email,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=all_recipients,
            )
            msg.content_subtype = "html"
            msg.attach(f"Cotizacion_{cot.numero}.pdf", pdf_bytes, "application/pdf")
            sent = msg.send()
            if not sent:
                return Response({"error": "SMTP no confirmó el envío (send() = 0)."}, status=502)
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        return Response({"ok": True, "enviado_a": all_recipients})

    @action(detail=True, methods=["patch"], url_path="estado")
    def cambiar_estado(self, request, pk=None):
        """PATCH /api/cotizaciones/{id}/estado/ — cambia solo el estado."""
        _require_admin(request)
        cotizacion = self.get_object()
        nuevo = request.data.get("estado")
        opciones = [c[0] for c in Cotizacion.ESTADO_CHOICES]
        if nuevo not in opciones:
            return Response({"error": f"Estado inválido. Opciones: {opciones}"}, status=400)
        cotizacion.estado = nuevo
        cotizacion.save(update_fields=["estado", "modificado"])
        return Response(CotizacionSerializer(cotizacion).data)

    @action(detail=True, methods=["post"], url_path="pdf_interno")
    def pdf_interno(self, request, pk=None):
        """POST /api/cotizaciones/{id}/pdf_interno/ — devuelve el PDF interno como descarga."""
        cot = self.get_object()
        raw_rows = request.data.get("proc_rows", [])
        ctx = {
            "cot": cot,
            "proc_rows": [{"nombre": p.get("nombre", ""), "costo": _fmt_cop(p.get("costo", 0))} for p in raw_rows],
            "costo_papel": _fmt_cop(request.data.get("costo_papel", 0)),
            "total_costos_op": _fmt_cop(request.data.get("total_costos_op", 0)),
            "valor_unitario": _fmt_cop(request.data.get("valor_unitario", 0)),
            "valor_total": _fmt_cop(request.data.get("valor_total", 0)),
            "logo_uri": _logo_data_uri(),
        }
        try:
            html_pdf = render_to_string("cotizaciones/pdf_cotizacion.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="Interno_{cot.numero}.pdf"'
        return response

    @action(detail=True, methods=["post"], url_path="crear_op")
    def crear_op(self, request, pk=None):
        """POST /api/cotizaciones/{id}/crear_op/ — convierte la COT aprobada en OP.

        Body: { valor_unitario, valor_total, total_costos, costo_papel } — valores
        efectivos del cálculo del front; se estampan en los overrides de la OP
        para que queden congelados (independientes de cambios futuros de precios).
        """
        _require_admin(request)
        cot = self.get_object()
        if cot.estado != "aprobada":
            return Response({"error": "Solo se puede crear OP desde una cotización aprobada."}, status=409)
        if cot.ordenes.exists():
            return Response({"error": "Esta cotización ya tiene una OP creada."}, status=409)

        def _num(key):
            try:
                v = float(request.data.get(key, 0) or 0)
            except (TypeError, ValueError):
                v = -1
            return v

        vals = {k: _num(k) for k in ("valor_unitario", "valor_total", "total_costos", "costo_papel")}
        if any(v < 0 for v in vals.values()):
            return Response({"error": "Valores de liquidación inválidos."}, status=400)

        with transaction.atomic():
            op = OrdenProduccion.objects.create(
                fecha=timezone.localdate(),
                cotizacion=cot,
                cliente=cot.cliente,
                referencia=cot.referencia,
                cantidad=cot.cantidad,
                sobrante=cot.sobrante,
                tipo_cliente=cot.tipo_cliente,
                molde_ancho=cot.molde_ancho,
                molde_alto=cot.molde_alto,
                pliego_tipo=cot.pliego_tipo,
                pliego_w=cot.pliego_w,
                pliego_h=cot.pliego_h,
                papel=cot.papel,
                precio_pliego=cot.precio_pliego,
                costo_papel_override=vals["costo_papel"],
                corte_inicial_active=cot.corte_inicial_active,
                corte_inicial_precio=cot.corte_inicial_precio,
                corte_final_active=cot.corte_final_active,
                corte_final_precio=cot.corte_final_precio,
                valor_unitario_override=vals["valor_unitario"],
                valor_total_override=vals["valor_total"],
                total_costos_override=vals["total_costos"],
                subtotal_override=cot.subtotal_override,
                margen=cot.margen,
                abono=0,
                condicion_pago=cot.condicion_pago,
                condicion_custom=cot.condicion_custom,
                tipo_facturacion=cot.tipo_facturacion,
                observaciones=cot.observaciones,
            )
            OpProceso.objects.bulk_create([
                OpProceso(
                    orden=op,
                    proceso_id=p.proceso_id,
                    active=p.active,
                    costo=p.costo,
                    costo_override=p.costo_override,
                    extras=p.extras,
                )
                for p in cot.procesos.all()
            ])
            cot.estado = "convertida"
            cot.save(update_fields=["estado", "modificado"])

        return Response(OrdenSerializer(op).data, status=201)


class DocumentoClienteViewSet(viewsets.ModelViewSet):
    queryset = DocumentoCliente.objects.select_related("cliente").prefetch_related("items")
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["numero", "cliente__nombre"]
    ordering_fields = ["creado", "fecha", "estado"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_admin(request)

    def get_serializer_class(self):
        if self.action == "list":
            return DocumentoClienteListSerializer
        return DocumentoClienteSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        estado = self.request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)
        return qs

    def _build_pdf_ctx(self, doc):
        return {
            "doc": doc,
            "items": [
                {
                    "referencia": item.referencia,
                    "descripcion": item.descripcion,
                    "tamano_display": item.tamano_display,
                    "cantidad": item.cantidad,
                    "valor_unitario": _fmt_cop(item.valor_unitario),
                    "valor_total": _fmt_cop(item.valor_total),
                }
                for item in doc.items.all()
            ],
            "logo_uri": _logo_data_uri(),
        }

    @action(detail=True, methods=["post"], url_path="pdf")
    def generar_pdf(self, request, pk=None):
        """POST /api/documentos/{id}/pdf/ — devuelve el PDF cliente como descarga."""
        doc = self.get_object()
        ctx = self._build_pdf_ctx(doc)
        try:
            html_pdf = render_to_string("cotizaciones/pdf_documento_cliente.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="Cotizacion_{doc.numero}.pdf"'
        return response

    @action(detail=True, methods=["post"], url_path="enviar")
    def enviar_correo(self, request, pk=None):
        """POST /api/documentos/{id}/enviar/ — envía el PDF cliente por correo."""
        doc = self.get_object()
        email_destino = request.data.get("email") or (doc.cliente.email if doc.cliente.email else None)
        if not email_destino:
            return Response({"error": "No hay email de destino configurado."}, status=400)

        extra_emails = [e for e in request.data.get("extra_emails", []) if e and e.strip()]
        all_recipients = [email_destino] + extra_emails

        ctx = self._build_pdf_ctx(doc)
        try:
            html_pdf = render_to_string("cotizaciones/pdf_documento_cliente.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()

            msg = EmailMessage(
                subject=f"Cotización {doc.numero} — Troqueles INK",
                body=html_pdf,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=all_recipients,
            )
            msg.content_subtype = "html"
            msg.attach(f"Cotizacion_{doc.numero}.pdf", pdf_bytes, "application/pdf")
            sent = msg.send()
            if not sent:
                return Response({"error": "SMTP no confirmó el envío (send() = 0)."}, status=502)
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)

        doc.estado = "enviado"
        doc.save(update_fields=["estado", "modificado"])
        return Response({"ok": True, "enviado_a": all_recipients})




class OrdenProduccionViewSet(viewsets.ModelViewSet):
    """Órdenes de producción. Módulo admin-only, sin estados."""

    queryset = OrdenProduccion.objects.select_related("cliente", "cotizacion", "papel").prefetch_related("procesos")
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["numero", "cliente__nombre", "referencia"]
    ordering_fields = ["creado", "fecha"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_admin(request)

    def get_queryset(self):
        qs = super().get_queryset()
        cliente_id = self.request.query_params.get("cliente")
        if cliente_id:
            qs = qs.filter(cliente_id=cliente_id)
        origen = self.request.query_params.get("origen")
        if origen == "cotizacion":
            qs = qs.filter(cotizacion__isnull=False)
        elif origen == "directa":
            qs = qs.filter(cotizacion__isnull=True)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return OrdenListSerializer
        return OrdenSerializer

    @action(detail=False, methods=["get"], url_path="next_numero")
    def next_numero(self, request):
        """GET /api/ordenes/next_numero/ — número estimado de la próxima OP.

        En SQLite el id usa AUTOINCREMENT (la secuencia no retrocede al borrar),
        así que el estimado sale de sqlite_sequence y no solo de Max(id).
        """
        max_id = OrdenProduccion.objects.aggregate(m=Max("id"))["m"] or 0
        if connection.vendor == "sqlite":
            table = OrdenProduccion._meta.db_table
            with connection.cursor() as cur:
                cur.execute("SELECT seq FROM sqlite_sequence WHERE name = %s", [table])
                row = cur.fetchone()
            if row and row[0]:
                max_id = max(max_id, int(row[0]))
        return Response({"next": f"OP-{max_id + 1:04d}"})

    def _ctx_admin(self, op, data):
        raw_rows = data.get("proc_rows", [])
        saldo = float(data.get("valor_total", 0) or 0) - float(op.abono or 0)
        return {
            "op": op,
            "proc_rows": [{"nombre": p.get("nombre", ""), "costo": _fmt_cop(p.get("costo", 0))} for p in raw_rows],
            "costo_papel": _fmt_cop(data.get("costo_papel", 0)),
            "total_costos_op": _fmt_cop(data.get("total_costos_op", 0)),
            "valor_unitario": _fmt_cop(data.get("valor_unitario", 0)),
            "valor_total": _fmt_cop(data.get("valor_total", 0)),
            "abono": _fmt_cop(op.abono),
            "saldo": _fmt_cop(saldo),
            "logo_uri": _logo_data_uri(),
        }

    @action(detail=True, methods=["post"], url_path="pdf_admin")
    def pdf_admin(self, request, pk=None):
        """POST /api/ordenes/{id}/pdf_admin/ — PDF completo (cliente + finanzas)."""
        op = self.get_object()
        ctx = self._ctx_admin(op, request.data)
        try:
            html_pdf = render_to_string("cotizaciones/pdf_op_admin.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{op.numero}_admin.pdf"'
        return response

    @action(detail=True, methods=["post"], url_path="pdf_produccion")
    def pdf_produccion(self, request, pk=None):
        """POST /api/ordenes/{id}/pdf_produccion/ — PDF para taller.

        Sin datos de cliente ni valores monetarios.
        """
        op = self.get_object()
        raw_rows = request.data.get("proc_rows", [])
        ctx = {
            "op": op,
            "proc_rows": [{"nombre": p.get("nombre", "")} for p in raw_rows],
            "unidades_por_pliego": request.data.get("unidades_por_pliego", ""),
            "pliegos_necesarios": request.data.get("pliegos_necesarios", ""),
            "papel_referencia": request.data.get("papel_referencia", ""),
            "logo_uri": _logo_data_uri(),
        }
        try:
            html_pdf = render_to_string("cotizaciones/pdf_op_produccion.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{op.numero}_produccion.pdf"'
        return response
