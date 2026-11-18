"""Facturación module: pending list, invoice registration, gap-free numbering,
payment states, filters, export and access."""

import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, Factura, OrdenProduccion, PerfilOperador, Remision


class FacturacionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.contadora = User.objects.create_user("fact_contadora")
        PerfilOperador.objects.create(user=self.contadora, es_contadora=True)
        self.operador = User.objects.create_user("fact_operador")
        PerfilOperador.objects.create(user=self.operador, es_general=True)
        self.api = APIClient()
        self.api.force_authenticate(self.contadora)
        self.pepito = Cliente.objects.create(nombre="Pepito Pérez")
        self.otro = Cliente.objects.create(nombre="Otro Cliente")

    def make_remision(self, cliente=None, referencia="Caja kraft", estado="liquidada",
                      fecha=None, descripcion="Troquel caja", valor=1000, procesos=("troquel",),
                      issue=True):
        cliente = cliente or self.pepito
        fecha = fecha or timezone.localdate()
        orden = OrdenProduccion.objects.create(
            cliente=cliente, fecha=fecha, referencia=referencia, cantidad=100,
        )
        for proceso_id in procesos:
            orden.procesos.create(proceso_id=proceso_id, active=True)
        rem = Remision.objects.create(orden=orden, cliente=cliente, fecha=fecha, estado=estado)
        rem.items.create(descripcion=descripcion, cantidad=1, valor_total=valor)
        if issue:
            rem.asignar_numero()
        return rem

    def facturar(self, rems, total="5000", estado="por_cobrar", **extra):
        return self.api.post("/api/facturas/", {
            "remision_ids": [r.id for r in rems], "total": total, "estado": estado, **extra,
        }, format="json")

    def pendientes(self, **params):
        return self.api.get("/api/facturas/pendientes/", params).data["results"]

    def test_remissions_are_pending_as_soon_as_they_exist(self):
        # The Admin's liquidation is not required: a remission is billable
        # from the moment it exists. Merged ones are billed in their target.
        liquidada = self.make_remision()
        pendiente = self.make_remision(estado="pendiente", issue=False)
        self.make_remision(estado="consolidada", issue=False)
        rows = self.pendientes()
        self.assertEqual([r["id"] for r in rows], [liquidada.id, pendiente.id])
        self.assertEqual(rows[0]["total"], "1000")
        self.assertEqual(rows[0]["referencias"], ["Caja kraft"])
        self.assertIsNone(rows[1]["numero"])

        self.assertEqual(self.facturar([liquidada, pendiente]).status_code, 201)
        self.assertEqual(self.pendientes(), [])
        # Invoicing issues the remission's REM- number.
        pendiente.refresh_from_db()
        self.assertTrue(pendiente.numero)

    def test_invoiced_remission_cannot_be_deleted_or_merged(self):
        admin = get_user_model().objects.create_user("fact_admin2", is_staff=True)
        facturada = self.make_remision(estado="pendiente")
        otra = self.make_remision(estado="pendiente")
        self.facturar([facturada])
        self.api.force_authenticate(admin)
        res = self.api.delete(f"/api/remisiones/{facturada.id}/")
        self.assertEqual(res.status_code, 409)
        self.assertIn("FAC-0001", res.data["error"])
        res = self.api.post(f"/api/remisiones/{otra.id}/importar/", {"remision_ids": [facturada.id]}, format="json")
        self.assertEqual(res.status_code, 409)
        res = self.api.post(f"/api/remisiones/{facturada.id}/importar/", {"remision_ids": [otra.id]}, format="json")
        self.assertEqual(res.status_code, 409)
        self.assertTrue(Remision.objects.filter(pk=facturada.pk).exists())
        # Once the invoice is cancelled the Admin can work on it again.
        self.api.force_authenticate(self.contadora)
        f = Factura.objects.get()
        self.api.patch(f"/api/facturas/{f.id}/", {"estado": "cancelada"}, format="json")
        self.api.force_authenticate(admin)
        self.assertEqual(self.api.delete(f"/api/remisiones/{facturada.id}/").status_code, 200)

    def test_number_is_assigned_from_one_without_gaps(self):
        a, b, c = self.make_remision(), self.make_remision(), self.make_remision()
        self.assertEqual(self.api.get("/api/facturas/siguiente_numero/").data["siguiente_codigo"], "FAC-0001")
        # A number sent by the client is ignored: the server assigns it.
        res = self.facturar([a], numero=500)
        self.assertEqual((res.data["numero"], res.data["codigo"]), (1, "FAC-0001"))
        self.assertEqual(self.facturar([b]).data["codigo"], "FAC-0002")
        self.assertEqual(self.api.get("/api/facturas/siguiente_numero/").data["siguiente_codigo"], "FAC-0003")
        self.assertEqual(self.facturar([c]).data["codigo"], "FAC-0003")

    def test_only_last_invoice_can_be_deleted(self):
        a, b = self.make_remision(), self.make_remision()
        f1 = self.facturar([a]).data
        f2 = self.facturar([b]).data
        self.assertEqual(self.api.delete(f"/api/facturas/{f1['id']}/").status_code, 409)
        self.assertEqual(self.api.delete(f"/api/facturas/{f2['id']}/").status_code, 200)
        self.assertEqual([r["id"] for r in self.pendientes()], [b.id])

    def test_several_remissions_same_client_only(self):
        a, b = self.make_remision(), self.make_remision()
        ajena = self.make_remision(cliente=self.otro)
        self.assertEqual(self.facturar([a, ajena]).status_code, 400)
        res = self.facturar([a, b], total="1.234.000".replace(".", ""))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(len(res.data["remisiones"]), 2)
        self.assertEqual(res.data["total"], "1234000.00")

    def test_cancelled_invoice_frees_remissions_and_keeps_number(self):
        a = self.make_remision()
        f1 = self.facturar([a]).data
        res = self.api.patch(f"/api/facturas/{f1['id']}/", {"estado": "cancelada"}, format="json")
        self.assertEqual(res.data["estado"], "cancelada")
        self.assertEqual([r["id"] for r in self.pendientes()], [a.id])
        self.assertEqual(self.facturar([a]).status_code, 201)
        # Reviving the voided one would double-invoice the remission.
        res = self.api.patch(f"/api/facturas/{f1['id']}/", {"estado": "pagada"}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_history_filters_combine(self):
        hoy = timezone.localdate()
        ayer = hoy - datetime.timedelta(days=1)
        r1 = self.make_remision(procesos=("troquel", "laminado"))
        r2 = self.make_remision(procesos=("impresion",))
        r3 = self.make_remision(cliente=self.otro, procesos=("laminado", "uvParcial", "otros_1"))
        self.facturar([r1], fecha=ayer.isoformat())
        self.facturar([r2], estado="pagada")
        self.facturar([r3])

        def numeros(**params):
            return [f["numero"] for f in self.api.get("/api/facturas/", params).data["results"]]

        self.assertEqual(numeros(cliente="pepito"), [2, 1])
        self.assertEqual(numeros(cliente="pepito", trabajo="laminado"), [1])
        self.assertEqual(numeros(trabajo="laminado", fecha_after=hoy.isoformat()), [3])
        self.assertEqual(numeros(fecha_before=ayer.isoformat()), [1])
        self.assertEqual(numeros(fecha=hoy.isoformat()), [3, 2])
        self.assertEqual(numeros(estado="pagada"), [2])
        self.assertEqual(numeros(numero="FAC-0003"), [3])
        self.assertEqual(numeros(estado="por_cobrar", cliente="pepito"), [1])
        self.assertEqual(numeros(trabajo="barnizado"), [3])
        self.assertEqual(self.pendientes(), [])
        totales = self.api.get("/api/facturas/").data["totales"]
        self.assertEqual(totales, {"por_cobrar": "10000", "pagada": "5000", "cancelada": "0"})

    def test_state_is_required_on_register(self):
        a = self.make_remision(procesos=("laminado", "uvTotal", "impresion", "otros"))
        self.assertEqual(self.facturar([a], estado="").status_code, 400)
        self.assertEqual(self.facturar([a], estado="cancelada").status_code, 400)
        res = self.facturar([a], estado="pagada")
        self.assertEqual(res.data["estado"], "pagada")
        self.assertEqual(res.data["trabajos"], ["impresion", "laminado", "barnizado"])

    def test_detail_has_full_remission_breakdown(self):
        a = self.make_remision(procesos=("impresion",), descripcion="Volantes", valor=1500)
        f = self.facturar([a], total="1500", observaciones="Pago en 30 días").data
        res = self.api.get(f"/api/facturas/{f['id']}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["codigo"], "FAC-0001")
        self.assertEqual(res.data["cliente_datos"]["nombre"], "Pepito Pérez")
        self.assertEqual(res.data["creada_por"], "fact_contadora")
        rem = res.data["remisiones"][0]
        self.assertEqual(rem["numero"], a.numero)
        self.assertEqual(rem["items"][0]["descripcion"], "Volantes")
        self.assertEqual(rem["total"], "1500")
        self.assertEqual(rem["trabajos"], ["impresion"])
        self.assertIn("troqueles", rem)
        self.assertIn("procesos", rem)

    def test_access(self):
        self.api.force_authenticate(self.operador)
        self.assertEqual(self.api.get("/api/facturas/").status_code, 403)
        self.assertEqual(self.api.get("/api/facturas/pendientes/").status_code, 403)
        admin = get_user_model().objects.create_user("fact_admin", is_staff=True)
        self.api.force_authenticate(admin)
        self.assertEqual(self.api.get("/api/facturas/").status_code, 200)
