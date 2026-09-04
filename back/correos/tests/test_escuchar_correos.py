"""Tests del listener IMAP IDLE (`escuchar_correos`).

Todos usan --una-vez: un ciclo y salir. Lo que importa es que el lote se
ejecute tanto cuando el servidor avisa como cuando vence la espera, y que un
fallo de IMAP no tumbe el proceso.
"""
from io import StringIO
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import SimpleTestCase, override_settings


@override_settings(IMAP_IDLE_TIMEOUT=0, IMAP_IDLE_GRACIA=0, LISTENER_BACKOFF_MAX=1)
class EscucharCorreosTests(SimpleTestCase):
    def _correr(self, **kwargs):
        conn = MagicMock()
        lote = MagicMock(return_value={"revisados": 1, "ordenes_creadas": 1, "errores": 0})
        parches = [
            patch("correos.imap_client.conectar", return_value=conn),
            patch("correos.imap_client.soporta_idle", return_value=kwargs.get("soporta_idle", True)),
            patch("correos.management.commands.escuchar_correos.ejecutar_lote", lote),
            patch("correos.telegram.notificar"),
        ]
        if "esperar" in kwargs:
            parches.append(patch("correos.imap_client.esperar_novedad", **kwargs["esperar"]))
        for parche in parches:
            parche.start()
        try:
            salida = StringIO()
            call_command("escuchar_correos", "--una-vez", stdout=salida)
        finally:
            for parche in parches:
                parche.stop()
        return conn, lote, salida.getvalue()

    def test_novedad_dispara_el_lote(self):
        conn, lote, salida = self._correr(esperar={"return_value": True})

        lote.assert_called_once_with(enviar_resumen=False)
        self.assertIn("novedad", salida)
        conn.logout.assert_called_once()

    def test_timeout_tambien_dispara_el_lote(self):
        # Un aviso perdido no puede costar un día: al vencer la espera se
        # revisa el buzón igual (barato gracias al prefiltro de cabeceras).
        _conn, lote, salida = self._correr(esperar={"return_value": False})

        lote.assert_called_once_with(enviar_resumen=False)
        self.assertIn("timeout", salida)

    def test_servidor_sin_idle_cae_a_sondeo(self):
        _conn, lote, salida = self._correr(soporta_idle=False)

        lote.assert_called_once_with(enviar_resumen=False)
        self.assertIn("no anuncia IDLE", salida)

    def test_fallo_de_imap_no_tumba_el_proceso(self):
        conn, lote, salida = self._correr(esperar={"side_effect": OSError("conexión caída")})

        lote.assert_not_called()
        self.assertIn("Error:", salida)
        self.assertIn("Listener de correos detenido", salida)
        conn.logout.assert_called_once()

    def test_lote_omitido_por_el_candado_se_reporta(self):
        conn = MagicMock()
        lote = MagicMock(return_value={"omitido": "otra corrida en progreso"})
        with patch("correos.imap_client.conectar", return_value=conn), \
             patch("correos.imap_client.soporta_idle", return_value=True), \
             patch("correos.imap_client.esperar_novedad", return_value=True), \
             patch("correos.management.commands.escuchar_correos.ejecutar_lote", lote), \
             patch("correos.telegram.notificar"):
            salida = StringIO()
            call_command("escuchar_correos", "--una-vez", stdout=salida)

        self.assertIn("omitido: otra corrida en progreso", salida.getvalue())
