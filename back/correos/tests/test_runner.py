"""Tests del lote compartido por el cron y el listener IDLE (correos/runner.py).

Lo que se cubre aquí es lo que el listener añadió y el batch diario no
necesitaba: no spamear el resumen, no pisarse con otra corrida, y no
descargar cuerpos de correos ya procesados.
"""
from contextlib import contextmanager
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from io import BytesIO
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from pypdf import PdfWriter

from cotizaciones.models import OrdenProduccion
from correos import runner
from correos.models import CorreoProcesado


def _pdf_valido():
    escritor = PdfWriter()
    escritor.add_blank_page(width=200, height=200)
    buffer = BytesIO()
    escritor.write(buffer)
    return buffer.getvalue()


def _mensaje(message_id, remitente="Alguien <info@nuevaempresa.com.co>"):
    msg = MIMEMultipart("mixed")
    msg["From"] = remitente
    msg["Subject"] = "Troquel"
    msg["Message-ID"] = message_id
    msg["Date"] = "Wed, 27 Aug 2026 09:00:00 -0500"
    msg.attach(MIMEText("cuerpo", "plain", "utf-8"))
    parte = MIMEApplication(_pdf_valido(), _subtype="pdf")
    parte.add_header("Content-Disposition", "attachment", filename="modelo.pdf")
    msg.attach(parte)
    return msg


@contextmanager
def _lock_ocupado():
    yield False


@override_settings(
    TELEGRAM_TOKEN="tok", TELEGRAM_CHAT_ID="1", IMAP_CARPETA_COTIZAR="Cotizar", BATCH_DIAS_ATRAS=3,
)
class EjecutarLoteTests(TestCase):
    def _mocks(self, mensajes_por_uid, ids_por_uid=None):
        conn = MagicMock()
        conn.untagged_responses = {"PERMANENTFLAGS": [b"(\\Answered \\Flagged \\*)"]}
        if ids_por_uid is None:
            ids_por_uid = {
                uid: msg["Message-ID"] or "" for uid, msg in mensajes_por_uid.items()
            }
        return conn, [
            patch("correos.imap_client.conectar", return_value=conn),
            patch("correos.imap_client.buscar_uids_recientes", return_value=list(mensajes_por_uid)),
            patch("correos.imap_client.message_ids_por_uid", return_value=ids_por_uid),
            patch("correos.imap_client.marcar_procesado"),
            patch("correos.imap_client.mover_a_carpeta"),
        ]

    def _correr(self, mensajes_por_uid, ids_por_uid=None, **kwargs):
        """Devuelve (resumen, mock_descargar, mock_notificar)."""
        conn, parches = self._mocks(mensajes_por_uid, ids_por_uid)
        descargar = MagicMock(side_effect=lambda c, uid: (mensajes_por_uid[uid], 1000))
        parches.append(patch("correos.imap_client.descargar_correo", descargar))
        notificar = MagicMock()
        parches.append(patch("correos.telegram.notificar", notificar))
        for parche in parches:
            parche.start()
        try:
            resumen = runner.ejecutar_lote(**kwargs)
        finally:
            for parche in parches:
                parche.stop()
        return resumen, descargar, notificar

    def test_sin_resumen_no_manda_el_mensaje_de_resumen_pero_si_los_avisos(self):
        resumen, _descargar, notificar = self._correr(
            {b"1": _mensaje("<r1@x.com>")}, enviar_resumen=False,
        )

        self.assertEqual(resumen["ordenes_creadas"], 1)
        self.assertEqual(OrdenProduccion.objects.count(), 1)
        textos = [llamada[0][0] for llamada in notificar.call_args_list]
        self.assertTrue(any("Troquel subido" in t for t in textos))
        self.assertFalse(any(t.startswith("📊 Resumen") for t in textos))

    def test_con_resumen_lo_manda(self):
        _resumen, _descargar, notificar = self._correr({b"1": _mensaje("<r2@x.com>")})
        textos = [llamada[0][0] for llamada in notificar.call_args_list]
        self.assertTrue(any(t.startswith("📊 Resumen") for t in textos))

    def test_candado_ocupado_no_toca_el_buzon(self):
        with patch("correos.runner.lock_lote", _lock_ocupado), \
             patch("correos.imap_client.conectar") as conectar:
            resumen = runner.ejecutar_lote()

        conectar.assert_not_called()
        self.assertEqual(resumen["omitido"], "otra corrida en progreso")
        self.assertEqual(resumen["revisados"], 0)

    def test_prefiltro_no_descarga_correos_ya_procesados(self):
        CorreoProcesado.objects.create(message_id="<r3@x.com>", resultado="ok", ordenes=["OP-0001"])
        resumen, descargar, _notificar = self._correr({b"1": _mensaje("<r3@x.com>")})

        descargar.assert_not_called()
        self.assertEqual(resumen["revisados"], 0)
        self.assertEqual(OrdenProduccion.objects.count(), 0)

    def test_prefiltro_reintenta_los_que_quedaron_en_error(self):
        CorreoProcesado.objects.create(message_id="<r4@x.com>", resultado="error")
        _resumen, descargar, _notificar = self._correr({b"1": _mensaje("<r4@x.com>")})

        descargar.assert_called_once()
        self.assertEqual(OrdenProduccion.objects.count(), 1)

    def test_prefiltro_nunca_salta_un_correo_sin_message_id(self):
        # Sin cabecera Message-ID el id es sintético y depende del tamaño real
        # del cuerpo: el prefiltro no puede decidir nada, tiene que descargarlo.
        _resumen, descargar, _notificar = self._correr(
            {b"1": _mensaje("<r5@x.com>")}, ids_por_uid={b"1": ""},
        )
        descargar.assert_called_once()

    def test_si_falla_la_lectura_de_cabeceras_se_procesan_todos(self):
        conn = MagicMock()
        with patch("correos.imap_client.message_ids_por_uid", side_effect=OSError("boom")):
            pendientes = runner.uids_pendientes(conn, [b"1", b"2"])
        self.assertEqual(pendientes, [b"1", b"2"])
