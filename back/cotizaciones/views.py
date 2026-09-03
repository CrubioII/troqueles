import base64
import os
import re
import threading
import traceback
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.core.mail import EmailMessage
from django.db import connection, transaction
from django.db.models import Exists, F, Max, OuterRef, ProtectedError, Q, Subquery
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_date
from weasyprint import HTML as WeasyprintHTML


_LOGO_PATH = os.path.join(settings.BASE_DIR, "cotizaciones", "static", "cotizaciones", "logo.png")
_FIRMA_PATH = os.path.join(settings.BASE_DIR, "cotizaciones", "static", "cotizaciones", "firma.png")

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


def _firma_data_uri():
    try:
        with open(_FIRMA_PATH, "rb") as f:
            return "data:image/png;base64," + base64.b64encode(f.read()).decode()
    except Exception:
        return ""


def _fmt_opcion_cot(o):
    """Formatea un bloque de opción de cobro (payload del front) para los templates."""
    return {
        "titulo": str(o.get("titulo", ""))[:80],
        "proc_rows": [
            {"nombre": p.get("nombre", ""), "costo": _fmt_cop(p.get("costo", 0)), "detalle": str(p.get("detalle", ""))[:120]}
            for p in o.get("proc_rows", [])
        ],
        "costo_papel": _fmt_cop(o.get("costo_papel", 0)),
        "mostrar_papel": float(o.get("costo_papel", 0) or 0) > 0,
        "total_costos_op": _fmt_cop(o.get("total_costos_op", 0)),
        "valor_unitario": _fmt_cop(o.get("valor_unitario", 0)),
        "valor_unitario_label": str(o.get("valor_unitario_label", "") or "Valor unitario")[:40],
        "valor_total": _fmt_cop(o.get("valor_total", 0)),
    }


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
    Remision, RemisionItem, RegistroProceso, Notificacion,
)
from .models import ORDEN_CAMPOS_AUDITADOS, orden_valor_legible, registrar_cambios_orden
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
    OrdenCambioSerializer,
    RemisionableOperadorSerializer,
    RemisionGeneradaOperadorSerializer,
    RemisionSerializer,
    RemisionListSerializer,
    RegistroProcesoSerializer,
    NotificacionSerializer,
    OrdenEstacionSerializer,
)
from .serializers import (
    _orden_progreso, _orden_valor_total_efectivo, _orden_valor_unitario_efectivo,
    _cantidad_esperada,
)
from . import chain
from . import roles


def _require_admin(request):
    if not request.user.is_staff:
        raise PermissionDenied("Solo administradores pueden realizar esta acción.")


def _require_estacion(request, estacion_id):
    if estacion_id not in roles.estaciones_permitidas(request.user):
        raise PermissionDenied("No tienes acceso a esta estación.")


def _require_troqueles(request):
    if not roles.puede_troqueles(request.user):
        raise PermissionDenied("No tienes acceso al módulo de Troqueles.")


def _require_remisiones_generales(request):
    if not roles.puede_remisiones_generales(request.user):
        raise PermissionDenied("No tienes acceso a las remisiones de producción.")


def _require_alguna_remision(request):
    if not roles.puede_alguna_remision(request.user):
        raise PermissionDenied("No tienes acceso a remisiones.")


CAUCHO_LABELS = dict(FormatoCuchillas.CAUCHO_TIPO_CHOICES)
CUCHILLA_TIPO_LABELS = dict(FormatoCuchillas.CUCHILLA_TIPO_CHOICES)
SAC_MEDIDA_LABELS = dict(FormatoCuchillas.SAC_MEDIDA_CHOICES)
GAN_LABELS = dict(FormatoCuchillas.GAN_TIPO_CHOICES)


def _build_costos_seed(formato, precios=None):
    """Líneas de costo derivadas de un formato de cuchillas (una por concepto con datos).

    Cada línea lleva una `price_key` estable por concepto (para los cauchos,
    `caucho:{tipo}`; para la cuchilla, `cuchilla:{tipo}`; para el resto, su propio
    `key`). `precios` es el mapa de precios por cliente (price_key → precio); cuando
    trae un valor > 0 se usa como precio inicial en vez de 0.
    """
    precios = precios or {}
    lines = []

    def add(key, concepto, detalle, unidad, cantidad, price_key=None):
        pk = price_key or key
        lines.append({
            "key": key, "price_key": pk, "concepto": concepto, "detalle": detalle or "",
            "unidad": unidad, "cantidad": float(cantidad or 0),
            "precio": float(precios.get(pk) or 0),
        })

    for idx, fila in enumerate(formato.cauchos or []):
        tipo = fila.get("tipo") or ""
        cm = float(fila.get("cm") or 0)
        if cm > 0:
            add(f"caucho-{idx}", CAUCHO_LABELS.get(tipo, tipo or "Caucho"), "", "cm", cm,
                price_key=f"caucho:{tipo}" if tipo else "caucho")
    # Cuchilla y desperdicio se cobran juntos: una sola línea con el total,
    # desglosando en el detalle cuánto corresponde a cada uno.
    cuchilla_cm = float(formato.cuchilla_cm or 0)
    desperdicio_cm = float(formato.desperdicio_cm or 0)
    if cuchilla_cm > 0 or desperdicio_cm > 0:
        # Doble bisel y Bohler se cobran distinto: cada tipo tiene su price_key.
        # Los formatos sin tipo (previos al campo) conservan la key histórica.
        tipo = formato.cuchilla_tipo
        partes = []
        if tipo:
            partes.append(CUCHILLA_TIPO_LABELS.get(tipo, tipo))
        if formato.cuchilla_puntos:
            partes.append(f"{formato.cuchilla_puntos} puntos")
        partes.append(f"{cuchilla_cm:g} cm + {desperdicio_cm:g} cm desperdicio")
        add("cuchilla", "Cuchilla", " · ".join(partes), "cm", cuchilla_cm + desperdicio_cm,
            price_key=f"cuchilla:{tipo}" if tipo else "cuchilla")
    if float(formato.grafa_cm or 0) > 0:
        partes = []
        if formato.grafa_puntos:
            partes.append(f"{formato.grafa_puntos} puntos")
        if formato.grafa_altura:
            partes.append(f"altura {formato.grafa_altura} mm")
        add("grafa", "Grafa", " · ".join(partes), "cm", formato.grafa_cm)
    if float(formato.ch_cm or 0) > 0:
        add("ch", "CH", formato.ch_medida, "cm", formato.ch_cm)
    sacabocados = formato.sacabocados or []
    if sacabocados:
        for idx, fila in enumerate(sacabocados):
            medida = fila.get("medida") or ""
            cantidad = float(fila.get("cantidad") or 0)
            if cantidad > 0:
                add(f"sacabocados-{idx}", "Sacabocados", SAC_MEDIDA_LABELS.get(medida, medida), "und", cantidad,
                    price_key=f"sacabocados:{medida}" if medida else "sacabocados")
    elif float(formato.sac_cm or 0) > 0:  # legacy: sacabocados en cm
        add("sacabocados", "Sacabocados", formato.sac_medida, "cm", formato.sac_cm)
    elif formato.sac_medida or float(formato.sac_cantidad or 0) > 0:
        add("sacabocados", "Sacabocados", formato.get_sac_medida_display(), "und", formato.sac_cantidad)
    if float(formato.perfo_cm or 0) > 0:
        add("perforaciones", "Perforado", formato.perfo_medida, "cm", formato.perfo_cm)
    gan = formato.gan or []
    if gan:
        for idx, fila in enumerate(gan):
            tipo = fila.get("tipo") or ""
            cantidad = float(fila.get("cantidad") or 0)
            if cantidad > 0:
                add(f"gan-{idx}", GAN_LABELS.get(tipo, tipo or "Gan"), "", "und", cantidad,
                    price_key=f"gan:{tipo}" if tipo else "gan")
    elif (formato.gan_legacy or "").strip():
        add("gan", "Gan", formato.gan_legacy.strip(), "und", 0)
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
    prev_sac_precio = {}
    prev_gan_precio = {}
    for item in (modelo.costos_items or []):
        if str(item.get("key", "")).startswith("caucho-") and float(item.get("precio") or 0) > 0:
            prev_caucho_precio.setdefault(item.get("concepto"), item.get("precio"))
        if str(item.get("key", "")).startswith("sacabocados-") and float(item.get("precio") or 0) > 0:
            # A diferencia del caucho, el concepto de sacabocados es genérico ("Sacabocados")
            # para toda medida — hay que distinguir por price_key (que sí lleva la medida).
            prev_sac_precio.setdefault(item.get("price_key"), item.get("precio"))
        if str(item.get("key", "")).startswith("gan-") and float(item.get("precio") or 0) > 0:
            prev_gan_precio.setdefault(item.get("concepto"), item.get("precio"))
    # Precios por defecto del cliente (rellenan las líneas que el Admin no fijó).
    precios = (op.cliente.precios_troquel or {}) if op.cliente_id else {}
    seed = _build_costos_seed(formato, precios)
    for line in seed:
        old = prev.get(line["key"])
        # El precio pertenece a la price_key: si el Operador cambió el concepto
        # (p.ej. la cuchilla pasó de doble bisel a Bohler) el precio anterior ya no
        # aplica. Los items viejos sin price_key conservan el comportamiento previo.
        if old and old.get("price_key") and old["price_key"] != line["price_key"]:
            old = None
        if old:
            # Precio por-OP escrito a mano manda; si es 0, conserva el default del cliente.
            line["precio"] = old.get("precio") or line["precio"]
            if line["key"] == "gan":
                line["cantidad"] = old.get("cantidad") or line["cantidad"]
        # Precio previo del mismo tipo de caucho; si no hay, conserva el default del cliente.
        if line["key"].startswith("caucho-") and not float(line["precio"] or 0):
            line["precio"] = prev_caucho_precio.get(line["concepto"]) or line["precio"]
        # Precio previo de la misma medida de sacabocados; si no hay, conserva el default del cliente.
        if line["key"].startswith("sacabocados-") and not float(line["precio"] or 0):
            line["precio"] = prev_sac_precio.get(line["concepto"]) or line["precio"]
        # Precio previo del mismo tipo de gan; si no hay, conserva el default del cliente.
        if line["key"].startswith("gan-") and not float(line["precio"] or 0):
            line["precio"] = prev_gan_precio.get(line["concepto"]) or line["precio"]
    modelo.costos_items = seed
    modelo.save(update_fields=["costos_items", "modificado"])
    _aplicar_costo_troquel(op, _costos_items_total(seed))
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


