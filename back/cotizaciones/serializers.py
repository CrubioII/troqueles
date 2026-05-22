from rest_framework import serializers
from .models import Cliente, Papel, Cotizacion, CotizacionProceso


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

    class Meta:
        model = Cotizacion
        fields = [
            "id", "numero", "fecha",
            "cliente", "cliente_nombre", "cliente_email", "cliente_telefono", "cliente_nit",
            "referencia", "cantidad", "sobrante", "tipo_cliente", "estado",
            "molde_ancho", "molde_alto",
            "pliego_tipo", "pliego_w", "pliego_h",
            "papel", "precio_pliego", "costo_papel_override",
            "valor_unitario_override", "valor_total_override",
            "total_costos_override", "subtotal_override",
            "condicion_pago", "condicion_custom", "observaciones",
            "creado", "modificado",
            "procesos",
        ]
        read_only_fields = ["id", "numero", "creado", "modificado"]

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
