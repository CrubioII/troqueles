from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from cotizaciones.models import (
    Cliente, clave_compacta_cliente, clientes_similares, normalizar_nombre_cliente,
)


def _fusionar(dup, principal):
    """Repunta todo lo que cuelga de `dup` a `principal` y borra `dup`."""
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


def _relacionados(cliente):
    return (
        cliente.cotizaciones.count() + cliente.ordenes.count()
        + cliente.remisiones.count() + cliente.documentos.count()
    )


class Command(BaseCommand):
    help = (
        "Fusiona clientes duplicados: conserva el más antiguo, le apunta cotizaciones, "
        "órdenes, remisiones y documentos de los demás, y los elimina.\n"
        "  (sin flags)  fusiona los que tienen el mismo nombre exacto (NFC, sin mayúsculas).\n"
        "  --similar    solo lista los parecidos (typos, espacios, puntuación) para revisión.\n"
        "  --merge A:B  fusiona el cliente A dentro del B, explícitamente.\n"
        "Por defecto todo es dry-run: usar --apply para ejecutar."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Ejecutar la fusión (sin esto, solo dry-run)")
        parser.add_argument(
            "--similar", action="store_true",
            help="Listar clientes parecidos (no fusiona: los typos necesitan ojo humano)",
        )
        parser.add_argument(
            "--merge", action="append", default=[], metavar="DUP_ID:PRINCIPAL_ID",
            help="Fusionar un par explícito. Repetible.",
        )

    def handle(self, *args, **options):
        if options["merge"]:
            return self._merge_explicito(options["merge"], options["apply"])
        if options["similar"]:
            return self._listar_similares()
        return self._merge_exactos(options["apply"])

    # ── pares explícitos ──────────────────────────────────────────────────
    def _merge_explicito(self, pares, aplicar):
        for par in pares:
            try:
                dup_id, principal_id = (int(x) for x in par.split(":", 1))
            except ValueError:
                raise CommandError(f'--merge espera "DUP_ID:PRINCIPAL_ID", recibí "{par}"')
            if dup_id == principal_id:
                raise CommandError(f"--merge {par}: son el mismo cliente")
            try:
                dup = Cliente.objects.get(pk=dup_id)
                principal = Cliente.objects.get(pk=principal_id)
            except Cliente.DoesNotExist as e:
                raise CommandError(f"--merge {par}: {e}")
            self.stdout.write(
                f'fusionar #{dup.id} "{dup.nombre}" ({_relacionados(dup)} registro(s)) '
                f'→ #{principal.id} "{principal.nombre}"'
            )
            if aplicar:
                _fusionar(dup, principal)
        self._cierre(aplicar)

    # ── solo listar parecidos ─────────────────────────────────────────────
    def _listar_similares(self):
        vistos = set()
        encontrados = 0
        for cliente in Cliente.objects.order_by("creado", "id"):
            for otro in clientes_similares(cliente.nombre, excluir_id=cliente.id):
                par = tuple(sorted((cliente.id, otro.id)))
                if par in vistos:
                    continue
                vistos.add(par)
                encontrados += 1
                a, b = Cliente.objects.get(pk=par[0]), Cliente.objects.get(pk=par[1])
                marca = "=" if clave_compacta_cliente(a.nombre) == clave_compacta_cliente(b.nombre) else "~"
                self.stdout.write(
                    f'{marca} #{a.id} "{a.nombre}" ({_relacionados(a)} reg., {a.creado:%Y-%m-%d})'
                    f'   <->   #{b.id} "{b.nombre}" ({_relacionados(b)} reg., {b.creado:%Y-%m-%d})'
                )
        if not encontrados:
            self.stdout.write(self.style.SUCCESS("No hay clientes parecidos."))
            return
        self.stdout.write(self.style.WARNING(
            f"\n{encontrados} par(es). Nada modificado: revisa cuáles son de verdad el mismo "
            "cliente y fusiónalos con --merge DUP_ID:PRINCIPAL_ID --apply."
        ))

    # ── duplicados exactos ────────────────────────────────────────────────
    def _merge_exactos(self, aplicar):
        grupos = defaultdict(list)
        for c in Cliente.objects.order_by("creado", "id"):
            grupos[normalizar_nombre_cliente(c.nombre)].append(c)

        duplicados = {k: v for k, v in grupos.items() if len(v) > 1}
        if not duplicados:
            self.stdout.write(self.style.SUCCESS("No hay clientes duplicados exactos."))
            self.stdout.write("Para los parecidos por typo o espacios, correr con --similar.")
            return

        for clave, clientes in duplicados.items():
            principal, *resto = clientes
            self.stdout.write(f'"{principal.nombre}": conservar #{principal.id} (creado {principal.creado:%Y-%m-%d})')
            for dup in resto:
                self.stdout.write(f"  fusionar #{dup.id} ({_relacionados(dup)} registro(s) relacionados)")
                if aplicar:
                    _fusionar(dup, principal)
        self._cierre(aplicar)

    def _cierre(self, aplicar):
        if aplicar:
            self.stdout.write(self.style.SUCCESS("Fusión completada."))
        else:
            self.stdout.write(self.style.WARNING("Dry-run: nada modificado. Repetir con --apply para ejecutar."))
