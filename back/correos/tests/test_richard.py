import io

from django.test import SimpleTestCase
from pypdf import PdfReader, PdfWriter

from correos.pdf_utils import (
    PdfProcesamientoError,
    contar_paginas,
    dividir_pdf,
    nombre_archivo_pagina,
    referencia_pagina_richard,
    truncar_nombre_archivo,
)


def _pdf_de_n_paginas(n):
    escritor = PdfWriter()
    for _ in range(n):
        escritor.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    escritor.write(buffer)
    return buffer.getvalue()


class ContarPaginasTests(SimpleTestCase):
    def test_pdf_de_cuatro_paginas(self):
        self.assertEqual(contar_paginas(_pdf_de_n_paginas(4)), 4)

    def test_pdf_de_una_pagina(self):
        self.assertEqual(contar_paginas(_pdf_de_n_paginas(1)), 1)

    def test_pdf_corrupto_lanza_error_sin_fallback(self):
        # Nunca debe caer en un fallback silencioso a 1 página (spec 6.5).
        with self.assertRaises(PdfProcesamientoError):
            contar_paginas(b"esto no es un pdf")

    def test_pdf_cifrado_lanza_error(self):
        escritor = PdfWriter()
        escritor.add_blank_page(width=200, height=200)
        escritor.encrypt("clave-secreta")
        buffer = io.BytesIO()
        escritor.write(buffer)
        with self.assertRaises(PdfProcesamientoError):
            contar_paginas(buffer.getvalue())


class DividirPdfTests(SimpleTestCase):
    def test_produce_una_entrada_por_pagina_en_orden(self):
        paginas = dividir_pdf(_pdf_de_n_paginas(4))
        self.assertEqual(len(paginas), 4)
        for contenido_pagina in paginas:
            lector = PdfReader(io.BytesIO(contenido_pagina))
            self.assertEqual(len(lector.pages), 1)

    def test_pdf_corrupto_lanza_error(self):
        with self.assertRaises(PdfProcesamientoError):
            dividir_pdf(b"basura")


class ReferenciaPaginaRichardTests(SimpleTestCase):
    def test_formato(self):
        self.assertEqual(
            referencia_pagina_richard(1, "catalogo_agosto.pdf"),
            "TROQUEL 1 - catalogo_agosto",
        )
        self.assertEqual(
            referencia_pagina_richard(4, "catalogo_agosto.pdf"),
            "TROQUEL 4 - catalogo_agosto",
        )


class NombreArchivoTests(SimpleTestCase):
    def test_nombre_corto_sin_cambios_en_estructura(self):
        self.assertEqual(nombre_archivo_pagina("catalogo_agosto.pdf", 3), "catalogo_agosto_p3.pdf")

    def test_nombre_largo_conserva_sufijo_y_extension(self):
        nombre_original = ("a" * 120) + ".pdf"
        resultado = nombre_archivo_pagina(nombre_original, 7, max_length=100)
        self.assertTrue(resultado.endswith("_p7.pdf"))
        self.assertLessEqual(len(resultado), 100)

    def test_paginas_distintas_no_colisionan_con_nombre_largo(self):
        nombre_original = ("a" * 120) + ".pdf"
        resultado_p1 = nombre_archivo_pagina(nombre_original, 1, max_length=100)
        resultado_p23 = nombre_archivo_pagina(nombre_original, 23, max_length=100)
        self.assertNotEqual(resultado_p1, resultado_p23)

    def test_truncar_nombre_archivo_generico(self):
        nombre_original = ("b" * 120) + ".cdr"
        resultado = truncar_nombre_archivo(nombre_original, max_length=100)
        self.assertEqual(len(resultado), 100)
        self.assertTrue(resultado.endswith(".cdr"))

    def test_truncar_nombre_archivo_corto_no_cambia(self):
        self.assertEqual(truncar_nombre_archivo("modelo.cdr"), "modelo.cdr")
