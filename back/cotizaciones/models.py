from django.conf import settings
from django.db import models


class Cliente(models.Model):
    TIPO_CHOICES = [("final", "Cliente Final"), ("terciario", "Cliente Terciario")]

    nombre = models.CharField(max_length=200)
    email = models.EmailField(blank=True, default='')
    telefono = models.CharField(max_length=30, blank=True, default='')
    nit = models.CharField(max_length=30, blank=True, default='')
    direccion = models.CharField(max_length=300, blank=True, default='')
    ciudad = models.CharField(max_length=120, blank=True, default='')
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
        ("60", "60 días"),
        ("custom", "Personalizado"),
    ]
    TIPO_CLIENTE_CHOICES = [
        ("final", "Cliente Final"),
        ("terciario", "Cliente Terciario"),
    ]
    TIPO_FACTURACION_CHOICES = [
        ("op", "Solo OP"),
        ("remision", "Remisión"),
        ("factura", "Factura"),
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
    tipo_facturacion = models.CharField(max_length=20, choices=TIPO_FACTURACION_CHOICES, default="factura")
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
    """Orden de producción. Espeja la estructura de Cotizacion.

    cotizacion != None => OP creada desde COT: todos los campos quedan
    bloqueados excepto abono/observaciones/fecha (whitelist en serializer).
    cotizacion == None => OP directa, totalmente editable. Sin estados.
    """

    TIPO_CLIENTE_CHOICES = Cliente.TIPO_CHOICES
    CONDICION_PAGO_CHOICES = [
        ("mismo", "Mismo día"),
        ("8", "8 días"),
        ("30", "30 días"),
        ("60", "60 días"),
        ("custom", "Personalizado"),  # solo heredada desde COT
    ]
    TIPO_FACTURACION_CHOICES = Cotizacion.TIPO_FACTURACION_CHOICES

    numero = models.CharField(max_length=20, unique=True, blank=True)
    fecha = models.DateField()
    fecha_entrega = models.DateField(null=True, blank=True)
    cotizacion = models.ForeignKey(
        Cotizacion, on_delete=models.SET_NULL, null=True, blank=True, related_name="ordenes"
    )
    cliente = models.ForeignKey(Cliente, on_delete=models.PROTECT, related_name="ordenes")
    referencia = models.CharField(max_length=300)
    cantidad = models.PositiveIntegerField()
    sobrante = models.PositiveIntegerField(default=0)
    tipo_cliente = models.CharField(max_length=20, choices=TIPO_CLIENTE_CHOICES, default="final")

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

    abono = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    # Condiciones
    condicion_pago = models.CharField(max_length=20, choices=CONDICION_PAGO_CHOICES, default="mismo")
    condicion_custom = models.CharField(max_length=300, blank=True, default="")
    tipo_facturacion = models.CharField(max_length=20, choices=TIPO_FACTURACION_CHOICES, default="factura")
    observaciones = models.TextField(blank=True, default="")

    # Solicitud del Operador de enviar la remisión cuando aún faltaban precios.
    # La alerta del Admin se computa: solicitada_en != None y costos del troquel en 0.
    remision_solicitada_en = models.DateTimeField(null=True, blank=True)
    remision_solicitada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="remisiones_solicitadas",
    )

    creado = models.DateTimeField(auto_now_add=True)
    modificado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-creado"]

    def save(self, *args, **kwargs):
        is_new = not self.pk
        super().save(*args, **kwargs)
        if is_new and not self.numero:
            self.numero = f"OP-{self.pk:04d}"
            OrdenProduccion.objects.filter(pk=self.pk).update(numero=self.numero)

    def __str__(self):
        return f"{self.numero} · {self.cliente}"


class OpProceso(models.Model):
    """Un proceso de producción activado o no en una OP. Espeja CotizacionProceso."""

    orden = models.ForeignKey(OrdenProduccion, on_delete=models.CASCADE, related_name="procesos")
    proceso_id = models.CharField(max_length=50)
    active = models.BooleanField(default=False)
    costo = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    costo_override = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    extras = models.JSONField(default=dict, blank=True)
    completado = models.BooleanField(default=False)
    completado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("orden", "proceso_id")
        ordering = ["proceso_id"]

    def __str__(self):
        return f"{self.orden.numero} · {self.proceso_id}"


