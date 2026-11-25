"""Station history: paginated, several stations in one list, server-side search."""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, PerfilOperador


def _api(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class HistorialEstacionesTestCase(TestCase):
    def setUp(self):
        self.u_general = User.objects.create_user("gen_hist_est", password="x")
        PerfilOperador.objects.create(user=self.u_general, es_general=True)
        self.u_guill = User.objects.create_user("guill_hist_est", password="x")
        PerfilOperador.objects.create(user=self.u_guill, es_guillotina=True)
        self.c_general = _api(self.u_general)
        self.c_guill = _api(self.u_guill)
        self.cliente = Cliente.objects.create(nombre="Litografía Búsqueda", email="l@test.com")

    def _op_con_corte(self, ref):
        resp = self.c_general.post("/api/ordenes/", {
            "fecha": "2026-11-25", "cliente": self.cliente.id, "referencia": ref, "cantidad": 100,
            "corte_inicial_active": True,
            "procesos": [{"proceso_id": "corteInicial", "active": True}, {"proceso_id": "impresion", "active": True}],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        op_id = resp.data["id"]
        resp = self.c_guill.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "guillotina", "proceso_id": "corteInicial",
            "cantidad_realizada": 100, "tamano": "pliego",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return op_id

    def test_varias_estaciones_paginado_y_busqueda(self):
        self._op_con_corte("CAJA AZUL")
        self._op_con_corte("SOBRE ROJO")
        d = self.c_guill.get("/api/registros-proceso/?estacion=guillotina,guillotina_final&page=1").data
        self.assertEqual(d["count"], 2)
        d = self.c_guill.get("/api/registros-proceso/?estacion=guillotina,guillotina_final&page=1&search=sobre").data
        self.assertEqual([r["orden_referencia"] for r in d["results"]], ["SOBRE ROJO"])

    def test_estacion_ajena_en_la_lista_da_403(self):
        resp = self.c_guill.get("/api/registros-proceso/?estacion=guillotina,impresora")
        self.assertEqual(resp.status_code, 403)