def _troquel_costos_incompletos(op):
    """True si al troquel le faltan precios: no hay modelo/costos, o alguna línea
    con cantidad > 0 quedó en precio 0 (concepto sin cotizar)."""
    modelo = TroquelModelo.objects.filter(orden=op).first()
    items = (modelo.costos_items if modelo else None) or []
    if not items:
        return True
    return any(
        float(i.get("cantidad") or 0) > 0 and float(i.get("precio") or 0) <= 0
        for i in items
    )


def _registrar_formato_cuchillas(formato):
    """Da por bueno el formato que el Operador acaba de enviar: completa el
    proceso troquel de la OP, siembra costos si faltan y dispara la creación de
    la remisión.

    No hay cola de aprobación: el Admin pone los precios sobre la remisión y,
    si el formato está mal, lo devuelve al Operador desde ahí.
    """
    formato.estado = "aprobado"
    formato.devolucion_motivo = ""
    formato.save(update_fields=["estado", "devolucion_motivo"])
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


def _reabrir_troquel(formato, motivo="", revisor=None):
    """Devuelve el troquel al Operador: el formato queda devuelto, el proceso
    vuelve a pendiente y reaparece en su cola.

    El llamador ya se encargó de la remisión (ver `_borrar_remision_de_op`).
    """
    formato.estado = "devuelto"
    formato.devolucion_motivo = (motivo or "").strip()[:300]
    formato.revisado_por = revisor
    formato.revisado_en = timezone.now() if revisor else None
    formato.save(update_fields=["estado", "devolucion_motivo", "revisado_por", "revisado_en"])
    if formato.orden_id:
        formato.orden.procesos.filter(proceso_id="troquel").update(
            completado=False, completado_en=None
        )


def _borrar_remision_de_op(op):
    """Elimina la remisión pendiente de la OP para que su troquel pueda volver a
    la cola del Operador. Devuelve un mensaje de error si ya no se puede deshacer.

    Si la remisión vive fusionada dentro de otra, solo se le sacan sus ítems (las
    demás OPs conservan la suya); si es ella la que consolidó a otras, se
    desconsolida antes de borrarla, para no arrastrarlas al vacío.
    """
    rem = Remision.objects.filter(orden=op).first()
    if rem is None:
        return None
    destino = rem.consolidada_en_remision if rem.estado == "consolidada" else rem
    if destino is not None and destino.estado == "liquidada":
        return (
            f"La remisión {destino.numero} ya fue liquidada; "
            "no se puede devolver este troquel al operador."
        )
    if destino is not None and destino.pk != rem.pk and not destino.items.filter(op=op).exists():
        # Consolidación anterior a la columna `op`: no se sabe qué ítems de la
        # remisión destino salieron de esta OP y borrar de más cobraría mal.
        return (
            f"La remisión {destino.numero} se consolidó antes de esta versión y no se puede "
            f"identificar qué ítems son de {op.numero}. Devuélvela desde el historial de "
            "remisiones del operador (así cada OP recupera la suya) y vuelve a intentarlo."
        )
    with transaction.atomic():
        if destino is not None and destino.pk != rem.pk:
            destino.items.filter(op=op).delete()
        if rem.remisiones_consolidadas.exists():
            _desconsolidar_remision(rem)
        rem.items.all().delete()
        rem.delete()
    return None


def _aplicar_costo_troquel(op, total):
    """Escribe el total del troquel en el proceso de la OP y en el ítem de su
    remisión pendiente: lo que el Admin cotiza es lo que se cobra."""
    op.procesos.filter(proceso_id="troquel").update(costo=total)
    _sync_remision_item_troquel(op, total)


def _remision_visible_de_op(op):
    """Id de la remisión donde se cobra esta OP: la suya, o la que la consolidó
    (una remisión consolidada ya no se edita). None si aún no existe."""
    rem = Remision.objects.filter(orden=op).first()
    if rem is None:
        return None
    if rem.estado == "consolidada":
        return rem.consolidada_en_remision_id
    return rem.id


def _sync_remision_item_troquel(op, total):
    """Refleja el total del troquel en el ítem que la OP aporta a su remisión.

    Con la remisión ya creada antes de que existan precios, el ítem nace en 0 (o
    con un valor viejo); esto lo pone al día cada vez que cambian los costos.
    Solo toca remisiones pendientes: liquidadas y consolidadas son historia.
    """
    rem = Remision.objects.filter(orden=op).first()
    if rem is None:
        return
    destino = rem.consolidada_en_remision if rem.estado == "consolidada" else rem
    if destino is None or destino.estado != "pendiente":
        return
    items = list(destino.items.filter(op=op))
    if not items and destino.items.count() == 1 and len(_remision_operador_ops(destino)) == 1:
        # Ítems anteriores a la columna `op`: sin ambigüedad posible, es este.
        items = list(destino.items.all())
    if len(items) == 1:
        RemisionItem.objects.filter(pk=items[0].pk).update(valor_total=total)


def _seed_remision_item(rem, op):
    """Ítem inicial de la remisión derivado de la OP (referencia + valor total de
    venta, o el total de costos de troquel si la OP tiene ese proceso activo).
    El dueño lo edita/divide al liquidar."""
    valor = 0
    if op.procesos.filter(proceso_id="troquel", active=True).exists():
        valor = _troquel_costos_total(op)
    if not valor:
        valor = _orden_valor_total_efectivo(op) or 0
    return RemisionItem.objects.create(
        remision=rem,
        descripcion=op.referencia,
        cantidad=op.cantidad or 0,
        valor_total=valor,
        orden=0,
        op=op,
    )


def _crear_remision(op):
    """Crea la remisión de la OP (estado=pendiente) si no existe; devuelve la existente si ya hay.

    No valida progreso ni aprobación.
    """
    existente = Remision.objects.filter(orden=op).first()
    if existente:
        return existente
    with transaction.atomic():
        rem = Remision.objects.create(
            fecha=timezone.localdate(),
            orden=op,
            cliente=op.cliente,
            direccion=op.cliente.direccion,
            ciudad=op.cliente.ciudad,
            observaciones=op.observaciones,
            tiene_troquel=op.procesos.filter(proceso_id="troquel", active=True).exists(),
        )
        _seed_remision_item(rem, op)
    return rem


def _maybe_crear_remision(op):
    """Si la OP está al 100% y aún no tiene remisión, créala (estado=pendiente).

    Idempotente y silencioso ante errores para no romper el flujo de
    finalización de procesos.
    """
    try:
        progreso = _orden_progreso(op)
        if not progreso or progreso.get("porcentaje") != 100:
            return None
        if Remision.objects.filter(orden=op).exists():
            return None
        return _crear_remision(op)
    except Exception:
        traceback.print_exc()
        return None


def _remision_pdf_ctx(rem, admin=False):
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
    # Desglose por concepto del troquel (cuchilla, madera, goma…) con precio
    # unitario, tal como lo dejó el Admin en TroquelModelo.costos_items.
    det = _remision_operador_pdf_ctx(rem, admin=True)
    ctx["troqueles"] = det["troqueles"]
    ctx["total_general"] = det["total_general"]
    ctx["procesos"] = det["procesos"]
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


def _consolidar_remisiones(target, fuentes, now=None):
    """Fusiona los ítems de `fuentes` (remisiones pendientes del mismo cliente)
    dentro de `target`. Cada fuente pasa a estado=consolidada apuntando al target.

    Devuelve `target` refrescada. No valida (el llamador comprueba cliente/estado).
    """
    now = now or timezone.now()
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
                    op_id=it.op_id or f.orden_id,
                )
                next_orden += 1
            f.estado = "consolidada"
            f.consolidada_en = now
            f.consolidada_en_remision = target
            f.save(update_fields=["estado", "consolidada_en", "consolidada_en_remision", "modificado"])
    target.refresh_from_db()
    return target


def _desconsolidar_remision(rem):
    """Deshace una remisión generada por el Operador: sus fuentes vuelven a
    pendiente y el destino se re-siembra solo con su propia OP, de modo que cada
    OP regresa por separado a la cola de remisionables.

    Se borran todos los ítems del destino en vez de identificar cuáles vinieron
    de cada fuente: la consolidación no deja rastro del origen y el Admin puede
    haberlos reescrito. Re-sembrar es lo único que garantiza que no queden
    copias que se cobrarían dos veces. Los precios no se pierden: viven en
    TroquelModelo.costos_items, no en los ítems de la remisión.
    """
    with transaction.atomic():
        for f in rem.remisiones_consolidadas.all():
            f.estado = "pendiente"
            f.consolidada_en = None
            f.consolidada_en_remision = None
            f.save(update_fields=["estado", "consolidada_en", "consolidada_en_remision", "modificado"])
        rem.items.all().delete()
        if rem.orden_id:
            _seed_remision_item(rem, rem.orden)
        rem.generada_en = None
        rem.generada_por = None
        rem.save(update_fields=["generada_en", "generada_por", "modificado"])
    rem.refresh_from_db()
    return rem


def _remision_operador_ops(rem):
    """OPs incluidas en la remisión: la propia + las de sus remisiones consolidadas."""
    ops = []
    if rem.orden_id:
        ops.append(rem.orden)
    for src in rem.remisiones_consolidadas.select_related("orden").all():
        if src.orden_id:
            ops.append(src.orden)
    return ops


_DESPERDICIO_RE = re.compile(r"\s*·?\s*[\d.,]+\s*cm\s*\+\s*[\d.,]+\s*cm\s+desperdicio")


