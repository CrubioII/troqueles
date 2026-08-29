from django.db import models


class CorreoProcesado(models.Model):
    """Registro de un correo ya procesado por el batch `procesar_correos`.

    Fuente de verdad para no reprocesar: la corrección vive aquí, no en el
    estado del servidor IMAP (ver correos/imap_client.py y la sección 5.1 de
    la especificación de migración — la ventana de búsqueda IMAP es amplia a
    propósito y este modelo es lo que hace eso seguro).
    """

    RESULTADO_CHOICES = [
        ("ok", "Órdenes creadas"),
        ("omitido_cotizacion", "Omitido — cotización"),
        ("omitido_sin_adjuntos", "Omitido — sin adjuntos válidos"),
        ("omitido_orden", "Omitido — todos los adjuntos eran 'orden'"),
        ("alerta_sin_regla", "Alerta — sin regla de cliente"),
        ("error", "Error"),
    ]

    message_id = models.CharField(max_length=500, unique=True, db_index=True)
    email_uid = models.CharField(max_length=100, blank=True, default="")
    asunto = models.CharField(max_length=500, blank=True, default="")
    remitente = models.CharField(max_length=320, blank=True, default="")
    fecha_correo = models.DateTimeField(null=True, blank=True)
    procesado_en = models.DateTimeField(auto_now_add=True)
    resultado = models.CharField(max_length=30, choices=RESULTADO_CHOICES)
    ordenes = models.JSONField(default=list, blank=True)
    detalle = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-procesado_en"]

    def __str__(self):
        return f"{self.message_id} · {self.resultado}"
