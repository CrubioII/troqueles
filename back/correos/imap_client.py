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
"""
import email
import hashlib
import imaplib
import logging
import re
from datetime import datetime, timedelta
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime

from django.conf import settings

from correos.reglas.adjuntos import Adjunto

logger = logging.getLogger(__name__)

_PATRON_ESPACIO_ADJUNTO = re.compile(r"\s+")


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


def buscar_uids_recientes(conn, dias_atras):
    desde = (datetime.now() - timedelta(days=dias_atras)).strftime("%d-%b-%Y")
    status, data = conn.uid("SEARCH", None, f"(SINCE {desde})")
    if status != "OK":
        raise ImapError(f"Búsqueda IMAP falló: {status}")
    if not data or not data[0]:
        return []
    return data[0].split()


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
