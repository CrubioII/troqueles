from django.core.management.base import BaseCommand
from django.db import transaction

from cotizaciones.models import Cliente

# Todo lo que puede colgar de un Cliente. Si alguna vez se agrega otra relación,
# va acá: borrar un cliente que tenga registros es pérdida de historia, no
# limpieza.
RELACIONES = ["cotizaciones", "ordenes", "remisiones", "documentos"]


def _registros(cliente):
    return {rel: getattr(cliente, rel).count() for rel in RELACIONES}


def _tiene_datos_propios(cliente):
    """Datos que el cliente guarda por sí mismo, aunque no tenga movimientos.

    Un cliente sin una sola OP pero con correo/NIT/teléfono es una ficha de
    contacto que alguien cargó a propósito (o el correo de quien pidió el
    trabajo); un cliente con precios de troquel configurados es una tarifa
    negociada. Ninguno de los dos es basura de una alta accidental.
    """
    return bool(
        cliente.email or cliente.telefono or cliente.nit
        or cliente.direccion or cliente.ciudad
        or cliente.precios_troquel
    )


class Command(BaseCommand):
    help = (
        "Borra clientes sin ningún registro asociado (cotizaciones, órdenes, "
        "remisiones ni documentos): altas accidentales, típicamente de haber "
        "escrito un nombre sin elegir la sugerencia.\n"
        "Por defecto conserva los que tienen datos propios (correo, teléfono, "
        "NIT, dirección o precios de troquel) — esos son fichas de contacto, no "
        "basura; usar --incluir-con-datos para borrarlos también.\n"
        "Todo es dry-run salvo que se pase --apply."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Ejecutar el borrado (sin esto, solo dry-run)")
        parser.add_argument(
            "--incluir-con-datos", action="store_true",
            help="Borrar también los que tienen correo/teléfono/NIT/dirección o precios de troquel",
        )

    def handle(self, *args, **options):
        aplicar = options["apply"]
        incluir = options["incluir_con_datos"]

        vacios, con_datos = [], []
        for cliente in Cliente.objects.order_by("id"):
            if any(_registros(cliente).values()):
                continue
            (con_datos if _tiene_datos_propios(cliente) else vacios).append(cliente)

        a_borrar = vacios + con_datos if incluir else vacios

        if con_datos and not incluir:
            self.stdout.write(self.style.WARNING(
                f"Conservando {len(con_datos)} cliente(s) sin movimientos pero con datos propios:"
            ))
            for c in con_datos:
                detalle = ", ".join(filter(None, [
                    c.email, c.telefono, c.nit, c.direccion, c.ciudad,
                    "precios de troquel" if c.precios_troquel else "",
                ]))
                self.stdout.write(f"  #{c.id} {c.nombre} — {detalle}")
            self.stdout.write("  (usar --incluir-con-datos para borrarlos también)\n")

        if not a_borrar:
            self.stdout.write(self.style.SUCCESS("No hay clientes huérfanos que borrar."))
            return

        self.stdout.write(f"\nBorrar {len(a_borrar)} cliente(s) sin ningún registro:")
        for c in a_borrar:
            self.stdout.write(f"  #{c.id} {c.nombre} (creado {c.creado:%Y-%m-%d})")

        if aplicar:
            with transaction.atomic():
                for c in a_borrar:
                    # Recontar dentro de la transacción: entre el listado y el
                    # borrado alguien pudo haberle creado una OP.
                    if any(_registros(c).values()):
                        self.stdout.write(self.style.WARNING(f"  #{c.id} ya tiene registros, se conserva"))
                        continue
                    c.delete()
            self.stdout.write(self.style.SUCCESS("Borrado completado."))
        else:
            self.stdout.write(self.style.WARNING("Dry-run: nada modificado. Repetir con --apply para ejecutar."))
