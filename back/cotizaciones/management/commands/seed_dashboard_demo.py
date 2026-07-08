import random
from datetime import date, timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from cotizaciones.models import (
    Cliente, Cotizacion, FormatoCuchillas, OrdenProduccion, OpProceso,
    RegistroMaquina,
)

CLIENTES = [
    "Empaques del Valle", "Cajas Andina", "Litografía Bogotá", "Etiquetas Premium",
    "Distribuidora Norte", "Cartones del Caribe", "Impresos San Marcos",
    "Bolsas y Más", "Grupo Empacar", "Plásticos La 80",
]

# Clientes cuya actividad es toda antigua (>90 días) → aparecen como "inactivos".
CLIENTES_INACTIVOS = [
    "Cartonería El Roble", "Gráficas Antiguas", "Empaques Olvido",
    "Litografía Vieja Guardia", "Distribuidora El Recuerdo",
]

REFERENCIAS = [
    "Caja plegadiza 12x8x4", "Etiqueta autoadhesiva 5x5", "Bolsa kraft 20x30",
    "Tarjeta presentación", "Caja display góndola", "Empaque farmacéutico",
    "Estuche cosmético", "Caja pizza 30x30", "Etiqueta termoencogible",
]


class Command(BaseCommand):
    help = "Pobla datos demo (cotizaciones, OPs, troquel, guillotina) para las gráficas del dashboard."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Borra datos demo previos antes de crear nuevos.")

    def handle(self, *args, **options):
        if options["clear"]:
            self._clear()

        clientes = [
            Cliente.objects.get_or_create(nombre=n, defaults={"tipo": "final", "email": f"{n.lower().replace(' ', '')}@demo.co"})[0]
            for n in CLIENTES
        ]

        hoy = timezone.localdate()

        # ── Cotizaciones: variedad de estados para el embudo ──
        estado_counts = {
            "borrador": 5, "enviada": 8, "aprobada": 4, "rechazada": 3, "convertida": 12,
        }
        cotizaciones = []
        for estado, n in estado_counts.items():
            for _ in range(n):
                cliente = random.choice(clientes)
                fecha = hoy - timedelta(days=random.randint(1, 300))
                cot = Cotizacion.objects.create(
                    fecha=fecha,
                    cliente=cliente,
                    referencia=random.choice(REFERENCIAS),
                    cantidad=random.randint(500, 20000),
                    estado=estado,
                    margen=random.choice([60, 70, 80, 90]),
                )
                cotizaciones.append(cot)
        self.stdout.write(self.style.SUCCESS(f"Creadas {len(cotizaciones)} cotizaciones demo."))

        # ── OPs: para ingresos por período, top clientes y OPs atrasadas ──
        convertidas = [c for c in cotizaciones if c.estado == "convertida"]
        ops = []
        for cot in convertidas:
            fecha = cot.fecha + timedelta(days=random.randint(1, 5))
            valor_total = random.randint(800_000, 15_000_000)
            entrega_dias = random.randint(-25, 20)  # negativo => ya pasó (atrasada candidata)
            fecha_entrega = hoy + timedelta(days=entrega_dias) if entrega_dias <= 0 else fecha + timedelta(days=entrega_dias)
            op = OrdenProduccion.objects.create(
                fecha=fecha,
                fecha_entrega=fecha_entrega,
                cotizacion=cot,
                cliente=cot.cliente,
                referencia=cot.referencia,
                cantidad=cot.cantidad,
                valor_total_override=valor_total,
                abono=random.choice([0, valor_total * 0.3, valor_total * 0.5, valor_total]),
            )
            # procesos: progreso variado
            for pid in ["impresion", "laminado", "troquelado", "pegado"]:
                active = random.random() > 0.2
                OpProceso.objects.create(
                    orden=op, proceso_id=pid, active=active,
                    completado=active and random.random() > 0.4,
                )
            ops.append(op)

        # OPs adicionales atrasadas y sin remisión, garantizadas para el chart
        for _ in range(6):
            cliente = random.choice(clientes)
            fecha = hoy - timedelta(days=random.randint(20, 60))
            valor_total = random.randint(1_000_000, 8_000_000)
            op = OrdenProduccion.objects.create(
                fecha=fecha,
                fecha_entrega=hoy - timedelta(days=random.randint(1, 15)),
                cliente=cliente,
                referencia=random.choice(REFERENCIAS),
                cantidad=random.randint(500, 10000),
                valor_total_override=valor_total,
                abono=random.choice([0, valor_total * 0.4]),
            )
            ops.append(op)

        self.stdout.write(self.style.SUCCESS(f"Creadas {len(ops)} OPs demo."))

        # ── Clientes inactivos: toda su actividad es antigua (>90 días) ──
        inactivos = [
            Cliente.objects.get_or_create(
                nombre=n,
                defaults={"tipo": "final", "email": f"{n.lower().replace(' ', '')}@demo.co"},
            )[0]
            for n in CLIENTES_INACTIVOS
        ]
        for cliente in inactivos:
            fecha = hoy - timedelta(days=random.randint(120, 500))
            cot = Cotizacion.objects.create(
                fecha=fecha,
                cliente=cliente,
                referencia=random.choice(REFERENCIAS),
                cantidad=random.randint(500, 15000),
                estado="convertida",
                margen=random.choice([60, 70, 80]),
            )
            cotizaciones.append(cot)
            valor_total = random.randint(1_000_000, 9_000_000)
            op = OrdenProduccion.objects.create(
                fecha=fecha + timedelta(days=2),
                fecha_entrega=fecha + timedelta(days=12),
                cotizacion=cot,
                cliente=cliente,
                referencia=cot.referencia,
                cantidad=cot.cantidad,
                valor_total_override=valor_total,
                abono=random.choice([0, valor_total]),
            )
            for pid in ["impresion", "troquelado", "pegado"]:
                OpProceso.objects.create(orden=op, proceso_id=pid, active=True, completado=True)
            ops.append(op)
        self.stdout.write(self.style.SUCCESS(f"Creados {len(inactivos)} clientes inactivos demo."))

        # ── FormatoCuchillas: tiempos troquel ──
        for op in random.sample(ops, k=min(15, len(ops))):
            for _ in range(random.randint(1, 3)):
                FormatoCuchillas.objects.create(
                    orden=op,
                    cuchilla_cm=random.uniform(50, 300),
                    grafa_cm=random.uniform(10, 80),
                    cauchos=[{"tipo": "verde", "cm": round(random.uniform(20, 150), 1)}],
                    tiempo_encalado_min=random.randint(5, 25),
                    tiempo_encuchillado_min=random.randint(15, 60),
                    tiempo_encauchado_min=random.randint(8, 30),
                )

        # ── RegistroMaquina: conteo troquel/guillotina ──
        for op in random.sample(ops, k=min(20, len(ops))):
            RegistroMaquina.objects.create(
                orden=op, maquina="troquel",
                descripcion="Troquelado lote", costo=random.randint(50_000, 300_000),
            )
        for op in random.sample(ops, k=min(25, len(ops))):
            RegistroMaquina.objects.create(
                orden=op, maquina="guillotina",
                descripcion="Corte guillotina", costo=random.randint(30_000, 200_000),
            )

        self.stdout.write(self.style.SUCCESS("Datos demo de troquel/guillotina creados."))
        self.stdout.write(self.style.SUCCESS("Listo. Refresca el dashboard."))

    def _clear(self):
        FormatoCuchillas.objects.filter(orden__referencia__in=REFERENCIAS).delete()
        RegistroMaquina.objects.filter(orden__referencia__in=REFERENCIAS).delete()
        OpProceso.objects.filter(orden__referencia__in=REFERENCIAS).delete()
        OrdenProduccion.objects.filter(referencia__in=REFERENCIAS, remision__isnull=True).delete()
        Cotizacion.objects.filter(referencia__in=REFERENCIAS).delete()
        self.stdout.write(self.style.WARNING("Datos demo previos borrados."))
