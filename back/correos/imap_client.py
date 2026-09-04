"""Cliente IMAP (Spacemail) — spec sección 7.

Puntos críticos que este módulo existe para no equivocar:
- BODY.PEEK[] para descargar, nunca RFC822 ni BODY[] (marcan \\Seen como
  efecto colateral — spec 7.1, "el punto más fácil de equivocar").
- Parseo MIME con la stdlib `email`, que recoge todos los bloques de texto
  (no solo el último, a diferencia del nodo n8n que reemplaza — spec 7.3) y
  resuelve el boundary del Content-Type correctamente sin que haya que
  tocarlo a mano.
- El keyword `procesado` es cosmético: si el STORE falla, se registra un
  warning y se continúa. La corrección real vive en CorreoProcesado
  (correos/models.py), no en el estado del servidor IMAP.
- IDLE (RFC 2177) se implementa a mano sobre `imaplib`: Python 3.11 no trae
  `IMAP4.idle()`. Spacemail no ofrece webhooks, así que esta es la única vía
  de "empuje" real — ver `esperar_novedad`.
"""
import email
import hashlib
import imaplib
import logging
import re
import select
import time
from datetime import datetime, timedelta
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime

from django.conf import settings

from correos.reglas.adjuntos import Adjunto

logger = logging.getLogger(__name__)

_PATRON_ESPACIO_ADJUNTO = re.compile(r"\s+")
_PATRON_UID_RESPUESTA = re.compile(rb"UID\s+(\d+)")
_PATRON_NOVEDAD = re.compile(rb"^\*\s+\d+\s+(EXISTS|RECENT)", re.IGNORECASE)


class ImapError(Exception):
    pass


def conectar():
    conn = imaplib.IMAP4_SSL(settings.IMAP_HOST, settings.IMAP_PORT)
    conn.login(settings.IMAP_USER, settings.IMAP_PASSWORD)
    status, _ = conn.select("INBOX")
    if status != "OK":
        raise ImapError("No se pudo seleccionar INBOX")
    return conn


def acepta_keywords_personalizados(conn):
    """True si el servidor soporta keywords IMAP arbitrarios (PERMANENTFLAGS
    trae \\*). Define si se usa el keyword `procesado` o el flag \\Flagged
    como respaldo — ver paso manual M1 en la especificación de migración."""
    flags = conn.untagged_responses.get("PERMANENTFLAGS", [])
    return any(b"\\*" in linea for linea in flags)


def soporta_idle(conn):
    """True si el servidor anuncia IDLE en su CAPABILITY."""
    capacidades = getattr(conn, "capabilities", ()) or ()
    normalizadas = {
        (c.decode("ascii", "ignore") if isinstance(c, bytes) else str(c)).upper()
        for c in capacidades
    }
    return "IDLE" in normalizadas


def _hay_datos(sock, timeout):
    # `pending()` solo existe en sockets SSL: son datos ya descifrados que
    # select() no ve.
    pending = getattr(sock, "pending", None)
    if pending and pending() > 0:
        return True
    listos, _, _ = select.select([sock], [], [], max(timeout, 0))
    return bool(listos)


