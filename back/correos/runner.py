"""Una corrida del lote de correos, extraída del management command para que
la puedan compartir `procesar_correos` (cron) y `escuchar_correos` (IDLE).

La lógica de negocio no vive aquí: este módulo solo recorre los uids, delega
en `pipeline.procesar_correo` y ejecuta las acciones de IMAP/Telegram que ese
resultado pide. Un correo que falla no tumba la corrida (spec 5.2): cada uid
va en su propio try/except.
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import close_old_connections

from correos import imap_client, pipeline, telegram
from correos.locking import lock_lote
from correos.models import CorreoProcesado

logger = logging.getLogger(__name__)
BOGOTA = ZoneInfo("America/Bogota")


def ejecutar_lote(dry_run=False, enviar_resumen=True, dias_atras=None):
    """Procesa el buzón y devuelve un resumen serializable.

    `enviar_resumen=False` calcula el resumen igual pero no lo manda a
    Telegram: el listener corre esto muchas veces al día y un "📊 Resumen ...
    revisados: 0" por cada correo entrante sería ruido. Los avisos por orden
    y las alertas sí salen siempre.
    """
    # El listener es un proceso de vida larga: la conexión a Postgres se cae
    # sola tras horas ociosas y Django no lo nota hasta el primer query.
    close_old_connections()

    if dry_run:
        # No escribe nada, así que no compite con nadie por el candado — y
        # tampoco tiene sentido que una corrida real le impida ensayar.
        return _ejecutar(dry_run=True, enviar_resumen=enviar_resumen, dias_atras=dias_atras)

    with lock_lote() as adquirido:
        if not adquirido:
            logger.info("Otra corrida del lote está en progreso; esta se salta")
            return {
                "dry_run": False,
                "omitido": "otra corrida en progreso",
                "revisados": 0,
                "ordenes_creadas": 0,
                "omitidos_cotizacion": [],
                "errores": 0,
                "correos": [],
            }
        return _ejecutar(dry_run=False, enviar_resumen=enviar_resumen, dias_atras=dias_atras)


def uids_pendientes(conn, uids):
    """Descarta los uids cuyo Message-ID ya está registrado como procesado,
    sin descargar el cuerpo de ninguno.

    Ante cualquier duda (el servidor no responde a la consulta de cabeceras,
    un correo sin Message-ID, un uid que no aparece en la respuesta) el uid se
    conserva: la verificación de verdad la hace `pipeline.correo_ya_procesado`
    más adelante, con el id definitivo. Esto es solo un atajo para no bajar
    megas de adjuntos que ya se procesaron.
    """
    if not uids:
        return []
    try:
        ids_por_uid = imap_client.message_ids_por_uid(conn, uids)
    except Exception:
        logger.warning("No se pudieron leer las cabeceras; se procesan todos los uids", exc_info=True)
        return list(uids)

    candidatos = {mid for mid in ids_por_uid.values() if mid}
    if not candidatos:
        return list(uids)

    ya_procesados = set(
        CorreoProcesado.objects.filter(message_id__in=candidatos)
        .exclude(resultado="error")
        .values_list("message_id", flat=True)
    )
    return [uid for uid in uids if ids_por_uid.get(uid) not in ya_procesados]


def _ejecutar(dry_run, enviar_resumen, dias_atras):
    if dias_atras is None:
        dias_atras = settings.BATCH_DIAS_ATRAS

    conn = imap_client.conectar()
    try:
        usar_keyword = imap_client.acepta_keywords_personalizados(conn)
        uids = uids_pendientes(conn, imap_client.buscar_uids_recientes(conn, dias_atras))

        revisados = 0
        ordenes_creadas = 0
        omitidos_cotizacion = []
        errores = 0
        detalle_correos = []

        for uid in uids:
            try:
                mensaje, tamano = imap_client.descargar_correo(conn, uid)
            except Exception:
                logger.exception("No se pudo descargar el correo uid=%s", uid)
                errores += 1
                continue

            message_id = imap_client.message_id_o_sintetico(mensaje, tamano)
            if pipeline.correo_ya_procesado(message_id):
                continue  # saltar en silencio — spec 5, paso b

            revisados += 1
            resultado = pipeline.procesar_correo(mensaje, message_id, dry_run=dry_run)

            if not dry_run:
                if resultado.marcar_procesado:
                    imap_client.marcar_procesado(conn, uid, usar_keyword=usar_keyword)
                if resultado.mover_a_cotizar:
                    imap_client.mover_a_carpeta(conn, uid, settings.IMAP_CARPETA_COTIZAR)
                for texto in resultado.mensajes_telegram:
                    telegram.notificar(texto)

            if resultado.resultado == "ok":
                ordenes_creadas += len(resultado.ordenes)
            elif resultado.resultado == "omitido_cotizacion" and resultado.omitido_cotizacion_info:
                omitidos_cotizacion.append(resultado.omitido_cotizacion_info)
            elif resultado.resultado == "error":
                errores += 1

            uid_texto = uid.decode() if isinstance(uid, bytes) else str(uid)
            detalle_correos.append({
                "uid": uid_texto,
                "message_id": message_id,
                "resultado": resultado.resultado,
                "detalle": resultado.detalle,
                "ordenes": resultado.ordenes,
                "cliente": resultado.cliente_nombre,
                "telegram": resultado.mensajes_telegram,
            })

        ahora = datetime.now(BOGOTA)
        texto_resumen = telegram.msg_resumen(
            ahora.strftime("%Y-%m-%d %H:%M"), revisados, ordenes_creadas, omitidos_cotizacion, errores,
        )
        if not dry_run and enviar_resumen:
            telegram.notificar(texto_resumen)

        return {
            "dry_run": dry_run,
            "revisados": revisados,
            "ordenes_creadas": ordenes_creadas,
            "omitidos_cotizacion": omitidos_cotizacion,
            "errores": errores,
            "correos": detalle_correos,
        }
    finally:
        try:
            conn.logout()
        except Exception:
            logger.warning("No se pudo cerrar la conexión IMAP limpiamente", exc_info=True)
