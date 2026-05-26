from rest_framework import serializers
from django.contrib.auth.models import User
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
            "condicion_pago", "condicion_custom", "observaciones",
            "creado", "modificado",
            "procesos",
            "valor_unitario_efectivo", "valor_total_efectivo",
        ]
        read_only_fields = ["id", "numero", "creado", "modificado"]

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

class OperarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name"]


class OpProcesoSerializer(serializers.ModelSerializer):
    operario_username = serializers.CharField(source="operario.username", read_only=True, default="")

    class Meta:
        model = OpProceso
        fields = [
            "id", "proceso_id", "active", "costo", "maquina_id",
            "operario", "operario_username",
            "estado", "unidades_completadas",
            "iniciado_en", "completado_en", "notas",
        ]
        read_only_fields = ["id"]


class OrdenListSerializer(serializers.ModelSerializer):
    cliente_nombre    = serializers.CharField(source="cliente.nombre", read_only=True)
    cotizacion_numero = serializers.CharField(source="cotizacion.numero", read_only=True, default="")
    saldo             = serializers.SerializerMethodField()
    progreso_procesos = serializers.SerializerMethodField()
    progreso_unidades = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = [
            "id", "numero", "fecha", "cliente_nombre", "cotizacion_numero",
            "referencia", "estado", "cantidad", "valor_total", "abono", "saldo",
            "condicion_pago", "tipo_cliente_op",
            "progreso_procesos", "progreso_unidades",
            "creado", "modificado",
        ]

    def get_saldo(self, obj):
        return float(obj.valor_total) - float(obj.abono)

    def _active_procs(self, obj):
        return [p for p in obj.procesos.all() if p.active]

    def get_progreso_procesos(self, obj):
        procs = self._active_procs(obj)
        if not procs:
            return 0
        completados = sum(1 for p in procs if p.estado == "completado")
        return round(completados / len(procs) * 100)

    def get_progreso_unidades(self, obj):
        if not obj.cantidad:
            return 0
        procs = self._active_procs(obj)
        if not procs:
            return 0
        max_completadas = max((p.unidades_completadas for p in procs), default=0)
        return round(min(max_completadas / obj.cantidad * 100, 100))


class OrdenSerializer(serializers.ModelSerializer):
    procesos          = OpProcesoSerializer(many=True, required=False)
    cliente_nombre    = serializers.CharField(source="cliente.nombre", read_only=True)
    cotizacion_numero = serializers.CharField(source="cotizacion.numero", read_only=True, default="")
    saldo             = serializers.SerializerMethodField()
    progreso_procesos = serializers.SerializerMethodField()
    progreso_unidades = serializers.SerializerMethodField()

    class Meta:
        model = OrdenProduccion
        fields = [
            "id", "numero", "fecha",
            "cliente", "cliente_nombre",
            "cotizacion", "cotizacion_numero",
            "referencia", "descripcion", "estado",
            "tipo_cliente_op", "condicion_cobro_terciario",
            "cantidad", "valor_unitario", "cantidad_pliegos", "papel_referencia",
            "corte_inicial", "corte_final", "medida_producto", "cantidad_impresion",
            "total_costos", "valor_total", "subtotal", "abono", "saldo",
            "condicion_pago", "observaciones",
            "creado", "modificado",
            "procesos",
            "progreso_procesos", "progreso_unidades",
        ]
        read_only_fields = ["id", "numero", "creado", "modificado"]

    def get_saldo(self, obj):
        return float(obj.valor_total) - float(obj.abono)

    def _active_procs(self, obj):
        return [p for p in obj.procesos.all() if p.active]

    def get_progreso_procesos(self, obj):
        procs = self._active_procs(obj)
        if not procs:
            return 0
        completados = sum(1 for p in procs if p.estado == "completado")
        return round(completados / len(procs) * 100)

    def get_progreso_unidades(self, obj):
        if not obj.cantidad:
            return 0
        procs = self._active_procs(obj)
        if not procs:
            return 0
        max_completadas = max((p.unidades_completadas for p in procs), default=0)
        return round(min(max_completadas / obj.cantidad * 100, 100))

    def create(self, validated_data):
        procesos_data = validated_data.pop("procesos", [])
        orden = OrdenProduccion.objects.create(**validated_data)
        for p in procesos_data:
            OpProceso.objects.create(orden=orden, **p)
        return orden

    def update(self, instance, validated_data):
        procesos_data = validated_data.pop("procesos", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if procesos_data is not None:
            instance.procesos.all().delete()
            for p in procesos_data:
                OpProceso.objects.create(orden=instance, **p)
        return instance