def esperar_novedad(conn, timeout_segundos):
    """Bloquea en IDLE hasta que el servidor avise de un mensaje nuevo.

    True  = el servidor mandó EXISTS/RECENT (llegó algo).
    False = se venció `timeout_segundos` sin novedad.
    ImapError = la sesión se cayó (el llamador debe reconectar).

    Python 3.11 no trae `imaplib.IMAP4.idle()`, así que se usa la API interna
    de imaplib (`_new_tag`, `tagged_commands`, `_get_tagged_response`). Está
    contenido a esta función a propósito: es el único punto del proyecto que
    depende de ella. El tag hay que registrarlo a mano en `tagged_commands`
    porque normalmente lo hace `_command()`, que aquí se está saltando, y sin
    ese registro `_get_tagged_response` revienta con KeyError.

    Se espera con select() sobre el socket en vez de ponerle timeout: un
    timeout a mitad de lectura deja el BufferedReader de imaplib en un estado
    del que no se puede seguir leyendo, y después del timeout todavía hay que
    mandar DONE y leer la respuesta etiquetada.

    El DONE del `finally` es obligatorio: sin él la conexión queda en un
    estado en el que el servidor rechaza cualquier otro comando.
    """
    sock = conn.socket()
    tag = conn._new_tag()
    conn.tagged_commands[tag] = None
    conn.send(b"%s IDLE\r\n" % tag)

    hay_novedad = False
    try:
        # Antes de la confirmación (`+ idling`) el servidor puede colar
        # respuestas sin etiqueta, incluido el aviso que se está esperando.
        while True:
            linea = conn.readline()
            if not linea:
                raise ImapError("El servidor cerró la conexión al iniciar IDLE")
            if linea.startswith(b"+"):
                break
            if not linea.startswith(b"*"):
                raise ImapError(f"El servidor no aceptó IDLE: {linea!r}")
            if _PATRON_NOVEDAD.match(linea):
                hay_novedad = True
    except Exception:
        conn.tagged_commands.pop(tag, None)
        raise

    # Si el aviso ya llegó durante el saludo no hay nada que esperar: se cierra
    # el IDLE de una vez.
    fin = time.monotonic() + (0 if hay_novedad else timeout_segundos)
    try:
        while True:
            restante = fin - time.monotonic()
            if restante <= 0 or not _hay_datos(sock, restante):
                break
            linea = conn.readline()
            if not linea:
                raise ImapError("El servidor cerró la conexión durante IDLE")
            if linea.startswith(b"*") and b"BYE" in linea.upper():
                raise ImapError(f"El servidor terminó la sesión durante IDLE: {linea!r}")
            if _PATRON_NOVEDAD.match(linea):
                hay_novedad = True
                break
    finally:
        try:
            conn.send(b"DONE\r\n")
            conn._get_tagged_response(tag)
        except Exception:
            logger.warning("No se pudo cerrar el IDLE limpiamente", exc_info=True)
        finally:
            conn.tagged_commands.pop(tag, None)

    return hay_novedad


def buscar_uids_recientes(conn, dias_atras):
    desde = (datetime.now() - timedelta(days=dias_atras)).strftime("%d-%b-%Y")
    status, data = conn.uid("SEARCH", None, f"(SINCE {desde})")
    if status != "OK":
        raise ImapError(f"Búsqueda IMAP falló: {status}")
    if not data or not data[0]:
        return []
    return data[0].split()


