"""Ways a sent die (troquel) task goes back for correction.

  - Operador: "Cancelar envío y corregir" (formatos-cuchillas/{id}/cancelar_envio/)
  - Operador: Historial › Remisiones › Devolver (ordenes/devolver_remision_operador/)
  - Admin:    "Devolver al operador" on the remisión (formatos-cuchillas/{id}/devolver/)
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, FormatoCuchillas, OrdenProduccion, PerfilOperador, Remision


def _api(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class DevolverTroquelTestCase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin_dev", is_staff=True, password="x")
        self.op_user = User.objects.create_user("troquelador_dev", password="x")
        PerfilOperador.objects.create(user=self.op_user, es_troquelador=True)
        self.cliente = Cliente.objects.create(nombre="Cliente Devolver", email="c@test.com")
        self.c_admin = _api(self.admin)
        self.c_op = _api(self.op_user)

    def _op_troquel_enviada(self, ref="TQ-DEV"):
        resp = self.c_op.post("/api/ordenes/", {
            "fecha": "2026-11-25", "cliente": self.cliente.id, "referencia": ref,
            "cantidad": 1, "procesos": [{"proceso_id": "troquel", "active": True}],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        op_id = resp.data["id"]
        resp = self.c_op.post("/api/formatos-cuchillas/", {
            "orden": op_id, "cuchilla_cm": 100, "cuchilla_puntos": "2", "cuchilla_tipo": "doble_bisel",
            "grafa_cm": 30, "grafa_puntos": "2", "grafa_altura": "23.4", "enviar": True,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["estado"], "aprobado")
        self.assertTrue(Remision.objects.filter(orden_id=op_id).exists())
        return op_id, resp.data["id"]

    def _assert_reabierta(self, op_id, formato_id, estados):
        op = OrdenProduccion.objects.get(pk=op_id)
        self.assertFalse(op.procesos.get(proceso_id="troquel").completado)
        self.assertFalse(Remision.objects.filter(orden=op).exists())
        self.assertIn(FormatoCuchillas.objects.get(pk=formato_id).estado, estados)

    def test_operador_cancela_envio(self):
        op_id, formato_id = self._op_troquel_enviada()
        resp = self.c_op.post(f"/api/formatos-cuchillas/{formato_id}/cancelar_envio/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self._assert_reabierta(op_id, formato_id, {"borrador"})

    def test_admin_devuelve_al_operador(self):
        op_id, formato_id = self._op_troquel_enviada()
        resp = self.c_admin.post(f"/api/formatos-cuchillas/{formato_id}/devolver/", {"motivo": "x"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self._assert_reabierta(op_id, formato_id, {"devuelto"})

    def test_operador_devuelve_remision_generada_y_luego_cancela_envio(self):
        op_id, formato_id = self._op_troquel_enviada()
        resp = self.c_op.post("/api/ordenes/consolidar_remision_operador/", {"orden_ids": [op_id]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        rem_id = resp.data["remision_id"]
        self.assertTrue(resp.data["remision_numero"])
        resp = self.c_op.post("/api/ordenes/devolver_remision_operador/", {"remision_id": rem_id}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        resp = self.c_op.post(f"/api/formatos-cuchillas/{formato_id}/cancelar_envio/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self._assert_reabierta(op_id, formato_id, {"borrador"})

    def test_operador_cancela_envio_de_remision_generada(self):
        """Generated (numbered) but not liquidated: the operator can still pull it back."""
        op_id, formato_id = self._op_troquel_enviada()
        resp = self.c_op.post("/api/ordenes/consolidar_remision_operador/", {"orden_ids": [op_id]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        resp = self.c_op.post(f"/api/formatos-cuchillas/{formato_id}/cancelar_envio/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self._assert_reabierta(op_id, formato_id, {"borrador"})

    def test_cola_remisiones_trae_formato_y_devolver_la_saca(self):
        """Troqueles › Remisiones "Devolver": the queue row carries the formato to pull back."""
        op_id, formato_id = self._op_troquel_enviada()
        cola = self.c_op.get("/api/ordenes/remisionables_operador/").data
        fila = next(o for o in cola if o["id"] == op_id)
        self.assertEqual(fila["formato_id"], formato_id)
        resp = self.c_op.post(f"/api/formatos-cuchillas/{fila['formato_id']}/cancelar_envio/")
        self.assertEqual(resp.status_code, 200, resp.data)
        cola = self.c_op.get("/api/ordenes/remisionables_operador/").data
        self.assertFalse(any(o["id"] == op_id for o in cola))
        self._assert_reabierta(op_id, formato_id, {"borrador"})
