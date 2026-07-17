import unicodedata
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from cotizaciones.models import Cliente


class Command(BaseCommand):
    help = (
        "Fusiona clientes con el mismo nombre (comparado en NFC, sin distinguir "
        "mayúsculas): conserva el más antiguo, le apunta cotizaciones, órdenes, "
        "remisiones y documentos de los demás, y los elimina. Por defecto solo "
        "muestra qué haría; usar --apply para ejecutar."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Ejecutar la fusión (sin esto, solo dry-run)")

    def handle(self, *args, **options):
        grupos = defaultdict(list)
        for c in Cliente.objects.order_by("creado", "id"):
            clave = unicodedata.normalize("NFC", c.nombre).strip().casefold()
            grupos[clave].append(c)

        duplicados = {k: v for k, v in grupos.items() if len(v) > 1}
        if not duplicados:
            self.stdout.write(self.style.SUCCESS("No hay clientes duplicados."))
            return

        aplicar = options["apply"]
        for clave, clientes in duplicados.items():
            principal, *resto = clientes
            self.stdout.write(f'"{principal.nombre}": conservar #{principal.id} (creado {principal.creado:%Y-%m-%d})')
            for dup in resto:
                n = (
                    dup.cotizaciones.count() + dup.ordenes.count()
                    + dup.remisiones.count() + dup.documentos.count()
                )
                self.stdout.write(f"  fusionar #{dup.id} ({n} registro(s) relacionados)")
                if aplicar:
                    with transaction.atomic():
                        dup.cotizaciones.update(cliente=principal)
                        dup.ordenes.update(cliente=principal)
                        dup.remisiones.update(cliente=principal)
                        dup.documentos.update(cliente=principal)
                        # Conservar datos de contacto que el principal no tenga
                        cambios = []
                        for campo in ["email", "telefono", "nit", "direccion", "ciudad"]:
                            if not getattr(principal, campo) and getattr(dup, campo):
                                setattr(principal, campo, getattr(dup, campo))
                                cambios.append(campo)
                        if cambios:
                            principal.save(update_fields=cambios)
                        dup.delete()

        if aplicar:
            self.stdout.write(self.style.SUCCESS("Fusión completada."))
        else:
            self.stdout.write(self.style.WARNING("Dry-run: nada modificado. Repetir con --apply para ejecutar."))
