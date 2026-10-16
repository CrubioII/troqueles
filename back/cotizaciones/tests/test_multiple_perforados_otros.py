from datetime import date

from django.contrib.auth import get_user_model
from django.template.loader import render_to_string
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, FormatoCuchillas, OpProceso, OrdenProduccion, PerfilOperador, Remision
from cotizaciones.serializers import _orden_progreso
from cotizaciones.views import _build_costos_seed, _remision_operador_pdf_ctx, _remision_pdf_ctx


class MultiplePerforadosOtrosTests(TestCase):
    def setUp(self):
        self.client_record = Cliente.objects.create(nombre="Multiple process customer")
        self.op = OrdenProduccion.objects.create(
            cliente=self.client_record, fecha=date(2026, 10, 16), referencia="Labels", cantidad=100,
        )
        self.admin = get_user_model().objects.create_user("multiple_admin", is_staff=True)
        self.operator = get_user_model().objects.create_user("multiple_operator")
        PerfilOperador.objects.create(user=self.operator, es_general=True, es_troquelador=True)
        self.admin_api = APIClient()
        self.admin_api.force_authenticate(self.admin)
        self.operator_api = APIClient()
        self.operator_api.force_authenticate(self.operator)

    def test_perforados_validate_and_appear_separately_in_remission(self):
        OpProceso.objects.create(orden=self.op, proceso_id="troquel", active=True)
        response = self.operator_api.post("/api/formatos-cuchillas/", {
            "orden": self.op.id,
            "perforados": [{"medida": "2x2", "cm": 12}, {"medida": "4x4", "cm": 8}],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        formato = FormatoCuchillas.objects.get(pk=response.data["id"])
        lines = [line for line in _build_costos_seed(formato) if line["concepto"] == "Perforado"]
        self.assertEqual([(line["detalle"], line["cantidad"]) for line in lines], [("2x2", 12), ("4x4", 8)])
        self.assertEqual([line["price_key"] for line in lines], ["perforaciones:2x2", "perforaciones:4x4"])
        invalid = self.operator_api.patch(f"/api/formatos-cuchillas/{formato.id}/", {
            "perforados": [{"medida": "wrong", "cm": 4}],
        }, format="json")
        self.assertEqual(invalid.status_code, 400)

        FormatoCuchillas.objects.filter(pk=formato.pk).update(estado="aprobado")
        rem = Remision.objects.create(orden=self.op, cliente=self.client_record, fecha=date(2026, 10, 16))
        for template, ctx in (
            ("pdf_remision_operador.html", _remision_operador_pdf_ctx(rem)),
            ("pdf_remision_admin.html", _remision_operador_pdf_ctx(rem, admin=True)),
            ("pdf_remision.html", _remision_pdf_ctx(rem)),
        ):
            with self.subTest(template=template):
                html = render_to_string("cotizaciones/" + template, ctx)
                self.assertIn("2x2", html)
                self.assertIn("4x4", html)
                self.assertEqual(html.count("Fecha de elaboración"), 1)
                self.assertNotIn("Fecha: __________________", html)

    def test_multiple_other_processes_keep_individual_costs_for_operator_edit(self):
        rows = [
            {"proceso_id": "otros", "active": True, "costo": 1000, "extras": {"descripcion": "Packing"}},
            {"proceso_id": "otros_1", "active": True, "costo": 2000, "extras": {"descripcion": "Assembly"}},
        ]
        created = self.admin_api.patch(f"/api/ordenes/{self.op.id}/", {"procesos": rows}, format="json")
        self.assertEqual(created.status_code, 200, created.data)
        read = self.operator_api.get(f"/api/ordenes/{self.op.id}/")
        self.assertEqual(read.status_code, 200, read.data)
        self.assertEqual({p["proceso_id"] for p in read.data["procesos"]}, {"otros", "otros_1"})
        self.assertTrue(all("costo" not in p for p in read.data["procesos"]))

        operator_rows = [
            {"proceso_id": "otros", "active": True, "costo": 0, "extras": {"descripcion": "Packing revised"}},
            {"proceso_id": "otros_1", "active": True, "costo": 0, "extras": {"descripcion": "Assembly revised"}},
        ]
        updated = self.operator_api.patch(f"/api/ordenes/{self.op.id}/", {"procesos": operator_rows}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        saved = {p.proceso_id: p for p in self.op.procesos.all()}
        self.assertEqual((saved["otros"].costo, saved["otros_1"].costo), (1000, 2000))
        self.assertEqual(saved["otros_1"].extras["descripcion"], "Assembly revised")
        OpProceso.objects.create(orden=self.op, proceso_id="impresion", active=True, completado=True)
        self.assertEqual(_orden_progreso(self.op)["porcentaje"], 100)