def _sin_desperdicio(detalle):
    """Quita el fragmento '120 cm + 15 cm desperdicio' del detalle de la cuchilla.

    El total en cm (cuchilla + desperdicio) ya va en la columna de consumo, así
    que fuera del PDF interno del Admin solo se muestra ese total. Se limpia al
    renderizar y no en `_build_costos_seed` porque los costos_items ya guardados
    llevan el texto viejo y el Admin lo sigue necesitando para auditar.
    """
    return _DESPERDICIO_RE.sub("", detalle or "").strip(" ·")


def _remision_procesos_ctx(op):
    """Bloque de resultados reales por estación de esta OP: solo la cantidad
    que salió de cada máquina, sin cantidad_esperada ni sobrante — es
    exclusivo para la remisión de producción completa (no toca costos ni el
    desglose de troquel, que sigue viniendo de FormatoCuchillas)."""
    proceso_ids = list(
        op.procesos.filter(proceso_id__in=chain.CHAIN_PROCESOS, active=True)
        .values_list("proceso_id", flat=True)
    )
    items = []
    for proceso_id in proceso_ids:
        registro = op.registros_proceso.filter(proceso_id=proceso_id).order_by("-fecha_hora").first()
        if not registro:
            continue
        estacion = chain.PROCESO_A_ESTACION.get(proceso_id)
        items.append({
            "proceso_label": chain.PROCESO_LABELS.get(proceso_id, proceso_id),
            "estacion_label": estacion["label"] if estacion else "",
            "cantidad_realizada": _fmt_num(registro.cantidad_realizada),
            "operador_username": registro.operador.username if registro.operador_id else "",
            "fecha_hora": registro.fecha_hora,
        })
    if not items:
        return None
    return {
        "op_id": op.id,
        "op_numero": op.numero,
        "referencia": op.referencia,
        "items": items,
    }


def _remision_operador_pdf_ctx(rem, admin=False, con_desperdicio=False):
    """Contexto del PDF de remisión: consumo en cm por troquel + cantidad
    entregada. Por defecto (admin=False) nunca lleva precios: los valores
    monetarios son de uso interno y solo se incluyen cuando admin=True, en
    cuyo caso se toman de TroquelModelo.costos_items (precios ya definidos
    por el Admin) en vez de re-derivarlos del formato con precio en 0.

    `con_desperdicio` solo lo activan los documentos internos del Admin (PDF
    admin y desglose de la pantalla de liquidación); en todo lo demás la línea
    de cuchilla muestra únicamente el total en cm."""
    troqueles = []
    total_general = 0.0
    for op in _remision_operador_ops(rem):
        if not op.procesos.filter(proceso_id="troquel", active=True).exists():
            # OP de cadena sin troquel: su resultado va en `procesos`, no aquí.
            continue
        formato = (
            op.formatos_cuchillas.exclude(estado="borrador").order_by("-fecha_hora").first()
            or op.formatos_cuchillas.order_by("-fecha_hora").first()
        )
        if admin:
            # Re-siembra las cantidades desde el formato vigente antes de imprimir
            # (conservando los precios ya puestos): la caché puede haber quedado
            # desactualizada respecto a la última corrección del Operador.
            modelo = _sync_troquel_costos(op) if formato else TroquelModelo.objects.filter(orden=op).first()
            raw_items = list(modelo.costos_items) if modelo and modelo.costos_items else []
        else:
            raw_items = _build_costos_seed(formato) if formato else []
        consumos = [
            {
                "concepto": ln["concepto"],
                "detalle": ln["detalle"] if con_desperdicio else _sin_desperdicio(ln["detalle"]),
                "cantidad": _fmt_num(ln["cantidad"]),
                "unidad": ln["unidad"],
                **({
                    "precio": _fmt_cop(ln.get("precio")),
                    "total": _fmt_cop(float(ln.get("cantidad") or 0) * float(ln.get("precio") or 0)),
                } if admin else {}),
            }
            for ln in raw_items
        ]
        troquel = {
            # op_id/formato_id no los usa ninguna plantilla: son para la pantalla
            # de liquidación, que edita precios y devuelve el formato por OP.
            "op_id": op.id,
            "formato_id": formato.id if formato else None,
            "op_numero": op.numero,
            "referencia": op.referencia,
            "cantidad": _fmt_num(op.cantidad or 0),
            "consumos": consumos,
            # Nota del Operador sobre este troquel: se imprime bajo su bloque.
            "observaciones": (formato.observaciones or "") if formato else "",
        }
        if admin:
            troquel_total = _costos_items_total(raw_items)
            troquel["total"] = _fmt_cop(troquel_total)
            total_general += troquel_total
        troqueles.append(troquel)

    procesos = [p for p in (_remision_procesos_ctx(op) for op in _remision_operador_ops(rem)) if p]

    ctx = {
        "rem": rem,
        "troqueles": troqueles,
        "procesos": procesos,
        "logo_uri": _logo_data_uri(),
    }
    if admin:
        ctx["total_general"] = _fmt_cop(total_general)
    return ctx


