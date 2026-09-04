import unicodedata

from rest_framework import serializers
from .models import Cliente, Papel, Cotizacion, CotizacionProceso, DocumentoCliente, DocumentoClienteItem, OrdenProduccion, OpProceso, OrdenCambio, RegistroMaquina, TroquelModelo, FormatoCuchillas, Remision, RemisionItem, RegistroProceso, Notificacion
from .models import ORDEN_CAMPOS_AUDITADOS, orden_valor_legible, registrar_cambios_orden
from . import chain


class ClienteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cliente
        fields = ["id", "nombre", "email", "telefono", "nit", "direccion", "ciudad", "tipo", "creado"]
        read_only_fields = ["id", "creado"]

    def validate_nombre(self, value):
        # NFC: acentos como un solo codepoint. Sin esto, un nombre guardado en
        # NFD (p.ej. pegado desde macOS) no aparece en ?search= aunque se vea
        # idéntico en pantalla.
        return unicodedata.normalize("NFC", value).strip()


class PapelSerializer(serializers.ModelSerializer):
    class Meta:
        model = Papel
        fields = ["id", "nombre", "gramaje", "material", "precio", "activo"]
        read_only_fields = ["id"]


# ─────────────────────────────────────────────────────────────────────────────
# OP sin plata (Operador)
#
# El Operador levanta sus propias OPs —OP directa o tarea de troquel— con los
# datos técnicos, el cliente y los procesos, pero no ve ni escribe un solo
# valor monetario. Lo mismo que se le oculta al leer se le ignora al escribir:
# si no se protegiera, su formulario (que llega con ceros donde no vio nada)
# borraría las tarifas que ya puso el Admin.
# ─────────────────────────────────────────────────────────────────────────────

OP_CAMPOS_DINERO = (
    "precio_pliego", "costo_papel_override",
    "corte_inicial_precio", "corte_final_precio",
    "valor_unitario_override", "valor_total_override",
    "total_costos_override", "subtotal_override",
    "margen", "abono",
)

# Solo lectura (derivados): se ocultan al leer, no existen al escribir.
OP_CAMPOS_DINERO_CALCULADOS = ("valor_unitario_efectivo", "valor_total_efectivo", "saldo")

# Condiciones comerciales: no son montos, pero se pactan con el precio y viven
# en la pantalla del Admin. El Operador no las ve, así que tampoco las pisa.
OP_CAMPOS_COMERCIALES = ("condicion_pago", "condicion_custom", "tipo_facturacion")

# Claves de `extras` de un proceso que llevan plata (tarifas y modo de cobro).
# El resto de extras son datos técnicos que el Operador sí maneja.
PROCESO_EXTRAS_DINERO = frozenset({
    "chargeMode", "valorBase", "precioUnit",
    "tiroChargeMode", "retiroChargeMode",
    "tiroValorBase", "retiroValorBase",
    "costoTiro", "costoRetiro",
    "tiroPrecioM2", "retiroPrecioM2",
})


def _pide_sin_plata(serializer):
    """True si quien lee/escribe no es staff: el documento va sin plata."""
    request = serializer.context.get("request")
    return bool(request) and not request.user.is_staff


def _sin_dinero(proceso_data):
    """Copia de una fila de proceso sin costo, override ni extras de plata."""
    limpio = {k: v for k, v in proceso_data.items() if k not in ("costo", "costo_override")}
    extras = limpio.get("extras")
    if isinstance(extras, dict):
        limpio["extras"] = {k: v for k, v in extras.items() if k not in PROCESO_EXTRAS_DINERO}
    return limpio


def _con_dinero_previo(proceso_data, previo):
    """Fila de proceso del Operador con la plata que ya tenía guardada.

    `previo` es el (costo, costo_override, extras) que había en la BD para ese
    proceso_id; si el proceso es nuevo, nace en cero y el Admin le pone precio.
    """
    costo, costo_override, extras_previos = previo or (0, None, {})
    fila = _sin_dinero(proceso_data)
    fila["costo"] = costo
    fila["costo_override"] = costo_override
    extras = dict(fila.get("extras") or {})
    for k, v in (extras_previos or {}).items():
        if k in PROCESO_EXTRAS_DINERO:
            extras[k] = v
    fila["extras"] = extras
    return fila


class CotizacionProcesoSerializer(serializers.ModelSerializer):
    class Meta:
        model = CotizacionProceso
        fields = ["id", "proceso_id", "active", "costo", "costo_override", "extras"]
        read_only_fields = ["id"]


class CotizacionListSerializer(serializers.ModelSerializer):
    """Vista resumida para el listado."""
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)

    class Meta:
        model = Cotizacion
        fields = [
            "id", "numero", "fecha", "cliente_nombre", "referencia",
            "cantidad", "estado", "tipo_cliente", "creado", "modificado",
        ]


