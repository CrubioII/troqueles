import base64
import os
import threading
import traceback
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.core.mail import EmailMessage
from django.db import connection, transaction
from django.db.models import F, Max, ProtectedError
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.conf import settings
from django.utils import timezone
from weasyprint import HTML as WeasyprintHTML

from .pdf_troquel import parse_troquel_pdf

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


def _fmt_num(n):
    """Número con separador de miles por puntos (sin símbolo de moneda)."""
    try:
        f = float(n)
    except Exception:
        return "0"
    if f == int(f):
        return "{:,.0f}".format(f).replace(",", ".")
    # decimales con coma, miles con punto (formato es-CO)
    return "{:,.2f}".format(f).replace(",", "X").replace(".", ",").replace("X", ".")

from .models import (
    Cliente, Papel, Cotizacion, DocumentoCliente, OrdenProduccion, OpProceso,
    RegistroMaquina, TroquelModelo, FormatoCuchillas,
    Remision, RemisionItem,
)
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
    RegistroMaquinaSerializer,
    TroquelModeloSerializer,
    FormatoCuchillasSerializer,
    OrdenOperadorSerializer,
    RemisionSerializer,
    RemisionListSerializer,
)
from .serializers import (
    _orden_progreso, _orden_valor_total_efectivo, _orden_valor_unitario_efectivo,
)


def _require_admin(request):
    if not request.user.is_staff:
        raise PermissionDenied("Solo administradores pueden realizar esta acción.")


CAUCHO_LABELS = dict(FormatoCuchillas.CAUCHO_TIPO_CHOICES)


def _build_costos_seed(formato):
    """Líneas de costo derivadas de un formato de cuchillas (una por concepto con datos)."""
    lines = []

    def add(key, concepto, detalle, unidad, cantidad):
        lines.append({
            "key": key, "concepto": concepto, "detalle": detalle or "",
            "unidad": unidad, "cantidad": float(cantidad or 0), "precio": 0,
        })

    for idx, fila in enumerate(formato.cauchos or []):
        tipo = fila.get("tipo") or ""
        cm = float(fila.get("cm") or 0)
        if cm > 0:
            add(f"caucho-{idx}", CAUCHO_LABELS.get(tipo, tipo or "Caucho"), "", "cm", cm)
    if float(formato.cuchilla_cm or 0) > 0:
        detalle = f"{formato.cuchilla_puntos} puntos" if formato.cuchilla_puntos else ""
        add("cuchilla", "Cuchilla", detalle, "cm", formato.cuchilla_cm)
    if float(formato.grafa_cm or 0) > 0:
        partes = []
        if formato.grafa_puntos:
            partes.append(f"{formato.grafa_puntos} puntos")
        if formato.grafa_altura:
            partes.append(f"altura {formato.grafa_altura} mm")
        add("grafa", "Grafa", " · ".join(partes), "cm", formato.grafa_cm)
    if float(formato.ch_cm or 0) > 0:
        add("ch", "CH", formato.ch_medida, "cm", formato.ch_cm)
    if float(formato.sac_cm or 0) > 0:  # legacy: sacabocados en cm
        add("sacabocados", "Sacabocados", formato.sac_medida, "cm", formato.sac_cm)
    elif formato.sac_medida:
        add("sacabocados", "Sacabocados", formato.get_sac_medida_display(), "und", 1)
    if float(formato.perfo_cm or 0) > 0:
        add("perforaciones", "Perforaciones", formato.perfo_medida, "cm", formato.perfo_cm)
    if float(formato.desperdicio_mm or 0) > 0:
        add("desperdicio", "Desperdicio", "", "mm", formato.desperdicio_mm)
    if (formato.gan or "").strip():
        add("gan", "Gan", formato.gan.strip(), "und", 0)
    return lines


