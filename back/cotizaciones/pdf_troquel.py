"""Extrae los datos técnicos del PDF de modelo de troquel (formato del proveedor).

Nota: en los PDFs reales de este proveedor, las etiquetas fijas del template
(Pinza, Madera, Cuchilla, Material, "(NO Hacer espejo)") suelen venir como
texto convertido a curvas/paths (artwork vectorial), no como texto
seleccionable — pdfplumber no puede leerlas directo del PDF. Por eso:

1. Primero se lee la capa de texto real del PDF (rápido, exacto) para
   Referencia, Troquel y los cm lineales (Corte/Score/Hendido).
2. Para lo que falte (típicamente Pinza/Madera/Cuchilla/Material/espejo) se
   renderiza la página a imagen y se corre OCR (tesseract) como respaldo.
"""
import io
import re

import pdfplumber
import pytesseract
from pdf2image import convert_from_bytes

_LABEL_PATTERNS = {
    "referencia": re.compile(r"^Referencia:\s*(.+)$", re.IGNORECASE),
    "troquel": re.compile(r"^Troquel:\s*(.+)$", re.IGNORECASE),
    "pinza": re.compile(r"^Pinza:\s*(.+)$", re.IGNORECASE),
    "madera": re.compile(r"^Madera:\s*(.+)$", re.IGNORECASE),
    "cuchilla": re.compile(r"^Cuchilla:\s*(.+)$", re.IGNORECASE),
    "material": re.compile(r"^Material:\s*(.+)$", re.IGNORECASE),
}

# Orden de aparición de las filas "Cm Lineales: Nmm" en el template: CORTE, SCORE, (HENDIDO).
_CM_LINEALES_ORDER = ["corte_cm", "score_cm", "hendido_cm"]

_CM_LINEALES_RE = re.compile(r"Cm\s+Lineales:\s*([\d.,]+)\s*mm", re.IGNORECASE)

# En el OCR, dos columnas a veces caen en el mismo renglón (ej. "Madera: 18 mm SCORE ... Cm
# Lineales: ...mm"); el valor se corta antes de que empiece la columna vecina.
_OCR_STOP = r"(?:\s+Cm\s+Lineales|\s+CORTE|\s+SCORE|\s+HENDIDO|$)"
_OCR_LABEL_PATTERNS = {
    "pinza": re.compile(r"Pinza:\s*(.+?)" + _OCR_STOP, re.IGNORECASE),
    "madera": re.compile(r"Madera:\s*(.+?)" + _OCR_STOP, re.IGNORECASE),
    "cuchilla": re.compile(r"Cuchilla:\s*(.+?)" + _OCR_STOP, re.IGNORECASE),
    "material": re.compile(r"Material:\s*(.+?)" + _OCR_STOP, re.IGNORECASE),
}
_OCR_TRAILING_NOISE = re.compile(r"[\s_\-—]+$")


def _lines_from_page(page, tol=2):
    """Reconstruye líneas de texto agrupando palabras por su coordenada `top`."""
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    rows = {}
    for w in words:
        key = round(w["top"] / tol) * tol
        rows.setdefault(key, []).append(w)
    lines = []
    for key in sorted(rows):
        row = sorted(rows[key], key=lambda w: w["x0"])
        lines.append(" ".join(w["text"] for w in row))
    return lines


def _es_co_to_float(raw):
    """'10171,885' (mil con punto, decimal con coma) -> 10171.885"""
    s = raw.strip()
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    return float(s)


def _extract_from_text_layer(file_bytes):
    data = {}
    cm_lineales_values = []

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        if not pdf.pages:
            return data
        lines = _lines_from_page(pdf.pages[0])

    for line in lines:
        stripped = line.strip()

        for key, pattern in _LABEL_PATTERNS.items():
            if key in data:
                continue
            m = pattern.match(stripped)
            if m:
                data[key] = m.group(1).strip()

        if "espejo" in stripped.lower() and "espejo" not in data:
            data["espejo"] = "no" not in stripped.lower()

        mm_match = _CM_LINEALES_RE.search(stripped)
        if mm_match:
            cm_lineales_values.append(_es_co_to_float(mm_match.group(1)))

    # Las filas "Cm Lineales" aparecen en el PDF en el orden CORTE, SCORE, (HENDIDO).
    for field, mm_value in zip(_CM_LINEALES_ORDER, cm_lineales_values):
        data[field] = round(mm_value / 10, 3)

    return data


def _extract_via_ocr(file_bytes, missing_keys):
    """OCR de respaldo: solo se usa para llenar las claves que falten."""
    if not missing_keys:
        return {}

    images = convert_from_bytes(file_bytes, dpi=200, first_page=1, last_page=1)
    if not images:
        return {}
    text = pytesseract.image_to_string(images[0], lang="spa")

    data = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        for key, pattern in _OCR_LABEL_PATTERNS.items():
            if key not in missing_keys or key in data:
                continue
            m = pattern.search(stripped)
            if m:
                data[key] = _OCR_TRAILING_NOISE.sub("", m.group(1).strip())

        if "espejo" in missing_keys and "espejo" not in data and "espejo" in stripped.lower():
            data["espejo"] = "no" not in stripped.lower()

    return data


def parse_troquel_pdf(fileobj):
    """Devuelve dict con las claves encontradas (no inventa valores faltantes)."""
    file_bytes = fileobj.read()
    data = _extract_from_text_layer(file_bytes)

    wanted = ["pinza", "madera", "cuchilla", "material", "espejo"]
    missing = [k for k in wanted if k not in data]
    if missing:
        try:
            ocr_data = _extract_via_ocr(file_bytes, missing)
        except Exception:
            ocr_data = {}
        for key, value in ocr_data.items():
            data.setdefault(key, value)

    return data
