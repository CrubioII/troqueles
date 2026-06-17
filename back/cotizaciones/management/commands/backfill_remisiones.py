from django.core.management.base import BaseCommand

from cotizaciones.models import OrdenProduccion
from cotizaciones.views import _maybe_crear_remision


class Command(BaseCommand):
    help = (
        "Crea remisiones para las OP que ya están al 100% pero aún no tienen "
        "remisión (p. ej. completadas antes de existir la creación automática). "
        "Idempotente: omite las que ya tienen remisión o no están completas."
    )

    def handle(self, *args, **options):
        creadas = 0
        for op in OrdenProduccion.objects.all():
            rem = _maybe_crear_remision(op)
            if rem is not None:
                creadas += 1
                self.stdout.write(self.style.SUCCESS(f"  {op.numero} → {rem.numero}"))
        self.stdout.write(self.style.SUCCESS(f"Listo. {creadas} remisión(es) creada(s)."))
