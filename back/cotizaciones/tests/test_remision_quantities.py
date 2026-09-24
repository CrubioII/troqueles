"""Consolidated remissions keep each OP's delivered quantity separate."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.template.loader import render_to_string
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, OpProceso, OrdenProduccion, RegistroProceso, Remision
from cotizaciones.views import _consolidar_remisiones, _remision_operador_pdf_ctx, _remision_pdf_ctx


class RemisionQuantitiesTests(TestCase):
    def setUp(self):
        self.customer = Cliente.objects.create(nombre="Quantity test customer")
        self.admin = get_user_model().objects.create_user("quantity_admin", is_staff=True)

    def make_remission(self, quantity=1200, size="medio_pliego", production=True, die=False):
        op = OrdenProduccion.objects.create(
            cliente=self.customer, fecha=timezone.localdate(), referencia="Honey labels",
            cantidad=9000,
        )
        if production:
            for process, station, count in [
                ("impresion", "impresora", 5000), ("uvTotal", "barnizadora", quantity),
            ]:
                OpProceso.objects.create(orden=op, proceso_id=process, active=True, completado=True)
                RegistroProceso.objects.create(
                    orden=op, proceso_id=process, estacion=station,
                    cantidad_realizada=count, cantidad_esperada=9000, tamano=size,
                )
        if die:
            OpProceso.objects.create(orden=op, proceso_id="troquel", active=True, completado=True)
        return Remision.objects.create(orden=op, cliente=self.customer, fecha=timezone.localdate())

    def assert_documents(self, rem, quantities, die_count=0):
        for template in ("pdf_remision_operador.html", "pdf_remision_admin.html", "pdf_remision.html"):
            with self.subTest(template=template):
                ctx = (_remision_pdf_ctx(rem) if template == "pdf_remision.html"
                       else _remision_operador_pdf_ctx(rem, admin=template == "pdf_remision_admin.html"))
                html = render_to_string("cotizaciones/" + template, ctx)
                self.assertEqual(html.count("Cantidad entregada:"), len(quantities) + die_count)
                for number, quantity in quantities:
                    header = html.split(f'{number}</span>')[-1].split('<table')[0]
                    self.assertIn(f'Cantidad entregada:</strong> {quantity}', header)
                if len(quantities) > 1:
                    self.assertNotIn("3.970", html)

    def test_consolidated_different_sizes_and_same_sizes(self):
        for size in ("cuarto_pliego", "medio_pliego"):
            with self.subTest(second_size=size):
                first = self.make_remission()
                second = self.make_remission(2770, size)
                _consolidar_remisiones(first, [second])
                ctx = _remision_operador_pdf_ctx(first)
                self.assertEqual([p["cantidad_entregada"] for p in ctx["procesos"]], ["1.200", "2.770"])
                self.assertEqual(ctx["cantidad_entregada"], "3.970")
                self.assertEqual(ctx["procesos"][1]["items"][-1]["detalle"], [
                    "Tamaño: " + ("1/4 pliego" if size == "cuarto_pliego" else "1/2 pliego")])
                self.assert_documents(first, [(first.orden.numero, "1.200"), (second.orden.numero, "2.770")])
                client = APIClient()
                client.force_authenticate(self.admin)
                response = client.get(f"/api/remisiones/{first.pk}/desglose/")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["cantidad_entregada"], "3.970")
                self.assertEqual([p["cantidad_entregada"] for p in response.data["procesos"]], ["1.200", "2.770"])

    def test_latest_final_process_record_not_intermediate_or_planned(self):
        rem = self.make_remission()
        older = rem.orden.registros_proceso.get(proceso_id="uvTotal")
        RegistroProceso.objects.filter(pk=older.pk).update(fecha_hora=timezone.now() - timedelta(days=1))
        RegistroProceso.objects.create(orden=rem.orden, proceso_id="uvTotal", estacion="barnizadora", cantidad_realizada=1175)
        RegistroProceso.objects.create(orden=rem.orden, proceso_id="impresion", estacion="impresora", cantidad_realizada=6000)
        self.assert_documents(rem, [(rem.orden.numero, "1.175")])

    def test_zero_delivered_is_displayed(self):
        rem = self.make_remission(0)
        self.assert_documents(rem, [(rem.orden.numero, "0")])

    def test_die_only_and_mixed_remissions(self):
        die = self.make_remission(production=False, die=True)
        self.assert_documents(die, [], die_count=1)
        mixed = self.make_remission(die=True)
        self.assert_documents(mixed, [(mixed.orden.numero, "1.200")], die_count=1)
