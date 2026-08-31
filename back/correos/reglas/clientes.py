"""Resolución de cliente — sección 6.3 de la especificación de migración.

Única fuente de verdad para las reglas de cliente. El workflow de n8n que
esto reemplaza tenía esta lógica duplicada byte a byte en dos nodos y había
que mantenerlas sincronizadas a mano — no se repite ese error aquí.

Cadena de prioridad (se evalúa en orden, la primera que hace match gana):
  Paso 1 — Alexander Restrepo (por dirección o nombre)
  Paso 2 — reglas exclusivas por cliente (tabla REGLAS_EXCLUSIVAS)
  Paso 3 — dominio propio sin regla → raíz del dominio, capitalizada
  Paso 4 — dominio público con alias del remitente
  Paso 5 — sin alias → parte local del correo, limpiada
  Paso 6 — sin remitente legible → "Unresolved" + alerta

El paso 0 (¿es cotización?) vive en reglas/cotizacion.py y lo evalúa
pipeline.py ANTES de llamar a resolver_cliente: si es cotización, la cadena
ni se ejecuta.

IMPORTANTE — no reintroducir un valor por defecto para Alexander. Hubo un
incidente real (OP-0550, OP-0557): un fallback "correo de Alexander → cliente
Alexander Restrepo" convirtió un error de parseo en órdenes plausibles pero
equivocadas. Si Alexander no trae "Cliente: xxx" en el cuerpo, no se crea
ningún cliente ni orden — solo una alerta. Ver ClienteResuelto.nombre=None.
"""
import re
from dataclasses import dataclass, field

DOMINIOS_PUBLICOS = {
    "gmail.com", "hotmail.com", "outlook.com", "outlook.es", "yahoo.com",
    "yahoo.es", "hotmail.es", "live.com", "icloud.com", "me.com", "aol.com",
    "protonmail.com", "proton.me", "msn.com",
}

ALEXANDER_EMAILS = {"gerenciatroquelesinc@gmail.com", "troquelesinclineas@gmail.com"}
_PATRON_ALEXANDER_NOMBRE = re.compile(r"alexander\s+restrepo", re.IGNORECASE)


@dataclass(frozen=True)
class ReglaCliente:
    cliente_nombre: str
    dominios: tuple = ()
    correos: tuple = ()
    nombres: tuple = ()  # patrones regex (str), case-insensitive
    flag: str = ""


# cliente_nombre debe coincidir EXACTAMENTE con el nombre ya existente en la
# base de datos. Verificado contra producción (spec, sección "Pasos
# manuales", punto M3): "Preprensa Inalmega" (con "re") y "Graficas
# Modernas" (sin tilde) son las grafías reales — usar cualquier otra crea un
# cliente duplicado en el primer run.
REGLAS_EXCLUSIVAS = (
    ReglaCliente(
        "Impresos Richard",
        dominios=("impresosrichard.com",),
        correos=("nelsonmontes@impresosrichard.com",),
        flag="multipagina",
    ),
    ReglaCliente(
        "Grupo Estelar",
        dominios=("estelarimpresores.com",),
        correos=("compras@estelarimpresores.com",),
        nombres=(r"carlos\s+a?\.?\s*bernal",),
    ),
    ReglaCliente(
        "COMPUCOPIAMOS",
        correos=("monicompucopiamos@gmail.com",),
        nombres=(r"monica\s+v?\.?\s*arrieta",),
    ),
    ReglaCliente(
        "Flexocar",
        dominios=("flexocar.com",),
        correos=("produccion@flexocar.com", "josefergarcia1@gmail.com"),
        nombres=(r"jose\s+fernando\s+garcia\s+valencia",),
    ),
    ReglaCliente(
        "Preprensa Inalmega",
        dominios=("inalmega.com",),
        correos=("preprensa@inalmega.com",),
    ),
    ReglaCliente(
        "FGT",
        dominios=("fgt.com.co",),
        correos=("compras@fgt.com.co",),
        nombres=(r"diana\s+osorio",),
    ),
    ReglaCliente(
        "Interbags",
        dominios=("interbags.com.co",),
        correos=("servicioalcliente@interbags.com.co",),
    ),
    ReglaCliente(
        "Litoruiz",
        dominios=("litoruiz.com",),
        correos=("henryq@litoruiz.com",),
        nombres=(r"henry\s+quintero",),
    ),
    ReglaCliente(
        "Inmcor",
        dominios=("inmcor.com",),
        correos=("javier.galindo@inmcor.com",),
        nombres=(r"javier\s+galindo",),
        flag="es_inmcor",
    ),
    ReglaCliente(
        "Ingeniería Gráfica",
        dominios=("igpack.co", "igpack.com"),
        correos=("produccion@igpack.co",),
        nombres=(r"carlos\s+valencia",),
    ),
    ReglaCliente(
        "Graficas Modernas",
        dominios=("graficasmodernas.com",),
        correos=("diseno@graficasmodernas.com",),
        nombres=(r"juan\s+carlos\s+arias",),
        flag="filtra_orden",
    ),
)