class CotizacionSerializer(serializers.ModelSerializer):
    procesos = CotizacionProcesoSerializer(many=True, required=False)
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    cliente_email = serializers.EmailField(source="cliente.email", read_only=True)
    cliente_telefono = serializers.CharField(source="cliente.telefono", read_only=True, default='')
    cliente_nit = serializers.CharField(source="cliente.nit", read_only=True, default='')
    valor_unitario_efectivo = serializers.SerializerMethodField()
    valor_total_efectivo = serializers.SerializerMethodField()
    orden_id = serializers.SerializerMethodField()

    class Meta:
        model = Cotizacion
        fields = [
            "id", "numero", "fecha",
            "cliente", "cliente_nombre", "cliente_email", "cliente_telefono", "cliente_nit",
            "referencia", "cantidad", "sobrante", "tipo_cliente", "estado",
            "molde_ancho", "molde_alto",
            "pliego_tipo", "pliego_w", "pliego_h",
            "papel", "papel_manual_nombre", "precio_pliego", "costo_papel_override",
            "corte_inicial_active", "corte_inicial_precio",
            "corte_final_active", "corte_final_precio",
            "valor_unitario_override", "valor_total_override",
            "total_costos_override", "subtotal_override",
            "margen",
            "condicion_pago", "condicion_custom", "tipo_facturacion", "observaciones",
            "opciones",
            "creado", "modificado",
            "procesos",
            "valor_unitario_efectivo", "valor_total_efectivo",
            "orden_id",
        ]
        read_only_fields = ["id", "numero", "creado", "modificado"]

    def get_orden_id(self, obj):
        orden = obj.ordenes.first()
        return orden.id if orden else None

    def _total_costos(self, obj):
        """Best-effort total OP cost from stored overrides + process data."""
        if obj.total_costos_override is not None:
            return float(obj.total_costos_override)
        # Build from parts we have stored
        paper = float(obj.costo_papel_override) if obj.costo_papel_override is not None else None
        if paper is None:
            return None  # paper cost without override requires full geometry — skip
        total = paper
        if obj.corte_inicial_active:
            total += float(obj.corte_inicial_precio or 0)
        if obj.corte_final_active:
            total += float(obj.corte_final_precio or 0)
        for proc in obj.procesos.filter(active=True):
            total += float(proc.costo or 0)
        return total

    def get_valor_unitario_efectivo(self, obj):
        if obj.valor_unitario_override is not None:
            return float(obj.valor_unitario_override)
        total = self._total_costos(obj)
        if total is not None and obj.cantidad:
            margen = float(obj.margen or 80)
            return round(total / obj.cantidad * (1 + margen / 100))
        return None

    def get_valor_total_efectivo(self, obj):
        if obj.valor_total_override is not None:
            return float(obj.valor_total_override)
        vu = self.get_valor_unitario_efectivo(obj)
        if vu is not None and obj.cantidad:
            return vu * obj.cantidad
        return None

    def create(self, validated_data):
        procesos_data = validated_data.pop("procesos", [])
        cotizacion = Cotizacion.objects.create(**validated_data)
        for p in procesos_data:
            CotizacionProceso.objects.create(cotizacion=cotizacion, **p)
        return cotizacion

    def update(self, instance, validated_data):
        procesos_data = validated_data.pop("procesos", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if procesos_data is not None:
            instance.procesos.all().delete()
            for p in procesos_data:
                CotizacionProceso.objects.create(cotizacion=instance, **p)
        return instance


class DocumentoClienteItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentoClienteItem
        fields = ["id", "cotizacion", "referencia", "descripcion", "tamano_display",
                  "cantidad", "valor_unitario", "valor_total", "orden"]
        read_only_fields = ["id"]


class DocumentoClienteSerializer(serializers.ModelSerializer):
    items = DocumentoClienteItemSerializer(many=True, required=False)
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    cliente_email = serializers.EmailField(source="cliente.email", read_only=True)
    cliente_telefono = serializers.CharField(source="cliente.telefono", read_only=True, default='')
    cliente_nit = serializers.CharField(source="cliente.nit", read_only=True, default='')

    class Meta:
        model = DocumentoCliente
        fields = [
            "id", "numero", "fecha",
            "cliente", "cliente_nombre", "cliente_email", "cliente_telefono", "cliente_nit",
            "tiempo_entrega", "condicion_pago", "condicion_custom",
            "nota", "estado", "creado", "modificado",
            "items",
        ]
        read_only_fields = ["id", "numero", "creado", "modificado"]

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        doc = DocumentoCliente.objects.create(**validated_data)
        for idx, item in enumerate(items_data):
            item.setdefault("orden", idx)
            DocumentoClienteItem.objects.create(documento=doc, **item)
        return doc

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for idx, item in enumerate(items_data):
                item.setdefault("orden", idx)
                DocumentoClienteItem.objects.create(documento=instance, **item)
        return instance


class DocumentoClienteListSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)

    class Meta:
        model = DocumentoCliente
        fields = ["id", "numero", "fecha", "cliente_nombre", "estado", "creado", "modificado"]


