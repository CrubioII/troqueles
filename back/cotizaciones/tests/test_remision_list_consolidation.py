"""Remission numbering: REM- numbers are taken only when a remission is
issued, so merging or discarding never-issued drafts never leaves gaps; an
issued remission is voided, never deleted."""

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

    def test_pending_remission_has_no_number_until_issued(self):
        rem = self.make_remision()
        self.assertIsNone(rem.numero)
        self.assertEqual(rem.asignar_numero(), "REM-0001")
        self.assertEqual(rem.asignar_numero(), "REM-0001")  # idempotent
        self.assertEqual(Remision.objects.get(pk=rem.pk).numero, "REM-0001")

    def test_merged_or_deleted_pending_remissions_leave_no_gaps(self):
        first = self.make_remision()
        merged = self.make_remision()
        deleted = self.make_remision()
        _consolidar_remisiones(first, [merged])
        deleted.delete()
        first.asignar_numero()
        later = self.make_remision()
        later.asignar_numero()
        self.assertEqual([first.numero, later.numero], ["REM-0001", "REM-0002"])

    def test_list_exposes_references_and_contents(self):
        first = self.make_remision()
        second = self.make_remision()
        first.orden.procesos.create(proceso_id="troquel", active=True)
        second.orden.procesos.create(proceso_id="troquel", active=True)
        second.orden.procesos.create(proceso_id="impresion", active=True)
        second.orden.procesos.create(proceso_id="laminado", active=False)
        _consolidar_remisiones(first, [second])
        row = self.client.get("/api/remisiones/", {"estado": "pendiente"}).data["results"][0]
        self.assertEqual(row["referencias"], ["Consolidation order", "Consolidation order"])
        self.assertEqual((row["num_productos"], row["num_troqueles"], row["num_procesos"]), (2, 2, 3))

    def test_merged_unissued_sources_stay_unnumbered_and_keep_order_links(self):
        first = self.make_remision()
        second = self.make_remision()
        target = self.make_remision()
        target.asignar_numero()
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
        self.assertEqual(next_remission.asignar_numero(), "REM-0002")

        target.estado = "liquidada"
        target.save(update_fields=["estado"])
        history = self.client.get("/api/remisiones/", {"estado": "liquidada"})
        self.assertEqual(history.data["results"][0]["numero"], target.numero)

    def test_restoring_merged_sources_assigns_unique_numbers(self):
        first = self.make_remision()
        second = self.make_remision()
        first.asignar_numero()
        _consolidar_remisiones(first, [second])
        self.assertIsNone(Remision.objects.get(pk=second.pk).numero)
        _desconsolidar_remision(first)
        second.refresh_from_db()
        self.assertEqual(second.estado, "pendiente")
        self.assertIsNone(second.numero)
        self.assertEqual(second.asignar_numero(), "REM-0002")

    def test_new_number_continues_after_highest_issued_number(self):
        order = OrdenProduccion.objects.create(
            cliente=self.customer, fecha=timezone.localdate(),
            referencia="Prior order", cantidad=1,
        )
        Remision.objects.create(
            orden=order, cliente=self.customer, fecha=timezone.localdate(),
            numero="REM-0075",
        )
        self.assertEqual(self.make_remision().asignar_numero(), "REM-0076")


class RemisionNeverDeletedTests(TestCase):
    """An issued remission is never deleted, only voided (anulada): it keeps
    its REM- number so the consecutive never loses one."""

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user("rem_anular_admin", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.customer = Cliente.objects.create(nombre="Anular customer")

    def make_remision(self, issue=True):
        order = OrdenProduccion.objects.create(
            cliente=self.customer, fecha=timezone.localdate(), referencia="Anular order", cantidad=1,
        )
        rem = Remision.objects.create(orden=order, cliente=self.customer, fecha=timezone.localdate())
        rem.items.create(descripcion="Troquel", cantidad=1, valor_total=1000, op=order)
        if issue:
            rem.asignar_numero()
        return rem

    def test_admin_voids_instead_of_deleting(self):
        rem = self.make_remision()
        order = rem.orden
        response = self.client.post(f"/api/remisiones/{rem.id}/anular/", {"motivo": "Precio errado"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["anulada"])
        rem.refresh_from_db()
        self.assertEqual(
            (rem.estado, rem.numero, rem.orden_id, rem.orden_anulada_id, rem.anulacion_motivo),
            ("anulada", "REM-0001", None, order.id, "Precio errado"),
        )
        self.assertEqual(rem.anulada_por, self.admin)
        self.assertEqual(rem.items.count(), 1)
        # The OP is free again: a new remission takes the next number.
        new = Remision.objects.create(orden=order, cliente=self.customer, fecha=timezone.localdate())
        self.assertEqual(new.asignar_numero(), "REM-0002")
        # Listed under Anuladas with its OP, read-only and not voidable twice.
        row = self.client.get("/api/remisiones/", {"estado": "anulada"}).data["results"][0]
        self.assertEqual((row["numero"], row["orden_numero"]), ("REM-0001", order.numero))
        detail = self.client.get(f"/api/remisiones/{rem.id}/").data
        self.assertEqual(detail["orden_numero"], order.numero)
        self.assertEqual(
            self.client.patch(f"/api/remisiones/{rem.id}/", {"observaciones": "x"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/remisiones/{rem.id}/anular/").status_code, 409)

    def test_old_delete_call_also_only_voids(self):
        rem = self.make_remision()
        self.assertEqual(self.client.delete(f"/api/remisiones/{rem.id}/").status_code, 200)
        rem.refresh_from_db()
        self.assertEqual((rem.estado, rem.numero), ("anulada", "REM-0001"))

    def test_never_issued_draft_is_just_discarded(self):
        rem = self.make_remision(issue=False)
        response = self.client.post(f"/api/remisiones/{rem.id}/anular/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["anulada"])
        self.assertFalse(Remision.objects.filter(pk=rem.pk).exists())

    def test_voiding_a_merge_gives_each_op_its_remission_back(self):
        target = self.make_remision()
        source = self.make_remision(issue=False)
        _consolidar_remisiones(target, [source])
        self.client.post(f"/api/remisiones/{target.id}/anular/")
        source.refresh_from_db()
        target.refresh_from_db()
        self.assertEqual(source.estado, "pendiente")
        self.assertEqual(target.estado, "anulada")
        self.assertFalse(target.remisiones_consolidadas.exists())

    def test_merging_an_issued_remission_keeps_its_number(self):
        target = self.make_remision()
        issued = self.make_remision()
        _consolidar_remisiones(target, [issued])
        issued.refresh_from_db()
        self.assertEqual((issued.estado, issued.numero), ("consolidada", "REM-0002"))
        # Restored with the same number when the merge is undone.
        _desconsolidar_remision(target)
        issued.refresh_from_db()
        self.assertEqual((issued.estado, issued.numero), ("pendiente", "REM-0002"))
        self.assertEqual(self.make_remision().numero, "REM-0003")

    def test_operator_cancel_voids_an_issued_remission(self):
        rem = self.make_remision()
        response = self.client.post(f"/api/ordenes/{rem.orden_id}/cancelar_remision/")
        self.assertEqual(response.status_code, 200)
        rem.refresh_from_db()
        self.assertEqual((rem.estado, rem.numero), ("anulada", "REM-0001"))