def _sync_troquel_costos(op):
    """Re-siembra costos_items desde el último formato no-borrador, conservando
    los precios ya ingresados por el Admin (y cantidad/precio del gan)."""
    formato = op.formatos_cuchillas.exclude(estado="borrador").order_by("-fecha_hora").first()
    if not formato:
        return None
    modelo, _ = TroquelModelo.objects.get_or_create(orden=op)
    prev = {item.get("key"): item for item in (modelo.costos_items or [])}
    prev_caucho_precio = {}
    for item in (modelo.costos_items or []):
        if str(item.get("key", "")).startswith("caucho-") and float(item.get("precio") or 0) > 0:
            prev_caucho_precio.setdefault(item.get("concepto"), item.get("precio"))
    seed = _build_costos_seed(formato)
    for line in seed:
        old = prev.get(line["key"])
        if old:
            line["precio"] = old.get("precio") or 0
            if line["key"] == "gan":
                line["cantidad"] = old.get("cantidad") or line["cantidad"]
        # Solo se conservan precios ya escritos por el Admin (misma línea o
        # mismo tipo de caucho); nunca se auto-rellenan.
        if line["key"].startswith("caucho-") and not float(line["precio"] or 0):
            line["precio"] = prev_caucho_precio.get(line["concepto"]) or 0
    modelo.costos_items = seed
    modelo.save(update_fields=["costos_items", "modificado"])
    _write_troquel_costo_proceso(op, _costos_items_total(seed))
    return modelo


def _costos_items_total(items):
    return round(sum(
        float(i.get("cantidad") or 0) * float(i.get("precio") or 0) for i in (items or [])
    ), 2)


def _troquel_costos_total(op):
    # Consulta directa (no la relación cacheada): el modelo puede haberse
    # creado/actualizado por _sync_troquel_costos en este mismo request.
    modelo = TroquelModelo.objects.filter(orden=op).first()
    return _costos_items_total(modelo.costos_items) if modelo else 0


def _write_troquel_costo_proceso(op, total):
    op.procesos.filter(proceso_id="troquel").update(costo=total)


def _maybe_crear_remision(op):
    """Si la OP está al 100% y aún no tiene remisión, créala (estado=pendiente).

    Genera un ítem inicial derivado de la OP (referencia + valor total de venta,
    o el total de costos de troquel si la OP tiene ese proceso activo);
    el dueño lo edita/divide al liquidar. Idempotente y silencioso ante errores
    para no romper el flujo de finalización de procesos.
    """
    try:
        progreso = _orden_progreso(op)
        if not progreso or progreso.get("porcentaje") != 100:
            return None
        if Remision.objects.filter(orden=op).exists():
            return None
        with transaction.atomic():
            rem = Remision.objects.create(
                fecha=timezone.localdate(),
                orden=op,
                cliente=op.cliente,
                direccion=op.cliente.direccion,
                ciudad=op.cliente.ciudad,
                observaciones=op.observaciones,
            )
            valor = 0
            if op.procesos.filter(proceso_id="troquel", active=True).exists():
                valor = _troquel_costos_total(op)
            if not valor:
                valor = _orden_valor_total_efectivo(op) or 0
            RemisionItem.objects.create(
                remision=rem,
                descripcion=op.referencia,
                cantidad=op.cantidad or 0,
                valor_total=valor,
                orden=0,
            )
        return rem
    except Exception:
        traceback.print_exc()
        return None


INACTIVE_DAYS = 90


def _cliente_ultima_actividad(cliente):
    """(fecha date|None, tipo str|None) de la actividad más reciente del cliente,
    considerando cotizaciones, órdenes y remisiones (por fecha de negocio)."""
    eventos = []
    cot = cliente.cotizaciones.order_by("-fecha").first()
    if cot:
        eventos.append((cot.fecha, "cotizacion"))
    orden = cliente.ordenes.order_by("-fecha").first()
    if orden:
        eventos.append((orden.fecha, "orden"))
    rem = cliente.remisiones.order_by("-fecha").first()
    if rem:
        eventos.append((rem.fecha, "remision"))
    if not eventos:
        return None, None
    fecha, tipo = max(eventos, key=lambda e: e[0])
    return fecha, tipo


def _cliente_finanzas(cliente):
    """Total facturado y saldo pendiente a partir de las OPs del cliente."""
    total_facturado = 0.0
    saldo_pendiente = 0.0
    for op in cliente.ordenes.all():
        valor = _orden_valor_total_efectivo(op)
        if valor is None:
            continue
        total_facturado += valor
        saldo_pendiente += valor - float(op.abono or 0)
    return round(total_facturado), round(saldo_pendiente)


