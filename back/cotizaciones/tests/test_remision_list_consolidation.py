"""The remission list exposes numbers folded into a remaining remission."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, OrdenProduccion, Remision
from cotizaciones.views import _consolidar_remisiones


class RemisionListConsolidationTests(TestCase):
    def setUp(self):
        admin = get_user_model().objects.create_user("rem_list_admin", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(admin)
        self.customer = Cliente.objects.create(nombre="Consolidation customer")

    def make_remision(self):
        order = OrdenProduccion.objects.create(
            cliente=self.customer,
            fecha=timezone.localdate(),
            referencia="Consolidation order",
            cantidad=100,
        )
        return Remision.objects.create(
            orden=order, cliente=self.customer, fecha=timezone.localdate(),
        )

    def test_active_and_history_rows_include_consolidated_numbers(self):
        first = self.make_remision()
        second = self.make_remision()
        target = self.make_remision()
        _consolidar_remisiones(target, [first, second])

        response = self.client.get("/api/remisiones/", {"estado": "pendiente"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(
            response.data["results"][0]["consolidated_numbers"],
            [second.numero, first.numero],
        )

        found = self.client.get("/api/remisiones/", {
            "estado": "pendiente", "search": second.numero,
        })
        self.assertEqual([row["numero"] for row in found.data["results"]], [target.numero])

        target.estado = "liquidada"
        target.save(update_fields=["estado"])
        history = self.client.get("/api/remisiones/", {"estado": "liquidada"})
        self.assertEqual(
            history.data["results"][0]["consolidated_numbers"],
            [second.numero, first.numero],
        )
