"""Permisos de producción del Operador, derivados de PerfilOperador.

Fuente única de verdad del mapeo rol → acceso. El Admin (is_staff) siempre
tiene acceso completo y no pasa por PerfilOperador.

Roles (booleanos independientes en PerfilOperador; normalmente un usuario
tiene uno solo, pero nada impide combinarlos):
  es_general      → todas las estaciones de la cadena + Guillotina + módulo
                     Troqueles + remisiones (de cadena y de troquel).
  es_troquelador  → solo el módulo Troqueles (fabricación de molde, formato
                     de cuchillas) y su propia cola de remisiones — NO incluye
                     la estación 'troqueladora' de la cadena (esa es la
                     máquina que trocela, no quien fabrica el molde).
  es_estaciones   → Impresora, Laminadora, Barnizadora, Troqueladora.
  es_guillotina   → Guillotina (corte inicial + corte final).
"""

ROLES_A_ESTACIONES = {
    "es_general": {"guillotina", "guillotina_final", "impresora", "laminadora", "barnizadora", "troqueladora"},
    "es_estaciones": {"impresora", "laminadora", "barnizadora", "troqueladora"},
    "es_guillotina": {"guillotina", "guillotina_final"},
    "es_troquelador": set(),
}

CAMPOS_ROL = list(ROLES_A_ESTACIONES)


def _perfil(user):
    return getattr(user, "perfil_operador", None)


def estaciones_permitidas(user):
    """Set de estacion_id (chain.ESTACION_POR_ID) que el usuario puede tocar."""
    if not getattr(user, "is_authenticated", False):
        return set()
    if user.is_staff:
        from . import chain
        return set(chain.ESTACION_POR_ID)
    perfil = _perfil(user)
    if perfil is None:
        return set()
    permitido = set()
    for campo, estaciones in ROLES_A_ESTACIONES.items():
        if getattr(perfil, campo, False):
            permitido |= estaciones
    return permitido


def puede_troqueles(user):
    """Acceso al módulo Troqueles (molde + formato de cuchillas + su cola de remisiones)."""
    if user.is_staff:
        return True
    perfil = _perfil(user)
    return bool(perfil and (perfil.es_general or perfil.es_troquelador))


def puede_remisiones_generales(user):
    """Acceso a la cola de remisiones de OPs de cadena (Producción General)."""
    if user.is_staff:
        return True
    perfil = _perfil(user)
    return bool(perfil and perfil.es_general)


def puede_alguna_remision(user):
    return puede_troqueles(user) or puede_remisiones_generales(user)
