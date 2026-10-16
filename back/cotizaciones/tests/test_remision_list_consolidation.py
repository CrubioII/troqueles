"""The remission list exposes numbers folded into a remaining remission."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, OrdenProduccion, Remision
from cotizaciones.views import _consolidar_remisiones, _desconsolidar_remision


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

    def test_merged_sources_release_numbers_and_keep_order_links(self):
        first = self.make_remision()
        second = self.make_remision()
        target = self.make_remision()
        _consolidar_remisiones(target, [first, second])
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertIsNone(first.numero)
        self.assertIsNone(second.numero)
        self.assertEqual({op.pk for op in [first.orden, second.orden]},
                         {source.orden_id for source in target.remisiones_consolidadas.all()})

        response = self.client.get("/api/remisiones/", {"estado": "pendiente"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["numero"], target.numero)
        self.assertNotIn("consolidated_numbers", response.data["results"][0])

        next_remission = self.make_remision()
        self.assertEqual(next_remission.numero, "REM-0004")

        target.estado = "liquidada"
        target.save(update_fields=["estado"])
        history = self.client.get("/api/remisiones/", {"estado": "liquidada"})
        self.assertEqual(history.data["results"][0]["numero"], target.numero)

    def test_restoring_merged_sources_assigns_unique_numbers(self):
        first = self.make_remision()
        second = self.make_remision()
        _consolidar_remisiones(first, [second])
        self.assertIsNone(Remision.objects.get(pk=second.pk).numero)
        _desconsolidar_remision(first)
        second.refresh_from_db()
        self.assertEqual(second.estado, "pendiente")
        self.assertTrue(second.numero)
        self.assertNotEqual(second.numero, first.numero)

    def test_new_number_continues_after_highest_issued_number(self):
        order = OrdenProduccion.objects.create(
            cliente=self.customer, fecha=timezone.localdate(),
            referencia="Prior order", cantidad=1,
        )
        Remision.objects.create(
            orden=order, cliente=self.customer, fecha=timezone.localdate(),
            numero="REM-0075",
        )
        self.assertEqual(self.make_remision().numero, "REM-0076")
