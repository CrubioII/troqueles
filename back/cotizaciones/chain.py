"""Cadena secuencial de estaciones de producción.

Fuente única de verdad del orden: (Guillotina · corte inicial) → Impresora →
Laminadora → Barnizadora → Troqueladora → (Guillotina · corte final). Una OP
solo pasa por los procesos activos en ella, pero el orden relativo entre los
que sí aplican es siempre este.

Guillotina aparece dos veces porque es la misma máquina en dos momentos: si
la OP tiene `corte_inicial_active` corta el pliego antes de entrar a la
cadena, y si tiene `corte_final_active` corta el producto terminado después
de Troqueladora. Son dos estaciones lógicas (`guillotina` / `guillotina_final`)
con órdenes 0 y 5 para que el bloqueo funcione en ambos extremos; comparten
label y pantalla en el front.

`troquel` (fabricación del molde) NO pertenece a la cadena: tiene su propio
flujo de formato de cuchillas con visibilidad manual del Admin.
"""

ESTACIONES = [
    {"id": "guillotina", "orden": 0, "label": "Guillotina", "procesos": ["corteInicial"]},
    {"id": "impresora", "orden": 1, "label": "Impresora", "procesos": ["impresion"]},
    {"id": "laminadora", "orden": 2, "label": "Laminadora", "procesos": ["laminado"]},
    {
        "id": "barnizadora",
        "orden": 3,
        "label": "Barnizadora",
        "procesos": ["uvTotal", "uvParcial", "uvReserva"],
    },
    {"id": "troqueladora", "orden": 4, "label": "Troqueladora", "procesos": ["troquelado"]},
    {"id": "guillotina_final", "orden": 5, "label": "Guillotina", "procesos": ["corteFinal"]},
]

# Gancho para exigir procesos de fuera de la cadena antes de una estación.
# Poner {"troqueladora": ["troquel"]} obliga a fabricar el molde antes de
# troquelar; no requiere migración.
PREREQUISITOS_EXTRA = {}

ESTACION_POR_ID = {e["id"]: e for e in ESTACIONES}
PROCESO_A_ESTACION = {p: e for e in ESTACIONES for p in e["procesos"]}
CHAIN_PROCESOS = set(PROCESO_A_ESTACION)

# Etiqueta legible por proceso_id, para nombrar el proceso concreto (no la
# estación) en notificaciones e historiales.
PROCESO_LABELS = {
    "corteInicial": "Corte inicial",
    "impresion": "Impresión",
    "laminado": "Laminado",
    "uvTotal": "UV total",
    "uvParcial": "UV parcial",
    "uvReserva": "UV reserva",
    "troquelado": "Troquelado",
    "corteFinal": "Corte final",
}


def procesos_anteriores(estacion_id):
    """proceso_ids de todas las estaciones anteriores a esta (aplanado)."""
    orden = ESTACION_POR_ID[estacion_id]["orden"]
    ids = [p for e in ESTACIONES if e["orden"] < orden for p in e["procesos"]]
    return ids + PREREQUISITOS_EXTRA.get(estacion_id, [])


def bloqueado_por(op, estacion_id):
    """Label de la estación anterior que falta completar, o None si es su turno.

    "Es mi turno" = ningún OpProceso activo y no completado de una estación
    anterior. Los procesos inactivos se ignoran: la OP solo pasa por lo suyo.
    """
    anteriores = set(procesos_anteriores(estacion_id))
    pendientes = [
        p for p in op.procesos.all()
        if p.active and not p.completado and p.proceso_id in anteriores
    ]
    if not pendientes:
        return None
    primero = min(
        pendientes,
        key=lambda p: PROCESO_A_ESTACION[p.proceso_id]["orden"]
        if p.proceso_id in PROCESO_A_ESTACION else 0,
    )
    est = PROCESO_A_ESTACION.get(primero.proceso_id)
    return est["label"] if est else PROCESO_LABELS.get(primero.proceso_id, primero.proceso_id)


def procesos_de(op, estacion_id):
    """OpProceso activos de la OP que le tocan a esta estación (completos o no)."""
    ids = set(ESTACION_POR_ID[estacion_id]["procesos"])
    return [p for p in op.procesos.all() if p.active and p.proceso_id in ids]


def procesos_pendientes_de(op, estacion_id):
    """OpProceso activos y no completados que esta estación debe cerrar.

    En Barnizadora pueden ser varios (uvTotal + uvParcial): la estación no se
    da por terminada hasta registrarlos todos.
    """
    return [p for p in procesos_de(op, estacion_id) if not p.completado]


def siguiente_estacion(op):
    """Primera estación (por orden) con algún proceso activo pendiente, o None."""
    for e in ESTACIONES:
        if procesos_pendientes_de(op, e["id"]):
            return e
    return None