def _liquidar_remision(rem, email=None, extra_emails=None):
    """Envía el PDF CLIENTE por correo y marca la remisión liquidada.

    Destinatarios: email (o el del cliente) + CONTADURIA_EMAIL + extra_emails.
    Tanto el cuerpo del correo como el PDF adjunto llevan el desglose por
    concepto del troquel y el total a pagar en COP.
    Devuelve (payload_dict, http_status).
    """
    recipients = []
    email_cliente = email or rem.cliente.email
    if email_cliente and email_cliente.strip():
        recipients.append(email_cliente.strip())
    contaduria = getattr(settings, "CONTADURIA_EMAIL", "")
    if contaduria and contaduria.strip():
        recipients.append(contaduria.strip())
    recipients += [e.strip() for e in (extra_emails or []) if e and e.strip()]
    # Únicos preservando orden
    recipients = list(dict.fromkeys(recipients))
    if not recipients:
        return {"error": "No hay destinatarios (cliente sin email y CONTADURIA_EMAIL vacío)."}, 400

    ctx = _remision_pdf_ctx(rem)
    try:
        html_pdf = render_to_string("cotizaciones/pdf_remision.html", ctx)
        pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        html_email = render_to_string("cotizaciones/email_remision.html", ctx)

        msg = EmailMessage(
            subject=f"Remisión {rem.numero} — Troqueles INK",
            body=html_email,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=recipients,
        )
        msg.content_subtype = "html"
        msg.attach(f"Remision_{rem.numero}.pdf", pdf_bytes, "application/pdf")
        sent = msg.send()
        if not sent:
            return {"error": "SMTP no confirmó el envío (send() = 0)."}, 502
    except Exception as e:
        traceback.print_exc()
        return {"error": str(e)}, 502

    now = timezone.now()
    rem.estado = "liquidada"
    rem.enviada_en = now
    rem.liquidada_en = now
    rem.save(update_fields=["estado", "enviada_en", "liquidada_en", "modificado"])
    if rem.orden_id:
        OrdenProduccion.objects.filter(pk=rem.orden_id).update(
            remision_solicitada_en=None, remision_solicitada_por=None)
    return {"ok": True, "enviado_a": recipients}, 200


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

    @action(detail=True, methods=["get", "patch"], url_path="precios_troquel")
    def precios_troquel(self, request, pk=None):
        """GET/PATCH /api/clientes/{id}/precios_troquel/ — precios de troquel por cliente (solo Admin).

        Precios unitarios por concepto (price_key → precio) que se usan como valor
        por defecto al sembrar los costos de cualquier troquel del cliente. PATCH body
        {"precios": {...}}: se fusiona sobre lo existente y re-siembra los troqueles del
        cliente (solo rellena líneas en 0; nunca pisa un precio ya escrito por-OP).
        """
        _require_admin(request)
        cliente = self.get_object()
        if request.method == "PATCH":
            raw = request.data.get("precios")
            if not isinstance(raw, dict):
                return Response({"error": "precios debe ser un objeto."}, status=400)
            precios = dict(cliente.precios_troquel or {})
            for k, v in raw.items():
                try:
                    precio = float(v or 0)
                except (TypeError, ValueError):
                    return Response({"error": "Los precios deben ser numéricos."}, status=400)
                if precio < 0:
                    return Response({"error": "Los precios no pueden ser negativos."}, status=400)
                precios[str(k)] = precio
            cliente.precios_troquel = precios
            cliente.save(update_fields=["precios_troquel"])
            # Rellena los troqueles del cliente con los nuevos defaults (conservando
            # los precios que el Admin ya escribió por-OP).
            ops = OrdenProduccion.objects.filter(
                cliente=cliente, procesos__proceso_id="troquel", procesos__active=True
            ).distinct()
            for op in ops:
                _sync_troquel_costos(op)
        return Response({"precios": cliente.precios_troquel or {}})

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

    @action(detail=True, methods=["post"], url_path="duplicar")
    def duplicar(self, request, pk=None):
        """POST /api/cotizaciones/{id}/duplicar/ — copia la COT (y sus procesos) como borrador nuevo.

        Permite cotizar el mismo producto con condiciones distintas (p. ej. tarifa
        con o sin suministros del cliente) sin re-digitar todo.
        """
        _require_admin(request)
        cot = self.get_object()
        procesos = list(cot.procesos.all())
        with transaction.atomic():
            copia = cot
            copia.pk = None
            copia.id = None
            copia.numero = ""
            copia.estado = "borrador"
            copia.fecha = timezone.localdate()
            copia.save()
            for p in procesos:
                p.pk = None
                p.id = None
                p.cotizacion = copia
                p.save()
        return Response(CotizacionSerializer(copia).data, status=201)

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
            "proc_rows": [{"nombre": p.get("nombre", ""), "costo": _fmt_cop(p.get("costo", 0)), "detalle": str(p.get("detalle", ""))[:120]} for p in raw_rows],
            "costo_papel": _fmt_cop(request.data.get("costo_papel", 0)),
            "mostrar_papel": float(request.data.get("costo_papel", 0) or 0) > 0,
            "total_costos_op": _fmt_cop(request.data.get("total_costos_op", 0)),
            "valor_unitario": _fmt_cop(request.data.get("valor_unitario", 0)),
            "valor_unitario_label": str(request.data.get("valor_unitario_label", "") or "Valor unitario")[:40],
            "valor_total": _fmt_cop(request.data.get("valor_total", 0)),
            "logo_uri": _logo_data_uri(),
            "firma_uri": _firma_data_uri(),
        }
        raw_opciones = request.data.get("opciones") or []
        ctx["opciones"] = [_fmt_opcion_cot(o) for o in raw_opciones] if len(raw_opciones) >= 2 else []

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
            "proc_rows": [{"nombre": p.get("nombre", ""), "costo": _fmt_cop(p.get("costo", 0)), "detalle": str(p.get("detalle", ""))[:120]} for p in raw_rows],
            "costo_papel": _fmt_cop(request.data.get("costo_papel", 0)),
            "mostrar_papel": float(request.data.get("costo_papel", 0) or 0) > 0,
            "total_costos_op": _fmt_cop(request.data.get("total_costos_op", 0)),
            "valor_unitario": _fmt_cop(request.data.get("valor_unitario", 0)),
            "valor_unitario_label": str(request.data.get("valor_unitario_label", "") or "Valor unitario")[:40],
            "valor_total": _fmt_cop(request.data.get("valor_total", 0)),
            "logo_uri": _logo_data_uri(),
            "firma_uri": _firma_data_uri(),
        }
        raw_opciones = request.data.get("opciones") or []
        ctx["opciones"] = [_fmt_opcion_cot(o) for o in raw_opciones] if len(raw_opciones) >= 2 else []
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
        # list/retrieve: lectura para el Operador (Producción General le muestra
        # progreso de solo lectura); los campos monetarios se ocultan en el
        # serializer para quien no sea staff. Escritura sigue admin-only.
        # create/update: el Operador levanta sus propias OPs directas (una OP
        # nueva o una tarea de troquel). El serializer le quita la plata al
        # leer y la ignora al escribir; `_solo_op_directa` le cierra las OPs
        # que nacieron de una cotización, que son del Admin.
        if self.action in ("list", "retrieve", "produccion", "buscar", "produccion_pendientes", "enviar_remision", "remision_pdf", "cancelar_remision", "remisionables_operador", "remisionables_produccion", "consolidar_remision_operador", "remision_operador_pdf", "remisiones_generadas_operador", "devolver_remision_operador", "descartar_remisionable_operador", "remisiones_solicitadas", "editar_campos", "create", "update", "partial_update", "next_numero"):
            self._require_rol_produccion(request)
            return
        _require_admin(request)

    # Acciones del Operador que además de "autenticado" exigen un rol de
    # producción concreto (ver cotizaciones/roles.py). `produccion_pendientes`
    # se valida a sí misma más abajo porque su chequeo depende de query params
    # (?estacion= vs ?proceso=troquel).
    _ACCIONES_TROQUELES = {
        "remisionables_operador", "descartar_remisionable_operador",
    }
    _ACCIONES_REMISIONES_GENERALES = {"remisionables_produccion"}
    _ACCIONES_ALGUNA_REMISION = {
        "consolidar_remision_operador", "remision_operador_pdf",
        "remisiones_generadas_operador", "devolver_remision_operador",
        "enviar_remision", "remision_pdf", "cancelar_remision",
        "remisiones_solicitadas",
    }

    def _require_rol_produccion(self, request):
        if request.user.is_staff:
            return
        accion = self.action
        if accion in self._ACCIONES_TROQUELES:
            _require_troqueles(request)
        elif accion in self._ACCIONES_REMISIONES_GENERALES:
            _require_remisiones_generales(request)
        elif accion in self._ACCIONES_ALGUNA_REMISION:
            _require_alguna_remision(request)

    def _solo_op_directa(self, request):
        """Le cierra al Operador las OPs derivadas de una cotización.

        En esas, lo único editable es la liquidación (OP_LOCKED_WHITELIST), que
        es justo lo que él no puede tocar: mejor un 403 claro que un PATCH que
        no cambia nada.
        """
        if request.user.is_staff:
            return
        if self.get_object().cotizacion_id is not None:
            raise PermissionDenied(
                "Esta OP viene de una cotización: solo el administrador puede editarla."
            )

    def update(self, request, *args, **kwargs):
        self._solo_op_directa(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._solo_op_directa(request)
        return super().partial_update(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        # Las OP ya remisionadas (100% completadas) salen de los LISTADOS de producción,
        # pero siguen accesibles por detalle (retrieve, troquel_costos, etc.) para que el
        # Admin pueda editar precios aunque ya se haya generado la remisión.
        if self.action == "list" and not self.request.query_params.get("incluir_remisionadas"):
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
            # Una OP con formato de cuchillas enviado (pendiente → Revisar troqueles) o
            # aprobado (→ remisión) sale de "OPs en Troquel". Los devueltos/borrador siguen
            # en la lista porque el troquel aún está en curso con el Operador.
            if self.action == "list" and "troquel" in ids:
                qs = qs.exclude(formatos_cuchillas__estado__in=["pendiente", "aprobado"])
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
            "proc_rows": [{"nombre": p.get("nombre", ""), "costo": _fmt_cop(p.get("costo", 0)), "detalle": str(p.get("detalle", ""))[:120]} for p in raw_rows],
            "costo_papel": _fmt_cop(data.get("costo_papel", 0)),
            "mostrar_papel": float(data.get("costo_papel", 0) or 0) > 0,
            "total_costos_op": _fmt_cop(data.get("total_costos_op", 0)),
            "valor_unitario": _fmt_cop(data.get("valor_unitario", 0)),
            "valor_unitario_label": str(data.get("valor_unitario_label", "") or "Valor unitario")[:40],
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
            "proc_rows": [{"nombre": p.get("nombre", ""), "detalle": str(p.get("detalle", ""))[:120]} for p in raw_rows],
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
        """PATCH /api/ordenes/{id}/procesos/{proceso_id}/completado/ — Body: { completado: bool }.

        Solo para ítems de servicio sin máquina ni formato propios (diseño,
        muestra, envío, etc.): los procesos de la cadena y troquel solo se
        completan con un registro real (RegistroProceso / FormatoCuchillas
        aprobado), nunca con este toggle manual.
        """
        if proceso_id in chain.CHAIN_PROCESOS or proceso_id == "troquel":
            return Response(
                {
                    "code": "requiere_registro_real",
                    "error": "Este proceso solo se completa con un registro real en su estación.",
                },
                status=409,
            )
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
            # OP fresca: el prefetch de procesos quedó desactualizado tras el save.
            _maybe_crear_remision(OrdenProduccion.objects.get(pk=op.pk))
        return Response(OpProcesoSerializer(proceso).data)

    @action(detail=False, methods=["post"], url_path=r"procesos/(?P<proceso_id>[^/.]+)/prioridades")
    def set_proceso_prioridades(self, request, proceso_id=None):
        """POST /api/ordenes/procesos/{proceso_id}/prioridades/ — Body: { orden_ids: [id, ...] }.

        Reordena la cola arrastrando: la posición en la lista es la prioridad
        (1 = primero). Solo se numeran las OPs que llegan en la lista.
        """
        return self._guardar_prioridades(request, [proceso_id], f"proceso '{proceso_id}'")

    @action(detail=False, methods=["post"], url_path=r"estaciones/(?P<estacion_id>[^/.]+)/prioridades")
    def set_estacion_prioridades(self, request, estacion_id=None):
        """POST /api/ordenes/estaciones/{estacion_id}/prioridades/ — Body: { orden_ids: [id, ...] }.

        Igual que la de un proceso suelto, pero para la cola de una estación de
        la cadena: numera TODOS los procesos que esa estación cubre (Barnizadora
        puede tener uvTotal + uvParcial en la misma OP), porque la cola se
        ordena por el menor de ellos.
        """
        if estacion_id not in chain.ESTACION_POR_ID:
            return Response({"error": "Estación desconocida."}, status=400)
        est = chain.ESTACION_POR_ID[estacion_id]
        return self._guardar_prioridades(
            request, est["procesos"], f"procesos de {est['label']}"
        )

    def _guardar_prioridades(self, request, proceso_ids, que):
        """Numera 1..N la prioridad de `proceso_ids` según el orden de orden_ids.

        Admin-only: priorizar la cola es decisión suya, no de quien la trabaja
        (bloqueado en `initial` — set_proceso_prioridades/set_estacion_prioridades
        ya no están en la whitelist del Operador).
        """
        orden_ids = request.data.get("orden_ids")
        if not isinstance(orden_ids, list):
            return Response({"error": "Se espera 'orden_ids' como lista."}, status=400)

        procesos = {}
        for p in OpProceso.objects.filter(
            proceso_id__in=proceso_ids, orden_id__in=orden_ids
        ):
            procesos.setdefault(p.orden_id, []).append(p)
        faltantes = [i for i in orden_ids if i not in procesos]
        if faltantes:
            return Response({"error": f"OPs sin {que}: {faltantes}"}, status=400)

        with transaction.atomic():
            actualizados = []
            for pos, orden_id in enumerate(orden_ids, start=1):
                for proceso in procesos[orden_id]:
                    proceso.prioridad = pos
                    actualizados.append(proceso)
            OpProceso.objects.bulk_update(actualizados, ["prioridad"])
        return Response({"ok": True, "total": len(actualizados)})

    @action(detail=True, methods=["get"], url_path="produccion")
    def produccion(self, request, pk=None):
        """GET /api/ordenes/{id}/produccion/ — OP sanitizada para el Operador.

        Sin cliente ni valores monetarios; incluye el modelo del troquel sanitizado.
        """
        op = self.get_object()
        return Response(OrdenOperadorSerializer(op, context={"request": request}).data)

    @action(detail=True, methods=["patch"], url_path="editar-campos")
    def editar_campos(self, request, pk=None):
        """PATCH /api/ordenes/{id}/editar-campos/ — Operador (o Admin) edita referencia,
        fecha_entrega y cliente de la OP. Cada cambio queda auditado en OrdenCambio.

        En OPs derivadas de una cotización el cliente queda bloqueado (coherente con
        OP_LOCKED_WHITELIST); referencia y fecha_entrega siguen editables.
        """
        op = self.get_object()
        data = request.data or {}

        # Campos permitidos según origen de la OP.
        campos_permitidos = ["referencia", "fecha_entrega"]
        if op.cotizacion_id is None:
            campos_permitidos.append("cliente")

        errores = {}
        pendientes = {}  # campo -> valor validado a asignar
        if "referencia" in data:
            pendientes["referencia"] = str(data.get("referencia") or "").strip()
        if "fecha_entrega" in data:
            fe = data.get("fecha_entrega")
            if fe in (None, ""):
                pendientes["fecha_entrega"] = None
            else:
                parsed = parse_date(str(fe))
                if parsed is None:
                    errores["fecha_entrega"] = "Fecha inválida (use AAAA-MM-DD)."
                else:
                    pendientes["fecha_entrega"] = parsed
        if "cliente" in data and "cliente" in campos_permitidos:
            cliente_id = data.get("cliente")
            cliente = Cliente.objects.filter(pk=cliente_id).first() if cliente_id else None
            if cliente is None:
                errores["cliente"] = "Cliente no encontrado."
            else:
                pendientes["cliente"] = cliente

        if errores:
            return Response(errores, status=400)

        # Auditoría: valores previos de los campos que realmente se van a tocar.
        previos = {
            campo: orden_valor_legible(op, campo)
            for campo in ORDEN_CAMPOS_AUDITADOS if campo in pendientes
        }
        for campo, valor in pendientes.items():
            setattr(op, campo, valor)
        op.save()
        if previos:
            registrar_cambios_orden(op, previos, request.user)
        return Response(OrdenOperadorSerializer(op, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="cambios")
    def cambios(self, request, pk=None):
        """GET /api/ordenes/{id}/cambios/ — historial de auditoría de la OP (Admin)."""
        op = self.get_object()
        qs = op.cambios.select_related("usuario").all()
        return Response(OrdenCambioSerializer(qs, many=True).data)

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

        OPs con un proceso activo pendiente (no completado). Ordenadas por la
        prioridad que el Admin le dio al proceso (1 = primero; sin prioridad al
        final) y, a igualdad, por fecha de entrega ascendente.
        Vista sanitizada: sin valores monetarios (el cliente sí es visible).
        """
        proceso_id = (request.query_params.get("proceso") or "").strip()
        estacion_id = (request.query_params.get("estacion") or "").strip()
        qs = OrdenProduccion.objects.select_related("cliente").prefetch_related("procesos")

        if estacion_id:
            # Cola de una estación de la cadena (impresora → … → troqueladora).
            # A diferencia de `?proceso=`, aquí la visibilidad NO la marca el
            # Admin: la OP entra sola cuando le llega el turno.
            if estacion_id not in chain.ESTACION_POR_ID:
                return Response({"error": "Estación desconocida."}, status=400)
            _require_estacion(request, estacion_id)
            est = chain.ESTACION_POR_ID[estacion_id]
            bloqueantes = OpProceso.objects.filter(
                orden=OuterRef("pk"), active=True, completado=False,
                proceso_id__in=chain.procesos_anteriores(estacion_id),
            )
            qs = (
                qs.prefetch_related("registros_proceso")
                .filter(
                    procesos__proceso_id__in=est["procesos"],
                    procesos__active=True,
                    procesos__completado=False,
                )
                .distinct()
                # Bloqueo duro: mientras quede un proceso activo pendiente de una
                # estación anterior, la OP no aparece en esta cola.
                .exclude(Exists(bloqueantes))
                .annotate(
                    prioridad_estacion=Subquery(
                        OpProceso.objects.filter(
                            orden=OuterRef("pk"), proceso_id__in=est["procesos"]
                        ).order_by(F("prioridad").asc(nulls_last=True)).values("prioridad")[:1]
                    )
                )
                .order_by(
                    F("prioridad_estacion").asc(nulls_last=True),
                    F("fecha_entrega").asc(nulls_last=True),
                    "creado",
                )
            )
            return Response(
                OrdenEstacionSerializer(
                    qs, many=True, context={"request": request, "estacion": estacion_id}
                ).data
            )

        if proceso_id:
            if proceso_id == "troquel":
                _require_troqueles(request)
            # Todas estas condiciones van en un solo filter() para que apliquen a
            # la MISMA fila de proceso (no a filas distintas de la misma OP).
            proc_cond = {
                "procesos__proceso_id": proceso_id,
                "procesos__active": True,
                "procesos__completado": False,
            }
            qs = qs.filter(**proc_cond).distinct()
            if proceso_id == "troquel":
                # OPs con formato esperando aprobación del Admin no están
                # pendientes para el Operador (los devueltos sí reaparecen).
                qs = qs.exclude(formatos_cuchillas__estado="pendiente")
            # La prioridad del Admin manda sobre la fecha de entrega. Se anota con
            # subconsulta: order_by sobre 'procesos__' abriría un segundo JOIN.
            qs = qs.annotate(
                prioridad_proceso=Subquery(
                    OpProceso.objects.filter(
                        orden=OuterRef("pk"), proceso_id=proceso_id
                    ).values("prioridad")[:1]
                )
            ).order_by(
                F("prioridad_proceso").asc(nulls_last=True),
                F("fecha_entrega").asc(nulls_last=True),
                "creado",
            )
            return Response(
                OrdenOperadorSerializer(qs, many=True, context={"request": request}).data
            )
        # Sin filtro: "todo lo pendiente en el taller" — solo el rol general
        # (o el Admin) lo ve completo, sin recortar por estación.
        if not request.user.is_staff and not roles.puede_remisiones_generales(request.user):
            raise PermissionDenied("No tienes acceso a esta vista.")
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
                    "price_key": str(i.get("price_key") or i.get("key") or ""),
                    "concepto": str(i.get("concepto") or "")[:100],
                    "detalle": str(i.get("detalle") or "")[:200],
                    "unidad": str(i.get("unidad") or "")[:10],
                    "cantidad": cantidad,
                    "precio": precio,
                })
            modelo, _ = TroquelModelo.objects.get_or_create(orden=op)
            modelo.costos_items = items
            modelo.save(update_fields=["costos_items", "modificado"])
            _aplicar_costo_troquel(op, _costos_items_total(items))
        else:
            modelo = getattr(op, "troquel_modelo", None)
            if not modelo or not modelo.costos_items:
                # bootstrap para formatos previos a esta función
                modelo = _sync_troquel_costos(op) or modelo
        items = list(modelo.costos_items) if modelo else []
        for i in items:
            i["total"] = round(float(i.get("cantidad") or 0) * float(i.get("precio") or 0), 2)
        return Response({"items": items, "total": _costos_items_total(items)})

    def _op_para_remision(self, request, pk):
        """(op, error_response) para las acciones de remisión del Operador.

        No usa get_object(): el queryset excluye OPs ya remisionadas (404).
        Si faltan los precios del troquel registra la solicitud (alerta
        persistente del Admin) y devuelve 409 precios_pendientes.
        La aprobación del formato NO condiciona nada, solo los precios.
        """
        op = OrdenProduccion.objects.filter(pk=pk).first()
        if op is None:
            return None, Response({"error": "OP no encontrada."}, status=404)
        if _troquel_costos_total(op) <= 0:
            OrdenProduccion.objects.filter(pk=op.pk).update(
                remision_solicitada_en=timezone.now(),
                remision_solicitada_por=request.user,
            )
            return None, Response({
                "code": "precios_pendientes",
                "error": "El administrador aún no ha completado los precios del troquel.",
            }, status=409)
        return op, None

    @action(detail=True, methods=["post"], url_path="enviar_remision")
    def enviar_remision(self, request, pk=None):
        """POST /api/ordenes/{id}/enviar_remision/ — Operador o Admin.

        Envía el PDF CLIENTE de la remisión (creándola si no existe) al correo
        del cliente + contaduría. Body {"email"} opcional: reemplaza el correo
        del cliente (el Operador no ve el registrado y puede digitarlo).
        Bloqueado si los costos del troquel siguen en 0 (409 precios_pendientes).
        """
        op, error = self._op_para_remision(request, pk)
        if error:
            return error

        rem = Remision.objects.filter(orden=op).first()
        if rem and rem.estado != "pendiente":
            return Response({
                "code": "ya_enviada",
                "error": f"La remisión {rem.numero} ya fue enviada o consolidada.",
            }, status=409)
        if rem is None:
            rem = _crear_remision(op)

        email = (request.data.get("email") or "").strip() or None
        data, status_code = _liquidar_remision(rem, email=email)
        if status_code == 200:
            # Sin datos financieros ni de contacto para el Operador
            data["remision_numero"] = rem.numero
        return Response(data, status=status_code)

    @action(detail=True, methods=["post"], url_path="remision_pdf")
    def remision_pdf(self, request, pk=None):
        """POST /api/ordenes/{id}/remision_pdf/ — Operador o Admin.

        Descarga el PDF CLIENTE de la remisión (creándola en pendiente si no
        existe) para imprimirla. Nunca genera la plantilla admin. Mismo
        bloqueo por precios que enviar_remision.
        """
        op, error = self._op_para_remision(request, pk)
        if error:
            return error

        rem = Remision.objects.filter(orden=op).first() or _crear_remision(op)
        ctx = _remision_pdf_ctx(rem)
        try:
            html_pdf = render_to_string("cotizaciones/pdf_remision.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="Remision_{rem.numero}.pdf"'
        return response

    @action(detail=True, methods=["post"], url_path="cancelar_remision")
    def cancelar_remision(self, request, pk=None):
        """POST /api/ordenes/{id}/cancelar_remision/ — Operador o Admin.

        Elimina la remisión pendiente de la OP (si existe) para sacarla de la
        cola y poder generarla de nuevo más adelante. Bloqueado si ya fue
        enviada, liquidada o consolidada (estado != pendiente).
        """
        op = OrdenProduccion.objects.filter(pk=pk).first()
        if op is None:
            return Response({"error": "OP no encontrada."}, status=404)
        rem = Remision.objects.filter(orden=op).first()
        if rem is None:
            return Response({"ok": True})
        if rem.estado != "pendiente":
            return Response({
                "error": f"La remisión {rem.numero} ya fue enviada o consolidada.",
            }, status=409)
        rem.delete()  # cascada: borra también sus RemisionItem
        return Response({"ok": True})

    @action(detail=False, methods=["get"], url_path="remisionables_operador")
    def remisionables_operador(self, request):
        """GET /api/ordenes/remisionables_operador/ — Operador o Admin.

        OPs de troquel cuya remisión aún está pendiente (o aún no existe) y por
        tanto pueden entrar en una remisión del Operador. Vista sanitizada (sin
        valores). El front agrupa por cliente y filtra en memoria.

        Lo que el Operador ya generó sale de esta cola y vive en
        `remisiones_generadas_operador`, desde donde puede devolverse. Lo que
        el Operador descartó (`descartar_remisionable_operador`) también sale
        de aquí: la OP sigue intacta, queda a cargo del Admin.
        """
        qs = (
            OrdenProduccion.objects
            .filter(procesos__proceso_id="troquel", procesos__active=True)
            # Solo OP con el formato de cuchillas enviado: sin él no hay consumo
            # que remisionar, y uno devuelto tiene que corregirse y reenviarse
            # antes de volver a entrar en una remisión.
            .filter(formatos_cuchillas__estado__in=["pendiente", "aprobado"])
            .filter(remision_descartada_operador_en__isnull=True)
            .filter(
                Q(remision__isnull=True)
                | Q(remision__estado="pendiente", remision__generada_en__isnull=True)
            )
            .select_related("cliente", "remision")
            .distinct()
            .order_by("cliente__nombre", F("fecha_entrega").asc(nulls_last=True), "creado")
        )
        data = RemisionableOperadorSerializer(qs, many=True, context={"request": request}).data
        return Response(data)

    @action(detail=False, methods=["get"], url_path="remisionables_produccion")
    def remisionables_produccion(self, request):
        """GET /api/ordenes/remisionables_produccion/ — Operador o Admin.

        OPs de la cadena (impresora/laminadora/barnizadora/troqueladora) que ya
        completaron todas sus estaciones activas y por eso tienen una remisión
        pendiente de generar (creada sola al llegar al 100%, ver
        `_maybe_crear_remision`). No incluye troquel: esas viven en
        `remisionables_operador` / la pantalla de Troqueles. Vista sanitizada
        (sin valores). El front agrupa por cliente.
        """
        qs = (
            OrdenProduccion.objects
            .filter(remision_descartada_operador_en__isnull=True)
            .filter(procesos__proceso_id__in=chain.CHAIN_PROCESOS, procesos__active=True)
            .exclude(procesos__proceso_id="troquel", procesos__active=True)
            .filter(remision__estado="pendiente", remision__generada_en__isnull=True)
            .select_related("cliente", "remision")
            .distinct()
            .order_by("cliente__nombre", F("fecha_entrega").asc(nulls_last=True), "creado")
        )
        data = RemisionableOperadorSerializer(qs, many=True, context={"request": request}).data
        return Response(data)

    @action(detail=False, methods=["post"], url_path="consolidar_remision_operador")
    def consolidar_remision_operador(self, request):
        """POST /api/ordenes/consolidar_remision_operador/ — Operador o Admin.

        Body { "orden_ids": [int, ...], "observaciones": str? }. Asegura una
        remisión pendiente para cada OP (mismo cliente), fusiona todas en la
        primera y devuelve { remision_id, remision_numero }. No exige precios
        del troquel.

        `observaciones` es la nota general que el Operador escribe al generar:
        se imprime al pie del documento. Vacía no borra la que ya traía la
        remisión (heredada de la OP).

        La remisión queda marcada como generada: sus OPs salen de la cola del
        Operador y pasan al historial.
        """
        ids = request.data.get("orden_ids", [])
        if not isinstance(ids, list) or not ids:
            return Response({"error": "Falta orden_ids."}, status=400)

        ops = list(OrdenProduccion.objects.filter(pk__in=ids).select_related("cliente"))
        if len(ops) != len(set(ids)):
            return Response({"error": "Alguna OP no existe."}, status=404)
        cliente_ids = {op.cliente_id for op in ops}
        if len(cliente_ids) > 1:
            return Response({"error": "Todas las OP deben ser del mismo cliente."}, status=400)

        # Solo a las OP con troquel les exige el formato de cuchillas enviado
        # (ni borrador ni devuelto); las de cadena pura ya llegan aquí completas.
        sin_formato = [
            op.numero for op in ops
            if op.procesos.filter(proceso_id="troquel", active=True).exists()
            and not op.formatos_cuchillas.filter(estado__in=["pendiente", "aprobado"]).exists()
        ]
        if sin_formato:
            return Response({
                "error": f"Falta el formato de cuchillas en: {', '.join(sin_formato)}.",
            }, status=409)

        # Preserva el orden solicitado por el Operador (la primera es el destino).
        ops.sort(key=lambda op: ids.index(op.id))
        remisiones = []
        for op in ops:
            rem = Remision.objects.filter(orden=op).first() or _crear_remision(op)
            if rem.estado != "pendiente":
                return Response({
                    "error": f"La remisión {rem.numero} ya fue enviada o consolidada.",
                }, status=409)
            remisiones.append(rem)

        target = remisiones[0]
        fuentes = remisiones[1:]
        if fuentes:
            _consolidar_remisiones(target, fuentes)
        # Se estampa aquí y no al descargar el PDF: `remision_operador_pdf`
        # también sirve para re-descargar desde el historial.
        campos = ["generada_en", "generada_por", "modificado"]
        target.generada_en = timezone.now()
        target.generada_por = request.user if request.user.is_authenticated else None
        observaciones = (request.data.get("observaciones") or "").strip()
        if observaciones:
            target.observaciones = observaciones
            campos.append("observaciones")
        target.save(update_fields=campos)
        return Response({"remision_id": target.id, "remision_numero": target.numero})

    @action(detail=False, methods=["post"], url_path="remision_operador_pdf")
    def remision_operador_pdf(self, request):
        """POST /api/ordenes/remision_operador_pdf/ — Operador o Admin.

        Body { "remision_id": int }. Descarga el PDF de remisión del Operador
        (consumo en cm por troquel + cantidad entregada, con firma del cliente).
        Sin valores salvo que el Admin haya activado `mostrar_valores`. Sin
        bloqueo por precios.
        """
        rem_id = request.data.get("remision_id")
        rem = Remision.objects.filter(pk=rem_id).select_related("cliente", "orden").first()
        if rem is None:
            return Response({"error": "Remisión no encontrada."}, status=404)
        ctx = _remision_operador_pdf_ctx(rem)
        try:
            html_pdf = render_to_string("cotizaciones/pdf_remision_operador.html", ctx)
            pdf_bytes = WeasyprintHTML(string=html_pdf).write_pdf()
        except Exception as e:
            traceback.print_exc()
            return Response({"error": str(e)}, status=502)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="Remision_{rem.numero}.pdf"'
        return response

    @action(detail=False, methods=["get"], url_path="remisiones_generadas_operador")
    def remisiones_generadas_operador(self, request):
        """GET /api/ordenes/remisiones_generadas_operador/ — Operador o Admin.

        Historial de remisiones que el Operador ya generó, para volver a
        descargar el PDF o devolverlas a la cola. Vista sanitizada (sin
        valores). Incluye las liquidadas: el historial no se vacía cuando el
        Admin cobra.
        """
        qs = (
            Remision.objects
            .filter(generada_en__isnull=False)
            .select_related("cliente", "orden", "generada_por")
            .prefetch_related("remisiones_consolidadas__orden")
            .order_by("-generada_en")
        )
        data = RemisionGeneradaOperadorSerializer(qs, many=True, context={"request": request}).data
        return Response(data)

    @action(detail=False, methods=["post"], url_path="devolver_remision_operador")
    def devolver_remision_operador(self, request):
        """POST /api/ordenes/devolver_remision_operador/ — Operador o Admin.

        Body { "remision_id": int }. Deshace una remisión generada: sus OPs
        vuelven por separado a la cola de remisionables. Bloqueado si el Admin
        ya la liquidó (o si fue consolidada dentro de otra).
        """
        rem_id = request.data.get("remision_id")
        rem = Remision.objects.filter(pk=rem_id).select_related("orden").first()
        if rem is None:
            return Response({"error": "Remisión no encontrada."}, status=404)
        if rem.generada_en is None:
            return Response({"error": f"La remisión {rem.numero} no está generada."}, status=409)
        if rem.estado != "pendiente":
            return Response({
                "error": f"La remisión {rem.numero} ya fue liquidada; no se puede devolver.",
            }, status=409)
        _desconsolidar_remision(rem)
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="descartar_remisionable_operador")
    def descartar_remisionable_operador(self, request):
        """POST /api/ordenes/descartar_remisionable_operador/ — Operador o Admin.

        Body { "orden_id": int }. No es un delete: la OP sigue intacta y con su
        formato de cuchillas aprobado, solo sale de `remisionables_operador`
        (la cola del Operador para armar remisiones) de ahí en adelante queda
        a cargo del Admin, que la sigue viendo igual en su propia gestión.
        """
        orden_id = request.data.get("orden_id")
        orden = OrdenProduccion.objects.filter(pk=orden_id).first()
        if orden is None:
            return Response({"error": "OP no encontrada."}, status=404)
        if orden.remision_descartada_operador_en is None:
            orden.remision_descartada_operador_en = timezone.now()
            orden.save(update_fields=["remision_descartada_operador_en"])
        return Response({"ok": True})

    @action(detail=False, methods=["get"], url_path="remisiones_solicitadas")
    def remisiones_solicitadas(self, request):
        """GET /api/ordenes/remisiones_solicitadas/ — solo Admin (via initial).

        OPs donde el Operador pidió enviar la remisión y los precios del
        troquel siguen en 0. La alerta desaparece sola al poner precios.

        `remision_id` apunta a la remisión donde se ponen esos precios (la de la
        OP, o la que la consolidó); es null si todavía no existe.
        """
        qs = (
            OrdenProduccion.objects
            .filter(remision_solicitada_en__isnull=False)
            .select_related("cliente", "remision_solicitada_por",
                            "remision", "remision__consolidada_en_remision")
            .order_by("remision_solicitada_en")
        )
        modelos = {m.orden_id: m for m in TroquelModelo.objects.filter(orden__in=qs)}
        data = [
            {
                "id": op.id,
                "numero": op.numero,
                "cliente_nombre": op.cliente.nombre,
                "referencia": op.referencia,
                "solicitada_en": op.remision_solicitada_en,
                "solicitada_por": getattr(op.remision_solicitada_por, "username", ""),
                "remision_id": _remision_visible_de_op(op),
            }
            for op in qs
            if _costos_items_total(getattr(modelos.get(op.id), "costos_items", None)) <= 0
        ]
        return Response(data)


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
        user = self.request.user
        maquina = serializer.validated_data.get("maquina")
        if not user.is_staff:
            if maquina == "guillotina" and "guillotina" not in roles.estaciones_permitidas(user):
                raise PermissionDenied("No tienes acceso a Guillotina.")
            if maquina == "troquel" and not roles.puede_troqueles(user):
                raise PermissionDenied("No tienes acceso al módulo de Troqueles.")
        serializer.save(operador=user)

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
    historial (estado=liquidada). No se crean desde la API; sí se pueden borrar
    (DELETE) para deshacer una liquidación equivocada.
    El Operador envía remisiones por su propia vía:
    OrdenProduccionViewSet.enviar_remision (solo PDF cliente).
    """

    queryset = Remision.objects.select_related("cliente", "orden").prefetch_related("items")
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["numero", "cliente__nombre", "orden__numero"]
    ordering_fields = ["creado", "fecha", "estado"]
    http_method_names = ["get", "patch", "put", "post", "delete", "head", "options"]

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

    def destroy(self, request, *args, **kwargs):
        """DELETE /api/remisiones/{id}/ — borra la remisión (solo Admin, via initial).

        Deshace una liquidación equivocada: el comprobante desaparece y sus OPs
        vuelven a la cola de remisiones del Operador para poder rehacerlo. El
        correo ya enviado, obviamente, no se deshace.

        Si agrupaba otras remisiones, primero se desconsolidan (cada OP recupera
        la suya, en pendiente). Una remisión consolidada dentro de otra no se
        borra por su cuenta: sus ítems se cobran en el destino, así que hay que
        borrar (o devolver) esa otra.
        """
        rem = self.get_object()
        if rem.estado == "consolidada":
            destino = rem.consolidada_en_remision
            return Response({
                "error": (
                    f"La remisión {rem.numero} está consolidada dentro de "
                    f"{destino.numero if destino else 'otra remisión'}; "
                    "elimina esa remisión."
                ),
            }, status=409)
        numero = rem.numero
        with transaction.atomic():
            if rem.remisiones_consolidadas.exists():
                _desconsolidar_remision(rem)
            if rem.orden_id:
                OrdenProduccion.objects.filter(pk=rem.orden_id).update(
                    remision_solicitada_en=None, remision_solicitada_por=None)
            rem.items.all().delete()
            rem.delete()
        return Response({"ok": True, "numero": numero}, status=200)

    @action(detail=True, methods=["post"], url_path="pdf")
    def generar_pdf(self, request, pk=None):
        """POST /api/remisiones/{id}/pdf/ — devuelve el PDF de la remisión como descarga.

        Body {"tipo": "admin"} → documento interno con desglose de costos del
        troquel; por defecto genera el PDF para el cliente (sin valores por ítem).
        """
        rem = self.get_object()
        es_admin = (request.data.get("tipo") or request.query_params.get("tipo")) == "admin"
        # El desglose de la cuchilla con el desperdicio solo va en el documento interno.
        ctx = _remision_operador_pdf_ctx(rem, admin=es_admin, con_desperdicio=es_admin)
        template = "cotizaciones/pdf_remision_admin.html" if es_admin else "cotizaciones/pdf_remision_operador.html"
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

    @action(detail=True, methods=["get"], url_path="desglose")
    def desglose(self, request, pk=None):
        """GET /api/remisiones/{id}/desglose/ — solo Admin (via initial).

        Desglose por concepto del/los troquel(es) de la remisión (incluidas las
        consolidadas), con precio unitario y subtotal. Mismos datos que van al
        PDF y al correo, ya formateados en COP.

        Cada troquel trae también `precios_incompletos`: la pantalla de
        liquidación es donde el Admin pone los precios, así que avisa antes de
        cobrar un concepto que quedó en cero.
        """
        rem = self.get_object()
        # Pantalla interna del Admin: conserva el desperdicio de la cuchilla.
        det = _remision_operador_pdf_ctx(rem, admin=True, con_desperdicio=True)
        ops = {op.id: op for op in _remision_operador_ops(rem)}
        for troquel in det["troqueles"]:
            op = ops.get(troquel["op_id"])
            troquel["precios_incompletos"] = bool(op and _troquel_costos_incompletos(op))
        return Response({
            "troqueles": det["troqueles"],
            "total_general": det["total_general"],
            "procesos": det["procesos"],
        })

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

        data, status_code = _liquidar_remision(
            rem,
            email=request.data.get("email"),
            extra_emails=request.data.get("extra_emails", []),
        )
        if status_code == 200:
            data["remision"] = RemisionSerializer(rem).data
        return Response(data, status=status_code)

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

        _consolidar_remisiones(target, fuentes)
        return Response(RemisionSerializer(target).data)


class TroquelModeloViewSet(viewsets.ModelViewSet):
    """Modelo del troquel asociado a una OP.

    Admin-only salvo `create`: el Operador adjunta el modelo cuando levanta una
    tarea de troquel nueva (mismo modal que el Admin). Consultarlo, editarlo o
    borrarlo sigue siendo del Admin — el Operador lo ve sanitizado dentro de su
    propia OP (TroquelModeloOperadorSerializer).
    """

    queryset = TroquelModelo.objects.select_related("orden")
    serializer_class = TroquelModeloSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.action != "create":
            _require_admin(request)
        else:
            _require_troqueles(request)

    def get_queryset(self):
        qs = super().get_queryset()
        orden_id = self.request.query_params.get("orden")
        if orden_id:
            qs = qs.filter(orden_id=orden_id)
        return qs


class FormatoCuchillasViewSet(viewsets.ModelViewSet):
    """Formato de cuchillas + tiempos. Listar/crear: autenticados (Operador).

    Editar/eliminar requiere admin. operador y fecha_hora se estampan server-side.
    """

    queryset = FormatoCuchillas.objects.select_related(
        "orden", "orden__cliente", "operador", "revisado_por"
    )
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
        if not self.request.user.is_staff:
            _require_troqueles(self.request)
        # Un solo formato por OP: el Operador registra una vez y queda bloqueado.
        # Solo el Admin puede crear/editar adicionales.
        orden = serializer.validated_data.get("orden")
        if not self.request.user.is_staff and FormatoCuchillas.objects.filter(orden=orden).exists():
            raise ValidationError(
                "Esta OP ya tiene un formato de cuchillas registrado. "
                "Solo el administrador puede modificarlo."
            )
        # El Operador guarda avances como borrador y decide cuándo enviar
        # (enviar=true). Al enviar, el troquel se da por terminado de una vez:
        # no hay cola de aprobación, el Admin cotiza sobre la remisión.
        if self.request.user.is_staff:
            formato = serializer.save(operador=self.request.user)
        else:
            formato = serializer.save(
                operador=self.request.user,
                estado="aprobado" if self.request.data.get("enviar") else "borrador",
            )
        self._post_guardado(formato)

    def update(self, request, *args, **kwargs):
        self._check_update_permission(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._check_update_permission(request)
        return super().partial_update(request, *args, **kwargs)

    def _post_guardado(self, formato):
        """Cierra el ciclo tras guardar el formato.

        Un formato que no es borrador ni devuelto está enviado: se da el troquel
        por terminado (proceso completo → remisión) y se re-siembran los costos
        conservando los precios que el Admin ya hubiera puesto.
        """
        if formato.estado in ("borrador", "devuelto") or not formato.orden_id:
            return
        _registrar_formato_cuchillas(formato)
        _sync_troquel_costos(formato.orden)

    def _check_update_permission(self, request):
        # Cualquier operador puede editar el formato de otro operador (no solo
        # el que lo registró): perform_update reasigna `operador` al último que
        # guardó, que es la trazabilidad de quién lo dejó así. Solo se
        # restringe por estado: no aprobados (pendiente, devuelto o borrador).
        # El estado solo cambia a pendiente cuando el body trae enviar=true;
        # si no, se conserva.
        if request.user.is_staff:
            return
        formato = self.get_object()
        if formato.estado not in ("pendiente", "devuelto", "borrador"):
            raise PermissionDenied("Solo administradores pueden realizar esta acción.")

    def perform_update(self, serializer):
        if self.request.user.is_staff:
            formato = serializer.save()
        elif self.request.data.get("enviar"):
            # Envío/reenvío del Operador: el troquel queda terminado.
            formato = serializer.save(
                operador=self.request.user,
                estado="aprobado",
                devolucion_motivo="",
            )
        else:
            # Guardar avance: conserva el estado actual (borrador/devuelto).
            formato = serializer.save(operador=self.request.user)
        self._post_guardado(formato)

    def destroy(self, request, *args, **kwargs):
        _require_admin(request)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="cancelar_envio")
    def cancelar_envio(self, request, pk=None):
        """POST /api/formatos-cuchillas/{id}/cancelar_envio/ — cualquier Operador
        retira un formato enviado (por cualquier operador) para volver a editarlo
        (→ borrador).

        Deshace el cierre del troquel: borra la remisión que se creó al enviarlo
        y devuelve la OP a su cola. Si el Admin ya la liquidó, 409.
        """
        formato = self.get_object()
        if formato.estado in ("borrador", "devuelto"):
            return Response({"error": "Este formato no está enviado."}, status=409)
        if formato.orden_id:
            error = _borrar_remision_de_op(formato.orden)
            if error:
                return Response({"error": error}, status=409)
            formato.orden.procesos.filter(proceso_id="troquel").update(
                completado=False, completado_en=None
            )
        formato.estado = "borrador"
        formato.devolucion_motivo = ""
        formato.save(update_fields=["estado", "devolucion_motivo"])
        return Response(self.get_serializer(formato).data)

    @action(detail=True, methods=["post"], url_path="devolver")
    def devolver(self, request, pk=None):
        """POST /api/formatos-cuchillas/{id}/devolver/ — Body: { motivo }.

        El Admin devuelve el formato al Operador desde la remisión: se borra la
        remisión de esa OP, el proceso troquel vuelve a pendiente y la OP
        reaparece en la cola del Operador para que corrija y reenvíe.

        Responde además `remision_eliminada_id` para que la pantalla que lo pidió
        sepa si se quedó sin remisión que mostrar.
        """
        _require_admin(request)
        formato = self.get_object()
        if formato.estado in ("borrador", "devuelto"):
            return Response({"error": "Este formato no está enviado."}, status=409)
        rem_id = None
        if formato.orden_id:
            rem = Remision.objects.filter(orden=formato.orden).first()
            rem_id = rem.id if rem else None
            error = _borrar_remision_de_op(formato.orden)
            if error:
                return Response({"error": error}, status=409)
        _reabrir_troquel(formato, request.data.get("motivo"), revisor=request.user)
        return Response({
            **self.get_serializer(formato).data,
            "remision_eliminada_id": rem_id,
        })


class RegistroProcesoViewSet(viewsets.ModelViewSet):
    """Registros de las máquinas de la cadena (impresora → … → troqueladora).

    Listar/crear: cualquier autenticado (Operador). Editar/eliminar: admin.
    Crear un registro cierra el OpProceso correspondiente y la OP pasa sola a la
    cola de la estación siguiente.
    """

    queryset = RegistroProceso.objects.select_related("orden", "orden__cliente", "operador")
    serializer_class = RegistroProcesoSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["fecha_hora"]

    def get_queryset(self):
        qs = super().get_queryset()
        orden_id = self.request.query_params.get("orden")
        if orden_id:
            qs = qs.filter(orden_id=orden_id)
        estacion = self.request.query_params.get("estacion")
        if estacion:
            if not self.request.user.is_staff and estacion not in roles.estaciones_permitidas(self.request.user):
                raise PermissionDenied("No tienes acceso a esta estación.")
            qs = qs.filter(estacion=estacion)
        if self.request.query_params.get("mias"):
            qs = qs.filter(operador=self.request.user)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = serializer.validated_data
        op = datos["orden"]
        estacion_id = datos["estacion"]
        proceso_id = datos["proceso_id"]

        est = chain.ESTACION_POR_ID.get(estacion_id)
        if est is None or proceso_id not in est["procesos"]:
            return Response(
                {"error": f"El proceso '{proceso_id}' no pertenece a esta estación."},
                status=400,
            )
        _require_estacion(request, estacion_id)

        proceso = op.procesos.filter(proceso_id=proceso_id, active=True, completado=False).first()
        if proceso is None:
            return Response(
                {
                    "code": "proceso_no_activo",
                    "error": "Este proceso no está activo o ya fue registrado en esta OP.",
                },
                status=409,
            )

        # Bloqueo duro: primero impresora, después laminadora, barnizadora y
        # troquelado. Solo cuentan los procesos que la OP sí tiene activos.
        falta = chain.bloqueado_por(op, estacion_id)
        if falta:
            return Response(
                {
                    "code": "fuera_de_orden",
                    "error": f"Falta completar {falta} antes de registrar en {est['label']}.",
                },
                status=409,
            )

        if estacion_id == "troqueladora" and getattr(op, "troquel_modelo", None) is None:
            return Response(
                {
                    "code": "troquel_no_registrado",
                    "error": "Esta OP no tiene el troquel registrado. Pide al Admin que lo cargue antes de continuar.",
                },
                status=409,
            )

        esperada = _cantidad_esperada(op)
        requerida = int(op.cantidad or 0)
        margen = int(op.sobrante or 0)
        realizada = int(datos.get("cantidad_realizada") or 0)
        # El sobrante es el margen de error que la empresa ya está asumiendo:
        # un faltante dentro de ese margen no bloquea el registro ni avisa al
        # Admin, solo lo que quede por debajo de (requerida - margen).
        faltante = realizada < (requerida - margen)
        if faltante and not request.data.get("confirmar_faltante"):
            # El servidor es la autoridad: sin confirmación explícita no se
            # registra, para que el aviso al Admin no se pueda saltar.
            return Response(
                {
                    "code": "cantidad_faltante",
                    "error": "La cantidad registrada es menor a la requerida.",
                    "cantidad_esperada": esperada,
                    "cantidad_requerida": requerida,
                    "cantidad_realizada": realizada,
                },
                status=409,
            )

        with transaction.atomic():
            registro = serializer.save(
                operador=request.user, cantidad_esperada=esperada, faltante=faltante,
            )
            op.procesos.filter(proceso_id=proceso_id).update(
                completado=True, completado_en=timezone.now()
            )
            if faltante:
                Notificacion.objects.create(
                    tipo="cantidad_faltante",
                    titulo=f"Faltan unidades · {op.cliente.nombre if op.cliente else 'Sin cliente'}",
                    mensaje=(
                        f"{est['label']}: se registraron {realizada:,} de {requerida:,} "
                        f"requeridas en la {op.numero}"
                        + (f" ({op.referencia})." if op.referencia else ".")
                    ).replace(",", "."),
                    orden=op,
                    registro=registro,
                    creada_por=request.user,
                )

        # El prefetch de procesos quedó obsoleto tras el update(): sin refetch,
        # el progreso se calcularía con el estado anterior.
        op_fresca = OrdenProduccion.objects.get(pk=op.pk)
        _maybe_crear_remision(op_fresca)

        siguiente = chain.siguiente_estacion(op_fresca)
        return Response(
            {
                **self.get_serializer(registro).data,
                "siguiente_estacion": (
                    {"id": siguiente["id"], "label": siguiente["label"]} if siguiente else None
                ),
                "estacion_terminada": not chain.procesos_pendientes_de(op_fresca, estacion_id),
                "progreso": _orden_progreso(op_fresca),
            },
            status=201,
        )

    @action(detail=True, methods=["post"], url_path="anular")
    def anular(self, request, pk=None):
        """POST /api/registros-proceso/{id}/anular/ — deshace un registro.

        Bajo bloqueo duro un error de tecleo dejaría la OP atascada en la
        estación siguiente, así que el Operador puede deshacer lo suyo mientras
        ninguna estación posterior haya registrado ya sobre esta OP.
        """
        registro = self.get_object()
        op = registro.orden
        es_admin = request.user.is_staff
        if not es_admin and registro.operador_id != request.user.id:
            return Response({"error": "Solo puedes anular tus propios registros."}, status=403)

        orden_estacion = chain.ESTACION_POR_ID[registro.estacion]["orden"]
        hay_posterior = any(
            chain.ESTACION_POR_ID[r.estacion]["orden"] > orden_estacion
            for r in op.registros_proceso.all()
            if r.estacion in chain.ESTACION_POR_ID
        )
        if hay_posterior and not es_admin:
            return Response(
                {"error": "Ya se registró una estación posterior; pide al administrador que lo corrija."},
                status=409,
            )

        with transaction.atomic():
            error = _borrar_remision_de_op(op)
            if error:
                return Response({"error": error}, status=409)
            op.procesos.filter(proceso_id=registro.proceso_id).update(
                completado=False, completado_en=None
            )
            Notificacion.objects.filter(registro=registro).delete()
            registro.delete()
        return Response({"ok": True})

    def update(self, request, *args, **kwargs):
        _require_admin(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        _require_admin(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        _require_admin(request)
        return super().destroy(request, *args, **kwargs)


class NotificacionViewSet(viewsets.ReadOnlyModelViewSet):
    """Avisos para el Admin (por ahora, faltantes de cantidad en producción).

    Admin-only en todas sus acciones: al Operador no le corresponde ver el
    tablero de alertas.
    """

    queryset = Notificacion.objects.select_related("orden", "creada_por")
    serializer_class = NotificacionSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_admin(request)

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("no_leidas"):
            qs = qs.filter(leida_en__isnull=True)
        return qs

    @action(detail=True, methods=["post"], url_path="leer")
    def leer(self, request, pk=None):
        noti = self.get_object()
        if noti.leida_en is None:
            noti.leida_en = timezone.now()
            noti.leida_por = request.user
            noti.save(update_fields=["leida_en", "leida_por"])
        return Response(self.get_serializer(noti).data)

    @action(detail=False, methods=["post"], url_path="marcar_todas_leidas")
    def marcar_todas_leidas(self, request):
        n = Notificacion.objects.filter(leida_en__isnull=True).update(
            leida_en=timezone.now(), leida_por=request.user
        )
        return Response({"ok": True, "total": n})

    @action(detail=False, methods=["get"], url_path="resumen")
    def resumen(self, request):
        return Response(
            {"no_leidas": Notificacion.objects.filter(leida_en__isnull=True).count()}
        )
