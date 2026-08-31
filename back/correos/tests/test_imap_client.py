from email.mime.application import MIMEApplication
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from django.test import SimpleTestCase

from correos import imap_client
from correos.reglas.adjuntos import extension_valida


def _mensaje_iphone_partido():
    """Simula el bug real de n8n: el cuerpo llega partido en dos bloques
    text/plain alrededor de un adjunto inline (firma de imagen del iPhone)."""
    msg = MIMEMultipart("mixed")
    msg["From"] = "Wilson Barrera <preprensa@inalmega.com>"
    msg["Subject"] = "Troquel BOST"
    msg["Message-ID"] = "<abc123@inalmega.com>"
    msg["Date"] = "Wed, 27 Aug 2026 09:00:00 -0500"

    msg.attach(MIMEText("Cliente: Armonia Impresores\n\n", "plain", "utf-8"))

    imagen = MIMEImage(b"\x89PNG\r\n\x1a\n", _subtype="png")
    imagen.add_header("Content-Disposition", "inline", filename="firma.png")
    msg.attach(imagen)

    msg.attach(MIMEText("Enviado desde mi iPhone", "plain", "utf-8"))

    pdf = MIMEApplication(b"%PDF-1.4 contenido falso", _subtype="pdf")
    pdf.add_header("Content-Disposition", "attachment", filename="troquel_bost.pdf")
    msg.attach(pdf)

    return msg


class ExtraerTextosTests(SimpleTestCase):
    def test_recoge_todos_los_bloques_text_plain(self):
        texto_plano, _texto_html = imap_client.extraer_textos(_mensaje_iphone_partido())
        self.assertIn("Cliente: Armonia Impresores", texto_plano)
        self.assertIn("Enviado desde mi iPhone", texto_plano)


class ExtraerAdjuntosTests(SimpleTestCase):
    def test_incluye_pdf_adjunto(self):
        adjuntos = imap_client.extraer_adjuntos(_mensaje_iphone_partido())
        nombres = [a.nombre for a in adjuntos]
        self.assertIn("troquel_bost.pdf", nombres)

    def test_firma_inline_se_descarta_por_extension_no_por_imap_client(self):
        # imap_client extrae TODO lo que tenga nombre de archivo; el filtro
        # de extensión (que descarta la firma .png) vive en reglas/adjuntos.
        adjuntos = imap_client.extraer_adjuntos(_mensaje_iphone_partido())
        validos = [a for a in adjuntos if extension_valida(a.nombre)]
        self.assertEqual([a.nombre for a in validos], ["troquel_bost.pdf"])


class RemitenteYMetadatosTests(SimpleTestCase):
    def test_extraer_remitente(self):
        nombre, direccion = imap_client.extraer_remitente(_mensaje_iphone_partido())
        self.assertEqual(nombre, "Wilson Barrera")
        self.assertEqual(direccion, "preprensa@inalmega.com")

    def test_extraer_asunto_y_message_id(self):
        msg = _mensaje_iphone_partido()
        self.assertEqual(imap_client.extraer_asunto(msg), "Troquel BOST")
        self.assertEqual(imap_client.extraer_message_id(msg), "<abc123@inalmega.com>")

    def test_message_id_o_sintetico_usa_el_real_si_existe(self):
        msg = _mensaje_iphone_partido()
        self.assertEqual(imap_client.message_id_o_sintetico(msg, 1234), "<abc123@inalmega.com>")

    def test_message_id_sintetico_cuando_falta(self):
        msg = _mensaje_iphone_partido()
        del msg["Message-ID"]
        resultado = imap_client.message_id_o_sintetico(msg, 1234)
        self.assertTrue(resultado.startswith("synth:"))

    def test_extraer_fecha(self):
        fecha = imap_client.extraer_fecha(_mensaje_iphone_partido())
        self.assertIsNotNone(fecha)
        self.assertEqual(fecha.year, 2026)
        self.assertEqual(fecha.month, 8)
        self.assertEqual(fecha.day, 27)
