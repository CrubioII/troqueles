"""Notificaciones a Telegram — spec sección 9. Mismo bot/token/chat que hoy.

`notificar()` nunca debe abortar el batch: un fallo de red o de config solo
se registra como warning. La notificación de error (msg_error) es requisito
fijo del proyecto — debe emitirse pase lo que pase con el resto del correo.
"""
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


def notificar(texto):
    """Texto plano, sin parse_mode: el cuerpo del correo puede traer
    caracteres que rompen Markdown/HTML."""
    if not settings.TELEGRAM_TOKEN or not settings.TELEGRAM_CHAT_ID:
        logger.warning("TELEGRAM_TOKEN/TELEGRAM_CHAT_ID no configurados; mensaje omitido: %s", texto[:80])
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{settings.TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": settings.TELEGRAM_CHAT_ID, "text": texto},
            timeout=10,
        )
    except Exception:
        logger.warning("Fallo enviando notificación a Telegram", exc_info=True)


def msg_confirmacion(numero_op, cliente_nombre, fecha, referencia, cuerpo_limpio, nota_cliente=""):
    lineas = [
        f"✅ Troquel subido: {numero_op}",
        f"Cliente: {cliente_nombre}",
        f"Fecha: {fecha}",
        f"Referencia: {referencia}",
    ]
    if nota_cliente:
        lineas.append(f"📝 Instrucción: {nota_cliente}")
    lineas.append("")
    lineas.append("📩 Mensaje original del remitente:")
    lineas.append(cuerpo_limpio)
    return "\n".join(lineas)


def msg_omitido_cotizacion(asunto, remitente):
    return (
        f"🏷️ Omitido (cotización): {asunto}\n"
        f"De: {remitente}\n"
        "Movido a la carpeta Cotizar. No se creó ninguna orden."
    )


def msg_omitido_orden(nombre_archivo):
    return f"📄 Omitido (archivo de orden): {nombre_archivo}\nDe: Graficas Modernas"


def msg_alerta_alexander_sin_instruccion(asunto):
    return (
        "⚠️ Correo de Alexander sin instrucción de cliente\n"
        f"Asunto: {asunto}\n"
        "No se creó ninguna orden. Revisar manualmente."
    )


def msg_alerta_remitente_no_identificado(asunto, remitente, cliente_nombre):
    """No está en la lista explícita de plantillas de la sección 9, pero el
    Paso 6 de reglas/clientes.py (remitente sin nombre legible, cliente
    "Unresolved") también necesita avisar al Admin. La orden SÍ se crea (a
    diferencia del caso de Alexander, cuyo CorreoProcesado.resultado es
    literalmente 'alerta_sin_regla' — spec 4.1); esto es solo para que
    alguien revise el nombre de cliente resultante."""
    return (
        f"⚠️ Cliente sin regla clara: {cliente_nombre}\n"
        f"Asunto: {asunto}\n"
        f"De: {remitente}\n"
        "Se creó la orden de todos modos. Revisar el nombre del cliente."
    )


def msg_error(paso, asunto, remitente, error):
    return (
        "❌ Error procesando correo\n"
        f"Paso: {paso}\n"
        f"Asunto: {asunto}\n"
        f"Remitente: {remitente}\n"
        f"Error: {error}"
    )


def msg_resumen(fecha_hora, revisados, ordenes_creadas, omitidos_cotizacion, errores):
    """omitidos_cotizacion: lista de (remitente, asunto)."""
    lineas = [
        f"📊 Resumen {fecha_hora}",
        f"Correos revisados: {revisados}",
        f"Órdenes creadas: {ordenes_creadas}",
        f"Omitidos por cotización: {len(omitidos_cotizacion)}",
    ]
    for remitente, asunto in omitidos_cotizacion:
        lineas.append(f'  • {remitente} — "{asunto}"')
    lineas.append(f"Errores: {errores}")
    return "\n".join(lineas)
