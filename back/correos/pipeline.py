"""Procesamiento de un correo — orquesta reglas/, pdf_utils, imap_client y
telegram para decidir qué hacer y (si no es dry-run) crear las órdenes.

No toca la conexión IMAP: recibe un email.message.Message ya descargado
(BODY.PEEK[], ver imap_client.py) y devuelve un ResultadoCorreo que le dice
al management command qué acciones de IMAP tomar (marcar procesado, mover a
Cotizar) y qué mensajes mandar a Telegram. Las acciones de IMAP en sí las
ejecuta el command, no este módulo.
"""
import os
import re
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from cotizaciones.models import Cliente, OrdenProduccion, TroquelModelo, normalizar_nombre_cliente
from correos import imap_client, telegram
from correos.models import CorreoProcesado
from correos.pdf_utils import (
    dividir_pdf,
    nombre_archivo_pagina,
    referencia_pagina_richard,
    truncar_nombre_archivo,
)
from correos.reglas.adjuntos import es_archivo_orden, filtrar_validos
from correos.reglas.clientes import resolver_cliente
from correos.reglas.cotizacion import es_cotizacion
from correos.reglas.cuerpo import cuerpo_visible, html_a_texto

BOGOTA = ZoneInfo("America/Bogota")


@dataclass
class Tarea:
    referencia: str
    nombre_archivo: str
    contenido: bytes


@dataclass
class ResultadoCorreo:
    resultado: str
    detalle: str = ""
    ordenes: list = field(default_factory=list)
    cliente_nombre: str = ""
    mover_a_cotizar: bool = False
    marcar_procesado: bool = True
    mensajes_telegram: list = field(default_factory=list)
    omitido_cotizacion_info: tuple = None  # (remitente, asunto), solo si resultado == omitido_cotizacion


def correo_ya_procesado(message_id):
    """Dedup real (no depende del estado del servidor IMAP). Un registro con
    resultado='error' NO cuenta como "ya procesado": debe poder reintentarse
    al día siguiente dentro de la ventana de BATCH_DIAS_ATRAS (spec 5.1 y
    5.2 — de otro modo esas dos reglas se contradicen)."""
    return CorreoProcesado.objects.filter(message_id=message_id).exclude(resultado="error").exists()


def _referencia_default(nombre_archivo):
    base, _ext = os.path.splitext(nombre_archivo or "")
    return base


def _tareas_richard(adjuntos_validos):
    """Spec 6.5. Si hay algún PDF, SOLO los PDF generan tareas (uno por
    página); los .ai/.cdr del mismo correo se ignoran. Si no hay ningún PDF,
    cada archivo no-PDF genera una tarea (sin split)."""
    pdfs = [a for a in adjuntos_validos if os.path.splitext(a.nombre)[1].lower() == ".pdf"]
    if pdfs:
        tareas = []
        for adjunto in pdfs:
            paginas = dividir_pdf(adjunto.contenido)  # PdfProcesamientoError se propaga, sin fallback
            for numero, contenido_pagina in enumerate(paginas, start=1):
                tareas.append(Tarea(
                    referencia=referencia_pagina_richard(numero, adjunto.nombre),
                    nombre_archivo=nombre_archivo_pagina(adjunto.nombre, numero),
                    contenido=contenido_pagina,
                ))
        return tareas
    return [
        Tarea(referencia=_referencia_default(a.nombre), nombre_archivo=truncar_nombre_archivo(a.nombre), contenido=a.contenido)
        for a in adjuntos_validos
    ]


_PATRON_TROQUEL_LINEA = re.compile(r"\btroquel\s*:\s*(\d+)", re.IGNORECASE)


def _tareas_inmcor(texto_busqueda, adjuntos_validos):
    """Spec 6.7: una orden por cada "Troquel: nnnn" en el cuerpo, todas con
    el mismo archivo (el primer adjunto válido), sin split."""
    numeros = _PATRON_TROQUEL_LINEA.findall(texto_busqueda or "")
    if not numeros:
        # No enmascarar con un fallback plausible (principio spec 16, #11):
        # un correo de Inmcor sin líneas "Troquel: nnnn" es un error, no un
        # correo de una sola orden estándar.
        raise ValueError('Correo de Inmcor sin ninguna línea "Troquel: nnnn" en el cuerpo')
    adjunto = adjuntos_validos[0]
    nombre_archivo = truncar_nombre_archivo(adjunto.nombre)
    return [
        Tarea(referencia=f"TROQUEL {numero}", nombre_archivo=nombre_archivo, contenido=adjunto.contenido)
        for numero in numeros
    ]


def _tareas_estandar(adjuntos_validos):
    return [
        Tarea(referencia=_referencia_default(a.nombre), nombre_archivo=truncar_nombre_archivo(a.nombre), contenido=a.contenido)
        for a in adjuntos_validos
    ]


def _construir_tareas(flag, texto_busqueda, adjuntos_validos):
    if flag == "multipagina":
        return _tareas_richard(adjuntos_validos)
    if flag == "es_inmcor":
        return _tareas_inmcor(texto_busqueda, adjuntos_validos)
    return _tareas_estandar(adjuntos_validos)


