"""Conteo/split de PDF (regla de Impresos Richard, spec 6.5) y utilidades de
nombre de archivo (límite de 100 caracteres del campo `archivo`, spec 8)."""
import io
import os

from pypdf import PdfReader, PdfWriter


class PdfProcesamientoError(Exception):
    """El PDF no se pudo leer o dividir (corrupto, cifrado, sin páginas).

    Nunca capturar esto para caer en un fallback silencioso a "1 orden" — es
    exactamente el tipo de error que produjo OP-0550 y OP-0557: un resultado
    plausible pero equivocado. El correo debe registrarse como error y
    reintentarse tras arreglar el problema (ver pipeline.py)."""


def contar_paginas(contenido_pdf):
    try:
        lector = PdfReader(io.BytesIO(contenido_pdf))
        if lector.is_encrypted:
            raise PdfProcesamientoError("El PDF está cifrado")
        return len(lector.pages)
    except PdfProcesamientoError:
        raise
    except Exception as exc:
        raise PdfProcesamientoError(f"No se pudo leer el PDF: {exc}") from exc


def dividir_pdf(contenido_pdf):
    """Devuelve una lista de bytes (un PDF de una sola página por elemento),
    en el mismo orden que el PDF original."""
    try:
        lector = PdfReader(io.BytesIO(contenido_pdf))
        if lector.is_encrypted:
            raise PdfProcesamientoError("El PDF está cifrado")
        paginas = []
        for pagina in lector.pages:
            escritor = PdfWriter()
            escritor.add_page(pagina)
            buffer = io.BytesIO()
            escritor.write(buffer)
            paginas.append(buffer.getvalue())
        if not paginas:
            raise PdfProcesamientoError("El PDF no tiene páginas")
        return paginas
    except PdfProcesamientoError:
        raise
    except Exception as exc:
        raise PdfProcesamientoError(f"No se pudo dividir el PDF: {exc}") from exc


def referencia_pagina_richard(numero_pagina, nombre_archivo):
    """"TROQUEL {n} - {nombre sin extensión}" — spec 6.5."""
    base, _ext = os.path.splitext(nombre_archivo or "")
    return f"TROQUEL {numero_pagina} - {base}"


def truncar_nombre_archivo(nombre, max_length=100):
    """Recorta `nombre` a `max_length` conservando la extensión (corta desde
    el frente de la parte descriptiva, nunca desde el final)."""
    nombre = nombre or ""
    if len(nombre) <= max_length:
        return nombre
    base, ext = os.path.splitext(nombre)
    disponible = max_length - len(ext)
    if disponible < 1:
        return nombre[-max_length:]
    return f"{base[:disponible]}{ext}"


def nombre_archivo_pagina(nombre_original, numero_pagina, max_length=100):
    """Nombre de archivo para la página `numero_pagina` de un split de Richard.

    Cuidado con el límite de 100 caracteres del campo `archivo`: si se
    recorta el nombre completo por el final sin cuidado, se pierde el
    sufijo "_pN" y las N páginas colisionan en el mismo nombre. Aquí el
    sufijo de página + extensión se conservan siempre; solo se recorta la
    parte descriptiva del nombre original."""
    base, ext = os.path.splitext(nombre_original or "")
    sufijo = f"_p{numero_pagina}{ext}"
    disponible = max_length - len(sufijo)
    base_recortada = base[:disponible] if disponible > 0 else ""
    return f"{base_recortada}{sufijo}"[-max_length:]
