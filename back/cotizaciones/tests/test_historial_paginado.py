"""Historial de Producción › Troqueles paginado de 50 en 50, con búsqueda en
el servidor (formatos de cuchillas y remisiones generadas)."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from cotizaciones.models import (
    Cliente, FormatoCuchillas, OpProceso, OrdenProduccion, PerfilOperador, Remision,
)

User = get_user_model()


class HistorialPaginadoTestCase(TestCase):
    def setUp(self):
        self.u_troquelador = User.objects.create_user("op_troq_hist", password="x")
        PerfilOperador.objects.create(user=self.u_troquelador, es_troquelador=True)
        self.u_general = User.objects.create_user("op_gen_hist", password="x")
        PerfilOperador.objects.create(user=self.u_general, es_general=True)
        self.c_troq = APIClient()
        self.c_troq.force_authenticate(self.u_troquelador)
        self.c_gen = APIClient()
        self.c_gen.force_authenticate(self.u_general)
        self.cliente = Cliente.objects.create(nombre="Cliente Hist", email="h@test.com")
        self.otro = Cliente.objects.create(nombre="Papelería Zeta", email="z@test.com")

    def _op(self, n, referencia=None, cliente=None, procesos=("troquel",)):
        op = OrdenProduccion.objects.create(
            numero=f"OP-H{n:04d}", fecha=timezone.localdate(),
            cliente=cliente or self.cliente, referencia=referencia or f"REF-{n}", cantidad=100,
        )
        for pid in procesos:
            OpProceso.objects.create(orden=op, proceso_id=pid, active=True)
        return op

    def _rem(self, n, op, **kw):
        return Remision.objects.create(
            numero=f"REM-H{n:04d}", fecha=timezone.localdate(), orden=op,
            cliente=op.cliente, generada_en=timezone.now(), **kw,
        )

    # ─────────────── Formatos ───────────────

    def test_formatos_paginados_de_50(self):
        for i in range(55):
            FormatoCuchillas.objects.create(orden=self._op(i), operador=self.u_troquelador)

        r1 = self.c_troq.get("/api/formatos-cuchillas/?page=1")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.data["count"], 55)
        self.assertEqual(len(r1.data["results"]), 50)
        r2 = self.c_troq.get("/api/formatos-cuchillas/?page=2")
        self.assertEqual(len(r2.data["results"]), 5)
        ids = {f["id"] for f in r1.data["results"]} | {f["id"] for f in r2.data["results"]}
        self.assertEqual(len(ids), 55)

    def test_formatos_busqueda_en_servidor(self):
        FormatoCuchillas.objects.create(orden=self._op(1, "CAJA-ROJA"), operador=self.u_troquelador)
        FormatoCuchillas.objects.create(orden=self._op(2, "BOLSA"), operador=self.u_troquelador)
        FormatoCuchillas.objects.create(orden=self._op(3, "SOBRE", cliente=self.otro), operador=self.u_troquelador)

        por_ref = self.c_troq.get("/api/formatos-cuchillas/", {"search": "caja"}).data
        self.assertEqual([f["referencia"] for f in por_ref["results"]], ["CAJA-ROJA"])
        por_cliente = self.c_troq.get("/api/formatos-cuchillas/", {"search": "zeta"}).data
        self.assertEqual([f["referencia"] for f in por_cliente["results"]], ["SOBRE"])
        por_op = self.c_troq.get("/api/formatos-cuchillas/", {"search": "OP-H0002"}).data
        self.assertEqual([f["referencia"] for f in por_op["results"]], ["BOLSA"])

    # ─────────────── Remisiones ───────────────

    def test_remisiones_paginadas_con_page(self):
        for i in range(53):
            self._rem(i, self._op(i))
        r1 = self.c_troq.get("/api/ordenes/remisiones_generadas_operador/?page=1")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.data["count"], 53)
        self.assertEqual(len(r1.data["results"]), 50)
        r2 = self.c_troq.get("/api/ordenes/remisiones_generadas_operador/?page=2")
        self.assertEqual(len(r2.data["results"]), 3)

    def test_remisiones_sin_page_sigue_devolviendo_lista(self):
        """Producción General consume la lista completa (sin `page`)."""
        for i in range(52):
            self._rem(i, self._op(i))
        resp = self.c_gen.get("/api/ordenes/remisiones_generadas_operador/")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)
        self.assertEqual(len(resp.data), 52)

    def test_remisiones_busqueda_incluye_ops_consolidadas(self):
        destino = self._rem(1, self._op(1, "CAJA"))
        fuente = self._rem(2, self._op(2, "ETIQUETA-AZUL"), estado="consolidada")
        fuente.consolidada_en_remision = destino
        fuente.save()
        self._rem(3, self._op(3, "BOLSA"))

        res = self.c_troq.get("/api/ordenes/remisiones_generadas_operador/",
                              {"page": 1, "search": "etiqueta"}).data["results"]
        self.assertIn(destino.id, [r["id"] for r in res])
        self.assertNotIn("REM-H0003", [r["numero"] for r in res])
        res = self.c_troq.get("/api/ordenes/remisiones_generadas_operador/",
                              {"page": 1, "search": "REM-H0003"}).data["results"]
        self.assertEqual([r["numero"] for r in res], ["REM-H0003"])

    def test_troquelador_no_ve_remisiones_de_cadena(self):
        propia_cadena = self._rem(1, self._op(1, procesos=("impresion",)))
        troquel = self._rem(2, self._op(2))
        destino = self._rem(3, self._op(3))
        fuente = self._rem(4, self._op(4, procesos=("laminado",)), estado="consolidada")
        fuente.consolidada_en_remision = destino
        fuente.save()

        ids = [r["id"] for r in self.c_troq.get(
            "/api/ordenes/remisiones_generadas_operador/?page=1").data["results"]]
        self.assertIn(troquel.id, ids)
        self.assertNotIn(propia_cadena.id, ids)
        self.assertNotIn(destino.id, ids)

        # es_general sí ve todo
        ids_gen = [r["id"] for r in self.c_gen.get(
            "/api/ordenes/remisiones_generadas_operador/?page=1").data["results"]]
        self.assertIn(propia_cadena.id, ids_gen)
        self.assertIn(destino.id, ids_gen)
