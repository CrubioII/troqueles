"""Tests generales del sistema de roles de producción y del flujo completo de
una OP a través de la cadena + troquel + remisión.

Cubre lo más crítico y lo más reciente del programa: que cada rol de
Operador (es_general, es_guillotina, es_estaciones, es_troquelador) solo
pueda tocar lo que le corresponde, y que el flujo de negocio de punta a
punta siga funcionando cuando varios usuarios distintos registran
información sobre la misma OP.

Corre contra la base de datos de test de Django (aislada, se descarta al
terminar) — no toca db.sqlite3 de desarrollo. Ver back/scripts/test_flujo_roles.py
para la variante manual que sí deja usuarios/datos reales para inspección.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import (
    Cliente, FormatoCuchillas, OrdenProduccion, PerfilOperador, Remision,
)
from cotizaciones.serializers import _orden_progreso

User = get_user_model()


def _cliente_api(user=None):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class RolesProduccionTestCase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin_test_roles", is_staff=True, password="x")

        self.u_general = User.objects.create_user("op_general", password="x")
        PerfilOperador.objects.create(user=self.u_general, es_general=True)

        self.u_guillotina = User.objects.create_user("op_guillotina", password="x")
        PerfilOperador.objects.create(user=self.u_guillotina, es_guillotina=True)

        self.u_estaciones = User.objects.create_user("op_estaciones", password="x")
        PerfilOperador.objects.create(user=self.u_estaciones, es_estaciones=True)

        self.u_troquelador = User.objects.create_user("op_troquelador", password="x")
        PerfilOperador.objects.create(user=self.u_troquelador, es_troquelador=True)

        self.cliente = Cliente.objects.create(nombre="Cliente Test Roles", email="c@test.com")

        self.c_admin = _cliente_api(self.admin)
        self.c_general = _cliente_api(self.u_general)
        self.c_guillotina = _cliente_api(self.u_guillotina)
        self.c_estaciones = _cliente_api(self.u_estaciones)
        self.c_troquelador = _cliente_api(self.u_troquelador)

    def _crear_op(self, referencia="TEST-001", con_troquel=True):
        procesos = [
            {"proceso_id": "corteInicial", "active": True},
            {"proceso_id": "impresion", "active": True},
            {"proceso_id": "laminado", "active": True},
            {"proceso_id": "uvTotal", "active": True},
            {"proceso_id": "troquelado", "active": True},
            {"proceso_id": "corteFinal", "active": True},
        ]
        if con_troquel:
            procesos.append({"proceso_id": "troquel", "active": True})
        resp = self.c_general.post("/api/ordenes/", {
            "fecha": "2026-09-03",
            "cliente": self.cliente.id,
            "referencia": referencia,
            "cantidad": 1000,
            "corte_inicial_active": True,
            "corte_final_active": True,
            "procesos": procesos,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data["id"]

    # ─────────────── Segmentación de acceso ───────────────

    def test_cada_rol_solo_toca_su_estacion(self):
        op_id = self._crear_op("TEST-SEG-001")

        casos_403 = [
            (self.c_guillotina, "impresora", "impresion"),
            (self.c_guillotina, "laminadora", "laminado"),
            (self.c_guillotina, "barnizadora", "uvTotal"),
            (self.c_guillotina, "troqueladora", "troquelado"),
            (self.c_estaciones, "guillotina", "corteInicial"),
            (self.c_troquelador, "guillotina", "corteInicial"),
            (self.c_troquelador, "impresora", "impresion"),
            (self.c_troquelador, "laminadora", "laminado"),
            (self.c_troquelador, "barnizadora", "uvTotal"),
            (self.c_troquelador, "troqueladora", "troquelado"),
        ]
        for cliente_api, estacion, proceso_id in casos_403:
            resp = cliente_api.post("/api/registros-proceso/", {
                "orden": op_id, "estacion": estacion, "proceso_id": proceso_id,
            }, format="json")
            self.assertEqual(
                resp.status_code, 403,
                f"{estacion}/{proceso_id} debería ser 403, fue {resp.status_code}: {resp.data}",
            )

    def test_solo_troqueles_puede_tocar_formato_cuchillas(self):
        op_id = self._crear_op("TEST-SEG-002")
        for cliente_api in (self.c_guillotina, self.c_estaciones):
            resp = cliente_api.post("/api/formatos-cuchillas/", {"orden": op_id}, format="json")
            self.assertEqual(resp.status_code, 403)

    def test_remisionables_operador_solo_troqueles(self):
        for cliente_api in (self.c_guillotina, self.c_estaciones):
            resp = cliente_api.get("/api/ordenes/remisionables_operador/")
            self.assertEqual(resp.status_code, 403)
        # general y troquelador sí pueden (aunque la lista venga vacía)
        for cliente_api in (self.c_general, self.c_troquelador):
            resp = cliente_api.get("/api/ordenes/remisionables_operador/")
            self.assertEqual(resp.status_code, 200)

    def test_remisionables_produccion_solo_general(self):
        for cliente_api in (self.c_guillotina, self.c_estaciones, self.c_troquelador):
            resp = cliente_api.get("/api/ordenes/remisionables_produccion/")
            self.assertEqual(resp.status_code, 403)
        resp = self.c_general.get("/api/ordenes/remisionables_produccion/")
        self.assertEqual(resp.status_code, 200)

    def test_troqueladora_bloqueada_sin_troquel_modelo(self):
        op_id = self._crear_op("TEST-SEG-003")
        # Completa la cadena hasta barnizadora sin pasar por troquel.
        self.c_guillotina.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "guillotina", "proceso_id": "corteInicial",
            "cantidad_realizada": 1000,
        }, format="json")
        self.c_estaciones.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "impresora", "proceso_id": "impresion",
            "cantidad_realizada": 1000,
        }, format="json")
        self.c_estaciones.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "laminadora", "proceso_id": "laminado",
            "cantidad_realizada": 1000,
        }, format="json")
        self.c_estaciones.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "barnizadora", "proceso_id": "uvTotal",
            "cantidad_realizada": 1000,
        }, format="json")
        resp = self.c_estaciones.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "troqueladora", "proceso_id": "troquelado",
            "cantidad_realizada": 1000,
        }, format="json")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data.get("code"), "troquel_no_registrado")

    def test_anonimo_no_puede_operar(self):
        anon = APIClient()
        resp = anon.get("/api/ordenes/")
        self.assertIn(resp.status_code, (401, 403))
        resp = anon.get("/api/ordenes/remisionables_operador/")
        self.assertIn(resp.status_code, (401, 403))

    def test_admin_bypassea_todos_los_roles(self):
        op_id = self._crear_op("TEST-SEG-004")
        for estacion, proceso_id in [
            ("guillotina", "corteInicial"), ("impresora", "impresion"),
            ("laminadora", "laminado"), ("barnizadora", "uvTotal"),
        ]:
            resp = self.c_admin.post("/api/registros-proceso/", {
                "orden": op_id, "estacion": estacion, "proceso_id": proceso_id,
                "cantidad_realizada": 1000,
            }, format="json")
            self.assertEqual(resp.status_code, 201, resp.data)

    # ─────────────── Flujo de negocio completo ───────────────

    def test_flujo_completo_multiusuario(self):
        """Una OP recorriendo toda la cadena + troquel + remisión, con un
        usuario distinto por estación, respetando el orden de la cadena."""
        op_id = self._crear_op("TEST-FLUJO-001")

        # 1. Guillotina: corte inicial
        resp = self.c_guillotina.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "guillotina", "proceso_id": "corteInicial",
            "cantidad_realizada": 1000, "tamano": "pliego",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)

        # 2. Impresora, Laminadora, Barnizadora (mismo usuario: es_estaciones)
        resp = self.c_estaciones.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "impresora", "proceso_id": "impresion",
            "cantidad_realizada": 1000, "tamano": "pliego",
            "tiro_active": True, "tiro_colores_num": 4,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)

        resp = self.c_estaciones.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "laminadora", "proceso_id": "laminado",
            "cantidad_realizada": 1000, "tamano": "pliego", "tipo_laminado": "mate",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)

        resp = self.c_estaciones.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "barnizadora", "proceso_id": "uvTotal",
            "cantidad_realizada": 1000, "tamano": "pliego",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)

        # 3. Troquel: borrador por el usuario general, envío por el troquelador
        resp = self.c_general.post("/api/formatos-cuchillas/", {
            "orden": op_id, "cuchilla_cm": 100, "cuchilla_puntos": "2",
            "observaciones": "Avance del general",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["estado"], "borrador")
        formato_id = resp.data["id"]

        resp = self.c_troquelador.patch(f"/api/formatos-cuchillas/{formato_id}/", {
            "cuchilla_tipo": "doble_bisel",
            "grafa_cm": 30, "grafa_puntos": "2", "grafa_altura": "23.4",
            "enviar": True,
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["estado"], "aprobado")

        formato_db = FormatoCuchillas.objects.get(pk=formato_id)
        self.assertEqual(formato_db.operador_id, self.u_troquelador.id)

        op = OrdenProduccion.objects.get(pk=op_id)
        self.assertTrue(op.procesos.get(proceso_id="troquel").completado)
        self.assertIsNotNone(getattr(op, "troquel_modelo", None))

        # 4. Troqueladora, ahora habilitada
        resp = self.c_estaciones.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "troqueladora", "proceso_id": "troquelado",
            "cantidad_realizada": 1000, "tamano": "pliego",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)

        # 5. Guillotina: corte final -> OP al 100%, remisión auto-creada
        resp = self.c_guillotina.post("/api/registros-proceso/", {
            "orden": op_id, "estacion": "guillotina_final", "proceso_id": "corteFinal",
            "cantidad_realizada": 1000, "tamano": "pliego",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)

        op = OrdenProduccion.objects.get(pk=op_id)
        self.assertEqual(_orden_progreso(op)["porcentaje"], 100)
        self.assertTrue(Remision.objects.filter(orden=op).exists())

        # 6. El general genera y descarga la remisión
        resp = self.c_general.get("/api/ordenes/remisionables_operador/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(any(o["id"] == op_id for o in resp.data))

        resp = self.c_general.post("/api/ordenes/consolidar_remision_operador/", {
            "orden_ids": [op_id],
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        remision_id = resp.data["remision_id"]
        remision = Remision.objects.get(pk=remision_id)
        self.assertIsNotNone(remision.generada_en)
        self.assertEqual(remision.generada_por_id, self.u_general.id)

        # La descarga del PDF (WeasyPrint sobre una plantilla Django) se
        # verifica con la variante manual (back/scripts/test_flujo_roles.py),
        # corrida fuera de `manage.py test`: el instrumentado de plantillas
        # que Django activa bajo TestCase (para assertTemplateUsed) choca con
        # copy() de Context en Python 3.14 (incompatibilidad de entorno de
        # Django 4.2 con Python 3.14, ajena a este código) y hace que
        # cualquier render_to_string truene aquí aunque el PDF real se genere
        # bien fuera de ese instrumentado.
