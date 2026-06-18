from rest_framework import serializers
from .models import Cliente, Papel, Cotizacion, CotizacionProceso, DocumentoCliente, DocumentoClienteItem, OrdenProduccion, OpProceso, RegistroMaquina, PrecioTroquel, TroquelModelo, FormatoCuchillas, Remision, RemisionItem


class ClienteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cliente
        fields = ["id", "nombre", "email", "telefono", "nit", "direccion", "ciudad", "tipo", "creado"]
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
OP_LOCKED_WHITELIST = {"abono", "observaciones", "fecha", "fecha_entrega"}


class OpProcesoSerializer(serializers.ModelSerializer):
    class Meta:
        model = OpProceso
        fields = ["id", "proceso_id", "active", "costo", "costo_override", "extras", "completado", "completado_en"]
        read_only_fields = ["id", "completado", "completado_en"]


class OrdenListSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source="cliente.nombre", read_only=True)
    cotizacion_numero = serializers.CharField(source="cotizacion.numero", read_only=True, default="")
    valor_total_efectivo = serializers.SerializerMethodField()
    saldo = serializers.SerializerMethodField()
    progreso = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = [
            "id", "numero", "fecha", "fecha_entrega", "cliente_nombre", "referencia",
            "cantidad", "valor_total_efectivo", "abono", "saldo",
            "cotizacion", "cotizacion_numero", "creado", "modificado",
            "progreso",
        ]

    def get_valor_total_efectivo(self, obj):
        return _orden_valor_total_efectivo(obj)

    def get_saldo(self, obj):
        total = _orden_valor_total_efectivo(obj)
        if total is None:
            return None
        return total - float(obj.abono or 0)

    def get_progreso(self, obj):
        return _orden_progreso(obj)


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
            old_state = {p.proceso_id: (p.completado, p.completado_en) for p in instance.procesos.all()}
            instance.procesos.all().delete()
            for p in procesos_data:
                completado, completado_en = old_state.get(p["proceso_id"], (False, None))
                OpProceso.objects.create(orden=instance, completado=completado, completado_en=completado_en, **p)
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


class PrecioTroquelSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrecioTroquel
        fields = ["id", "tipo", "precio_unitario", "modificado"]
        read_only_fields = ["id", "tipo", "modificado"]


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

    class Meta:
        model = FormatoCuchillas
        fields = [
            "id", "orden", "orden_numero",
            "cuchilla_cm", "grafa_cm",
            "dos_puntos", "tres_puntos", "perfo",
            "ch", "sac", "gan",
            "caucho_cm", "desperdicio",
            "tiempo_encalado_min", "tiempo_encuchillado_min", "tiempo_encauchado_min",
            "operador", "operador_username", "fecha_hora",
        ]
        read_only_fields = ["id", "operador", "fecha_hora"]


class OrdenOperadorSerializer(serializers.ModelSerializer):
    """Vista sanitizada de la OP para el Operador.

    Sin cliente ni valores monetarios. Solo lo necesario para producir:
    referencia, cantidad, procesos activos y el modelo del troquel sanitizado.
    """

    procesos = serializers.SerializerMethodField()
    troquel_modelo = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = ["id", "numero", "fecha_entrega", "referencia", "cantidad", "procesos", "troquel_modelo"]

    def get_procesos(self, obj):
        return [
            {"proceso_id": p.proceso_id, "active": p.active, "completado": p.completado}
            for p in obj.procesos.all() if p.active
        ]

    def get_troquel_modelo(self, obj):
        modelo = getattr(obj, "troquel_modelo", None)
        if modelo is None:
            return None
        return TroquelModeloOperadorSerializer(modelo, context=self.context).data


# ─────────────── Remisiones ───────────────


class RemisionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RemisionItem
        fields = ["id", "descripcion", "cantidad", "valor_total", "orden"]
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
            "direccion", "ciudad", "observaciones",
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
                  "estado", "creado", "modificado"]