# ─────────────── Órdenes de Producción ───────────────

# Campos editables en una OP creada desde cotización (todo lo demás quedó
# pactado en la COT y se ignora server-side).
OP_LOCKED_WHITELIST = {"abono", "observaciones", "fecha", "fecha_entrega", "referencia"}


def _proceso_troquel(obj):
    """Fila de proceso 'troquel' de la OP, o None. Usa la caché del prefetch."""
    return next((p for p in obj.procesos.all() if p.proceso_id == "troquel"), None)


class OpProcesoSerializer(serializers.ModelSerializer):
    class Meta:
        model = OpProceso
        fields = ["id", "proceso_id", "active", "costo", "costo_override", "extras", "completado", "completado_en", "prioridad"]
        read_only_fields = ["id", "completado", "completado_en"]


class OrdenListSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    cotizacion_numero = serializers.CharField(source="cotizacion.numero", read_only=True, default="")
    valor_total_efectivo = serializers.SerializerMethodField()
    saldo = serializers.SerializerMethodField()
    progreso = serializers.SerializerMethodField()
    prioridad_troquel = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = [
            "id", "numero", "fecha", "fecha_entrega", "cliente_nombre", "referencia",
            "cantidad", "valor_total_efectivo", "abono", "saldo",
            "cotizacion", "cotizacion_numero", "creado", "modificado",
            "progreso", "prioridad_troquel",
        ]

    def get_prioridad_troquel(self, obj):
        p = _proceso_troquel(obj)
        return p.prioridad if p else None

    def get_valor_total_efectivo(self, obj):
        return _orden_valor_total_efectivo(obj)

    def get_saldo(self, obj):
        total = _orden_valor_total_efectivo(obj)
        if total is None:
            return None
        return total - float(obj.abono or 0)

    def get_progreso(self, obj):
        return _orden_progreso(obj)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and not request.user.is_staff:
            for f in ("valor_total_efectivo", "abono", "saldo"):
                data.pop(f, None)
        return data


def _orden_progreso(obj):
    """Progreso de la OP = % de procesos activos marcados como completado."""
    activos = [p for p in obj.procesos.all() if p.active]
    if not activos:
        return None
    completados = sum(1 for p in activos if p.completado)
    return {
        "total": len(activos),
        "completados": completados,
        "porcentaje": round(completados / len(activos) * 100),
    }


def _orden_total_costos(obj):
    """Best-effort total cost from stored overrides + process data (mismo patrón COT)."""
    if obj.total_costos_override is not None:
        return float(obj.total_costos_override)
    paper = float(obj.costo_papel_override) if obj.costo_papel_override is not None else None
    if paper is None:
        return None
    total = paper
    if obj.corte_inicial_active:
        total += float(obj.corte_inicial_precio or 0)
    if obj.corte_final_active:
        total += float(obj.corte_final_precio or 0)
    for proc in obj.procesos.all():
        if proc.active:
            total += float(proc.costo or 0)
    return total


def _orden_valor_unitario_efectivo(obj):
    if obj.valor_unitario_override is not None:
        return float(obj.valor_unitario_override)
    total = _orden_total_costos(obj)
    if total is not None and obj.cantidad:
        margen = float(obj.margen or 80)
        return round(total / obj.cantidad * (1 + margen / 100))
    return None


def _orden_valor_total_efectivo(obj):
    if obj.valor_total_override is not None:
        return float(obj.valor_total_override)
    vu = _orden_valor_unitario_efectivo(obj)
    if vu is not None and obj.cantidad:
        return vu * obj.cantidad
    return None


