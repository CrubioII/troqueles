"""Freno a los clientes duplicados por typo, y la herramienta para limpiar los
que ya entraron.

Por qué importa: la cola de remisiones del Operador agrupa por `cliente_id` y
solo deja consolidar un cliente a la vez. Con "Prepensa Inalmega" conviviendo
con "Preprensa Inalmega" (caso real de producción), los troqueles del mismo
cliente quedan en dos grupos que no se pueden reunir: el operador enviaba un
troquel, no lo veía junto a los demás y terminaba generando otra remisión.
"""
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import (
    Cliente, FormatoCuchillas, OrdenProduccion, OpProceso, PerfilOperador,
    clientes_similares,
)

User = get_user_model()


class ClientesSimilaresTestCase(TestCase):
    """La detección en sí, sin pasar por HTTP."""

    def test_typo_de_una_letra_en_nombre_largo(self):
        Cliente.objects.create(nombre="Preprensa Inalmega")
        self.assertEqual(
            [c.nombre for c in clientes_similares("Prepensa Inalmega")],
            ["Preprensa Inalmega"],
        )

    def test_diferencia_solo_de_espacios_o_mayusculas(self):
        # El unique de nombre_normalizado no atrapa esto: "troqueles ink" y
        # "Troquelesink" son claves distintas para él.
        Cliente.objects.create(nombre="troqueles ink")
        self.assertEqual(
            [c.nombre for c in clientes_similares("Troquelesink")],
            ["troqueles ink"],
        )

    def test_nombres_cortos_y_distintos_no_se_confunden(self):
        Cliente.objects.create(nombre="zorro")
        self.assertEqual(clientes_similares("Toro Corredor"), [])

    def test_nombres_largos_sin_parecido(self):
        Cliente.objects.create(nombre="Impresos Richard")
        self.assertEqual(clientes_similares("Graficas Modernas"), [])

    def test_excluir_id_no_se_reporta_a_si_mismo(self):
        c = Cliente.objects.create(nombre="Preprensa Inalmega")
        self.assertEqual(clientes_similares(c.nombre, excluir_id=c.id), [])


