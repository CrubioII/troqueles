from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from correos import telegram


class NotificarTests(SimpleTestCase):
    @override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
    def test_sin_config_no_llama_a_requests(self):
        with patch("correos.telegram.requests.post") as mock_post:
            telegram.notificar("hola")
        mock_post.assert_not_called()

    @override_settings(TELEGRAM_TOKEN="token-de-prueba", TELEGRAM_CHAT_ID="123")
    def test_con_config_llama_a_requests_sin_parse_mode(self):
        with patch("correos.telegram.requests.post") as mock_post:
            telegram.notificar("hola mundo")
        mock_post.assert_called_once()
        _args, kwargs = mock_post.call_args
        self.assertEqual(kwargs["json"]["text"], "hola mundo")
        self.assertNotIn("parse_mode", kwargs["json"])

    @override_settings(TELEGRAM_TOKEN="token-de-prueba", TELEGRAM_CHAT_ID="123")
    def test_fallo_de_red_no_propaga_excepcion(self):
        with patch("correos.telegram.requests.post", side_effect=Exception("boom")):
            telegram.notificar("hola")  # no debe lanzar


class PlantillasTests(SimpleTestCase):
    def test_confirmacion_incluye_instruccion_solo_si_hay_nota(self):
        sin_nota = telegram.msg_confirmacion("OP-0579", "Preprensa Inalmega", "2026-08-27", "TROQUEL 1", "cuerpo")
        self.assertNotIn("📝 Instrucción", sin_nota)
        con_nota = telegram.msg_confirmacion(
            "OP-0579", "Preprensa Inalmega", "2026-08-27", "TROQUEL 1", "cuerpo", nota_cliente="fabricar cab 2"
        )
        self.assertIn("📝 Instrucción: fabricar cab 2", con_nota)

    def test_omitido_cotizacion(self):
        msg = telegram.msg_omitido_cotizacion("Solicitud cotización", "cliente@x.com")
        self.assertIn("🏷️ Omitido (cotización): Solicitud cotización", msg)
        self.assertIn("cliente@x.com", msg)

    def test_omitido_orden(self):
        msg = telegram.msg_omitido_orden("pedido_orden.pdf")
        self.assertIn("pedido_orden.pdf", msg)
        self.assertIn("Graficas Modernas", msg)

    def test_alerta_alexander(self):
        msg = telegram.msg_alerta_alexander_sin_instruccion("Troquel urgente")
        self.assertIn("Alexander sin instrucción", msg)
        self.assertIn("Troquel urgente", msg)

    def test_error(self):
        msg = telegram.msg_error("resolver_cliente", "Asunto X", "de@x.com", "boom")
        self.assertIn("Paso: resolver_cliente", msg)
        self.assertIn("Error: boom", msg)

    def test_resumen_lista_omitidos(self):
        msg = telegram.msg_resumen(
            "2026-08-30 07:00", 14, 9,
            [("Preprensa Inalmega", "Solicitud cotización troquel")],
            0,
        )
        self.assertIn("Correos revisados: 14", msg)
        self.assertIn("Órdenes creadas: 9", msg)
        self.assertIn('Preprensa Inalmega — "Solicitud cotización troquel"', msg)
        self.assertIn("Errores: 0", msg)
