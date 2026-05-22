from django.db import models


class Cliente(models.Model):
    TIPO_CHOICES = [("final", "Cliente Final"), ("terciario", "Cliente Terciario")]

    nombre = models.CharField(max_length=200)
    email = models.EmailField(blank=True, default='')
    telefono = models.CharField(max_length=30, blank=True, default='')
    nit = models.CharField(max_length=30, blank=True, default='')
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="final")
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


class Papel(models.Model):
    nombre = models.CharField(max_length=100)
    gramaje = models.PositiveIntegerField(help_text="g/m²")
    material = models.CharField(max_length=100)
    precio = models.DecimalField(max_digits=10, decimal_places=2, help_text="COP por pliego")
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre", "gramaje"]

    def __str__(self):
        return f"{self.nombre} {self.gramaje}g · {self.material}"


class Cotizacion(models.Model):
    ESTADO_CHOICES = [
        ("borrador", "Borrador"),
        ("enviada", "Enviada"),
        ("aprobada", "Aprobada"),
        ("rechazada", "Rechazada"),
        ("convertida", "Convertida a OP"),
    ]
    CONDICION_CHOICES = [
        ("mismo", "Mismo día"),
        ("8", "8 días"),
        ("30", "30 días"),
        ("custom", "Personalizado"),
    ]
    TIPO_CLIENTE_CHOICES = [
        ("final", "Cliente Final"),
        ("terciario", "Cliente Terciario"),
    ]

    numero = models.CharField(max_length=20, unique=True, blank=True)
    fecha = models.DateField()
    cliente = models.ForeignKey(Cliente, on_delete=models.PROTECT, related_name="cotizaciones")
    referencia = models.CharField(max_length=300)
    cantidad = models.PositiveIntegerField()
    sobrante = models.PositiveIntegerField(default=0)
    tipo_cliente = models.CharField(max_length=20, choices=TIPO_CLIENTE_CHOICES, default="final")
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default="borrador")

    # Papel
    molde_ancho = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    molde_alto = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    pliego_tipo = models.CharField(max_length=20, default="70x100")
    pliego_w = models.DecimalField(max_digits=7, decimal_places=2, default=70)
    pliego_h = models.DecimalField(max_digits=7, decimal_places=2, default=100)
    papel = models.ForeignKey(Papel, on_delete=models.PROTECT, null=True, blank=True)
    precio_pliego = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    costo_papel_override = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    corte_inicial_active = models.BooleanField(default=False)
    corte_inicial_precio = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    corte_final_active = models.BooleanField(default=False)
    corte_final_precio = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    # Liquidación overrides (null = usar cálculo automático del front)
    valor_unitario_override = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    valor_total_override = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    total_costos_override = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    subtotal_override = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    margen = models.DecimalField(max_digits=6, decimal_places=2, default=80)

    # Condiciones
    condicion_pago = models.CharField(max_length=20, choices=CONDICION_CHOICES, default="30")
    condicion_custom = models.CharField(max_length=300, blank=True, default="")
    observaciones = models.TextField(blank=True, default="")

    creado = models.DateTimeField(auto_now_add=True)
    modificado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-creado"]

    def save(self, *args, **kwargs):
        is_new = not self.pk
        super().save(*args, **kwargs)
        if is_new and not self.numero:
            self.numero = f"COT-{self.pk:04d}"
            Cotizacion.objects.filter(pk=self.pk).update(numero=self.numero)

    def __str__(self):
        return f"{self.numero} · {self.cliente}"


class CotizacionProceso(models.Model):
    """Un proceso de producción activado o no en una cotización."""

    cotizacion = models.ForeignKey(Cotizacion, on_delete=models.CASCADE, related_name="procesos")
    proceso_id = models.CharField(max_length=50)
    active = models.BooleanField(default=False)
    costo = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    costo_override = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Campos variables por tipo: tipoLaminado, precioM2, disenador, cantidad, precioUnit, etc.
    extras = models.JSONField(default=dict, blank=True)

    class Meta:
        unique_together = ("cotizacion", "proceso_id")
        ordering = ["proceso_id"]

    def __str__(self):
        return f"{self.cotizacion.numero} · {self.proceso_id}"