class OrdenSerializer(serializers.ModelSerializer):
    procesos = OpProcesoSerializer(many=True, required=False)
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    cliente_email = serializers.EmailField(source="cliente.email", read_only=True)
    cliente_telefono = serializers.CharField(source="cliente.telefono", read_only=True, default='')
    cliente_nit = serializers.CharField(source="cliente.nit", read_only=True, default='')
    cotizacion_numero = serializers.CharField(source="cotizacion.numero", read_only=True, default="")
    valor_unitario_efectivo = serializers.SerializerMethodField()
    valor_total_efectivo = serializers.SerializerMethodField()
    saldo = serializers.SerializerMethodField()
    progreso = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = [
            "id", "numero", "fecha", "fecha_entrega",
            "cotizacion", "cotizacion_numero",
            "cliente", "cliente_nombre", "cliente_email", "cliente_telefono", "cliente_nit",
            "referencia", "tamano", "cantidad", "sobrante", "tipo_cliente",
            "molde_ancho", "molde_alto",
            "pliego_tipo", "pliego_w", "pliego_h",
            "papel", "papel_manual_nombre", "precio_pliego", "costo_papel_override",
            "corte_inicial_active", "corte_inicial_precio",
            "corte_final_active", "corte_final_precio",
            "valor_unitario_override", "valor_total_override",
            "total_costos_override", "subtotal_override",
            "margen", "abono",
            "condicion_pago", "condicion_custom", "tipo_facturacion", "observaciones",
            "creado", "modificado",
            "procesos",
            "valor_unitario_efectivo", "valor_total_efectivo", "saldo", "progreso",
        ]
        read_only_fields = ["id", "numero", "cotizacion", "creado", "modificado"]

    def get_valor_unitario_efectivo(self, obj):
        return _orden_valor_unitario_efectivo(obj)

    def get_valor_total_efectivo(self, obj):
        return _orden_valor_total_efectivo(obj)

    def get_saldo(self, obj):
        total = _orden_valor_total_efectivo(obj)
        if total is None:
            return None
        return total - float(obj.abono or 0)

    def get_progreso(self, obj):
        return _orden_progreso(obj)

    @property
    def _sin_plata(self):
        return _pide_sin_plata(self)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self._sin_plata:
            for f in OP_CAMPOS_DINERO + OP_CAMPOS_DINERO_CALCULADOS:
                data.pop(f, None)
            data["procesos"] = [_sin_dinero(p) for p in data.get("procesos", [])]
        return data

    def create(self, validated_data):
        procesos_data = validated_data.pop("procesos", [])
        if self._sin_plata:
            # OP directa creada por el Operador (o tarea de troquel): nace sin
            # precios y el Admin los pone después.
            for campo in OP_CAMPOS_DINERO + OP_CAMPOS_COMERCIALES:
                validated_data.pop(campo, None)
            procesos_data = [_sin_dinero(p) for p in procesos_data]
        orden = OrdenProduccion.objects.create(**validated_data)
        for p in procesos_data:
            OpProceso.objects.create(orden=orden, **p)
        return orden

    def update(self, instance, validated_data):
        procesos_data = validated_data.pop("procesos", None)
        if self._sin_plata:
            # Sin estos campos en validated_data, el instance conserva los suyos.
            for campo in OP_CAMPOS_DINERO + OP_CAMPOS_COMERCIALES:
                validated_data.pop(campo, None)
            if procesos_data is not None:
                previos_plata = {
                    p.proceso_id: (p.costo, p.costo_override, p.extras)
                    for p in instance.procesos.all()
                }
                procesos_data = [
                    _con_dinero_previo(p, previos_plata.get(p["proceso_id"]))
                    for p in procesos_data
                ]
        if instance.cotizacion_id is not None:
            # OP desde COT: solo liquidación editable
            validated_data = {k: v for k, v in validated_data.items() if k in OP_LOCKED_WHITELIST}
            procesos_data = None
        # Auditoría: valores previos de los campos auditados que se van a tocar.
        previos = {
            campo: orden_valor_legible(instance, campo)
            for campo in ORDEN_CAMPOS_AUDITADOS if campo in validated_data
        }
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if previos:
            request = self.context.get("request")
            registrar_cambios_orden(instance, previos, request.user if request else None)
        if procesos_data is not None:
            # Los procesos se recrean, pero el estado de producción (avance del
            # Operador y prioridad de cola) no es del Admin: se conserva o se
            # perdería en cada guardado de la OP.
            old_state = {
                p.proceso_id: (p.completado, p.completado_en, p.prioridad)
                for p in instance.procesos.all()
            }
            instance.procesos.all().delete()
            for p in procesos_data:
                completado, completado_en, prioridad = old_state.get(
                    p["proceso_id"], (False, None, None)
                )
                OpProceso.objects.create(
                    orden=instance, completado=completado, completado_en=completado_en,
                    prioridad=prioridad, **p,
                )
        return instance


class RegistroMaquinaSerializer(serializers.ModelSerializer):
    orden_numero = serializers.CharField(source="orden.numero", read_only=True, default="")
    orden_cliente = serializers.CharField(source="orden.cliente.nombre", read_only=True, default="")
    orden_referencia = serializers.CharField(source="orden.referencia", read_only=True, default="")
    operador_username = serializers.CharField(source="operador.username", read_only=True, default="")

    class Meta:
        model = RegistroMaquina
        fields = [
            "id", "orden", "orden_numero", "orden_cliente", "orden_referencia",
            "maquina", "descripcion", "costo", "fecha_hora",
            "operador", "operador_username",
        ]
        read_only_fields = ["id", "fecha_hora", "operador"]


