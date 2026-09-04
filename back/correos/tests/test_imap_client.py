from email.mime.application import MIMEApplication
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from unittest.mock import MagicMock, patch

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


class _ConexionFalsa:
    """Lo mínimo de la API de imaplib que usa `esperar_novedad`.

    Incluye `tagged_commands` porque `_get_tagged_response` de imaplib lee de
    ahí: si el tag no quedó registrado, revienta con KeyError.
    """

    def __init__(self, lineas):
        self.lineas = list(lineas)
        self.enviado = []
        self.tagged_commands = {}

    def socket(self):
        return object()

    def _new_tag(self):
        return b"TAG1"

    def _get_tagged_response(self, tag):
        return self.tagged_commands.pop(tag, None) or ("OK", [b"IDLE terminated"])

    def send(self, datos):
        self.enviado.append(datos)

    def readline(self):
        return self.lineas.pop(0) if self.lineas else b""


class MessageIdsPorUidTests(SimpleTestCase):
    def _conn(self, respuesta):
        conn = MagicMock()
        conn.uid.return_value = respuesta
        return conn

    def test_mapea_uid_a_message_id(self):
        conn = self._conn(("OK", [
            (b"1 (UID 12 BODY[HEADER.FIELDS (MESSAGE-ID)] {30}", b"Message-ID: <a@x.com>\r\n\r\n"),
            b")",
            (b"2 (UID 13 BODY[HEADER.FIELDS (MESSAGE-ID)] {30}", b"Message-ID: <b@x.com>\r\n\r\n"),
            b")",
        ]))
        self.assertEqual(
            imap_client.message_ids_por_uid(conn, [b"12", b"13"]),
            {b"12": "<a@x.com>", b"13": "<b@x.com>"},
        )

    def test_correo_sin_message_id_queda_vacio(self):
        conn = self._conn(("OK", [
            (b"1 (UID 12 BODY[HEADER.FIELDS (MESSAGE-ID)] {2}", b"\r\n"),
            b")",
        ]))
        self.assertEqual(imap_client.message_ids_por_uid(conn, [b"12"]), {b"12": ""})

    def test_sin_uids_no_consulta_al_servidor(self):
        conn = self._conn(("OK", []))
        self.assertEqual(imap_client.message_ids_por_uid(conn, []), {})
        conn.uid.assert_not_called()

    def test_respuesta_no_ok_levanta_error(self):
        conn = self._conn(("NO", [b"error"]))
        with self.assertRaises(imap_client.ImapError):
            imap_client.message_ids_por_uid(conn, [b"12"])


class IdleTests(SimpleTestCase):
    def test_soporta_idle_lee_las_capabilities(self):
        conn = MagicMock()
        conn.capabilities = ("IMAP4REV1", "IDLE", "MOVE")
        self.assertTrue(imap_client.soporta_idle(conn))
        conn.capabilities = (b"IMAP4REV1", b"MOVE")
        self.assertFalse(imap_client.soporta_idle(conn))

    def test_novedad_devuelve_true_y_cierra_el_idle(self):
        conn = _ConexionFalsa([b"+ idling\r\n", b"* 3 EXISTS\r\n"])
        with patch("correos.imap_client._hay_datos", return_value=True):
            self.assertTrue(imap_client.esperar_novedad(conn, 5))
        self.assertIn(b"DONE\r\n", conn.enviado)

    def test_timeout_devuelve_false_y_cierra_el_idle(self):
        conn = _ConexionFalsa([b"+ idling\r\n"])
        with patch("correos.imap_client._hay_datos", return_value=False):
            self.assertFalse(imap_client.esperar_novedad(conn, 5))
        self.assertIn(b"DONE\r\n", conn.enviado)

    def test_ignora_respuestas_que_no_son_novedad(self):
        conn = _ConexionFalsa([b"+ idling\r\n", b"* 1 FETCH (FLAGS (\\Seen))\r\n", b"* 4 EXISTS\r\n"])
        with patch("correos.imap_client._hay_datos", return_value=True):
            self.assertTrue(imap_client.esperar_novedad(conn, 5))

    def test_bye_del_servidor_levanta_error(self):
        conn = _ConexionFalsa([b"+ idling\r\n", b"* BYE Autologout\r\n"])
        with patch("correos.imap_client._hay_datos", return_value=True):
            with self.assertRaises(imap_client.ImapError):
                imap_client.esperar_novedad(conn, 5)
        # Aun fallando hay que mandar DONE: sin él la sesión queda inservible.
        self.assertIn(b"DONE\r\n", conn.enviado)

    def test_servidor_que_rechaza_idle_levanta_error(self):
        conn = _ConexionFalsa([b"TAG1 NO IDLE no soportado\r\n"])
        with self.assertRaises(imap_client.ImapError):
            imap_client.esperar_novedad(conn, 5)
        # No se entró en IDLE: no hay que mandar DONE ni dejar el tag colgado.
        self.assertNotIn(b"DONE\r\n", conn.enviado)
        self.assertEqual(conn.tagged_commands, {})

    def test_aviso_recibido_antes_del_saludo_no_se_pierde(self):
        # El servidor puede colar el EXISTS antes del "+ idling"; si eso se
        # ignorara, el correo esperaría al siguiente ciclo.
        conn = _ConexionFalsa([b"* 7 EXISTS\r\n", b"+ idling\r\n"])
        with patch("correos.imap_client._hay_datos", return_value=False) as hay_datos:
            self.assertTrue(imap_client.esperar_novedad(conn, 900))
        hay_datos.assert_not_called()  # no espera los 900s de balde
        self.assertIn(b"DONE\r\n", conn.enviado)

    def test_el_tag_no_queda_colgado_en_tagged_commands(self):
        conn = _ConexionFalsa([b"+ idling\r\n", b"* 3 EXISTS\r\n"])
        with patch("correos.imap_client._hay_datos", return_value=True):
            imap_client.esperar_novedad(conn, 5)
        self.assertEqual(conn.tagged_commands, {})