class RegistroMaquina(models.Model):
    """Registro de ejecución en una máquina (troquel, guillotina).

    Operador registra descripción y costo; fecha_hora y operador se
    estampan server-side.
    """

    MAQUINA_CHOICES = [
        ("troquel", "Troquel"),
        ("guillotina", "Guillotina"),
    ]

    orden = models.ForeignKey(
        OrdenProduccion, on_delete=models.CASCADE, related_name="registros_maquina",
        null=True, blank=True,
    )
    maquina = models.CharField(max_length=30, choices=MAQUINA_CHOICES)
    descripcion = models.CharField(max_length=300)
    costo = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    fecha_hora = models.DateTimeField(auto_now_add=True)
    operador = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="registros_maquina",
    )

    class Meta:
        ordering = ["-fecha_hora"]

    def __str__(self):
        return f"{self.orden.numero} · {self.maquina} · {self.fecha_hora:%Y-%m-%d %H:%M}"


class TroquelModelo(models.Model):
    """Modelo del troquel asociado a una OP. Cargado por el Admin.

    Incluye archivo (diagrama recibido por email), datos técnicos visibles
    al Operador (vista sanitizada) y los CM lineales por tipo de cobro que
    alimentan el cálculo de costos (solo Admin).
    """

    orden = models.OneToOneField(
        OrdenProduccion, on_delete=models.CASCADE, related_name="troquel_modelo",
        null=True, blank=True,
    )
    archivo = models.FileField(upload_to="troquel_modelos/", null=True, blank=True)
    # Datos técnicos (visibles al Operador)
    troquel_numero = models.CharField(max_length=50, blank=True, default="")
    pinza = models.CharField(max_length=100, blank=True, default="")
    madera = models.CharField(max_length=100, blank=True, default="")
    cuchilla_puntos = models.CharField(max_length=100, blank=True, default="")
    material = models.CharField(max_length=100, blank=True, default="")
    espejo = models.BooleanField(default=False)  # "NO hacer espejo" cuando False
    # Anotaciones técnicas (único cuadro libre, visible al Operador)
    instrucciones = models.TextField(blank=True, default="")
    # CM lineales impresos en el modelo (alimentan cálculo, solo Admin)
    corte_cm = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    score_cm = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    hendido_cm = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    # Precios unitarios por OP (legacy: el costeo ahora usa costos_items)
    precio_corte = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    precio_score = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    precio_hendido = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    precio_caucho = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    # Líneas de costo editables por el Admin, sembradas desde el formato de
    # cuchillas del Operador. Cada línea:
    # {"key", "concepto", "detalle", "unidad", "cantidad", "precio"}
    # (los totales se calculan siempre al vuelo, nunca se almacenan)
    costos_items = models.JSONField(default=list, blank=True)
    creado = models.DateTimeField(auto_now_add=True)
    modificado = models.DateTimeField(auto_now=True)

    def __str__(self):
        ref = self.orden.numero if self.orden else "sin OP"
        return f"Modelo troquel {self.troquel_numero or ''} · {ref}".strip()


