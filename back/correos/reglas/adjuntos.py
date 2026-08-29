"""Filtrado de adjuntos — sección 6.1 y regla de Graficas Modernas (6.6)."""
import os
import re
import unicodedata
from dataclasses import dataclass

EXTENSIONES_VALIDAS = {".pdf", ".ai", ".cdr"}


@dataclass
class Adjunto:
    nombre: str
    contenido: bytes


def _normalizar(texto):
    nfc = unicodedata.normalize("NFC", texto or "").lower()
    return "".join(c for c in unicodedata.normalize("NFD", nfc) if unicodedata.category(c) != "Mn")


def extension_valida(nombre_archivo):
    """Filtra por extensión del nombre de archivo, NUNCA por Content-Type MIME:
    los .cdr llegan como application/octet-stream y los .ai como
    application/postscript. El MIME no es confiable (spec 6.1)."""
    _, ext = os.path.splitext(nombre_archivo or "")
    return ext.lower() in EXTENSIONES_VALIDAS


def filtrar_validos(adjuntos):
    """adjuntos: iterable de Adjunto. Devuelve solo los de extensión válida."""
    return [a for a in adjuntos if extension_valida(a.nombre)]


_PATRON_ORDEN_FINAL = re.compile(r"(?:^|[_\-\s]+)orden$")


def es_archivo_orden(nombre_archivo):
    """True si el nombre (sin extensión) termina en la palabra "orden" —
    regla de Graficas Modernas (spec 6.6). Insensible a mayúsculas/tildes.
    Exige que "orden" sea el último token completo: "pedido_orden.pdf",
    "pedido-orden.pdf" y "pedido orden.pdf" descartan; "orden_de_compra.pdf"
    y "pedido_orden_v2.pdf" NO, porque la palabra no queda al final."""
    base, _ext = os.path.splitext(nombre_archivo or "")
    base = _normalizar(base).strip()
    return bool(_PATRON_ORDEN_FINAL.search(base))
