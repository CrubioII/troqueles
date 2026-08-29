"""Limpieza del cuerpo del correo.

Hay dos usos distintos del cuerpo de un correo y no se deben confundir:
- texto de búsqueda (armado en pipeline.py: asunto + texto plano + HTML como
  texto, sin pasar por limpiar_cuerpo): solo para detectar instrucciones
  ("Cliente:", "Cotizar", "Troquel: nnnn"). Nunca se muestra.
- cuerpo visible: el más largo entre texto plano y HTML convertido a texto,
  pasado por limpiar_cuerpo(). Es lo que va a `observaciones` y a Telegram.
"""
import html
import re
from html.parser import HTMLParser

MARCADORES_CORTE = [
    r'cordial\s+saludo',
    r'cordialmente',
    r'atentamente',
    r'saludos\s+cordiales',
    r'^\s*saludos[,.]?\s*$',
    r'enviado desde mi (iphone|android|celular)',
    r'get outlook for',
    r'compart[ií]o una carpeta contigo',
    r'this message may contain confidential',
    r'este correo electr[oó]nico se genera',
    r'^--\s*$',
]

_MARCADORES_COMPILADOS = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in MARCADORES_CORTE]

_TAGS_BLOQUE = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table"}


class _ExtractorTexto(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._partes = []
        self._omitir = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._omitir += 1
        elif tag in _TAGS_BLOQUE:
            self._partes.append("\n")

    def handle_startendtag(self, tag, attrs):
        if tag in _TAGS_BLOQUE:
            self._partes.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._omitir:
            self._omitir -= 1
        elif tag in _TAGS_BLOQUE:
            self._partes.append("\n")

    def handle_data(self, data):
        if not self._omitir:
            self._partes.append(data)

    def texto(self):
        return "".join(self._partes)


def html_a_texto(contenido_html):
    """Convierte HTML a texto plano, preservando saltos de línea de bloque."""
    if not contenido_html:
        return ""
    parser = _ExtractorTexto()
    parser.feed(contenido_html)
    parser.close()
    texto = html.unescape(parser.texto())
    lineas = [re.sub(r"[ \t]+", " ", linea).strip() for linea in texto.split("\n")]
    return "\n".join(linea for linea in lineas if linea)


def _primer_corte(texto):
    posiciones = [m.start() for patron in _MARCADORES_COMPILADOS for m in [patron.search(texto)] if m]
    return min(posiciones) if posiciones else None


def _postprocesar(texto):
    lineas = [linea.rstrip() for linea in texto.split("\n")]
    texto = "\n".join(lineas)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    texto = re.sub(r"[ \t]{2,}", " ", texto)
    return texto.strip()


def limpiar_cuerpo(texto):
    """Corta el cuerpo en el primer marcador de firma/boilerplate y limpia el resultado.

    Salvaguarda: si el recorte deja el cuerpo vacío, devuelve el texto original
    (limpio pero sin recortar) — nunca observaciones vacías.
    """
    if not texto:
        return ""
    corte = _primer_corte(texto)
    recortado = texto[:corte] if corte is not None else texto
    resultado = _postprocesar(recortado)
    if resultado:
        return resultado
    return _postprocesar(texto)


def cuerpo_visible(texto_plano, html_crudo):
    """El más largo entre texto plano y HTML-a-texto, ya limpio."""
    candidato_html = html_a_texto(html_crudo)
    base = texto_plano if len(texto_plano or "") >= len(candidato_html) else candidato_html
    return limpiar_cuerpo(base)
