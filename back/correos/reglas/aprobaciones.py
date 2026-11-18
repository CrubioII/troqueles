"""Recognize a new Grupo Estelar production approval in an email thread."""
import re
import unicodedata


ESTELAR_DOMAIN = "estelarimpresores.com"
# Estelar rarely writes "aprobado": the go-ahead usually comes as a work
# instruction ("por favor trabajar con este archivo", "realizar el troquel").
_APPROVAL = re.compile(
    r"\b(?:aprobado|aprobada|aprobamos|apruebo|"
    r"d(?:ar|en|ale|enle)\s+proceso|"
    r"proced(?:an|er|a|emos)\b|"
    r"autoriz(?:o|amos|ado|ada)\b|"
    r"trabaj(?:ar|en|e)\s+con\s+(?:este|el|ese)\s+archivo|"
    r"(?:realizar|hacer|fabricar|elaborar)(?:\s+el)?\s+troquel)",
    re.IGNORECASE,
)
_QUOTE_REQUEST = re.compile(r"\bcotiza\w*", re.IGNORECASE)
_REJECTION = re.compile(r"\b(?:no|sin)\s+(?:esta\s+)?aprobad[oa]\b", re.IGNORECASE)
_QUOTED_REPLY = re.compile(
    r"(?im)^\s*(?:>+|(?:on|el)\s+.+(?:wrote|escribio):\s*$|"
    r"(?:from|de):\s+|[- ]{2,}(?:original|forwarded)\s+message)",
)
_MESSAGE_ID = re.compile(r"<[^<>\s]+>")
_SUBJECT_PREFIX = re.compile(r"^\s*(?:(?:re|rv|fw|fwd|tr|reenviar|aw)\s*:\s*)+", re.IGNORECASE)


def _without_accents(value):
    return "".join(
        char for char in unicodedata.normalize("NFD", value or "")
        if unicodedata.category(char) != "Mn"
    )


def es_remitente_estelar(email):
    return (email or "").strip().lower().endswith("@" + ESTELAR_DOMAIN)


def texto_nuevo(cuerpo):
    """The sender's own text: everything before the quoted/forwarded history."""
    return _QUOTED_REPLY.split(_without_accents(cuerpo), maxsplit=1)[0][:500]


def es_aprobacion_estelar(email, cuerpo_actual):
    if not es_remitente_estelar(email):
        return False
    # The approval must be in the sender's new text, never in quoted history.
    texto = texto_nuevo(cuerpo_actual)
    # "Cotícenos y luego realizar el troquel" is still a quote request.
    if _QUOTE_REQUEST.search(texto) or _REJECTION.search(texto):
        return False
    return bool(_APPROVAL.search(texto))


def ids_referenciados(mensaje):
    """Nearest parent first; quoted original messages are later in the list."""
    headers = f"{mensaje.get('References', '')} {mensaje.get('In-Reply-To', '')}"
    return list(dict.fromkeys(reversed(_MESSAGE_ID.findall(headers))))


def asunto_normalizado(asunto):
    """Thread key for subjects: Estelar re-forwards its designer's emails
    ("Fwd: ..."), so References point at internal messages we never saw and
    the subject is the only link back to the quotation."""
    sin_prefijo = _SUBJECT_PREFIX.sub("", _without_accents(asunto or ""))
    return re.sub(r"\s+", " ", sin_prefijo).strip().casefold()
