from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cliente, OrdenProduccion, OpProceso
from cotizaciones.troquel_prioridades import reordenar_cola_troquel_por_clientes


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
