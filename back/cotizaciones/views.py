import base64
import os
import threading
import traceback
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from django.contrib.auth.models import User
from django.core.mail import EmailMessage
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
    OpProcesoSerializer,
    OperarioSerializer,
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


class DocumentoClienteViewSet(viewsets.ModelViewSet):
    queryset = DocumentoCliente.objects.select_related("cliente").prefetch_related("items")
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["numero", "cliente__nombre"]
    ordering_fields = ["creado", "fecha", "estado"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_admin(request)

    def create(self, request, *args, **kwargs):
        return Response(
            {"detail": "Documentos solo se crean desde una cotización aprobada."},
            status=405,
        )

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
    queryset = OrdenProduccion.objects.select_related("cliente", "cotizacion").prefetch_related(
        "procesos__operario"
    )
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
        if not self.request.user.is_staff:
            qs = qs.filter(procesos__operario=self.request.user).distinct()
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return OrdenListSerializer
        return OrdenSerializer

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

    @action(detail=True, methods=["patch"], url_path="estado")
    def cambiar_estado(self, request, pk=None):
        _require_admin(request)
        orden = self.get_object()
        nuevo = request.data.get("estado")
        opciones = [c[0] for c in OrdenProduccion.ESTADOS]
        if nuevo not in opciones:
            return Response({"error": f"Estado inválido. Opciones: {opciones}"}, status=400)
        orden.estado = nuevo
        orden.save(update_fields=["estado", "modificado"])
        return Response(OrdenSerializer(orden).data)

    @action(detail=True, methods=["patch"], url_path="anular")
    def anular(self, request, pk=None):
        _require_admin(request)
        orden = self.get_object()
        orden.estado = "anulada"
        orden.save(update_fields=["estado", "modificado"])
        return Response(OrdenSerializer(orden).data)

    @action(detail=True, methods=["patch"], url_path="procesos/progreso")
    def actualizar_progreso(self, request, pk=None):
        """Operario actualiza progreso de un proceso asignado.
        Body: { proceso_id, estado?, unidades_completadas?, notas? }
        """
        orden = self.get_object()
        proceso_id = request.data.get("proceso_id")
        if not proceso_id:
            return Response({"error": "proceso_id requerido"}, status=400)

        try:
            proc = orden.procesos.get(proceso_id=proceso_id)
        except OpProceso.DoesNotExist:
            return Response({"error": "Proceso no encontrado"}, status=404)

        if not request.user.is_staff and proc.operario != request.user:
            raise PermissionDenied("Solo puedes actualizar tus procesos asignados.")

        update_fields = []

        nuevo_estado = request.data.get("estado")
        if nuevo_estado and nuevo_estado in [c[0] for c in OpProceso.ESTADOS]:
            if nuevo_estado == "en_proceso" and not proc.iniciado_en:
                proc.iniciado_en = timezone.now()
                update_fields.append("iniciado_en")
            elif nuevo_estado == "completado" and not proc.completado_en:
                proc.completado_en = timezone.now()
                update_fields.append("completado_en")
            proc.estado = nuevo_estado
            update_fields.append("estado")

        if "unidades_completadas" in request.data:
            proc.unidades_completadas = int(request.data["unidades_completadas"])
            update_fields.append("unidades_completadas")

        if "notas" in request.data:
            proc.notas = request.data["notas"]
            update_fields.append("notas")

        if update_fields:
            proc.save(update_fields=update_fields)
            self._sync_orden_estado(orden)

        return Response(OpProcesoSerializer(proc).data)

    def _sync_orden_estado(self, orden):
        procs = list(orden.procesos.filter(active=True))
        if not procs:
            return
        estados = [p.estado for p in procs]
        if all(e == "completado" for e in estados):
            if orden.estado not in ("finalizada", "remisionada"):
                orden.estado = "finalizada"
                orden.save(update_fields=["estado", "modificado"])
        elif any(e == "en_proceso" for e in estados):
            if orden.estado == "programada":
                orden.estado = "en_proceso"
                orden.save(update_fields=["estado", "modificado"])

    @action(detail=False, methods=["get"], url_path="operarios")
    def listar_operarios(self, request):
        _require_admin(request)
        users = User.objects.filter(is_active=True).order_by("username")
        return Response(OperarioSerializer(users, many=True).data)
