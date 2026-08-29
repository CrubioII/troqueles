from django.test import SimpleTestCase

from correos.reglas.cuerpo import html_a_texto, limpiar_cuerpo


INALMEGA_CRUDO = """Buenos días,

TROQUEL: BOST COMERCIAL PLIEGO
CALIBRE: 31 + MICROCORRUGADO FLAUTA E

Quedo atento al envío del troquel.

Cordial saludo,

Wilson Barrera
Coordinador de Preprensa
Inalmega S.A.S.
Cel: 300 000 0000

ESCOBAR Johana Lorena compartió una carpeta contigo en OneDrive.

This message may contain confidential information and is intended only for the addressee.

Este correo electrónico se genera automáticamente, por favor no responder.

This message may contain confidential information and is intended only for the addressee.

Este correo electronico se genera automáticamente, por favor no responder.
"""

INALMEGA_ESPERADO = (
    "Buenos días,\n\n"
    "TROQUEL: BOST COMERCIAL PLIEGO\n"
    "CALIBRE: 31 + MICROCORRUGADO FLAUTA E\n\n"
    "Quedo atento al envío del troquel."
)


class LimpiarCuerpoTests(SimpleTestCase):
    def test_inalmega_corta_antes_de_cordial_saludo(self):
        resultado = limpiar_cuerpo(INALMEGA_CRUDO)
        self.assertEqual(resultado, INALMEGA_ESPERADO)
        self.assertNotIn("Wilson Barrera", resultado)
        self.assertNotIn("compartió una carpeta", resultado)
        self.assertNotIn("confidential", resultado)

    def test_salvaguarda_marcador_al_inicio_devuelve_original(self):
        texto = "Cordial saludo,\n\nJuan Perez"
        resultado = limpiar_cuerpo(texto)
        self.assertEqual(resultado, texto)

    def test_cuerpo_vacio(self):
        self.assertEqual(limpiar_cuerpo(""), "")
        self.assertEqual(limpiar_cuerpo(None), "")

    def test_colapsa_saltos_de_linea_multiples(self):
        texto = "Línea 1\n\n\n\n\nLínea 2\n\nCordialmente,\nFirma"
        resultado = limpiar_cuerpo(texto)
        self.assertEqual(resultado, "Línea 1\n\nLínea 2")

    def test_colapsa_espacios_multiples(self):
        texto = "Hola    mundo   con espacios"
        resultado = limpiar_cuerpo(texto)
        self.assertEqual(resultado, "Hola mundo con espacios")

    def test_marcador_get_outlook_for(self):
        texto = "Mensaje real\n\nGet Outlook for iOS"
        resultado = limpiar_cuerpo(texto)
        self.assertEqual(resultado, "Mensaje real")

    def test_marcador_firma_doble_guion(self):
        texto = "Mensaje real\n--\nFirma de correo"
        resultado = limpiar_cuerpo(texto)
        self.assertEqual(resultado, "Mensaje real")

    def test_marcador_saludos_linea_sola(self):
        texto = "Mensaje real\n\nSaludos,\nJuan"
        resultado = limpiar_cuerpo(texto)
        self.assertEqual(resultado, "Mensaje real")

    def test_no_corta_si_saludo_no_esta_en_linea_propia(self):
        # "saludo cordial" (orden invertido, dentro de una oración) no es el
        # marcador "cordial saludo" ni la línea "Saludos," sola.
        texto = "Reciban un saludo cordial de nuestra parte junto con el pedido adjunto."
        resultado = limpiar_cuerpo(texto)
        self.assertEqual(resultado, texto)


class HtmlATextoTests(SimpleTestCase):
    def test_extrae_texto_y_preserva_bloques(self):
        html_crudo = "<html><body><p>Hola</p><p>Mundo</p></body></html>"
        self.assertEqual(html_a_texto(html_crudo), "Hola\nMundo")

    def test_descarta_script_y_style(self):
        html_crudo = "<div>Texto real<style>.a{color:red}</style><script>alert(1)</script></div>"
        resultado = html_a_texto(html_crudo)
        self.assertIn("Texto real", resultado)
        self.assertNotIn("alert", resultado)
        self.assertNotIn("color:red", resultado)

    def test_decodifica_entidades(self):
        html_crudo = "<p>Precio &amp; cantidad &ntilde;</p>"
        self.assertEqual(html_a_texto(html_crudo), "Precio & cantidad ñ")

    def test_vacio(self):
        self.assertEqual(html_a_texto(""), "")
        self.assertEqual(html_a_texto(None), "")
