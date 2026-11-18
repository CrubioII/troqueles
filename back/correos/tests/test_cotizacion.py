from django.test import SimpleTestCase

from correos.reglas.cotizacion import es_cotizacion
from correos.reglas.aprobaciones import asunto_normalizado, es_aprobacion_estelar


class EsCotizacionTests(SimpleTestCase):
    def test_variantes_positivas_en_asunto(self):
        for palabra in ["cotizar", "Cotización", "COTIZACION", "cotizaciones", "cotizamos", "COTIZAR"]:
            with self.subTest(palabra=palabra):
                self.assertTrue(es_cotizacion(f"Solicitud de {palabra}", ""))

    def test_positiva_en_cuerpo(self):
        self.assertTrue(es_cotizacion("Troquel nuevo", "Quedamos atentos a la cotización del troquel."))

    def test_negativa_sin_la_palabra(self):
        self.assertFalse(es_cotizacion("Troquel BOST", "Adjunto el troquel para producción."))

    def test_asunto_y_cuerpo_vacios(self):
        self.assertFalse(es_cotizacion("", ""))
        self.assertFalse(es_cotizacion(None, None))

    def test_riesgo_conocido_inalmega_ahora_se_omite(self):
        # Comportamiento intencional (sección 6.4): antes generaba orden, ahora se omite.
        cuerpo = "Buenos días, para su ayuda con la cotización del troquel adjunto el diseño."
        self.assertTrue(es_cotizacion("Troquel BOST", cuerpo))


class AprobacionEstelarTests(SimpleTestCase):
    def test_detecta_aprobacion_actual(self):
        self.assertTrue(es_aprobacion_estelar(
            "compras@estelarimpresores.com",
            "Buen día. Por favor dar proceso a la fabricación del troquel.",
        ))

    def test_no_usa_aprobacion_en_cita(self):
        self.assertFalse(es_aprobacion_estelar(
            "compras@estelarimpresores.com",
            "Gracias.\nEl martes escribió:\n> Aprobado, dar proceso a la fabricación.",
        ))

    def test_no_procesa_rechazo(self):
        self.assertFalse(es_aprobacion_estelar(
            "compras@estelarimpresores.com", "No está aprobado el troquel.",
        ))

    def test_instruccion_de_trabajo_es_aprobacion(self):
        # Real Estelar go-ahead (thread 88039 - 88104): no "aprobado" anywhere.
        self.assertTrue(es_aprobacion_estelar(
            "compras@estelarimpresores.com",
            "Buen dia\n\nPor favor trabajar con este archivo, tiene un pequeño cambio "
            "en el tamaño de una de las figuras\n\n---------- Forwarded message ---------\n"
            "envío pdf para realizar troquel",
        ))

    def test_respuesta_que_cita_la_cotizacion_es_aprobacion(self):
        self.assertTrue(es_aprobacion_estelar(
            "compras@estelarimpresores.com",
            "Listo, procedan.\nEl mar, 3 nov 2026 escribió:\n"
            "> Por favor nos colaboran con la cotizacion de las 2 lineas de troquel",
        ))

    def test_pedido_de_cotizacion_no_es_aprobacion(self):
        self.assertFalse(es_aprobacion_estelar(
            "compras@estelarimpresores.com",
            "Por favor nos colaboran con la cotizacion para realizar el troquel adjunto",
        ))


class AsuntoNormalizadoTests(SimpleTestCase):
    def test_ignora_prefijos_de_respuesta_y_reenvio(self):
        base = "88039 - 88059 TROQUEL STICKERS - ESTELAR IMPRESORES"
        for asunto in [f"Fwd: {base}", f"Re: Fwd: {base}", f"RV:  {base}", f"FW: re: {base}"]:
            with self.subTest(asunto=asunto):
                self.assertEqual(asunto_normalizado(asunto), asunto_normalizado(base))