@dataclass
class ClienteResuelto:
    # None => no crear ningún cliente ni orden (único caso: Alexander sin
    # instrucción). Siempre viene con `alerta` en ese caso.
    nombre: str | None
    nota_cliente: str = ""
    flag: str = ""
    alerta: str = ""


_PATRON_CLIENTE_LINEA = re.compile(r"^\s*cliente\s*:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
_PATRON_PARENTESIS = re.compile(r"[\(\[\{]([^\)\]\}]*)[\)\]\}]")


def _extraer_instruccion_cliente(cuerpo_busqueda):
    """Busca una línea "Cliente: xxx" y separa nombre de instrucción entre
    paréntesis/corchetes/llaves. Solo la usa Alexander (Paso 1) — si
    cualquier remitente pudiera fijarla, anularía la regla de dominio de
    Alexander. Devuelve (nombre, nota) o None si no hay línea o queda vacía."""
    m = _PATRON_CLIENTE_LINEA.search(cuerpo_busqueda or "")
    if not m:
        return None
    valor = m.group(1).strip()
    if not valor:
        return None
    nota_match = _PATRON_PARENTESIS.search(valor)
    nota = nota_match.group(1).strip() if nota_match else ""
    nombre = _PATRON_PARENTESIS.sub("", valor).strip()
    if not nombre:
        return None
    return nombre, nota


def _es_alexander(email, nombre_remitente):
    if email in ALEXANDER_EMAILS:
        return True
    return bool(_PATRON_ALEXANDER_NOMBRE.search(nombre_remitente or ""))


def _coincide_regla(regla, email, dominio, nombre_remitente):
    if dominio and dominio in regla.dominios:
        return True
    if email and email in regla.correos:
        return True
    for patron in regla.nombres:
        if re.search(patron, nombre_remitente or "", re.IGNORECASE):
            return True
    return False


def _nombre_desde_dominio(dominio):
    raiz = dominio.split(".")[0]
    return raiz.capitalize()


def _alias_valido(nombre_remitente, email):
    alias = (nombre_remitente or "").strip()
    if not alias:
        return None
    if alias.lower() == (email or "").lower():
        return None
    if "@" in alias:
        return None
    return alias


def _nombre_desde_parte_local(email):
    parte_local = email.split("@")[0]
    limpio = re.sub(r"[._\-+]+", " ", parte_local)
    palabras = [p for p in limpio.split() if p]
    return " ".join(p.capitalize() for p in palabras) if palabras else None


def resolver_cliente(remitente_email, remitente_nombre, cuerpo_busqueda):
    """Ejecuta la cadena de prioridad completa (pasos 1-6). No evalúa el
    paso 0 (cotización) — eso lo hace pipeline.py antes de llamar aquí."""
    email = (remitente_email or "").strip().lower()
    dominio = email.rsplit("@", 1)[-1] if "@" in email else ""

    if _es_alexander(email, remitente_nombre):
        instruccion = _extraer_instruccion_cliente(cuerpo_busqueda)
        if instruccion is None:
            return ClienteResuelto(
                nombre=None,
                alerta="Correo de Alexander sin instrucción de cliente",
            )
        nombre, nota = instruccion
        return ClienteResuelto(nombre=nombre, nota_cliente=nota)

    for regla in REGLAS_EXCLUSIVAS:
        if _coincide_regla(regla, email, dominio, remitente_nombre):
            return ClienteResuelto(nombre=regla.cliente_nombre, flag=regla.flag)

    if dominio and dominio not in DOMINIOS_PUBLICOS:
        return ClienteResuelto(nombre=_nombre_desde_dominio(dominio))

    alias = _alias_valido(remitente_nombre, email)
    if alias:
        return ClienteResuelto(nombre=alias)

    if email:
        nombre = _nombre_desde_parte_local(email)
        if nombre:
            return ClienteResuelto(nombre=nombre)

    return ClienteResuelto(nombre="Unresolved", alerta="Correo sin remitente identificable")
