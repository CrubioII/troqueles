from django.test import SimpleTestCase

from correos.reglas.adjuntos import Adjunto, es_archivo_orden, extension_valida, filtrar_validos, preferir_pdf


class ExtensionValidaTests(SimpleTestCase):
    def test_extensiones_validas(self):
        for nombre in ["troquel.pdf", "diseno.AI", "modelo.cdr", "MODELO.CDR"]:
            with self.subTest(nombre=nombre):
                self.assertTrue(extension_valida(nombre))

    def test_cdr_con_mime_octet_stream_se_acepta_por_extension(self):
        # El MIME nunca se consulta aquí — el filtro es solo por nombre de archivo.
        self.assertTrue(extension_valida("modelo_final.cdr"))

    def test_docx_se_rechaza(self):
        self.assertFalse(extension_valida("orden_de_compra.docx"))

    def test_sin_extension(self):
        self.assertFalse(extension_valida("archivo_sin_extension"))
        self.assertFalse(extension_valida(""))
        self.assertFalse(extension_valida(None))

    def test_filtrar_validos(self):
        adjuntos = [
            Adjunto("troquel.pdf", b"1"),
            Adjunto("logo_firma.png", b"2"),
            Adjunto("modelo.cdr", b"3"),
            Adjunto("nota.docx", b"4"),
        ]
        resultado = filtrar_validos(adjuntos)
        self.assertEqual([a.nombre for a in resultado], ["troquel.pdf", "modelo.cdr"])


class PreferirPdfTests(SimpleTestCase):
    def test_pdf_y_ai_se_queda_solo_con_el_pdf(self):
        adjuntos = [Adjunto("modelo.ai", b"1"), Adjunto("modelo.pdf", b"2")]
        resultado = preferir_pdf(adjuntos)
        self.assertEqual([a.nombre for a in resultado], ["modelo.pdf"])

    def test_pdf_y_cdr_se_queda_solo_con_el_pdf(self):
        adjuntos = [Adjunto("modelo.cdr", b"1"), Adjunto("modelo.pdf", b"2")]
        resultado = preferir_pdf(adjuntos)
        self.assertEqual([a.nombre for a in resultado], ["modelo.pdf"])

    def test_sin_pdf_no_cambia_nada(self):
        adjuntos = [Adjunto("modelo.ai", b"1"), Adjunto("modelo.cdr", b"2")]
        resultado = preferir_pdf(adjuntos)
        self.assertEqual([a.nombre for a in resultado], ["modelo.ai", "modelo.cdr"])

    def test_solo_pdf_no_cambia_nada(self):
        adjuntos = [Adjunto("modelo.pdf", b"1")]
        resultado = preferir_pdf(adjuntos)
        self.assertEqual([a.nombre for a in resultado], ["modelo.pdf"])


class EsArchivoOrdenTests(SimpleTestCase):
    def test_termina_en_orden_con_guion_bajo(self):
        self.assertTrue(es_archivo_orden("pedido_orden.pdf"))

    def test_termina_en_orden_con_guion(self):
        self.assertTrue(es_archivo_orden("pedido-orden.pdf"))

    def test_termina_en_orden_con_espacio(self):
        self.assertTrue(es_archivo_orden("pedido orden.pdf"))

    def test_es_solo_orden(self):
        self.assertTrue(es_archivo_orden("Orden.PDF"))

    def test_orden_no_esta_al_final_no_descarta(self):
        self.assertFalse(es_archivo_orden("orden_de_compra.pdf"))

    def test_orden_con_sufijo_v2_no_descarta(self):
        self.assertFalse(es_archivo_orden("pedido_orden_v2.pdf"))

    def test_palabra_ordenamiento_no_es_orden(self):
        self.assertFalse(es_archivo_orden("ordenamiento.pdf"))