class ClienteViewSet(viewsets.ModelViewSet):
    queryset = Cliente.objects.all()
    serializer_class = ClienteSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["nombre"]

    @action(detail=False, methods=["get"])
    def resumen(self, request):
        """Listado de clientes con señales de re-engagement y finanzas."""
        hoy = timezone.localdate()
        qs = Cliente.objects.prefetch_related(
            "cotizaciones", "ordenes", "ordenes__procesos", "remisiones",
        ).order_by("nombre")
        clientes = []
        inactivos = 0
        for c in qs:
            ultima, tipo = _cliente_ultima_actividad(c)
            dias = (hoy - ultima).days if ultima else None
            inactivo = dias is not None and dias >= INACTIVE_DAYS
            if inactivo:
                inactivos += 1
            total_facturado, saldo_pendiente = _cliente_finanzas(c)
            clientes.append({
                "id": c.id,
                "nombre": c.nombre,
                "tipo": c.tipo,
                "email": c.email,
                "telefono": c.telefono,
                "ultima_actividad": ultima,
                "ultima_actividad_tipo": tipo,
                "dias_inactivo": dias,
                "inactivo": inactivo,
                "n_cotizaciones": c.cotizaciones.count(),
                "n_ordenes": c.ordenes.count(),
                "total_facturado": total_facturado,
                "saldo_pendiente": saldo_pendiente,
            })
        return Response({"inactivos": inactivos, "clientes": clientes})

    @action(detail=True, methods=["get"])
    def perfil(self, request, pk=None):
        """Perfil completo: datos, finanzas e historial del cliente."""
        cliente = self.get_object()
        hoy = timezone.localdate()
        ultima, tipo = _cliente_ultima_actividad(cliente)
        dias = (hoy - ultima).days if ultima else None
        total_facturado, saldo_pendiente = _cliente_finanzas(cliente)

        cotizaciones = cliente.cotizaciones.select_related("cliente").order_by("-creado")
        ordenes = cliente.ordenes.select_related("cliente", "cotizacion").prefetch_related("procesos").order_by("-creado")
        remisiones = cliente.remisiones.select_related("cliente", "orden").order_by("-creado")

        ctx = {"request": request}
        return Response({
            "cliente": ClienteSerializer(cliente).data,
            "finanzas": {
                "total_facturado": total_facturado,
                "saldo_pendiente": saldo_pendiente,
                "n_cotizaciones": cotizaciones.count(),
                "n_ordenes": ordenes.count(),
                "n_remisiones": remisiones.count(),
                "ultima_actividad": ultima,
                "ultima_actividad_tipo": tipo,
                "dias_inactivo": dias,
                "inactivo": dias is not None and dias >= INACTIVE_DAYS,
            },
            "cotizaciones": CotizacionListSerializer(cotizaciones, many=True, context=ctx).data,
            "ordenes": OrdenListSerializer(ordenes, many=True, context=ctx).data,
            "remisiones": RemisionListSerializer(remisiones, many=True, context=ctx).data,
        })


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
        if self.action in ("toggle_proceso_completado", "list", "retrieve", "produccion", "buscar", "produccion_pendientes"):
            return
        _require_admin(request)

    def get_queryset(self):
        qs = super().get_queryset()
        # Las OP ya remisionadas (100% completadas) salen de los listados de producción.
        if not self.request.query_params.get("incluir_remisionadas"):
            qs = qs.filter(remision__isnull=True)
        cliente_id = self.request.query_params.get("cliente")
        if cliente_id:
            qs = qs.filter(cliente_id=cliente_id)
        origen = self.request.query_params.get("origen")
        if origen == "cotizacion":
            qs = qs.filter(cotizacion__isnull=False)
        elif origen == "directa":
            qs = qs.filter(cotizacion__isnull=True)
        proceso_id = self.request.query_params.get("proceso")
        if proceso_id:
            ids = proceso_id.split(",")
            qs = qs.filter(procesos__proceso_id__in=ids, procesos__active=True).distinct()
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return OrdenListSerializer
        return OrdenSerializer

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "La OP ya tiene remisión y no puede eliminarse."},
                status=400,
            )

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

    @action(detail=True, methods=["patch"], url_path=r"procesos/(?P<proceso_id>[^/.]+)/completado")
    def toggle_proceso_completado(self, request, pk=None, proceso_id=None):
        """PATCH /api/ordenes/{id}/procesos/{proceso_id}/completado/ — Body: { completado: bool }."""
        op = self.get_object()
        try:
            proceso = op.procesos.get(proceso_id=proceso_id)
        except OpProceso.DoesNotExist:
            return Response({"error": "Proceso no encontrado en esta OP."}, status=404)
        completado = bool(request.data.get("completado"))
        proceso.completado = completado
        proceso.completado_en = timezone.now() if completado else None
        proceso.save(update_fields=["completado", "completado_en"])
        if completado:
            if proceso_id == "troquel":
                # Completar troquel manualmente equivale a aprobar los formatos en cola.
                # Los borradores no se aprueban: el operador retiró ese envío a propósito.
                op.formatos_cuchillas.filter(estado="pendiente").update(
                    estado="aprobado", revisado_por=request.user, revisado_en=timezone.now()
                )
            # OP fresca: el prefetch de procesos quedó desactualizado tras el save.
            _maybe_crear_remision(OrdenProduccion.objects.get(pk=op.pk))
        return Response(OpProcesoSerializer(proceso).data)

    @action(detail=True, methods=["get"], url_path="produccion")
    def produccion(self, request, pk=None):
        """GET /api/ordenes/{id}/produccion/ — OP sanitizada para el Operador.

        Sin cliente ni valores monetarios; incluye el modelo del troquel sanitizado.
        """
        op = self.get_object()
        return Response(OrdenOperadorSerializer(op, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="buscar")
    def buscar(self, request):
        """GET /api/ordenes/buscar/?numero=OP-0001 — búsqueda por número (Operador).

        Devuelve la OP sanitizada, evitando exponer la lista admin con cliente.
        """
        numero = (request.query_params.get("numero") or "").strip()
        if not numero:
            return Response({"error": "Falta el parámetro 'numero'."}, status=400)
        op = OrdenProduccion.objects.filter(numero__iexact=numero).first()
        if op is None:
            op = OrdenProduccion.objects.filter(numero__icontains=numero).first()
        if op is None:
            return Response({"error": "OP no encontrada."}, status=404)
        return Response(OrdenOperadorSerializer(op, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="produccion_pendientes")
    def produccion_pendientes(self, request):
        """GET /api/ordenes/produccion_pendientes/?proceso=troquel — lista para el Operador.

        OPs con un proceso activo pendiente (no completado), ordenadas por fecha de
        entrega ascendente (las más próximas a vencer primero; sin fecha al final).
        Vista sanitizada: sin valores monetarios (el cliente sí es visible).
        """
        proceso_id = (request.query_params.get("proceso") or "").strip()
        qs = OrdenProduccion.objects.select_related("cliente")
        if proceso_id:
            qs = qs.filter(
                procesos__proceso_id=proceso_id,
                procesos__active=True,
                procesos__completado=False,
            ).distinct()
            if proceso_id == "troquel":
                # OPs con formato esperando aprobación del Admin no están
                # pendientes para el Operador (los devueltos sí reaparecen).
                qs = qs.exclude(formatos_cuchillas__estado="pendiente")
        qs = qs.order_by(F("fecha_entrega").asc(nulls_last=True), "creado")
        data = OrdenOperadorSerializer(qs, many=True, context={"request": request}).data
        return Response(data)

    @action(detail=True, methods=["get", "patch"], url_path="troquel_costos")
    def troquel_costos(self, request, pk=None):
        """GET/PATCH /api/ordenes/{id}/troquel_costos/ — líneas de costo (solo Admin).

        Las líneas se siembran desde el formato de cuchillas del Operador y el
        Admin las edita (cantidad × precio). PATCH body: {"items": [...]}.
        El total se refleja en el costo del proceso troquel de la OP.
        """
        op = self.get_object()
        if request.method == "PATCH":
            raw = request.data.get("items")
            if not isinstance(raw, list):
                return Response({"error": "items debe ser una lista."}, status=400)
            items = []
            for i in raw:
                if not isinstance(i, dict):
                    return Response({"error": "Cada línea debe ser un objeto."}, status=400)
                try:
                    cantidad = float(i.get("cantidad") or 0)
                    precio = float(i.get("precio") or 0)
                except (TypeError, ValueError):
                    return Response({"error": "cantidad y precio deben ser numéricos."}, status=400)
                if cantidad < 0 or precio < 0:
                    return Response({"error": "cantidad y precio no pueden ser negativos."}, status=400)
                items.append({
                    "key": str(i.get("key") or ""),
                    "concepto": str(i.get("concepto") or "")[:100],
                    "detalle": str(i.get("detalle") or "")[:200],
                    "unidad": str(i.get("unidad") or "")[:10],
                    "cantidad": cantidad,
                    "precio": precio,
                })
            modelo, _ = TroquelModelo.objects.get_or_create(orden=op)
            modelo.costos_items = items
            modelo.save(update_fields=["costos_items", "modificado"])
            _write_troquel_costo_proceso(op, _costos_items_total(items))
        else:
            modelo = getattr(op, "troquel_modelo", None)
            if not modelo or not modelo.costos_items:
                # bootstrap para formatos previos a esta función
                modelo = _sync_troquel_costos(op) or modelo
        items = list(modelo.costos_items) if modelo else []
        for i in items:
            i["total"] = round(float(i.get("cantidad") or 0) * float(i.get("precio") or 0), 2)
        return Response({"items": items, "total": _costos_items_total(items)})


class RegistroMaquinaViewSet(viewsets.ModelViewSet):
    """Registros de ejecución por máquina (troquel, guillotina).

    fecha_hora y operador se estampan server-side. Editar/eliminar
    registros existentes requiere admin; listar/crear es para cualquier
    usuario autenticado.
    """

    queryset = RegistroMaquina.objects.select_related("orden", "orden__cliente", "operador")
    serializer_class = RegistroMaquinaSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["fecha_hora"]

    def get_queryset(self):
        qs = super().get_queryset()
        maquina = self.request.query_params.get("maquina")
        if maquina:
            qs = qs.filter(maquina=maquina)
        orden_id = self.request.query_params.get("orden")
        if orden_id:
            qs = qs.filter(orden_id=orden_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(operador=self.request.user)

    def update(self, request, *args, **kwargs):
        _require_admin(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        _require_admin(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        _require_admin(request)
        return super().destroy(request, *args, **kwargs)


class RemisionViewSet(viewsets.ModelViewSet):
    """Remisiones (comprobante de entrega/cobro). Módulo admin-only.

    Se autogeneran al completar una OP (estado=pendiente). El dueño edita los
    ítems y al liquidar se envía por correo (cliente + contaduría) y pasa al
    historial (estado=liquidada). No se crean ni borran desde la API (PROTECT).
    """

    queryset = Remision.objects.select_related("cliente", "orden").prefetch_related("items")
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["numero", "cliente__nombre", "orden__numero"]
    ordering_fields = ["creado", "fecha", "estado"]
    http_method_names = ["get", "patch", "put", "post", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_admin(request)

    def get_serializer_class(self):
        if self.action == "list":
            return RemisionListSerializer
        return RemisionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        estado = self.request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)
        fecha = self.request.query_params.get("fecha")
        if fecha:
            qs = qs.filter(fecha=fecha)
        fecha_after = self.request.query_params.get("fecha_after")
        if fecha_after:
            qs = qs.filter(fecha__gte=fecha_after)
        fecha_before = self.request.query_params.get("fecha_before")
        if fecha_before:
            qs = qs.filter(fecha__lte=fecha_before)
        return qs

    def _build_pdf_ctx(self, rem, admin=False):
        items = list(rem.items.all())
        total_cantidad = sum((it.cantidad or 0) for it in items)
        total_valor = sum((it.valor_total or 0) for it in items)
        ctx = {
            "rem": rem,
            "items": [
                {
                    "descripcion": item.descripcion,
                    "cantidad": _fmt_num(item.cantidad),
                    "valor_total": _fmt_cop(item.valor_total),
                }
                for item in items
            ],
            "total_cantidad": _fmt_num(total_cantidad),
            "total_valor": _fmt_cop(total_valor),
            "logo_uri": _logo_data_uri(),
        }
        if admin:
            modelo = TroquelModelo.objects.filter(orden=rem.orden).first() if rem.orden_id else None
            costos = list(modelo.costos_items) if modelo else []
            ctx["costos"] = [
                {
                    "concepto": c.get("concepto") or "",
                    "detalle": c.get("detalle") or "",
                    "unidad": c.get("unidad") or "",
                    "cantidad": _fmt_num(c.get("cantidad")),
                    "precio": _fmt_cop(c.get("precio")),
                    "total": _fmt_cop(float(c.get("cantidad") or 0) * float(c.get("precio") or 0)),
                }
                for c in costos
            ]
            ctx["costos_total"] = _fmt_cop(_costos_items_total(costos))
        return ctx

    @action(detail=True, methods=["post"], url_path="pdf")
    def generar_pdf(self, request, pk=None):
        """POST /api/remisiones/{id}/pdf/ — devuelve el PDF de la remisión como descarga.

        Body {"tipo": "admin"} → documento interno con desglose de costos del
        troquel; por defecto genera el PDF para el cliente (sin valores por ítem).
        """
        rem = self.get_object()
        es_admin = (request.data.get("tipo") or request.query_params.get("tipo")) == "admin"
        ctx = self._build_pdf_ctx(rem, admin=es_admin)
        template = "cotizaciones/pdf_remision_admin.html" if es_admin else "cotizaciones/pdf_remision.html"
        try:
            html_pdf = render_to_string(template, ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        filename = f"Remision_{rem.numero}_admin.pdf" if es_admin else f"Remision_{rem.numero}.pdf"
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="liquidar")
    def liquidar(self, request, pk=None):
        """POST /api/remisiones/{id}/liquidar/ — envía por correo y pasa al historial.

        Destinatarios: email del cliente + CONTADURIA_EMAIL (settings) + extra_emails.
        Marca estado=liquidada y estampa enviada_en/liquidada_en.
        """
        rem = self.get_object()
        if rem.estado != "pendiente":
            return Response(
                {"error": "Esta remisión ya fue liquidada o consolidada."}, status=409)

        recipients = []
        email_cliente = request.data.get("email") or rem.cliente.email
        if email_cliente and email_cliente.strip():
            recipients.append(email_cliente.strip())
        contaduria = getattr(settings, "CONTADURIA_EMAIL", "")
        if contaduria and contaduria.strip():
            recipients.append(contaduria.strip())
        recipients += [e.strip() for e in request.data.get("extra_emails", []) if e and e.strip()]
        # Únicos preservando orden
        recipients = list(dict.fromkeys(recipients))
        if not recipients:
            return Response({"error": "No hay destinatarios (cliente sin email y CONTADURIA_EMAIL vacío)."}, status=400)

        ctx = self._build_pdf_ctx(rem)
        try:
            html_pdf = render_to_string("cotizaciones/pdf_remision.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()

            msg = EmailMessage(
                subject=f"Remisión {rem.numero} — Troqueles INK",
                body=html_pdf,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=recipients,
            )
            msg.content_subtype = "html"
            msg.attach(f"Remision_{rem.numero}.pdf", pdf_bytes, "application/pdf")
            sent = msg.send()
            if not sent:
                return Response({"error": "SMTP no confirmó el envío (send() = 0)."}, status=502)
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)

        now = timezone.now()
        rem.estado = "liquidada"
        rem.enviada_en = now
        rem.liquidada_en = now
        rem.save(update_fields=["estado", "enviada_en", "liquidada_en", "modificado"])
        return Response({"ok": True, "enviado_a": recipients, "remision": RemisionSerializer(rem).data})

    def _resumen_importable(self, rem):
        items = list(rem.items.all())
        return {
            "id": rem.id,
            "numero": rem.numero,
            "orden_numero": rem.orden.numero if rem.orden_id else "",
            "fecha": rem.fecha,
            "total_cantidad": sum((it.cantidad or 0) for it in items),
            "total_valor": sum((it.valor_total or 0) for it in items),
            "items": [
                {"descripcion": it.descripcion, "cantidad": it.cantidad, "valor_total": it.valor_total}
                for it in items
            ],
        }

    @action(detail=True, methods=["get"], url_path="importables")
    def importables(self, request, pk=None):
        """GET /api/remisiones/{id}/importables/ — otras remisiones pendientes del mismo
        cliente que pueden fusionarse en esta. Excluye liquidadas/consolidadas y a sí misma."""
        rem = self.get_object()
        qs = (
            Remision.objects.filter(cliente=rem.cliente, estado="pendiente")
            .exclude(pk=rem.pk)
            .select_related("orden")
            .prefetch_related("items")
            .order_by("fecha", "numero")
        )
        return Response([self._resumen_importable(r) for r in qs])

    @action(detail=True, methods=["post"], url_path="importar")
    def importar(self, request, pk=None):
        """POST /api/remisiones/{id}/importar/ — fusiona los ítems de las remisiones origen
        (mismo cliente, pendientes) en esta. Cada origen pasa a estado=consolidada.

        Body: { "remision_ids": [int, ...] }
        """
        target = self.get_object()
        if target.estado != "pendiente":
            return Response(
                {"error": "Solo se puede importar a una remisión pendiente."}, status=409)

        ids = request.data.get("remision_ids", [])
        if not isinstance(ids, list) or not ids:
            return Response({"error": "Falta remision_ids."}, status=400)

        fuentes = list(
            Remision.objects.filter(pk__in=ids).prefetch_related("items").exclude(pk=target.pk)
        )
        if len(fuentes) != len({i for i in ids if i != target.pk}):
            return Response({"error": "Alguna remisión no existe."}, status=404)
        for f in fuentes:
            if f.cliente_id != target.cliente_id:
                return Response({"error": "Todas las remisiones deben ser del mismo cliente."}, status=400)
            if f.estado != "pendiente":
                return Response({"error": f"La remisión {f.numero} ya fue enviada o consolidada."}, status=409)

        now = timezone.now()
        next_orden = (target.items.aggregate(m=Max("orden")).get("m") or 0) + 1
        with transaction.atomic():
            for f in fuentes:
                for it in f.items.all():
                    RemisionItem.objects.create(
                        remision=target,
                        descripcion=it.descripcion,
                        cantidad=it.cantidad,
                        valor_total=it.valor_total,
                        orden=next_orden,
                    )
                    next_orden += 1
                f.estado = "consolidada"
                f.consolidada_en = now
                f.consolidada_en_remision = target
                f.save(update_fields=["estado", "consolidada_en", "consolidada_en_remision", "modificado"])
        target.refresh_from_db()
        return Response(RemisionSerializer(target).data)


class TroquelModeloViewSet(viewsets.ModelViewSet):
    """Modelo del troquel asociado a una OP. CRUD solo Admin (subida de archivo)."""

    queryset = TroquelModelo.objects.select_related("orden")
    serializer_class = TroquelModeloSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_admin(request)

    def get_queryset(self):
        qs = super().get_queryset()
        orden_id = self.request.query_params.get("orden")
        if orden_id:
            qs = qs.filter(orden_id=orden_id)
        return qs

    @action(detail=False, methods=["post"])
    def extraer_pdf(self, request):
        """Lee un PDF de modelo de troquel y devuelve los campos detectados (sin guardar)."""
        archivo = request.FILES.get("archivo")
        if not archivo:
            return Response({"error": "Falta el archivo"}, status=400)
        try:
            data = parse_troquel_pdf(archivo)
        except Exception:
            return Response({"error": "No se pudo leer el PDF"}, status=400)
        return Response(data)


class FormatoCuchillasViewSet(viewsets.ModelViewSet):
    """Formato de cuchillas + tiempos. Listar/crear: autenticados (Operador).

    Editar/eliminar requiere admin. operador y fecha_hora se estampan server-side.
    """

    queryset = FormatoCuchillas.objects.select_related("orden", "operador")
    serializer_class = FormatoCuchillasSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["fecha_hora"]

    def get_queryset(self):
        qs = super().get_queryset()
        orden_id = self.request.query_params.get("orden")
        if orden_id:
            qs = qs.filter(orden_id=orden_id)
        estado = self.request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)
        return qs

    def perform_create(self, serializer):
        # Un solo formato por OP: el Operador registra una vez y queda bloqueado.
        # Solo el Admin puede crear/editar adicionales.
        orden = serializer.validated_data.get("orden")
        if not self.request.user.is_staff and FormatoCuchillas.objects.filter(orden=orden).exists():
            raise ValidationError(
                "Esta OP ya tiene un formato de cuchillas registrado. "
                "Solo el administrador puede modificarlo."
            )
        # El Operador guarda avances como borrador y decide cuándo enviar
        # (enviar=true → pendiente de aprobación). El troquel solo se completa
        # (y puede generar remisión) cuando el Admin lo aprueba.
        if self.request.user.is_staff:
            formato = serializer.save(operador=self.request.user)
        else:
            estado = "pendiente" if self.request.data.get("enviar") else "borrador"
            formato = serializer.save(operador=self.request.user, estado=estado)
        if formato.estado != "borrador" and formato.orden_id:
            _sync_troquel_costos(formato.orden)

    def update(self, request, *args, **kwargs):
        self._check_update_permission(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._check_update_permission(request)
        return super().partial_update(request, *args, **kwargs)

    def _check_update_permission(self, request):
        # Operador solo puede editar sus propios formatos no aprobados
        # (pendiente, devuelto o borrador). El estado solo cambia a pendiente
        # cuando el body trae enviar=true; si no, se conserva.
        if request.user.is_staff:
            return
        formato = self.get_object()
        if formato.estado not in ("pendiente", "devuelto", "borrador"):
            raise PermissionDenied("Solo administradores pueden realizar esta acción.")
        if formato.operador_id != request.user.id:
            raise PermissionDenied("Solo el operador que registró el formato puede editarlo.")

    def perform_update(self, serializer):
        if self.request.user.is_staff:
            formato = serializer.save()
        elif self.request.data.get("enviar"):
            # Envío/reenvío del Operador: vuelve a la cola de aprobación.
            formato = serializer.save(
                operador=self.request.user,
                estado="pendiente",
                devolucion_motivo="",
            )
        else:
            # Guardar avance: conserva el estado actual (borrador/devuelto/pendiente).
            formato = serializer.save(operador=self.request.user)
        if formato.estado != "borrador" and formato.orden_id:
            _sync_troquel_costos(formato.orden)

    def destroy(self, request, *args, **kwargs):
        _require_admin(request)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="cancelar_envio")
    def cancelar_envio(self, request, pk=None):
        """POST /api/formatos-cuchillas/{id}/cancelar_envio/ — el Operador dueño
        retira un formato pendiente para volver a editarlo (→ borrador)."""
        formato = self.get_object()
        if not request.user.is_staff and formato.operador_id != request.user.id:
            raise PermissionDenied("Solo el operador que envió el formato puede cancelarlo.")
        # UPDATE condicional atómico: si el Admin lo revisó un instante antes,
        # no actualiza ninguna fila y respondemos 409.
        updated = FormatoCuchillas.objects.filter(pk=formato.pk, estado="pendiente").update(
            estado="borrador", devolucion_motivo=""
        )
        if not updated:
            return Response({"error": "El formato ya fue revisado por el administrador."}, status=409)
        formato.refresh_from_db()
        return Response(self.get_serializer(formato).data)

    @action(detail=True, methods=["post"], url_path="aprobar")
    def aprobar(self, request, pk=None):
        """POST /api/formatos-cuchillas/{id}/aprobar/ — Admin aprueba el formato.

        Completa el proceso troquel de la OP y dispara la creación de remisión
        si la OP queda al 100%.
        """
        _require_admin(request)
        formato = self.get_object()
        if formato.estado == "borrador":
            return Response({"error": "El operador canceló el envío de este formato."}, status=409)
        formato.estado = "aprobado"
        formato.devolucion_motivo = ""
        formato.revisado_por = request.user
        formato.revisado_en = timezone.now()
        formato.save(update_fields=["estado", "devolucion_motivo", "revisado_por", "revisado_en"])
        if formato.orden_id:
            formato.orden.procesos.filter(proceso_id="troquel").update(
                completado=True, completado_en=timezone.now()
            )
            # Bootstrap defensivo: si aún no hay líneas de costo, siémbralas.
            # No re-sincroniza si existen, para no pisar ediciones del Admin.
            modelo = TroquelModelo.objects.filter(orden=formato.orden).first()
            if not modelo or not modelo.costos_items:
                _sync_troquel_costos(formato.orden)
            _maybe_crear_remision(formato.orden)
        return Response(self.get_serializer(formato).data)

    @action(detail=True, methods=["post"], url_path="devolver")
    def devolver(self, request, pk=None):
        """POST /api/formatos-cuchillas/{id}/devolver/ — Body: { motivo }.

        Devuelve el formato al Operador: el proceso troquel vuelve a pendiente
        y la OP reaparece en su lista. Si ya existía remisión, no se elimina;
        una re-aprobación no la duplica (creación idempotente).
        """
        _require_admin(request)
        formato = self.get_object()
        if formato.estado == "borrador":
            return Response({"error": "El operador canceló el envío de este formato."}, status=409)
        formato.estado = "devuelto"
        formato.devolucion_motivo = (request.data.get("motivo") or "").strip()[:300]
        formato.revisado_por = request.user
        formato.revisado_en = timezone.now()
        formato.save(update_fields=["estado", "devolucion_motivo", "revisado_por", "revisado_en"])
        if formato.orden_id:
            formato.orden.procesos.filter(proceso_id="troquel").update(
                completado=False, completado_en=None
            )
        return Response(self.get_serializer(formato).data)
