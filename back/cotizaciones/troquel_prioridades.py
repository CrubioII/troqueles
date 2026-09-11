"""Reglas de la cola de Troqueles agrupada por cliente.

La prioridad se sigue guardando en ``OpProceso`` para no cambiar la cola que
consume el Troquelador. Este módulo garantiza que las OPs de un cliente sean
un bloque contiguo y que dentro del bloque se atiendan en orden FIFO.
"""

from django.db import transaction

from .models import OpProceso


ESTADOS_FORMATO_FUERA_DE_COLA = ("pendiente", "aprobado")


def _procesos_en_cola(lock=False):
    qs = (
        OpProceso.objects.filter(
            proceso_id="troquel",
            active=True,
            completado=False,
            orden__remision__isnull=True,
        )
        .exclude(orden__formatos_cuchillas__estado__in=ESTADOS_FORMATO_FUERA_DE_COLA)
        .select_related("orden__cliente")
    )
    # El filtro ``orden__remision__isnull`` incorpora un LEFT OUTER JOIN. En
    # PostgreSQL, ``FOR UPDATE`` sin ``OF`` intenta bloquear también el lado
    # nullable de ese join y falla. Solo las filas de OpProceso cambian abajo,
    # así que limitar el bloqueo a ``self`` es tanto suficiente como válido.
    return qs.select_for_update(of=("self",)) if lock else qs


def reordenar_cola_troquel_por_clientes(cliente_ids=None):
    """Guarda la cola completa por grupos de cliente y devuelve sus OP ids.

    ``cliente_ids`` debe contener exactamente los clientes que hoy tienen una
    tarea activa en la cola. Si se omite, se conserva el orden actual de los
    grupos; sirve al crear una OP para insertar una tarea nueva en el grupo
    existente o añadir un cliente nuevo al final.
    """
    with transaction.atomic():
        procesos = list(_procesos_en_cola(lock=True))
        grupos = {}
        for proceso in procesos:
            grupos.setdefault(proceso.orden.cliente_id, []).append(proceso)

        # El orden previo se toma de la primera prioridad del grupo; los grupos
        # sin prioridad quedan al final por la antigüedad de su primera OP.
        def clave_grupo(cliente_id):
            tareas = grupos[cliente_id]
            prioridad = min((p.prioridad for p in tareas if p.prioridad is not None), default=None)
            primera = min(tareas, key=lambda p: (p.orden.creado, p.orden_id))
            return (prioridad is None, prioridad if prioridad is not None else 0, primera.orden.creado, primera.orden_id)

        actuales = sorted(grupos, key=clave_grupo)
        if cliente_ids is None:
            cliente_ids = actuales
        else:
            if not isinstance(cliente_ids, list) or any(isinstance(pk, bool) or not isinstance(pk, int) for pk in cliente_ids):
                raise ValueError("Se espera 'cliente_ids' como una lista de IDs enteros.")
            if len(cliente_ids) != len(set(cliente_ids)):
                raise ValueError("Un cliente no puede aparecer más de una vez en la cola.")
            if set(cliente_ids) != set(actuales):
                raise ValueError("La lista debe incluir exactamente todos los clientes activos de la cola.")

        actualizados = []
        orden_ids = []
        for posicion_grupo, cliente_id in enumerate(cliente_ids):
            # FIFO inequívoco dentro del grupo, incluso si un orden anterior
            # hubiera dejado sus prioridades intercaladas.
            tareas = sorted(grupos[cliente_id], key=lambda p: (p.orden.creado, p.orden_id))
            inicio = sum(len(grupos[anterior]) for anterior in cliente_ids[:posicion_grupo])
            for desplazamiento, proceso in enumerate(tareas, start=1):
                proceso.prioridad = inicio + desplazamiento
                actualizados.append(proceso)
                orden_ids.append(proceso.orden_id)
        if actualizados:
            OpProceso.objects.bulk_update(actualizados, ["prioridad"])
        return orden_ids
