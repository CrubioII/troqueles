"""Producción › Remisiones (central page): one queue for die tasks and
production orders, and a preview of the remisión that generates nothing."""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, PerfilOperador, Remision


def _api(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class RemisionesCentralTestCase(TestCase):
    def setUp(self):
        self.u_general = User.objects.create_user("general_central", password="x")
        PerfilOperador.objects.create(user=self.u_general, es_general=True)
        self.u_troq = User.objects.create_user("troq_central", password="x")
        PerfilOperador.objects.create(user=self.u_troq, es_troquelador=True)
        self.c_general = _api(self.u_general)
        self.c_troq = _api(self.u_troq)
        self.cliente = Cliente.objects.create(nombre="Cliente Central", email="c@test.com", nit="900")
        self.otro = Cliente.objects.create(nombre="Otro Cliente", email="o@test.com")

    def _troquel(self, ref="TQ-C", cliente=None):
        resp = self.c_troq.post("/api/ordenes/", {
            "fecha": "2026-11-25", "cliente": (cliente or self.cliente).id, "referencia": ref,
            "cantidad": 1, "procesos": [{"proceso_id": "troquel", "active": True}],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        op_id = resp.data["id"]
        resp = self.c_troq.post("/api/formatos-cuchillas/", {
            "orden": op_id, "cuchilla_cm": 120, "cuchilla_puntos": "2", "cuchilla_tipo": "doble_bisel",
            "grafa_cm": 30, "grafa_puntos": "2", "grafa_altura": "23.4",
            "observaciones": "Nota del troquelador", "enviar": True,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return op_id

    def _produccion(self, ref="PROD-C"):
        resp = self.c_general.post("/api/ordenes/", {
            "fecha": "2026-11-25", "cliente": self.cliente.id, "referencia": ref,
            "cantidad": 500, "procesos": [{"proceso_id": "terminado", "active": True}],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data["id"]

    def test_cola_central_por_rol(self):
        tq, prod = self._troquel(), self._produccion()
        filas = {f["id"]: f for f in self.c_general.get("/api/ordenes/remisionables_central/").data}
        self.assertEqual(filas[tq]["tipo"], "troquel")
        self.assertTrue(filas[tq]["formato_id"])
        self.assertEqual(filas[prod]["tipo"], "produccion")
        filas_troq = {f["id"] for f in self.c_troq.get("/api/ordenes/remisionables_central/").data}
        self.assertIn(tq, filas_troq)
        self.assertNotIn(prod, filas_troq)

    def test_previsualizar_no_genera_nada(self):
        tq, prod = self._troquel(), self._produccion()
        antes = list(Remision.objects.values_list("id", "estado", "numero", "generada_en"))
        resp = self.c_general.post("/api/ordenes/previsualizar_remision_operador/",
                                   {"orden_ids": [tq, prod]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        d = resp.data
        self.assertEqual(d["cliente"]["nombre"], "Cliente Central")
        self.assertEqual({o["id"]: o["tipo"] for o in d["ops"]}, {tq: "troquel", prod: "produccion"})
        self.assertEqual(len(d["troqueles"]), 1)
        self.assertEqual(d["troqueles"][0]["observaciones"], "Nota del troquelador")
        self.assertTrue(d["troqueles"][0]["consumos"])
        self.assertEqual(len(d["procesos"]), 1)
        self.assertEqual(d["procesos"][0]["cantidad_entregada"], "500")
        # Nothing changed: same remissions, both OPs still in the queue.
        self.assertEqual(list(Remision.objects.values_list("id", "estado", "numero", "generada_en")), antes)
        cola = {f["id"] for f in self.c_general.get("/api/ordenes/remisionables_central/").data}
        self.assertTrue({tq, prod} <= cola)

        # Generating right after takes the number the preview announced.
        resp = self.c_general.post("/api/ordenes/consolidar_remision_operador/",
                                   {"orden_ids": [tq, prod]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["remision_numero"], d["numero_estimado"])
        cola = {f["id"] for f in self.c_general.get("/api/ordenes/remisionables_central/").data}
        self.assertFalse({tq, prod} & cola)

    def test_previsualizar_mismas_validaciones_que_generar(self):
        a, b = self._troquel(), self._troquel("TQ-OTRO", cliente=self.otro)
        resp = self.c_general.post("/api/ordenes/previsualizar_remision_operador/",
                                   {"orden_ids": [a, b]}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("mismo cliente", resp.data["error"])

    def test_troquelador_no_previsualiza_produccion_de_cadena(self):
        resp = self.c_general.post("/api/ordenes/", {
            "fecha": "2026-11-25", "cliente": self.cliente.id, "referencia": "CADENA",
            "cantidad": 500, "procesos": [{"proceso_id": "impresion", "active": True}],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        prod = resp.data["id"]
        resp = self.c_troq.post("/api/ordenes/previsualizar_remision_operador/",
                                {"orden_ids": [prod]}, format="json")
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(Remision.objects.filter(orden_id=prod).exists())

    def test_previsualizar_respeta_numero_ya_asignado(self):
        """Remissions numbered by the old flow keep their number when generated."""
        tq = self._troquel()
        rem = Remision.objects.get(orden_id=tq)
        Remision.objects.filter(pk=rem.pk).update(numero="REM-0007")
        otra = self._troquel("TQ-OTRO", cliente=self.otro)
        Remision.objects.filter(orden_id=otra).update(numero="REM-0050")
        resp = self.c_general.post("/api/ordenes/previsualizar_remision_operador/", {"orden_ids": [tq]}, format="json")
        self.assertEqual(resp.data["numero_estimado"], "REM-0007")
        resp = self.c_general.post("/api/ordenes/consolidar_remision_operador/", {"orden_ids": [tq]}, format="json")
        self.assertEqual(resp.data["remision_numero"], "REM-0007")

    def test_historial_no_muestra_troquel_sin_generar(self):
        """A freshly sent die is pending in the queue, not in Historial."""
        tq = self._troquel()
        hist = {r["id"] for r in self.c_general.get("/api/ordenes/remisiones_generadas_operador/").data}
        self.assertNotIn(Remision.objects.get(orden_id=tq).id, hist)
        cola = {f["id"] for f in self.c_general.get("/api/ordenes/remisionables_central/").data}
        self.assertIn(tq, cola)

    def test_historial_conserva_troquel_legacy_sin_sello(self):
        """Pre-Sept-2026 delivered dies left pending without stamps stay in Historial."""
        import datetime
        tq = self._troquel()
        rem = Remision.objects.get(orden_id=tq)
        Remision.objects.filter(pk=rem.pk).update(
            creado=datetime.datetime(2026, 9, 1, tzinfo=datetime.timezone.utc))
        hist = {r["id"] for r in self.c_general.get("/api/ordenes/remisiones_generadas_operador/").data}
        self.assertIn(rem.id, hist)

    def test_troquel_con_procesos_de_cadena_inactivos_entra_a_la_cola(self):
        """OPs from the full form carry inactive chain rows; they are still pure die tasks."""
        resp = self.c_general.post("/api/ordenes/", {
            "fecha": "2026-11-25", "cliente": self.cliente.id, "referencia": "FORM-COMPLETO",
            "cantidad": 1, "procesos": [
                {"proceso_id": "troquel", "active": True},
                {"proceso_id": "impresion", "active": False},
                {"proceso_id": "laminado", "active": False},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        op_id = resp.data["id"]
        resp = self.c_troq.post("/api/formatos-cuchillas/", {
            "orden": op_id, "cuchilla_cm": 50, "cuchilla_puntos": "2", "cuchilla_tipo": "doble_bisel",
            "grafa_cm": 10, "grafa_puntos": "2", "grafa_altura": "23.4", "enviar": True,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        filas = {f["id"]: f for f in self.c_troq.get("/api/ordenes/remisionables_central/").data}
        self.assertEqual(filas[op_id]["tipo"], "troquel")
        self.assertTrue(any(o["id"] == op_id for o in self.c_troq.get("/api/ordenes/remisionables_operador/").data))
