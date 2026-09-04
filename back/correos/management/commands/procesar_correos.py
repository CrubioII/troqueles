"""Corrida puntual del lote de correos: la que dispara el cron.

Desde que existe `escuchar_correos` (listener IMAP IDLE, que procesa cada
correo a los segundos de llegar) este comando cumple dos papeles:

- red de seguridad cada media hora, con `--no-resumen`, por si el listener
  está caído o el servidor no mandó la notificación;
- corrida diaria con el resumen de Telegram que el Admin ya recibe.

El trabajo real vive en `correos/runner.py`, compartido con el listener. Un
correo que falla no tumba el lote (spec 5.2); solo un fallo del proceso ENTERO
(p. ej. no se puede conectar al IMAP) hace que el comando salga con código
distinto de cero y mande la alerta de "el batch murió por completo".
"""
import json
import logging
import sys

from django.conf import settings
from django.core.management.base import BaseCommand

from correos import telegram
from correos.runner import ejecutar_lote

logger = logging.getLogger(__name__)


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
        parser.add_argument(
            "--no-resumen",
            action="store_true",
            help=(
                "No manda el resumen del lote a Telegram. Para las corridas frecuentes "
                "de red de seguridad, que si no llenarían el chat de 'revisados: 0'."
            ),
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        try:
            resumen = ejecutar_lote(dry_run=dry_run, enviar_resumen=not options["no_resumen"])
        except Exception as exc:
            logger.exception("El batch procesar_correos murió por completo")
            telegram.notificar(f"❌ El batch procesar_correos falló por completo: {exc}")
            sys.exit(1)

        self.stdout.write(json.dumps(resumen, ensure_ascii=False, default=str, indent=2 if dry_run else None))
