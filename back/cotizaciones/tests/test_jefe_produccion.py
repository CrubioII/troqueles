"""Jefe de producción (PerfilOperador.es_jefe_produccion).

One level below the Admin: the only Operador who can correct what other users
already submitted. A plain Operador can't edit or undo a submitted station
record — not even his own.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, Notificacion, OrdenProduccion, PerfilOperador, RegistroProceso


def _api(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class JefeProduccionTestCase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin_jefe", is_staff=True, password="x")
        self.u_op = User.objects.create_user("op_jefe", password="x")
        PerfilOperador.objects.create(user=self.u_op, es_general=True)
        self.u_otro = User.objects.create_user("op2_jefe", password="x")
        PerfilOperador.objects.create(user=self.u_otro, es_general=True)
        self.u_jefe = User.objects.create_user("jefe_jefe", password="x")
        PerfilOperador.objects.create(user=self.u_jefe, es_jefe_produccion=True)
        self.c_op = _api(self.u_op)
        self.c_otro = _api(self.u_otro)
        self.c_jefe = _api(self.u_jefe)
        self.c_admin = _api(self.admin)
        self.cliente = Cliente.objects.create(nombre="Cliente Jefe", email="j@test.com")

    def _registro(self, cantidad=1000, confirmar=False):
        resp = self.c_op.post("/api/ordenes/", {
            "fecha": "2026-11-27", "cliente": self.cliente.id, "referencia": "CAJA", "cantidad": 1000,
            "procesos": [{"proceso_id": "impresion", "active": True}, {"proceso_id": "laminado", "active": True}],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        resp = self.c_op.post("/api/registros-proceso/", {
            "orden": resp.data["id"], "estacion": "impresora", "proceso_id": "impresion",
            "cantidad_realizada": cantidad, "tiro_active": True, "tiro_colores_num": 4,
            "confirmar_faltante": confirmar,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data["id"]

    def test_claim_en_me(self):
        self.assertTrue(self.c_jefe.get("/api/auth/me/").data["corregir_registros"])
        self.assertFalse(self.c_op.get("/api/auth/me/").data["corregir_registros"])
        self.assertTrue(self.c_admin.get("/api/auth/me/").data["corregir_registros"])

    def test_jefe_tiene_acceso_general(self):
        me = self.c_jefe.get("/api/auth/me/").data
        self.assertIn("impresora", me["estaciones"])
        self.assertTrue(me["troqueles"])
        self.assertTrue(me["remisiones_generales"])

    def test_operador_no_edita_ni_lo_suyo_ni_lo_ajeno(self):
        rid = self._registro()
        for c in (self.c_op, self.c_otro):
            resp = c.patch(f"/api/registros-proceso/{rid}/", {"observaciones": "x"}, format="json")
            self.assertEqual(resp.status_code, 403)
            resp = c.post(f"/api/registros-proceso/{rid}/anular/")
            self.assertEqual(resp.status_code, 403)
        self.assertEqual(RegistroProceso.objects.get(pk=rid).observaciones, "")

    def test_jefe_corrige_el_registro_de_otro(self):
        rid = self._registro()
        resp = self.c_jefe.patch(f"/api/registros-proceso/{rid}/", {
            "cantidad_realizada": 990, "tiro_colores_num": 2, "observaciones": "Corregido",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        r = RegistroProceso.objects.get(pk=rid)
        self.assertEqual((r.cantidad_realizada, r.tiro_colores_num, r.observaciones), (990, 2, "Corregido"))
        # Who registered it stays the same.
        self.assertEqual(r.operador_id, self.u_op.id)

    def test_jefe_no_mueve_el_registro_ni_toca_dinero(self):
        rid = self._registro()
        otra = OrdenProduccion.objects.create(fecha="2026-11-27", cliente=self.cliente, referencia="OTRA", cantidad=1)
        resp = self.c_jefe.patch(f"/api/registros-proceso/{rid}/", {
            "orden": otra.id, "estacion": "laminadora", "monto_cobrado": 50000,
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        r = RegistroProceso.objects.get(pk=rid)
        self.assertNotEqual(r.orden_id, otra.id)
        self.assertEqual(r.estacion, "impresora")
        self.assertIsNone(r.monto_cobrado)

    def test_corregir_cantidad_recalcula_faltante(self):
        rid = self._registro(cantidad=500, confirmar=True)
        self.assertTrue(RegistroProceso.objects.get(pk=rid).faltante)
        self.assertTrue(Notificacion.objects.filter(registro_id=rid).exists())
        resp = self.c_jefe.patch(f"/api/registros-proceso/{rid}/", {"cantidad_realizada": 1000}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(RegistroProceso.objects.get(pk=rid).faltante)
        self.assertFalse(Notificacion.objects.filter(registro_id=rid).exists())

    def test_jefe_anula_registro_de_otro(self):
        rid = self._registro()
        resp = self.c_jefe.post(f"/api/registros-proceso/{rid}/anular/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(RegistroProceso.objects.filter(pk=rid).exists())

    def test_admin_sigue_pudiendo(self):
        rid = self._registro()
        resp = self.c_admin.patch(f"/api/registros-proceso/{rid}/", {"monto_cobrado": 1234}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(RegistroProceso.objects.get(pk=rid).monto_cobrado, 1234)
