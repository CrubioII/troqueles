from django.db import models
from django.contrib.auth.models import User


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


class DocumentoCliente(models.Model):
    ESTADO_CHOICES = [("borrador", "Borrador"), ("enviado", "Enviado")]
    CONDICION_CHOICES = Cotizacion.CONDICION_CHOICES

    numero = models.CharField(max_length=20, unique=True, blank=True)
    fecha = models.DateField()
    cliente = models.ForeignKey(Cliente, on_delete=models.PROTECT, related_name="documentos")
    tiempo_entrega = models.CharField(max_length=200, blank=True, default="8 días hábiles")
    condicion_pago = models.CharField(max_length=20, choices=CONDICION_CHOICES, default="30")
    condicion_custom = models.CharField(max_length=300, blank=True, default="")
    nota = models.TextField(blank=True, default="En la presente cotización No incluye el impuesto del IVA, el cliente debe suministrar el diseño de logotipo e impresión.")
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default="borrador")
    creado = models.DateTimeField(auto_now_add=True)
    modificado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-creado"]

    def save(self, *args, **kwargs):
        is_new = not self.pk
        super().save(*args, **kwargs)
        if is_new and not self.numero:
            self.numero = f"DC-{self.pk:04d}"
            DocumentoCliente.objects.filter(pk=self.pk).update(numero=self.numero)

    def __str__(self):
        return f"{self.numero} · {self.cliente}"


class DocumentoClienteItem(models.Model):
    documento = models.ForeignKey(DocumentoCliente, on_delete=models.CASCADE, related_name="items")
    cotizacion = models.ForeignKey(Cotizacion, on_delete=models.SET_NULL, null=True, blank=True, related_name="documento_items")
    referencia = models.CharField(max_length=300)
    descripcion = models.TextField(blank=True, default="")
    tamano_display = models.CharField(max_length=200, blank=True, default="")
    cantidad = models.PositiveIntegerField(default=0)
    valor_unitario = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["orden", "id"]

    def __str__(self):
        return f"{self.documento.numero} · {self.referencia}"


class OrdenProduccion(models.Model):
    ESTADOS = [
        ('borrador',    'Borrador'),
        ('programada',  'Programada'),
        ('en_proceso',  'En Proceso'),
        ('finalizada',  'Finalizada'),
        ('remisionada', 'Remisionada'),
        ('anulada',     'Anulada'),
    ]
    CONDICION_COBRO_CHOICES = [
        ('op',       'Solo OP'),
        ('remision', 'Remisión'),
        ('factura',  'Factura'),
    ]
    CONDICION_PAGO_CHOICES = [
        ('mismo_dia', 'Mismo Día'),
        ('8_dias',    '8 Días'),
        ('30_dias',   '30 Días'),
        ('60_dias',   '60 Días'),
    ]
    TIPO_CLIENTE_CHOICES = [
        ('final',     'Cliente Final'),
        ('terciario', 'Cliente Terciario'),
    ]

    numero       = models.CharField(max_length=20, unique=True, blank=True)
    fecha        = models.DateField()
    cliente      = models.ForeignKey(Cliente, on_delete=models.PROTECT, related_name='ordenes')
    cotizacion   = models.ForeignKey(
        Cotizacion, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='ordenes'
    )
    referencia   = models.CharField(max_length=300)
    descripcion  = models.TextField(blank=True, default='')
    estado       = models.CharField(max_length=20, choices=ESTADOS, default='borrador')

    tipo_cliente_op            = models.CharField(max_length=20, choices=TIPO_CLIENTE_CHOICES, default='final')
    condicion_cobro_terciario  = models.CharField(max_length=20, choices=CONDICION_COBRO_CHOICES, blank=True, default='')

    # RF-01.4
    cantidad           = models.PositiveIntegerField(default=0)
    valor_unitario     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cantidad_pliegos   = models.PositiveIntegerField(default=0)
    papel_referencia   = models.CharField(max_length=200, blank=True, default='')
    corte_inicial      = models.CharField(max_length=100, blank=True, default='')
    corte_final        = models.CharField(max_length=100, blank=True, default='')
    medida_producto    = models.CharField(max_length=100, blank=True, default='')
    cantidad_impresion = models.PositiveIntegerField(default=0)

    # RF-01.5
    total_costos = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valor_total  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    subtotal     = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    # RF-01.6
    abono = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    condicion_pago = models.CharField(max_length=20, choices=CONDICION_PAGO_CHOICES, default='mismo_dia')
    observaciones  = models.TextField(blank=True, default='')

    creado    = models.DateTimeField(auto_now_add=True)
    modificado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-creado']

    def save(self, *args, **kwargs):
        is_new = not self.pk
        super().save(*args, **kwargs)
        if is_new and not self.numero:
            self.numero = f'OP-{self.pk:04d}'
            OrdenProduccion.objects.filter(pk=self.pk).update(numero=self.numero)

    def __str__(self):
        return f'{self.numero} · {self.cliente}'


class OpProceso(models.Model):
    ESTADOS = [
        ('pendiente',  'Pendiente'),
        ('en_proceso', 'En Proceso'),
        ('completado', 'Completado'),
    ]

    orden               = models.ForeignKey(OrdenProduccion, on_delete=models.CASCADE, related_name='procesos')
    proceso_id          = models.CharField(max_length=50)
    active              = models.BooleanField(default=False)
    costo               = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    maquina_id          = models.CharField(max_length=50, blank=True, default='')
    operario            = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='procesos_op'
    )
    estado              = models.CharField(max_length=20, choices=ESTADOS, default='pendiente')
    unidades_completadas = models.PositiveIntegerField(default=0)
    iniciado_en         = models.DateTimeField(null=True, blank=True)
    completado_en       = models.DateTimeField(null=True, blank=True)
    notas               = models.TextField(blank=True, default='')

    class Meta:
        unique_together = ('orden', 'proceso_id')
        ordering = ['proceso_id']

    def __str__(self):
        return f'{self.orden.numero} · {self.proceso_id}'