class FormatoCuchillas(models.Model):
    """Captura operativa del Operador sobre una OP (formato de cuchillas + tiempos).

    Reemplaza el RegistroMaquina simple para troquel. Varios registros por OP,
    cada uno con fecha/hora y operador estampados server-side (trazabilidad).
    """

    CH_MEDIDA_CHOICES = [(v, v) for v in ["3x3", "4x4", "6x6", "8x8", "10x10"]]
    SAC_MEDIDA_CHOICES = (
        [(str(n), f"{n} (expulsor)") for n in range(1, 11)]
        + [(str(n), f"{n} (tubo)") for n in range(11, 16)]
    )
    PERFO_MEDIDA_CHOICES = [
        (v, v)
        for v in ["1x1", "2x1", "2x2", "3x1", "3x2", "3x3", "4x1", "4x2", "4x3", "4x4", "6x6", "10x10"]
    ]
    CAUCHO_TIPO_CHOICES = [
        ("verde", "Caucho Verde"),
        ("profigumi", "Profigumi"),
        ("blucolan", "Blucolan"),
    ]
    PUNTOS_CHOICES = [("2", "2 puntos"), ("3", "3 puntos")]
    GRAFA_ALTURA_CHOICES = [("23.4", "23,4 mm"), ("23.3", "23,3 mm")]

    orden = models.ForeignKey(
        OrdenProduccion, on_delete=models.CASCADE, related_name="formatos_cuchillas"
    )
    # Cuchilla/grafa: cm usados + tipo de puntos. Las medidas fijas por tipo
    # (espesor 0,71 mm en 2pt / 1,05 mm en 3pt; altura 23,8 mm salvo grafa 3pt
    # que es 23,0 mm) se muestran en el front; solo la altura de grafa 2pt es
    # elegible (23,4 o 23,3 mm).
    cuchilla_cm = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    cuchilla_puntos = models.CharField(max_length=1, choices=PUNTOS_CHOICES, blank=True, default="")
    grafa_cm = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    grafa_puntos = models.CharField(max_length=1, choices=PUNTOS_CHOICES, blank=True, default="")
    grafa_altura = models.CharField(max_length=5, choices=GRAFA_ALTURA_CHOICES, blank=True, default="")
    ch_cm = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    ch_medida = models.CharField(max_length=10, choices=CH_MEDIDA_CHOICES, blank=True, default="")
    sac_cm = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sac_medida = models.CharField(max_length=5, choices=SAC_MEDIDA_CHOICES, blank=True, default="")
    perfo_cm = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    perfo_medida = models.CharField(max_length=10, choices=PERFO_MEDIDA_CHOICES, blank=True, default="")
    desperdicio_mm = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Filas de caucho: [{"tipo": "verde"|"profigumi"|"blucolan", "cm": <number>}, ...]
    cauchos = models.JSONField(default=list, blank=True)
    gan = models.CharField(max_length=100, blank=True, default="")
    # Legacy (solo lectura, formatos anteriores al formulario estructurado)
    dos_puntos = models.BooleanField(default=False)
    tres_puntos = models.BooleanField(default=False)
    perfo = models.BooleanField(default=False)
    ch = models.CharField(max_length=100, blank=True, default="")
    sac = models.CharField(max_length=100, blank=True, default="")
    desperdicio = models.CharField(max_length=200, blank=True, default="")
    # Tiempos por fase en minutos enteros (analizable: promedios, sumas, gráficos)
    tiempo_encalado_min = models.PositiveIntegerField(default=0)
    tiempo_encuchillado_min = models.PositiveIntegerField(default=0)
    tiempo_encauchado_min = models.PositiveIntegerField(default=0)
    operador = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="formatos_cuchillas",
    )
    fecha_hora = models.DateTimeField(auto_now_add=True)
    # Aprobación admin: el troquel no se completa (ni genera remisión) hasta aprobar.
    ESTADO_CHOICES = [
        ("pendiente", "Pendiente de aprobación"),
        ("aprobado", "Aprobado"),
        ("devuelto", "Devuelto al operador"),
        ("borrador", "Borrador (envío cancelado)"),
    ]
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default="pendiente")
    devolucion_motivo = models.CharField(max_length=300, blank=True, default="")
    revisado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="formatos_cuchillas_revisados",
    )
    revisado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-fecha_hora"]

    def __str__(self):
        return f"{self.orden.numero} · cuchillas · {self.fecha_hora:%Y-%m-%d %H:%M}"


class Remision(models.Model):
    """Comprobante de entrega y cobro al cliente, generado al completar una OP.

    Se crea automáticamente cuando la OP llega al 100% (estado=pendiente).
    El dueño la liquida (edita ítems/valores) y la envía por correo a contaduría
    y al cliente; al liquidarse pasa al historial (estado=liquidada).
    Espeja la estructura de DocumentoCliente.
    """

    ESTADO_CHOICES = [
        ("pendiente", "Pendiente"),
        ("liquidada", "Liquidada"),
        ("consolidada", "Consolidada"),
    ]

    numero = models.CharField(max_length=20, unique=True, blank=True)
    fecha = models.DateField()
    orden = models.OneToOneField(
        OrdenProduccion, on_delete=models.PROTECT, related_name="remision"
    )
    cliente = models.ForeignKey(Cliente, on_delete=models.PROTECT, related_name="remisiones")
    # Snapshot editable de datos del cliente impresos en el comprobante
    direccion = models.CharField(max_length=300, blank=True, default="")
    ciudad = models.CharField(max_length=120, blank=True, default="")
    observaciones = models.TextField(blank=True, default="")
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default="pendiente")
    enviada_en = models.DateTimeField(null=True, blank=True)
    liquidada_en = models.DateTimeField(null=True, blank=True)
    # Si fue fusionada dentro de otra remisión: estado=consolidada y apunta al destino.
    consolidada_en = models.DateTimeField(null=True, blank=True)
    consolidada_en_remision = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="remisiones_consolidadas",
    )
    creado = models.DateTimeField(auto_now_add=True)
    modificado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-creado"]

    def save(self, *args, **kwargs):
        is_new = not self.pk
        super().save(*args, **kwargs)
        if is_new and not self.numero:
            self.numero = f"REM-{self.pk:04d}"
            Remision.objects.filter(pk=self.pk).update(numero=self.numero)

    def __str__(self):
        return f"{self.numero} · {self.cliente}"


class RemisionItem(models.Model):
    """Ítem de línea de una remisión: Descripción · Cantidad · Vr. Total."""

    remision = models.ForeignKey(Remision, on_delete=models.CASCADE, related_name="items")
    descripcion = models.TextField(blank=True, default="")
    cantidad = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["orden", "id"]

    def __str__(self):
        return f"{self.remision.numero} · {self.descripcion[:40]}"