class AltaClienteGuardTestCase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin_dedup", is_staff=True, password="x")
        self.api = APIClient()
        self.api.force_authenticate(user=self.admin)

    def test_nombre_parecido_devuelve_409_con_candidatos(self):
        existente = Cliente.objects.create(nombre="Preprensa Inalmega")
        r = self.api.post("/api/clientes/", {"nombre": "Prepensa Inalmega", "tipo": "final"}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["code"], "cliente_similar")
        self.assertEqual(
            [c["id"] for c in r.data["candidatos"]], [existente.id],
        )
        self.assertEqual(Cliente.objects.count(), 1)

    def test_confirmar_nuevo_crea_igual(self):
        Cliente.objects.create(nombre="Preprensa Inalmega")
        r = self.api.post(
            "/api/clientes/",
            {"nombre": "Prepensa Inalmega", "tipo": "final", "confirmar_nuevo": True},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Cliente.objects.count(), 2)

    def test_nombre_sin_parecido_pasa_directo(self):
        Cliente.objects.create(nombre="Preprensa Inalmega")
        r = self.api.post("/api/clientes/", {"nombre": "Impresos Richard", "tipo": "final"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Cliente.objects.count(), 2)


class MergeClientesTestCase(TestCase):
    def setUp(self):
        self.principal = Cliente.objects.create(nombre="Preprensa Inalmega")
        self.dup = Cliente.objects.create(nombre="Prepensa Inalmega", email="dup@test.com")
        self.op = OrdenProduccion.objects.create(
            fecha="2026-09-01", cliente=self.dup, referencia="TQ dup", cantidad=1,
        )

    def _run(self, *args):
        out = StringIO()
        call_command("merge_clientes_duplicados", *args, stdout=out)
        return out.getvalue()

    def test_similar_lista_sin_tocar_nada(self):
        salida = self._run("--similar")
        self.assertIn("Prepensa Inalmega", salida)
        self.assertIn("Preprensa Inalmega", salida)
        self.assertEqual(Cliente.objects.count(), 2)

    def test_merge_dry_run_no_modifica(self):
        self._run("--merge", f"{self.dup.id}:{self.principal.id}")
        self.assertEqual(Cliente.objects.count(), 2)
        self.op.refresh_from_db()
        self.assertEqual(self.op.cliente_id, self.dup.id)

    def test_merge_apply_repunta_y_borra(self):
        self._run("--merge", f"{self.dup.id}:{self.principal.id}", "--apply")
        self.assertFalse(Cliente.objects.filter(pk=self.dup.id).exists())
        self.op.refresh_from_db()
        self.assertEqual(self.op.cliente_id, self.principal.id)
        # Los datos de contacto que solo tenía el duplicado se conservan
        self.principal.refresh_from_db()
        self.assertEqual(self.principal.email, "dup@test.com")

    def test_merge_par_invalido(self):
        with self.assertRaises(Exception):
            self._run("--merge", "no-es-un-par", "--apply")


class BorrarClientesHuerfanosTestCase(TestCase):
    def setUp(self):
        self.vacio = Cliente.objects.create(nombre="Alta accidental")
        self.con_contacto = Cliente.objects.create(nombre="Ficha de contacto", email="x@test.com")
        self.con_precios = Cliente.objects.create(nombre="Con tarifa", precios_troquel={"cuchilla": 100})
        self.con_op = Cliente.objects.create(nombre="Cliente real")
        OrdenProduccion.objects.create(
            fecha="2026-09-01", cliente=self.con_op, referencia="TQ", cantidad=1,
        )

    def _run(self, *args):
        out = StringIO()
        call_command("borrar_clientes_huerfanos", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_no_borra(self):
        self._run()
        self.assertEqual(Cliente.objects.count(), 4)

    def test_borra_solo_el_vacio(self):
        self._run("--apply")
        self.assertFalse(Cliente.objects.filter(pk=self.vacio.id).exists())
        # Contacto, tarifa y movimientos se conservan
        self.assertTrue(Cliente.objects.filter(pk=self.con_contacto.id).exists())
        self.assertTrue(Cliente.objects.filter(pk=self.con_precios.id).exists())
        self.assertTrue(Cliente.objects.filter(pk=self.con_op.id).exists())

    def test_incluir_con_datos_borra_contacto_y_tarifa(self):
        self._run("--incluir-con-datos", "--apply")
        self.assertFalse(Cliente.objects.filter(pk=self.con_contacto.id).exists())
        self.assertFalse(Cliente.objects.filter(pk=self.con_precios.id).exists())
        # El que tiene una OP nunca se borra, ni con la bandera
        self.assertTrue(Cliente.objects.filter(pk=self.con_op.id).exists())

    def test_cliente_con_documento_no_se_borra(self):
        from cotizaciones.models import DocumentoCliente
        cli = Cliente.objects.create(nombre="Solo documento")
        DocumentoCliente.objects.create(fecha="2026-09-01", cliente=cli)
        self._run("--incluir-con-datos", "--apply")
        self.assertTrue(Cliente.objects.filter(pk=cli.id).exists())


class ColaRemisionesAgrupaPorClienteTestCase(TestCase):
    """Regresión del síntoma: dos troqueles del mismo cliente tienen que salir
    en el mismo grupo de la cola; si el cliente está duplicado, salen en dos.
    """

    def setUp(self):
        self.user = User.objects.create_user("op_general_dedup", password="x")
        PerfilOperador.objects.create(user=self.user, es_general=True)
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)

    def _op_troquel(self, cliente, referencia):
        op = OrdenProduccion.objects.create(
            fecha="2026-09-01", cliente=cliente, referencia=referencia, cantidad=1,
        )
        OpProceso.objects.create(orden=op, proceso_id="troquel", active=True)
        FormatoCuchillas.objects.create(orden=op, estado="aprobado")
        return op

    def test_mismo_cliente_un_solo_grupo(self):
        cliente = Cliente.objects.create(nombre="Preprensa Inalmega")
        self._op_troquel(cliente, "TQ 1")
        self._op_troquel(cliente, "TQ 2")
        r = self.api.get("/api/ordenes/remisionables_operador/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len({fila["cliente_id"] for fila in r.data}), 1)
        self.assertEqual(len(r.data), 2)

    def test_cliente_duplicado_parte_la_cola(self):
        # Documenta el daño que causa el duplicado: mismo cliente real, dos
        # grupos, y la UI solo deja remisionar uno a la vez.
        a = Cliente.objects.create(nombre="Preprensa Inalmega")
        b = Cliente.objects.create(nombre="Prepensa Inalmega")
        self._op_troquel(a, "TQ 1")
        self._op_troquel(b, "TQ 2")
        r = self.api.get("/api/ordenes/remisionables_operador/")
        self.assertEqual(len({fila["cliente_id"] for fila in r.data}), 2)