# ─────────────── Troqueles ───────────────


class TroquelModeloSerializer(serializers.ModelSerializer):
    """Vista completa del modelo (solo Admin): incluye los CM de cobro."""

    orden_numero = serializers.CharField(source="orden.numero", read_only=True, default="")

    class Meta:
        model = TroquelModelo
        fields = [
            "id", "orden", "orden_numero", "archivo",
            "troquel_numero", "pinza", "madera", "cuchilla_puntos", "material",
            "espejo", "instrucciones",
            "corte_cm", "score_cm", "hendido_cm",
            "creado", "modificado",
        ]
        read_only_fields = ["id", "creado", "modificado"]


class TroquelModeloOperadorSerializer(serializers.ModelSerializer):
    """Vista sanitizada del modelo para el Operador: datos técnicos sin CM de cobro."""

    class Meta:
        model = TroquelModelo
        fields = [
            "id", "archivo",
            "troquel_numero", "pinza", "madera", "cuchilla_puntos", "material",
            "espejo", "instrucciones",
        ]


class FormatoCuchillasSerializer(serializers.ModelSerializer):
    orden_numero = serializers.CharField(source="orden.numero", read_only=True, default="")
    operador_username = serializers.CharField(source="operador.username", read_only=True, default="")
    revisado_por_username = serializers.CharField(source="revisado_por.username", read_only=True, default="")
    fecha_entrega = serializers.DateField(source="orden.fecha_entrega", read_only=True, default=None)
    referencia = serializers.CharField(source="orden.referencia", read_only=True, default="")
    cliente_nombre = serializers.SerializerMethodField()

    def get_cliente_nombre(self, obj):
        return obj.orden.cliente.nombre if (obj.orden and obj.orden.cliente) else ""

    def validate_cauchos(self, value):
        tipos_validos = dict(FormatoCuchillas.CAUCHO_TIPO_CHOICES)
        if not isinstance(value, list):
            raise serializers.ValidationError("Debe ser una lista de filas {tipo, cm}.")
        filas = []
        for fila in value:
            try:
                tipo = fila.get("tipo")
                cm = float(fila.get("cm") or 0)
            except (AttributeError, TypeError, ValueError):
                raise serializers.ValidationError("Cada fila de caucho requiere tipo válido y cm ≥ 0.")
            if tipo not in tipos_validos or cm < 0:
                raise serializers.ValidationError("Cada fila de caucho requiere tipo válido y cm ≥ 0.")
            filas.append({"tipo": tipo, "cm": cm})
        return filas

    def validate_sacabocados(self, value):
        medidas_validas = dict(FormatoCuchillas.SAC_MEDIDA_CHOICES)
        if not isinstance(value, list):
            raise serializers.ValidationError("Debe ser una lista de filas {medida, cantidad}.")
        filas = []
        for fila in value:
            try:
                medida = fila.get("medida")
                cantidad = int(fila.get("cantidad") or 0)
            except (AttributeError, TypeError, ValueError):
                raise serializers.ValidationError("Cada fila de sacabocados requiere medida válida y cantidad ≥ 0.")
            if medida not in medidas_validas or cantidad < 0:
                raise serializers.ValidationError("Cada fila de sacabocados requiere medida válida y cantidad ≥ 0.")
            filas.append({"medida": medida, "cantidad": cantidad})
        return filas

    def validate_gan(self, value):
        tipos_validos = dict(FormatoCuchillas.GAN_TIPO_CHOICES)
        if not isinstance(value, list):
            raise serializers.ValidationError("Debe ser una lista de filas {tipo, cantidad}.")
        filas = []
        for fila in value:
            try:
                tipo = fila.get("tipo")
                cantidad = float(fila.get("cantidad") or 0)
            except (AttributeError, TypeError, ValueError):
                raise serializers.ValidationError("Cada fila de gan requiere tipo válido y cantidad ≥ 0.")
            if tipo not in tipos_validos or cantidad < 0:
                raise serializers.ValidationError("Cada fila de gan requiere tipo válido y cantidad ≥ 0.")
            filas.append({"tipo": tipo, "cantidad": cantidad})
        return filas

    def validate(self, data):
        get = lambda k: data.get(k, getattr(self.instance, k, None) if self.instance else None)
        # El tipo de cuchilla solo se exige al enviar: el Operador puede guardar
        # avances incompletos como borrador y los formatos previos al campo
        # (sin tipo) siguen siendo editables por el Admin.
        request = self.context.get("request")
        if request and request.data.get("enviar"):
            if float(get("cuchilla_cm") or 0) > 0 and not get("cuchilla_tipo"):
                raise serializers.ValidationError(
                    {"cuchilla_tipo": "Seleccione el tipo de cuchilla (doble bisel o Bohler)."}
                )
        grafa_puntos = get("grafa_puntos")
        if grafa_puntos == "2" and float(get("grafa_cm") or 0) > 0 and not get("grafa_altura"):
            raise serializers.ValidationError(
                {"grafa_altura": "Seleccione la altura de la grafa de 2 puntos (23,4 o 23,3 mm)."}
            )
        if grafa_puntos == "3":
            data["grafa_altura"] = ""  # altura fija (23,0 mm), no aplica elección
        return data

    class Meta:
        model = FormatoCuchillas
        fields = [
            "id", "orden", "orden_numero", "cliente_nombre", "fecha_entrega", "referencia",
            "cuchilla_cm", "cuchilla_tipo", "cuchilla_puntos",
            "grafa_cm", "grafa_puntos", "grafa_altura",
            "ch_cm", "ch_medida", "sac_cm", "sac_medida", "sac_cantidad", "sacabocados", "perfo_cm", "perfo_medida",
            "desperdicio_cm", "madera", "cauchos", "gan", "gan_legacy", "observaciones",
            "dos_puntos", "tres_puntos", "perfo", "ch", "sac", "desperdicio",  # legacy, solo lectura
            "tiempo_encalado_min", "tiempo_encuchillado_min", "tiempo_encauchado_min",
            "operador", "operador_username", "fecha_hora",
            "estado", "devolucion_motivo", "revisado_por_username", "revisado_en",
        ]
        read_only_fields = [
            "id", "operador", "fecha_hora",
            "dos_puntos", "tres_puntos", "perfo", "ch", "sac", "desperdicio",
            "sac_cm", "sac_medida", "sac_cantidad",  # legacy, reemplazados por `sacabocados`
            "gan_legacy",  # legacy, reemplazado por `gan`
            "estado", "devolucion_motivo", "revisado_en",
        ]


