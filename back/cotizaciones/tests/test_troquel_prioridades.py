from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, OrdenCambio, OrdenProduccion, OpProceso
from cotizaciones.serializers import OrdenSerializer
from cotizaciones.troquel_prioridades import (
    _procesos_en_cola,
    reordenar_cola_troquel_por_clientes,
)


User = get_user_model()


class TroquelClientePrioridadTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin_cola_clientes", is_staff=True, password="x")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        self.cliente_a = Cliente.objects.create(nombre="Cliente A")
        self.cliente_b = Cliente.objects.create(nombre="Cliente B")

    def crear_troquel(self, cliente, dia):
        op = OrdenProduccion.objects.create(
            fecha=date(2026, 9, 1) + timedelta(days=dia),
            cliente=cliente,
            referencia=f"REF-{cliente.id}-{dia}",
            cantidad=1,
        )
        OpProceso.objects.create(orden=op, proceso_id="troquel", active=True)
        return op

    def test_reordenar_clientes_deja_bloques_fifo_y_alimenta_cola_operador(self):
        a_primero = self.crear_troquel(self.cliente_a, 0)
        b_primero = self.crear_troquel(self.cliente_b, 1)
        a_segundo = self.crear_troquel(self.cliente_a, 2)

        respuesta = self.api.post(
            "/api/ordenes/procesos/troquel/prioridades-clientes/",
            {"cliente_ids": [self.cliente_b.id, self.cliente_a.id]},
            format="json",
        )
        self.assertEqual(respuesta.status_code, 200, respuesta.data)
        prioridades = {
            p.orden_id: p.prioridad
            for p in OpProceso.objects.filter(proceso_id="troquel")
        }
        self.assertEqual(prioridades, {b_primero.id: 1, a_primero.id: 2, a_segundo.id: 3})

        pendientes = self.api.get("/api/ordenes/produccion_pendientes/?proceso=troquel")
        self.assertEqual(pendientes.status_code, 200, pendientes.data)
        self.assertEqual([op["id"] for op in pendientes.data], [b_primero.id, a_primero.id, a_segundo.id])

    def test_tarea_nueva_se_inserta_en_su_cliente_y_cliente_nuevo_va_al_final(self):
        a_primero = self.crear_troquel(self.cliente_a, 0)
        b_primero = self.crear_troquel(self.cliente_b, 1)
        reordenar_cola_troquel_por_clientes([self.cliente_b.id, self.cliente_a.id])

        a_segundo = self.crear_troquel(self.cliente_a, 2)
        reordenar_cola_troquel_por_clientes()
        prioridades = {
            p.orden_id: p.prioridad
            for p in OpProceso.objects.filter(proceso_id="troquel")
        }
        self.assertEqual(prioridades, {b_primero.id: 1, a_primero.id: 2, a_segundo.id: 3})

        cliente_c = Cliente.objects.create(nombre="Cliente C")
        c_primero = self.crear_troquel(cliente_c, 3)
        reordenar_cola_troquel_por_clientes()
        prioridades = {
            p.orden_id: p.prioridad
            for p in OpProceso.objects.filter(proceso_id="troquel")
        }
        self.assertEqual(prioridades[c_primero.id], 4)

    def test_endpoint_exige_todos_los_clientes_activos_y_solo_admin(self):
        self.crear_troquel(self.cliente_a, 0)
        self.crear_troquel(self.cliente_b, 1)
        incompleta = self.api.post(
            "/api/ordenes/procesos/troquel/prioridades-clientes/",
            {"cliente_ids": [self.cliente_a.id]}, format="json",
        )
        self.assertEqual(incompleta.status_code, 400)

        operador = User.objects.create_user("operador_cola_clientes", password="x")
        api_operador = APIClient()
        api_operador.force_authenticate(operador)
        prohibida = api_operador.post(
            "/api/ordenes/procesos/troquel/prioridades-clientes/",
            {"cliente_ids": [self.cliente_a.id, self.cliente_b.id]}, format="json",
        )
        self.assertEqual(prohibida.status_code, 403)

    def test_bloqueo_de_cola_se_limita_a_los_procesos(self):
        # PostgreSQL no permite bloquear el lado nullable del LEFT JOIN que
        # añade ``orden__remision__isnull``. El endpoint debe bloquear solo
        # OpProceso, que es además la única tabla que actualiza.
        self.assertEqual(_procesos_en_cola(lock=True).query.select_for_update_of, ("self",))

    def test_put_cambia_cliente_y_reagrupa_troquel_sin_error(self):
        a_primero = self.crear_troquel(self.cliente_a, 0)
        a_segundo = self.crear_troquel(self.cliente_a, 1)
        b_primero = self.crear_troquel(self.cliente_b, 2)
        reordenar_cola_troquel_por_clientes()

        respuesta = self.api.put(
            f"/api/ordenes/{a_segundo.id}/",
            {
                "fecha": "2026-09-02", "cliente": self.cliente_b.id,
                "referencia": a_segundo.referencia, "cantidad": 1,
                "procesos": [{"proceso_id": "troquel", "active": True}],
            },
            format="json",
        )
        self.assertEqual(respuesta.status_code, 200, respuesta.data)
        self.assertEqual(respuesta.data["cliente"], self.cliente_b.id)
        a_segundo.refresh_from_db()
        self.assertEqual(a_segundo.cliente_id, self.cliente_b.id)
        self.assertEqual(
            [p.orden_id for p in _procesos_en_cola().order_by("prioridad")],
            [a_primero.id, a_segundo.id, b_primero.id],
        )
        self.assertTrue(OrdenCambio.objects.filter(
            orden=a_segundo, campo="cliente",
            valor_anterior=self.cliente_a.nombre,
            valor_nuevo=self.cliente_b.nombre,
        ).exists())

    def test_put_sin_troquel_no_recalcula_cola(self):
        orden = OrdenProduccion.objects.create(
            fecha=date(2026, 9, 1), cliente=self.cliente_a,
            referencia="SIN-TROQUEL", cantidad=1,
        )
        with patch("cotizaciones.serializers.reordenar_cola_troquel_por_clientes") as reordenar:
            respuesta = self.api.put(
                f"/api/ordenes/{orden.id}/",
                {"fecha": "2026-09-01", "cliente": self.cliente_b.id,
                 "referencia": "SIN-TROQUEL", "cantidad": 1},
                format="json",
            )
        reordenar.assert_not_called()
        self.assertEqual(respuesta.status_code, 200, respuesta.data)
        orden.refresh_from_db()
        self.assertEqual(orden.cliente_id, self.cliente_b.id)

    def test_fallo_al_reordenar_revierte_cambio_de_cliente(self):
        orden = self.crear_troquel(self.cliente_a, 0)
        serializer = OrdenSerializer(
            orden,
            data={"fecha": "2026-09-01", "cliente": self.cliente_b.id,
                  "referencia": "CAMBIADA", "cantidad": 1,
                  "procesos": [{"proceso_id": "troquel", "active": True}]},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        with patch("cotizaciones.serializers.reordenar_cola_troquel_por_clientes", side_effect=RuntimeError("queue failed")):
            with self.assertRaisesMessage(RuntimeError, "queue failed"):
                serializer.save()
        orden.refresh_from_db()
        self.assertEqual(orden.cliente_id, self.cliente_a.id)
        self.assertNotEqual(orden.referencia, "CAMBIADA")
        self.assertFalse(OrdenCambio.objects.filter(orden=orden).exists())
        self.assertTrue(OpProceso.objects.filter(orden=orden, proceso_id="troquel", active=True).exists())
