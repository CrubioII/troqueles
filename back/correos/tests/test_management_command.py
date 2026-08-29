import json
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from io import StringIO
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase, override_settings

from cotizaciones.models import OrdenProduccion
from correos.models import CorreoProcesado


def _pdf_valido():
    from io import BytesIO

    from pypdf import PdfWriter

    escritor = PdfWriter()
    escritor.add_blank_page(width=200, height=200)
    buffer = BytesIO()
    escritor.write(buffer)
    return buffer.getvalue()


def _mensaje(remitente, asunto, cuerpo, adjuntos, message_id):
    msg = MIMEMultipart("mixed")
    msg["From"] = remitente
    msg["Subject"] = asunto
    msg["Message-ID"] = message_id
    msg["Date"] = "Wed, 27 Aug 2026 09:00:00 -0500"
    msg.attach(MIMEText(cuerpo, "plain", "utf-8"))
    for nombre, contenido in adjuntos:
        parte = MIMEApplication(contenido, _subtype="pdf")
        parte.add_header("Content-Disposition", "attachment", filename=nombre)
        msg.attach(parte)
    return msg


def _mock_conn():
    conn = MagicMock()
    conn.untagged_responses = {"PERMANENTFLAGS": [b"(\\Answered \\Flagged \\*)"]}
    return conn


@override_settings(
    TELEGRAM_TOKEN="tok", TELEGRAM_CHAT_ID="1", IMAP_CARPETA_COTIZAR="Cotizar", BATCH_DIAS_ATRAS=3,
)
class ProcesarCorreosCommandTests(TestCase):
    def _preparar_mocks(self, mensajes_por_uid):
        conn = _mock_conn()
        parche_conectar = patch("correos.imap_client.conectar", return_value=conn)
        parche_uids = patch("correos.imap_client.buscar_uids_recientes", return_value=list(mensajes_por_uid))
        parche_descargar = patch(
            "correos.imap_client.descargar_correo",
            side_effect=lambda c, uid: (mensajes_por_uid[uid], 1000),
        )
        parche_marcar = patch("correos.imap_client.marcar_procesado")
        parche_mover = patch("correos.imap_client.mover_a_carpeta")
        parche_notificar = patch("correos.telegram.notificar")
        return conn, parche_conectar, parche_uids, parche_descargar, parche_marcar, parche_mover, parche_notificar

    def test_run_real_crea_orden_marca_y_notifica(self):
        uid = b"1"
        mensajes = {uid: _mensaje(
            "Alguien <info@nuevaempresa.com.co>", "Troquel", "cuerpo",
            [("modelo.pdf", _pdf_valido())], "<cmd1@x.com>",
        )}
        (conn, p_conectar, p_uids, p_descargar, p_marcar, p_mover, p_notificar) = self._preparar_mocks(mensajes)
        with p_conectar, p_uids, p_descargar, p_marcar as mock_marcar, p_mover as mock_mover, p_notificar as mock_notificar:
            out = StringIO()
            call_command("procesar_correos", stdout=out)

        self.assertEqual(OrdenProduccion.objects.count(), 1)
        self.assertTrue(CorreoProcesado.objects.filter(message_id="<cmd1@x.com>", resultado="ok").exists())
        mock_marcar.assert_called_once()
        mock_mover.assert_not_called()
        # Un mensaje de confirmación + el resumen final.
        self.assertGreaterEqual(mock_notificar.call_count, 2)
        conn.logout.assert_called_once()

    def test_cotizacion_mueve_a_carpeta_y_no_crea_orden(self):
        uid = b"1"
        mensajes = {uid: _mensaje(
            "Cliente <c@gmail.com>", "Cotización de troquel", "quiero cotizar", [], "<cmd2@x.com>",
        )}
        (conn, p_conectar, p_uids, p_descargar, p_marcar, p_mover, p_notificar) = self._preparar_mocks(mensajes)
        with p_conectar, p_uids, p_descargar, p_marcar as mock_marcar, p_mover as mock_mover, p_notificar:
            call_command("procesar_correos", stdout=StringIO())

        self.assertEqual(OrdenProduccion.objects.count(), 0)
        mock_mover.assert_called_once_with(conn, uid, "Cotizar")
        mock_marcar.assert_called_once()

    def test_dedup_no_reprocesa_correo_ya_registrado(self):
        uid = b"1"
        mensajes = {uid: _mensaje(
            "Alguien <info@nuevaempresa.com.co>", "Troquel", "cuerpo",
            [("modelo.pdf", _pdf_valido())], "<cmd3@x.com>",
        )}
        CorreoProcesado.objects.create(message_id="<cmd3@x.com>", resultado="ok", ordenes=["OP-0001"])
        (conn, p_conectar, p_uids, p_descargar, p_marcar, p_mover, p_notificar) = self._preparar_mocks(mensajes)
        with p_conectar, p_uids, p_descargar, p_marcar as mock_marcar, p_mover, p_notificar as mock_notificar:
            call_command("procesar_correos", stdout=StringIO())

        self.assertEqual(OrdenProduccion.objects.count(), 0)
        mock_marcar.assert_not_called()
        # Solo el resumen (0 revisados), ningún mensaje por el correo saltado.
        mock_notificar.assert_called_once()

    def test_dry_run_no_toca_imap_ni_telegram_ni_bd(self):
        uid = b"1"
        mensajes = {uid: _mensaje(
            "Alguien <info@nuevaempresa.com.co>", "Troquel", "cuerpo",
            [("modelo.pdf", _pdf_valido())], "<cmd4@x.com>",
        )}
        (conn, p_conectar, p_uids, p_descargar, p_marcar, p_mover, p_notificar) = self._preparar_mocks(mensajes)
        with p_conectar, p_uids, p_descargar, p_marcar as mock_marcar, p_mover as mock_mover, p_notificar as mock_notificar:
            out = StringIO()
            call_command("procesar_correos", "--dry-run", stdout=out)

        self.assertEqual(OrdenProduccion.objects.count(), 0)
        self.assertEqual(CorreoProcesado.objects.count(), 0)
        mock_marcar.assert_not_called()
        mock_mover.assert_not_called()
        mock_notificar.assert_not_called()
        salida = json.loads(out.getvalue())
        self.assertTrue(salida["dry_run"])
        self.assertEqual(salida["revisados"], 1)
        self.assertEqual(salida["correos"][0]["resultado"], "ok")

    def test_fallo_total_alerta_y_sale_con_error(self):
        with patch("correos.imap_client.conectar", side_effect=ConnectionError("no imap")), \
             patch("correos.telegram.notificar") as mock_notificar:
            with self.assertRaises(SystemExit):
                call_command("procesar_correos", stdout=StringIO())
        mock_notificar.assert_called_once()
        self.assertIn("falló por completo", mock_notificar.call_args[0][0])