class OrdenOperadorSerializer(serializers.ModelSerializer):
    """Vista sanitizada de la OP para el Operador.

    Sin valores monetarios. Incluye cliente, referencia, cantidad,
    procesos activos y el modelo del troquel sanitizado.
    """

    procesos = serializers.SerializerMethodField()
    troquel_modelo = serializers.SerializerMethodField()
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True, default="")
    remision_enviada = serializers.SerializerMethodField()
    prioridad_troquel = serializers.SerializerMethodField()
    desde_cotizacion = serializers.SerializerMethodField()
    formato_estado = serializers.SerializerMethodField()
    formato_devolucion_motivo = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = ["id", "numero", "fecha_entrega", "creado", "cliente", "cliente_nombre", "referencia", "tamano", "cantidad", "pliego_tipo", "pliego_w", "pliego_h", "procesos", "troquel_modelo", "remision_enviada", "prioridad_troquel", "desde_cotizacion", "formato_estado", "formato_devolucion_motivo"]

    def _ultimo_formato(self, obj):
        formatos = list(obj.formatos_cuchillas.all())
        formatos = [f for f in formatos if f.estado != "borrador"]
        if not formatos:
            return None
        return max(formatos, key=lambda f: f.fecha_hora)

    def get_formato_estado(self, obj):
        f = self._ultimo_formato(obj)
        return f.estado if f else None

    def get_formato_devolucion_motivo(self, obj):
        f = self._ultimo_formato(obj)
        return f.devolucion_motivo if f and f.estado == "devuelto" else ""

    def get_desde_cotizacion(self, obj):
        return obj.cotizacion_id is not None

    def get_prioridad_troquel(self, obj):
        p = _proceso_troquel(obj)
        return p.prioridad if p else None

    def get_procesos(self, obj):
        return [
            {"proceso_id": p.proceso_id, "active": p.active, "completado": p.completado}
            for p in obj.procesos.all() if p.active
        ]

    def get_remision_enviada(self, obj):
        rem = Remision.objects.filter(orden=obj).only("estado").first()
        return bool(rem and rem.estado != "pendiente")

    def get_troquel_modelo(self, obj):
        modelo = getattr(obj, "troquel_modelo", None)
        if modelo is None:
            return None
        return TroquelModeloOperadorSerializer(modelo, context=self.context).data


def _cantidad_esperada(obj):
    """Lo que la OP espera que salga de cada máquina: solo lo requerido.

    El sobrante no es esperado — es el margen de tolerancia que absorbe
    faltantes pequeños antes de avisar (ver RegistroProcesoViewSet.create).
    """
    return int(obj.cantidad or 0)