def _crear_ordenes(cliente_nombre, nota_cliente, tareas, cuerpo_limpio):
    """Cliente + órdenes + TroquelModelo, todo en una transacción (spec 8):
    si algo falla a la mitad, no queda medio correo procesado."""
    with transaction.atomic():
        cliente, _creado = Cliente.objects.get_or_create(
            nombre_normalizado=normalizar_nombre_cliente(cliente_nombre),
            defaults={"nombre": cliente_nombre},
        )
        fecha = timezone.now().astimezone(BOGOTA).date()
        ordenes = []
        mensajes = []
        for tarea in tareas:
            orden = OrdenProduccion.objects.create(
                fecha=fecha,
                cliente=cliente,
                referencia=tarea.referencia,
                cantidad=1,  # OP de fabricación de troquel: no hay tiraje asociado en el correo
                observaciones=cuerpo_limpio,
            )
            troquel = TroquelModelo(orden=orden, nota_cliente=nota_cliente)
            troquel.archivo.save(tarea.nombre_archivo, ContentFile(tarea.contenido), save=True)
            ordenes.append(orden.numero)
            mensajes.append(telegram.msg_confirmacion(
                orden.numero, cliente.nombre, fecha.isoformat(), tarea.referencia,
                cuerpo_limpio, nota_cliente=nota_cliente,
            ))
        return ordenes, mensajes


def _registrar(message_id, asunto, remitente, fecha_correo, resultado, ordenes=None, detalle=""):
    CorreoProcesado.objects.update_or_create(
        message_id=message_id,
        defaults=dict(
            asunto=asunto, remitente=remitente, fecha_correo=fecha_correo,
            resultado=resultado, ordenes=ordenes or [], detalle=detalle,
        ),
    )


def procesar_correo(mensaje, message_id, dry_run=False):
    paso = "extraer_contenido"
    try:
        asunto = imap_client.extraer_asunto(mensaje)
        nombre_remitente, email_remitente = imap_client.extraer_remitente(mensaje)
        remitente_completo = f"{nombre_remitente} <{email_remitente}>" if nombre_remitente else email_remitente
        fecha_correo = imap_client.extraer_fecha(mensaje)
        texto_plano, texto_html = imap_client.extraer_textos(mensaje)
        texto_busqueda = "\n".join([asunto, texto_plano, html_a_texto(texto_html)])
        cuerpo_limpio = cuerpo_visible(texto_plano, texto_html)

        paso = "cotizacion"
        if es_cotizacion(asunto, texto_busqueda):
            if not dry_run:
                _registrar(message_id, asunto, remitente_completo, fecha_correo, "omitido_cotizacion")
            return ResultadoCorreo(
                resultado="omitido_cotizacion",
                mover_a_cotizar=True,
                mensajes_telegram=[telegram.msg_omitido_cotizacion(asunto, remitente_completo)],
                omitido_cotizacion_info=(remitente_completo, asunto),
            )

        paso = "filtrar_adjuntos"
        adjuntos_validos = filtrar_validos(imap_client.extraer_adjuntos(mensaje))
        if not adjuntos_validos:
            if not dry_run:
                _registrar(message_id, asunto, remitente_completo, fecha_correo, "omitido_sin_adjuntos")
            return ResultadoCorreo(resultado="omitido_sin_adjuntos")

        paso = "resolver_cliente"
        resuelto = resolver_cliente(email_remitente, nombre_remitente, texto_busqueda)
        if resuelto.nombre is None:
            if not dry_run:
                _registrar(message_id, asunto, remitente_completo, fecha_correo, "alerta_sin_regla", detalle=resuelto.alerta)
            return ResultadoCorreo(
                resultado="alerta_sin_regla",
                mensajes_telegram=[telegram.msg_alerta_alexander_sin_instruccion(asunto)],
            )

        mensajes_extra = []
        if resuelto.alerta:
            mensajes_extra.append(
                telegram.msg_alerta_remitente_no_identificado(asunto, remitente_completo, resuelto.nombre)
            )

        paso = "regla_graficas_modernas"
        if resuelto.flag == "filtra_orden":
            descartados = [a for a in adjuntos_validos if es_archivo_orden(a.nombre)]
            adjuntos_validos = [a for a in adjuntos_validos if not es_archivo_orden(a.nombre)]
            for adjunto in descartados:
                mensajes_extra.append(telegram.msg_omitido_orden(adjunto.nombre))
            if not adjuntos_validos:
                if not dry_run:
                    _registrar(message_id, asunto, remitente_completo, fecha_correo, "omitido_orden")
                return ResultadoCorreo(resultado="omitido_orden", mensajes_telegram=mensajes_extra)

        paso = "construir_tareas"
        tareas = _construir_tareas(resuelto.flag, texto_busqueda, adjuntos_validos)

        if dry_run:
            return ResultadoCorreo(
                resultado="ok",
                detalle=f"{len(tareas)} orden(es) simuladas",
                cliente_nombre=resuelto.nombre,
                mensajes_telegram=mensajes_extra,
            )

        paso = "crear_ordenes"
        ordenes, mensajes_confirmacion = _crear_ordenes(
            resuelto.nombre, resuelto.nota_cliente, tareas, cuerpo_limpio,
        )

        paso = "registrar_correo_procesado"
        _registrar(message_id, asunto, remitente_completo, fecha_correo, "ok", ordenes=ordenes)

        return ResultadoCorreo(
            resultado="ok",
            ordenes=ordenes,
            cliente_nombre=resuelto.nombre,
            mensajes_telegram=mensajes_extra + mensajes_confirmacion,
        )
    except Exception as exc:
        asunto_seguro = locals().get("asunto", "") or ""
        remitente_seguro = locals().get("remitente_completo", "") or ""
        fecha_seguro = locals().get("fecha_correo", None)
        if not dry_run:
            _registrar(message_id, asunto_seguro, remitente_seguro, fecha_seguro, "error", detalle=str(exc))
        return ResultadoCorreo(
            resultado="error",
            detalle=str(exc),
            marcar_procesado=False,
            mensajes_telegram=[telegram.msg_error(paso, asunto_seguro, remitente_seguro, str(exc))],
        )
