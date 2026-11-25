"""Adding new work to an OP that already finished (e.g. a printing job on a
die-task OP): the OP reopens and its remission comes back with everything."""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, PerfilOperador, Remision


def _api(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class AgregarTrabajoOpTestCase(TestCase):
    def setUp(self):
        self.u_general = User.objects.create_user("gen_agregar", password="x")
        PerfilOperador.objects.create(user=self.u_general, es_general=True)
        self.c = _api(self.u_general)
        self.cliente = Cliente.objects.create(nombre="Cliente Agregar", email="a@test.com")
        resp = self.c.post("/api/ordenes/", {
            "fecha": "2026-11-25", "cliente": self.cliente.id, "referencia": "CAJA + TROQUEL",
            "cantidad": 300, "procesos": self._procesos(impresion=False),
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.op_id = resp.data["id"]
        resp = self.c.post("/api/formatos-cuchillas/", {
            "orden": self.op_id, "cuchilla_cm": 80, "cuchilla_puntos": "2", "cuchilla_tipo": "doble_bisel",
            "grafa_cm": 20, "grafa_puntos": "2", "grafa_altura": "23.4", "enviar": True,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(Remision.objects.filter(orden_id=self.op_id).exists())

    @staticmethod
    def _procesos(impresion):
        # Like the full OP form: every row sent, only some active.
        return [
            {"proceso_id": "troquel", "active": True},
            {"proceso_id": "impresion", "active": impresion},
            {"proceso_id": "laminado", "active": False},
        ]

    def _patch(self, impresion):
        return self.c.patch(f"/api/ordenes/{self.op_id}/", {"procesos": self._procesos(impresion)}, format="json")

    def _en_cola_remisiones(self):
        return any(f["id"] == self.op_id for f in self.c.get("/api/ordenes/remisionables_central/").data)

    def test_op_con_remision_pendiente_sigue_en_la_lista_de_ordenes(self):
        data = self.c.get("/api/ordenes/").data
        self.assertIn(self.op_id, [o["id"] for o in data["results"]])

    def test_agregar_trabajo_reabre_y_la_remision_vuelve_con_todo(self):
        self.assertTrue(self._en_cola_remisiones())
        resp = self._patch(impresion=True)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIsNone(resp.data["remision_id"])
        self.assertFalse(Remision.objects.filter(orden_id=self.op_id).exists())
        self.assertFalse(self._en_cola_remisiones())
        cola = self.c.get("/api/ordenes/produccion_pendientes/?estacion=impresora").data
        self.assertIn(self.op_id, [o["id"] for o in cola])

        resp = self.c.post("/api/registros-proceso/", {
            "orden": self.op_id, "estacion": "impresora", "proceso_id": "impresion",
            "cantidad_realizada": 300, "tamano": "pliego", "tiro_active": True, "tiro_colores_num": 4,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(self._en_cola_remisiones())
        prev = self.c.post("/api/ordenes/previsualizar_remision_operador/", {"orden_ids": [self.op_id]}, format="json").data
        self.assertEqual(len(prev["troqueles"]), 1)
        self.assertEqual([i["proceso_label"] for i in prev["procesos"][0]["items"]], ["Impresión"])

    def test_quitar_el_trabajo_nuevo_devuelve_la_remision(self):
        self._patch(impresion=True)
        resp = self._patch(impresion=False)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data["remision_id"])
        self.assertTrue(self._en_cola_remisiones())

    def test_con_remision_generada_hay_que_devolverla_primero(self):
        rem = self.c.post("/api/ordenes/consolidar_remision_operador/", {"orden_ids": [self.op_id]}, format="json").data
        resp = self._patch(impresion=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("devuélvela", str(resp.data))
        self.assertTrue(Remision.objects.filter(orden_id=self.op_id, generada_en__isnull=False).exists())
        # Returned from Historial, the OP takes the new work.
        resp = self.c.post("/api/ordenes/devolver_remision_operador/", {"remision_id": rem["remision_id"]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self._patch(impresion=True).status_code, 200)
        self.assertFalse(Remision.objects.filter(orden_id=self.op_id).exists())

    def test_guardar_sin_cambios_no_toca_la_remision(self):
        rem_id = Remision.objects.get(orden_id=self.op_id).id
        resp = self.c.patch(f"/api/ordenes/{self.op_id}/", {"referencia": "CAJA + TROQUEL v2"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Remision.objects.get(orden_id=self.op_id).id, rem_id)