class RegistroProcesoSerializer(serializers.ModelSerializer):
    """Registro de una máquina de la cadena. El Operador solo aporta los datos
    del trabajo: operador, cantidad_esperada y faltante los estampa la vista."""

    orden_numero = serializers.CharField(source="orden.numero", read_only=True, default="")
    orden_cliente = serializers.CharField(source="orden.cliente.nombre", read_only=True, default="")
    orden_referencia = serializers.CharField(source="orden.referencia", read_only=True, default="")
    operador_username = serializers.CharField(source="operador.username", read_only=True, default="")
    estacion_label = serializers.SerializerMethodField()
    proceso_label = serializers.SerializerMethodField()
    tamano_label = serializers.CharField(source="get_tamano_display", read_only=True, default="")

    class Meta:
        model = RegistroProceso
        fields = [
            "id", "orden", "orden_numero", "orden_cliente", "orden_referencia",
            "estacion", "estacion_label", "proceso_id", "proceso_label",
            "cantidad_realizada", "cantidad_esperada", "faltante",
            "tamano", "tamano_label", "tamano_otro",
            "tiro_active", "tiro_colores_num", "tiro_colores_desc",
            "retiro_active", "retiro_colores_num", "retiro_colores_desc",
            "tipo_laminado", "tipo_metalizado", "tipo_metalizado_otro", "observaciones",
            "operador", "operador_username", "fecha_hora", "monto_cobrado",
        ]
        read_only_fields = ["cantidad_esperada", "faltante", "operador", "fecha_hora"]

    def get_estacion_label(self, obj):
        est = chain.ESTACION_POR_ID.get(obj.estacion)
        return est["label"] if est else obj.estacion

    def get_proceso_label(self, obj):
        return chain.PROCESO_LABELS.get(obj.proceso_id, obj.proceso_id)


class NotificacionSerializer(serializers.ModelSerializer):
    orden_numero = serializers.CharField(source="orden.numero", read_only=True, default="")
    creada_por_username = serializers.CharField(
        source="creada_por.username", read_only=True, default=""
    )
    leida = serializers.SerializerMethodField()

    class Meta:
        model = Notificacion
        fields = [
            "id", "tipo", "titulo", "mensaje", "orden", "orden_numero", "registro",
            "creada_por", "creada_por_username", "leida", "leida_en", "creada",
        ]

    def get_leida(self, obj):
        return obj.leida_en is not None


class OrdenEstacionSerializer(OrdenOperadorSerializer):
    """OP en la cola de una estación de la cadena.

    Añade a la vista sanitizada del Operador lo que necesita el formulario de
    máquina: cuánto se espera, qué procesos cierra esta estación y cuánto llegó
    de la estación anterior. Sigue sin valores monetarios.
    """

    cantidad_esperada = serializers.SerializerMethodField()
    estacion_procesos = serializers.SerializerMethodField()
    bloqueado_por = serializers.SerializerMethodField()
    registro_previo = serializers.SerializerMethodField()

    class Meta(OrdenOperadorSerializer.Meta):
        fields = OrdenOperadorSerializer.Meta.fields + [
            "sobrante", "cantidad_esperada", "estacion_procesos", "bloqueado_por",
            "registro_previo",
        ]

    def _estacion(self):
        return self.context.get("estacion")

    def get_cantidad_esperada(self, obj):
        return _cantidad_esperada(obj)

    def get_estacion_procesos(self, obj):
        estacion = self._estacion()
        if not estacion:
            return []
        return [
            {
                "proceso_id": p.proceso_id,
                "label": chain.PROCESO_LABELS.get(p.proceso_id, p.proceso_id),
                "completado": p.completado,
                "extras": {k: v for k, v in (p.extras or {}).items() if k not in PROCESO_EXTRAS_DINERO},
            }
            for p in chain.procesos_de(obj, estacion)
        ]

    def get_bloqueado_por(self, obj):
        estacion = self._estacion()
        return chain.bloqueado_por(obj, estacion) if estacion else None

    def get_registro_previo(self, obj):
        """Último registro de una estación anterior: cuánto llegó realmente."""
        estacion = self._estacion()
        if not estacion:
            return None
        anteriores = set(chain.procesos_anteriores(estacion))
        previos = [r for r in obj.registros_proceso.all() if r.proceso_id in anteriores]
        if not previos:
            return None
        ultimo = max(previos, key=lambda r: (r.fecha_hora, r.id))
        est = chain.ESTACION_POR_ID.get(ultimo.estacion)
        return {
            "estacion": ultimo.estacion,
            "estacion_label": est["label"] if est else ultimo.estacion,
            "cantidad_realizada": ultimo.cantidad_realizada,
            "faltante": ultimo.faltante,
        }


