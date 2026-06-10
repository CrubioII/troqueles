from rest_framework import serializers
from .models import Cliente, Papel, Cotizacion, CotizacionProceso, DocumentoCliente, DocumentoClienteItem, OrdenProduccion, OpProceso


class ClienteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cliente
        fields = ["id", "nombre", "email", "telefono", "nit", "tipo", "creado"]
        read_only_fields = ["id", "creado"]


class PapelSerializer(serializers.ModelSerializer):
    class Meta:
        model = Papel
        fields = ["id", "nombre", "gramaje", "material", "precio", "activo"]
        read_only_fields = ["id"]


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
            "papel", "precio_pliego", "costo_papel_override",
            "corte_inicial_active", "corte_inicial_precio",
            "corte_final_active", "corte_final_precio",
            "valor_unitario_override", "valor_total_override",
            "total_costos_override", "subtotal_override",
            "margen",
            "condicion_pago", "condicion_custom", "tipo_facturacion", "observaciones",
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
OP_LOCKED_WHITELIST = {"abono", "observaciones", "fecha"}


class OpProcesoSerializer(serializers.ModelSerializer):
    class Meta:
        model = OpProceso
        fields = ["id", "proceso_id", "active", "costo", "costo_override", "extras"]
        read_only_fields = ["id"]


class OrdenListSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    cotizacion_numero = serializers.CharField(source="cotizacion.numero", read_only=True, default="")
    valor_total_efectivo = serializers.SerializerMethodField()
    saldo = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = [
            "id", "numero", "fecha", "cliente_nombre", "referencia",
            "cantidad", "valor_total_efectivo", "abono", "saldo",
            "cotizacion", "cotizacion_numero", "creado", "modificado",
        ]

    def get_valor_total_efectivo(self, obj):
        return _orden_valor_total_efectivo(obj)

    def get_saldo(self, obj):
        total = _orden_valor_total_efectivo(obj)
        if total is None:
            return None
        return total - float(obj.abono or 0)


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

    class Meta:
        model = OrdenProduccion
        fields = [
            "id", "numero", "fecha",
            "cotizacion", "cotizacion_numero",
            "cliente", "cliente_nombre", "cliente_email", "cliente_telefono", "cliente_nit",
            "referencia", "cantidad", "sobrante", "tipo_cliente",
            "molde_ancho", "molde_alto",
            "pliego_tipo", "pliego_w", "pliego_h",
            "papel", "precio_pliego", "costo_papel_override",
            "corte_inicial_active", "corte_inicial_precio",
            "corte_final_active", "corte_final_precio",
            "valor_unitario_override", "valor_total_override",
            "total_costos_override", "subtotal_override",
            "margen", "abono",
            "condicion_pago", "condicion_custom", "tipo_facturacion", "observaciones",
            "creado", "modificado",
            "procesos",
            "valor_unitario_efectivo", "valor_total_efectivo", "saldo",
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

    def create(self, validated_data):
        procesos_data = validated_data.pop("procesos", [])
        orden = OrdenProduccion.objects.create(**validated_data)
        for p in procesos_data:
            OpProceso.objects.create(orden=orden, **p)
        return orden

    def update(self, instance, validated_data):
        procesos_data = validated_data.pop("procesos", None)
        if instance.cotizacion_id is not None:
            # OP desde COT: solo liquidación editable
            validated_data = {k: v for k, v in validated_data.items() if k in OP_LOCKED_WHITELIST}
            procesos_data = None
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if procesos_data is not None:
            instance.procesos.all().delete()
            for p in procesos_data:
                OpProceso.objects.create(orden=instance, **p)
        return instance
