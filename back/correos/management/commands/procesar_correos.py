"""Batch diario que reemplaza el workflow n8n "Troqueles Upload Troquel Task
v1.8" (ver spec de migración). Pensado para correr una vez al día a las
7:00 AM hora de Bogotá vía Azure Container Apps Job — spec sección 12.3.

Un correo que falla no tumba el batch (spec 5.2): cada uid se procesa en su
propio try/except. Solo un fallo del proceso ENTERO (p. ej. no se puede
conectar al IMAP) hace que el comando salga con código distinto de cero y
mande la alerta de "el batch murió por completo".
"""
import json
import logging
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management.base import BaseCommand

from correos import imap_client, pipeline, telegram

logger = logging.getLogger(__name__)
BOGOTA = ZoneInfo("America/Bogota")


class Command(BaseCommand):
    help = (
        "Lee produccion@troquelesink.com por IMAP, resuelve el cliente de cada correo y "
        "crea las órdenes de troquel correspondientes. Reemplaza el workflow n8n."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=settings.BATCH_DRY_RUN,
            help=(
                "No escribe en base de datos, no sube archivos, no marca flags ni mueve "
                "correos. Imprime a stdout un JSON con lo que habría hecho."
            ),
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        try:
            resumen = self._ejecutar(dry_run)
        except Exception as exc:
            logger.exception("El batch procesar_correos murió por completo")
            telegram.notificar(f"❌ El batch procesar_correos falló por completo: {exc}")
            sys.exit(1)

        self.stdout.write(json.dumps(resumen, ensure_ascii=False, default=str, indent=2 if dry_run else None))

    def _ejecutar(self, dry_run):
        conn = imap_client.conectar()
        try:
            usar_keyword = imap_client.acepta_keywords_personalizados(conn)
            uids = imap_client.buscar_uids_recientes(conn, settings.BATCH_DIAS_ATRAS)

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
            if not dry_run:
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
