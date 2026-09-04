"""Listener IMAP IDLE: procesa cada correo a los segundos de que llega.

Reemplaza la latencia de la corrida diaria (hasta 24 h) por una de segundos.
El problema que resuelve no es técnico sino de negocio: la urgencia de un
troquel se decide por fuera del correo (llamada, WhatsApp, contexto), así que
no hay forma de detectarla y priorizarla — la única salida es que TODO entre
a la cola enseguida.

Spacemail no tiene webhooks ni API de push; IDLE (RFC 2177) es el único
mecanismo de empuje disponible: se mantiene una conexión abierta y el
servidor avisa cuando entra un mensaje.

Ciclo: IDLE → (novedad o timeout) → lote → reconectar. Se reconecta después
de CADA lote a propósito: el lote hace STORE/COPY/EXPUNGE por su propia
conexión y esta recibiría esas respuestas sin etiqueta como falsas novedades.

El lote es el mismo que corre el cron (`correos/runner.py`), con el candado
de `correos/locking.py` protegiendo el solape entre ambos.
"""
import logging
import signal
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management.base import BaseCommand

from correos import imap_client, telegram
from correos.runner import ejecutar_lote

logger = logging.getLogger(__name__)
BOGOTA = ZoneInfo("America/Bogota")

BACKOFF_INICIAL = 5
# A partir de este tiempo acumulado sin poder conectar se avisa por Telegram.
UMBRAL_ALERTA_SEGUNDOS = 300


class Command(BaseCommand):
    help = (
        "Mantiene una conexión IMAP IDLE contra produccion@troquelesink.com y ejecuta el "
        "lote de procesamiento en cuanto llega un correo."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--una-vez",
            action="store_true",
            help="Un solo ciclo (esperar novedad + procesar) y salir. Para pruebas.",
        )

    def handle(self, *args, **options):
        self.una_vez = options["una_vez"]
        self.detener = False
        signal.signal(signal.SIGTERM, self._pedir_parada)
        signal.signal(signal.SIGINT, self._pedir_parada)

        conn = None
        espera = BACKOFF_INICIAL
        caido_desde = None
        alerta_enviada = False

        self._log("Listener de correos iniciado")
        while not self.detener:
            try:
                if conn is None:
                    conn = imap_client.conectar()
                    self._log(f"Conectado a {settings.IMAP_HOST} como {settings.IMAP_USER}")
                    if caido_desde is not None:
                        if alerta_enviada:
                            telegram.notificar("✅ El listener de correos volvió a conectarse.")
                        caido_desde = None
                        alerta_enviada = False
                    espera = BACKOFF_INICIAL

                novedad = self._esperar(conn)
                if self.detener:
                    break
                if novedad:
                    # Margen para que una entrega multiparte termine de
                    # asentarse en el buzón antes de leerla.
                    time.sleep(settings.IMAP_IDLE_GRACIA)

                self._procesar(motivo="novedad" if novedad else "timeout")

                # Conexión nueva para el siguiente IDLE (ver docstring).
                conn = self._cerrar(conn)
                if self.una_vez:
                    break
            except Exception as exc:
                logger.exception("Fallo en el ciclo del listener")
                self._log(f"Error: {exc} — reintentando en {espera}s")
                conn = self._cerrar(conn)
                if self.una_vez:
                    break
                if caido_desde is None:
                    caido_desde = time.monotonic()
                elif not alerta_enviada and time.monotonic() - caido_desde >= UMBRAL_ALERTA_SEGUNDOS:
                    telegram.notificar(
                        f"⚠️ El listener de correos lleva varios minutos sin conectarse al IMAP.\n"
                        f"Último error: {exc}\n"
                        "El cron de respaldo sigue procesando el buzón cada media hora."
                    )
                    alerta_enviada = True
                self._dormir(espera)
                espera = min(espera * 2, settings.LISTENER_BACKOFF_MAX)

        self._cerrar(conn)
        self._log("Listener de correos detenido")

    def _esperar(self, conn):
        """True si el servidor avisó de un correo nuevo, False si venció el
        tiempo de espera. En ambos casos el llamador procesa el buzón: el
        lote con prefiltro de cabeceras es barato y así un aviso perdido
        cuesta minutos, no un día."""
        if not imap_client.soporta_idle(conn):
            self._log("El servidor no anuncia IDLE; se cae a sondeo periódico")
            self._dormir(settings.IMAP_IDLE_TIMEOUT)
            return False
        return imap_client.esperar_novedad(conn, settings.IMAP_IDLE_TIMEOUT)

    def _procesar(self, motivo):
        resumen = ejecutar_lote(enviar_resumen=False)
        if resumen.get("omitido"):
            self._log(f"Lote ({motivo}) omitido: {resumen['omitido']}")
            return
        self._log(
            f"Lote ({motivo}): revisados={resumen['revisados']} "
            f"órdenes={resumen['ordenes_creadas']} errores={resumen['errores']}"
        )

    def _cerrar(self, conn):
        if conn is not None:
            try:
                conn.logout()
            except Exception:
                logger.warning("No se pudo cerrar la conexión IMAP limpiamente", exc_info=True)
        return None

    def _dormir(self, segundos):
        """Duerme en tramos cortos para reaccionar rápido a un SIGTERM (el
        contenedor no espera indefinidamente en un redeploy)."""
        fin = time.monotonic() + segundos
        while not self.detener and time.monotonic() < fin:
            time.sleep(min(1, fin - time.monotonic()))

    def _pedir_parada(self, *_args):
        self.detener = True

    def _log(self, texto):
        marca = datetime.now(BOGOTA).strftime("%Y-%m-%d %H:%M:%S")
        self.stdout.write(f"[{marca}] {texto}")
        self.stdout.flush()
