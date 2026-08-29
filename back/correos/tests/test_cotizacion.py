from django.test import SimpleTestCase

from correos.reglas.cotizacion import es_cotizacion


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
