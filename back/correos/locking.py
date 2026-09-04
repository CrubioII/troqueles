"""Candado para que solo una corrida del lote de correos esté viva a la vez.

Desde que el listener IDLE (`escuchar_correos`) procesa en cuanto llega un
correo, hay tres fuentes que pueden disparar el lote al mismo tiempo: el
listener, el cron de red de seguridad y el cron diario. La deduplicación de
`pipeline.correo_ya_procesado` NO alcanza para eso: el `CorreoProcesado` se
graba *después* de crear las órdenes, así que dos corridas simultáneas pueden
pasar ambas la verificación antes de que cualquiera escriba y crear la orden
dos veces.

Se usa un advisory lock de Postgres (a nivel de sesión, no de transacción)
porque no requiere tabla ni migración y se libera solo si el proceso muere.
En sqlite —desarrollo local y tests— no hay equivalente y no hace falta: el
candado se vuelve un no-op.
"""
import logging
from contextlib import contextmanager

from django.db import connection

logger = logging.getLogger(__name__)

# Constante arbitraria pero fija: identifica *este* candado dentro del espacio
# global de advisory locks de la base. No cambiar sin cambiarla en todos lados.
LOCK_LOTE_CORREOS = 74010531


@contextmanager
def lock_lote():
    """Cede True si esta corrida tomó el candado, False si ya hay otra viva.

    Nunca bloquea esperando: si otra corrida está en curso, la de ahora se
    salta. No se pierde nada — la ventana de búsqueda IMAP es de varios días
    y la otra corrida ve los mismos correos.
    """
    if connection.vendor != "postgresql":
        yield True
        return

    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [LOCK_LOTE_CORREOS])
        adquirido = bool(cursor.fetchone()[0])

    try:
        yield adquirido
    finally:
        if adquirido:
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_unlock(%s)", [LOCK_LOTE_CORREOS])
            except Exception:
                # Si la conexión ya murió, Postgres libera el candado solo.
                logger.warning("No se pudo liberar el advisory lock del lote", exc_info=True)