def message_ids_por_uid(conn, uids):
    """{uid: message_id} pidiendo SOLO la cabecera Message-ID de cada correo.

    Existe para no descargar cuerpos que ya se procesaron: con el listener
    IDLE el lote corre cada vez que llega un correo, y descargar con
    BODY.PEEK[] todos los mensajes de la ventana de BATCH_DIAS_ATRAS (con sus
    adjuntos) en cada disparo sería absurdo.

    Un uid puede faltar en el resultado o traer "" — eso significa "no sé",
    y quien llame DEBE tratarlo como pendiente y descargarlo completo. Este
    prefiltro solo puede ahorrar trabajo ya hecho, nunca decidir por sí solo
    que un correo está procesado (el id sintético de los correos sin
    Message-ID depende del tamaño real del cuerpo — ver
    `message_id_o_sintetico`).
    """
    if not uids:
        return {}

    lista = b",".join(uid if isinstance(uid, bytes) else str(uid).encode() for uid in uids)
    status, data = conn.uid("FETCH", lista, "(UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
    if status != "OK" or not data:
        raise ImapError(f"No se pudieron leer las cabeceras: {status}")

    ids = {}
    for item in data:
        if not isinstance(item, tuple) or len(item) < 2:
            continue  # el b')' de cierre que imaplib intercala
        prefijo, cabeceras = item[0], item[1]
        coincidencia = _PATRON_UID_RESPUESTA.search(prefijo or b"")
        if not coincidencia:
            continue
        mensaje = email.message_from_bytes(cabeceras or b"")
        ids[coincidencia.group(1)] = extraer_message_id(mensaje)
    return ids


def descargar_correo(conn, uid):
    """Devuelve el email.message.Message parseado, SIN marcar \\Seen."""
    status, data = conn.uid("FETCH", uid, "(BODY.PEEK[])")
    if status != "OK" or not data or data[0] is None:
        raise ImapError(f"No se pudo descargar el correo uid={uid}: {status}")
    crudo = data[0][1]
    return email.message_from_bytes(crudo), len(crudo)


def asegurar_no_leido(conn, uid):
    try:
        conn.uid("STORE", uid, "-FLAGS", "(\\Seen)")
    except Exception:
        logger.warning("No se pudo quitar \\Seen del correo uid=%s", uid, exc_info=True)


def marcar_procesado(conn, uid, usar_keyword=True):
    flag = "procesado" if usar_keyword else "\\Flagged"
    try:
        conn.uid("STORE", uid, "+FLAGS", f"({flag})")
    except Exception:
        logger.warning("No se pudo marcar como procesado (%s) el correo uid=%s", flag, uid, exc_info=True)
    asegurar_no_leido(conn, uid)


def mover_a_carpeta(conn, uid, carpeta):
    """Si el MOVE/COPY falla, se registra un warning y se continúa — no se
    aborta el correo por esto (spec 7.4)."""
    try:
        status, _ = conn.uid("COPY", uid, carpeta)
        if status != "OK":
            raise ImapError(f"COPY a {carpeta} falló: {status}")
        conn.uid("STORE", uid, "+FLAGS", "(\\Deleted)")
        conn.expunge()
    except Exception:
        logger.warning("No se pudo mover el correo uid=%s a %s", uid, carpeta, exc_info=True)


def _decodificar_header(valor):
    if not valor:
        return ""
    partes = decode_header(valor)
    resultado = []
    for texto, codificacion in partes:
        if isinstance(texto, bytes):
            resultado.append(texto.decode(codificacion or "utf-8", errors="replace"))
        else:
            resultado.append(texto)
    return "".join(resultado)


def extraer_remitente(mensaje):
    """(nombre_decodificado, direccion_email) a partir del header From."""
    nombre, direccion = parseaddr(mensaje.get("From", ""))
    return _decodificar_header(nombre), direccion


def extraer_asunto(mensaje):
    return _decodificar_header(mensaje.get("Subject", ""))


def extraer_message_id(mensaje):
    return (mensaje.get("Message-ID") or "").strip()


def message_id_o_sintetico(mensaje, tamano_bytes):
    """Fallback determinístico cuando el correo no trae Message-ID (spec 4.1)."""
    mid = extraer_message_id(mensaje)
    if mid:
        return mid
    base = f"{mensaje.get('From', '')}|{mensaje.get('Date', '')}|{mensaje.get('Subject', '')}|{tamano_bytes}"
    return "synth:" + hashlib.sha256(base.encode("utf-8", errors="replace")).hexdigest()


def extraer_fecha(mensaje):
    crudo = mensaje.get("Date")
    if not crudo:
        return None
    try:
        return parsedate_to_datetime(crudo)
    except (TypeError, ValueError):
        return None


def _decodificar_parte_texto(parte):
    payload = parte.get_payload(decode=True)
    if payload is None:
        return ""
    charset = parte.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except (LookupError, TypeError):
        return payload.decode("utf-8", errors="replace")


def extraer_textos(mensaje):
    """(texto_plano, texto_html) concatenando TODOS los bloques de cada tipo.

    Bug real del nodo n8n que esto reemplaza: el ciclo se quedaba con el
    último bloque text/plain y perdía "Cliente: xxx" en correos de iPhone,
    que parten el texto en dos bloques alrededor del adjunto inline."""
    partes_plano, partes_html = [], []
    for parte in mensaje.walk():
        if parte.get_content_maintype() == "multipart":
            continue
        disposicion = str(parte.get("Content-Disposition") or "").lower()
        if "attachment" in disposicion:
            continue
        tipo = parte.get_content_type()
        if tipo == "text/plain":
            partes_plano.append(_decodificar_parte_texto(parte))
        elif tipo == "text/html":
            partes_html.append(_decodificar_parte_texto(parte))
    return "\n".join(partes_plano), "\n".join(partes_html)


def extraer_adjuntos(mensaje):
    """Todo adjunto con nombre de archivo (filtrar por extensión es
    responsabilidad de reglas/adjuntos.py, no de este módulo).

    Algunos clientes de correo pliegan el header Content-Disposition en
    varias líneas y el nombre decodificado queda con un salto de línea
    incrustado a la mitad (visto en un correo real de Gráficas Modernas).
    Se colapsa todo espacio en blanco a uno solo para que ese nombre sea
    seguro de usar como referencia de la orden y como nombre de archivo."""
    adjuntos = []
    for parte in mensaje.walk():
        if parte.get_content_maintype() == "multipart":
            continue
        nombre = parte.get_filename()
        if not nombre:
            continue
        contenido = parte.get_payload(decode=True)
        if contenido is None:
            continue
        nombre_limpio = _PATRON_ESPACIO_ADJUNTO.sub(" ", _decodificar_header(nombre)).strip()
        adjuntos.append(Adjunto(nombre=nombre_limpio, contenido=contenido))
    return adjuntos
