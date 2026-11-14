"""Free station record (POST /api/registros-proceso/libre/).

A station worker registers a job the Admin never loaded: an OP is created on
the fly (origen=registro_libre, no prices) and either completes right away —
landing in Producción General for remission — or keeps flowing through the
extra processes the worker picked.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, OrdenProduccion, PerfilOperador, Remision

User = get_user_model()
URL = "/api/registros-proceso/libre/"


def _api(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class RegistroLibreTestCase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin_libre", is_staff=True, password="x")
        self.u_estaciones = User.objects.create_user("op_est_libre", password="x")
        PerfilOperador.objects.create(user=self.u_estaciones, es_estaciones=True)
        self.u_general = User.objects.create_user("op_gen_libre", password="x")
        PerfilOperador.objects.create(user=self.u_general, es_general=True)
        self.u_guillotina = User.objects.create_user("op_guil_libre", password="x")
        PerfilOperador.objects.create(user=self.u_guillotina, es_guillotina=True)
        self.cliente = Cliente.objects.create(nombre="Cliente Libre", email="l@test.com")
        self.c_est = _api(self.u_estaciones)
        self.c_gen = _api(self.u_general)

    def _payload(self, **extra):
        data = {
            "estacion": "impresora",
            "proceso_id": "impresion",
            "cliente": self.cliente.id,
            "referencia": "Volante promo",
            "cantidad_realizada": 500,
            "tiro_active": True,
            "tiro_colores_num": 4,
        }
        data.update(extra)
        return data

    def _remisionables(self):
        resp = self.c_gen.get("/api/ordenes/remisionables_produccion/")
        self.assertEqual(resp.status_code, 200)
        return resp.data

    def test_sin_procesos_adicionales_queda_lista_para_remision(self):
        resp = self.c_est.post(URL, self._payload(), format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIsNone(resp.data["siguiente_estacion"])

        op = OrdenProduccion.objects.get(pk=resp.data["orden"])
        self.assertEqual(op.origen, "registro_libre")
        self.assertEqual(op.cantidad, 500)
        self.assertEqual(op.cliente, self.cliente)
        self.assertTrue(op.procesos.get(proceso_id="impresion").completado)
        self.assertTrue(Remision.objects.filter(orden=op, estado="pendiente").exists())

        rem = self._remisionables()
        fila = next(r for r in rem if r["id"] == op.id)
        self.assertEqual(fila["origen"], "registro_libre")

    def test_con_procesos_adicionales_pasa_a_la_siguiente_estacion(self):
        resp = self.c_est.post(
            URL, self._payload(procesos_adicionales=["laminado", "troquelado"]), format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["siguiente_estacion"]["id"], "laminadora")
        op_id = resp.data["orden"]
        self.assertFalse(Remision.objects.filter(orden_id=op_id).exists())
        self.assertNotIn(op_id, [r["id"] for r in self._remisionables()])

        cola = self.c_est.get("/api/ordenes/produccion_pendientes/?estacion=laminadora")
        self.assertEqual(cola.status_code, 200)
        filas = cola.data if isinstance(cola.data, list) else cola.data.get("results", [])
        self.assertIn(op_id, [o["id"] for o in filas])

        for estacion, proceso in (("laminadora", "laminado"), ("troqueladora", "troquelado")):
            r = self.c_est.post("/api/registros-proceso/", {
                "orden": op_id, "estacion": estacion, "proceso_id": proceso,
                "cantidad_realizada": 500,
            }, format="json")
            self.assertEqual(r.status_code, 201, r.data)

        self.assertTrue(Remision.objects.filter(orden_id=op_id).exists())
        self.assertIn(op_id, [r["id"] for r in self._remisionables()])

    def test_rechaza_proceso_anterior_o_desconocido(self):
        resp = self.c_est.post(URL, self._payload(
            estacion="laminadora", proceso_id="laminado", procesos_adicionales=["impresion"],
        ), format="json")
        self.assertEqual(resp.status_code, 400)
        resp = self.c_est.post(URL, self._payload(procesos_adicionales=["nada"]), format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(OrdenProduccion.objects.exists())

    def test_valida_cliente_referencia_y_cantidad(self):
        for extra in ({"cliente": 99999}, {"referencia": "  "}, {"cantidad_realizada": 0}):
            resp = self.c_est.post(URL, self._payload(**extra), format="json")
            self.assertEqual(resp.status_code, 400, extra)
        self.assertFalse(OrdenProduccion.objects.exists())

    def test_requiere_acceso_a_la_estacion(self):
        resp = _api(self.u_guillotina).post(URL, self._payload(), format="json")
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(OrdenProduccion.objects.exists())

    def test_operador_no_escribe_dinero(self):
        resp = self.c_est.post(URL, self._payload(monto_cobrado=123456), format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        op = OrdenProduccion.objects.get(pk=resp.data["orden"])
        self.assertIsNone(op.registros_proceso.get().monto_cobrado)
        self.assertIsNone(op.valor_total_override)

    def test_anular_borra_la_op_libre(self):
        resp = self.c_est.post(URL, self._payload(), format="json")
        op_id = resp.data["orden"]
        r = self.c_est.post(f"/api/registros-proceso/{resp.data['id']}/anular/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(OrdenProduccion.objects.filter(pk=op_id).exists())