class OrdenCambioSerializer(serializers.ModelSerializer):
    """Auditoría de un cambio de campo de una OP (para mostrar quién/cuándo/antes/después)."""

    CAMPO_LABELS = {"referencia": "Referencia", "fecha_entrega": "Fecha de entrega", "cliente": "Cliente"}

    campo_label = serializers.SerializerMethodField()
    usuario_username = serializers.CharField(source="usuario.username", read_only=True, default="")

    class Meta:
        model = OrdenCambio
        fields = ["id", "fecha_hora", "campo", "campo_label", "valor_anterior", "valor_nuevo", "usuario_username"]

    def get_campo_label(self, obj):
        return self.CAMPO_LABELS.get(obj.campo, obj.campo)


class RemisionableOperadorSerializer(serializers.ModelSerializer):
    """OP de troquel candidata a remisión del Operador (sin valores monetarios)."""

    cliente_id = serializers.IntegerField(source="cliente.id", read_only=True)
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True, default="")
    remision_numero = serializers.SerializerMethodField()
    remision_estado = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = ["id", "numero", "referencia", "cantidad", "fecha_entrega",
                  "cliente_id", "cliente_nombre", "remision_numero", "remision_estado"]

    def _remision(self, obj):
        # Prefetch-friendly: OneToOne related_name="remision"
        return getattr(obj, "remision", None)

    def get_remision_numero(self, obj):
        rem = self._remision(obj)
        return rem.numero if rem else ""

    def get_remision_estado(self, obj):
        rem = self._remision(obj)
        return rem.estado if rem else ""


class RemisionGeneradaOperadorSerializer(serializers.ModelSerializer):
    """Remisión ya generada por el Operador (su historial). Sin valores monetarios."""

    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True, default="")
    generada_por_username = serializers.CharField(
        source="generada_por.username", read_only=True, default="")
    ops = serializers.SerializerMethodField()

    class Meta:
        model = Remision
        fields = ["id", "numero", "fecha", "estado", "generada_en",
                  "cliente_nombre", "generada_por_username", "ops", "tiene_troquel"]

    def get_ops(self, obj):
        # La OP propia + las de sus remisiones consolidadas (mismo criterio que
        # _remision_operador_ops en views.py).
        ordenes = [obj.orden] if obj.orden_id else []
        ordenes += [src.orden for src in obj.remisiones_consolidadas.all() if src.orden_id]
        return [
            {"numero": op.numero, "referencia": op.referencia, "cantidad": op.cantidad}
            for op in ordenes
        ]


# ─────────────── Remisiones ───────────────


class RemisionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RemisionItem
        # `op` viaja de ida y vuelta: al guardar, RemisionSerializer recrea los
        # ítems, y sin él se perdería el vínculo con la OP que los originó.
        fields = ["id", "descripcion", "cantidad", "valor_total", "orden", "op"]
        read_only_fields = ["id"]


class RemisionSerializer(serializers.ModelSerializer):
    items = RemisionItemSerializer(many=True, required=False)
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    cliente_email = serializers.EmailField(source="cliente.email", read_only=True)
    cliente_telefono = serializers.CharField(source="cliente.telefono", read_only=True, default='')
    cliente_nit = serializers.CharField(source="cliente.nit", read_only=True, default='')
    orden_numero = serializers.CharField(source="orden.numero", read_only=True, default="")
    consolidada_en_numero = serializers.CharField(
        source="consolidada_en_remision.numero", read_only=True, default="")

    class Meta:
        model = Remision
        fields = [
            "id", "numero", "fecha",
            "orden", "orden_numero",
            "cliente", "cliente_nombre", "cliente_email", "cliente_telefono", "cliente_nit",
            "direccion", "ciudad", "observaciones", "mostrar_valores", "tiene_troquel",
            "estado", "enviada_en", "liquidada_en",
            "consolidada_en", "consolidada_en_remision", "consolidada_en_numero",
            "creado", "modificado",
            "items",
        ]
        read_only_fields = ["id", "numero", "orden", "cliente", "estado",
                            "enviada_en", "liquidada_en",
                            "consolidada_en", "consolidada_en_remision", "consolidada_en_numero",
                            "creado", "modificado"]

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for idx, item in enumerate(items_data):
                item.setdefault("orden", idx)
                RemisionItem.objects.create(remision=instance, **item)
        return instance


class RemisionListSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    orden_numero = serializers.CharField(source="orden.numero", read_only=True, default="")

    class Meta:
        model = Remision
        fields = ["id", "numero", "fecha", "cliente_nombre", "orden_numero",
                  "estado", "mostrar_valores", "tiene_troquel", "creado", "modificado"]
