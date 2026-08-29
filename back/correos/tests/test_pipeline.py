from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from unittest.mock import patch

from django.test import TestCase, override_settings

from cotizaciones.models import Cliente, OrdenProduccion, TroquelModelo
from correos import pipeline
from correos.models import CorreoProcesado


def _pdf_valido(paginas=1):
    from io import BytesIO

    from pypdf import PdfWriter

    escritor = PdfWriter()
    for _ in range(paginas):
        escritor.add_blank_page(width=200, height=200)
    buffer = BytesIO()
    escritor.write(buffer)
    return buffer.getvalue()


def _mensaje(remitente, asunto, cuerpo, adjuntos=None, message_id="<test@x.com>"):
    msg = MIMEMultipart("mixed")
    msg["From"] = remitente
    msg["Subject"] = asunto
    msg["Message-ID"] = message_id
    msg["Date"] = "Wed, 27 Aug 2026 09:00:00 -0500"
    msg.attach(MIMEText(cuerpo, "plain", "utf-8"))
    for nombre, contenido in (adjuntos or []):
        parte = MIMEApplication(contenido, _subtype="pdf" if nombre.endswith(".pdf") else "octet-stream")
        parte.add_header("Content-Disposition", "attachment", filename=nombre)
        msg.attach(parte)
    return msg


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class ProcesarCorreoEstandarTests(TestCase):
    def test_crea_cliente_orden_y_troquel_modelo(self):
        msg = _mensaje(
            "Alguien <info@nuevaempresa.com.co>", "Troquel nuevo", "Buenos días, adjunto el troquel.",
            adjuntos=[("modelo.pdf", _pdf_valido(1))],
            message_id="<caso1@nuevaempresa.com.co>",
        )
        resultado = pipeline.procesar_correo(msg, "<caso1@nuevaempresa.com.co>")

        self.assertEqual(resultado.resultado, "ok")
        self.assertEqual(len(resultado.ordenes), 1)

        cliente = Cliente.objects.get(nombre="Nuevaempresa")
        orden = OrdenProduccion.objects.get(numero=resultado.ordenes[0])
        self.assertEqual(orden.cliente_id, cliente.id)
        self.assertTrue(TroquelModelo.objects.filter(orden=orden).exists())

        registro = CorreoProcesado.objects.get(message_id="<caso1@nuevaempresa.com.co>")
        self.assertEqual(registro.resultado, "ok")
        self.assertEqual(registro.ordenes, resultado.ordenes)

    def test_reusa_cliente_existente_por_nombre_normalizado(self):
        Cliente.objects.create(nombre="Nuevaempresa")
        msg = _mensaje(
            "Alguien <info@nuevaempresa.com.co>", "Otro troquel", "cuerpo",
            adjuntos=[("modelo2.pdf", _pdf_valido(1))],
            message_id="<caso2@x.com>",
        )
        pipeline.procesar_correo(msg, "<caso2@x.com>")
        self.assertEqual(Cliente.objects.filter(nombre="Nuevaempresa").count(), 1)

    def test_dedup_no_reprocesa(self):
        msg = _mensaje(
            "Alguien <info@nuevaempresa.com.co>", "Troquel", "cuerpo",
            adjuntos=[("modelo.pdf", _pdf_valido(1))],
            message_id="<dup@x.com>",
        )
        pipeline.procesar_correo(msg, "<dup@x.com>")
        self.assertTrue(pipeline.correo_ya_procesado("<dup@x.com>"))
        ordenes_antes = OrdenProduccion.objects.count()
        # Simula el chequeo de dedup del command: no vuelve a llamar a procesar_correo.
        if not pipeline.correo_ya_procesado("<dup@x.com>"):
            pipeline.procesar_correo(msg, "<dup@x.com>")
        self.assertEqual(OrdenProduccion.objects.count(), ordenes_antes)


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class ProcesarCorreoCotizacionTests(TestCase):
    def test_cotizacion_no_crea_nada(self):
        msg = _mensaje(
            "Cliente <cliente@gmail.com>", "Cotización de troquel", "Quisiera cotizar un troquel",
            adjuntos=[("modelo.pdf", _pdf_valido(1))],
            message_id="<cot@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<cot@x.com>")
        self.assertEqual(resultado.resultado, "omitido_cotizacion")
        self.assertTrue(resultado.mover_a_cotizar)
        self.assertEqual(OrdenProduccion.objects.count(), 0)
        self.assertEqual(CorreoProcesado.objects.get(message_id="<cot@x.com>").resultado, "omitido_cotizacion")


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class ProcesarCorreoSinAdjuntosTests(TestCase):
    def test_sin_adjuntos_validos(self):
        msg = _mensaje("Cliente <cliente@gmail.com>", "Sin nada", "Solo texto", adjuntos=[("logo.png", b"1")], message_id="<sinadj@x.com>")
        resultado = pipeline.procesar_correo(msg, "<sinadj@x.com>")
        self.assertEqual(resultado.resultado, "omitido_sin_adjuntos")
        self.assertEqual(OrdenProduccion.objects.count(), 0)


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class ProcesarCorreoAlexanderTests(TestCase):
    def test_sin_instruccion_no_crea_nada(self):
        msg = _mensaje(
            "Alexander <gerenciatroquelesinc@gmail.com>", "Troquel urgente", "Buenos días, adjunto.",
            adjuntos=[("modelo.pdf", _pdf_valido(1))],
            message_id="<alex1@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<alex1@x.com>")
        self.assertEqual(resultado.resultado, "alerta_sin_regla")
        self.assertEqual(OrdenProduccion.objects.count(), 0)
        self.assertEqual(Cliente.objects.count(), 0)

    def test_con_instruccion_crea_orden_con_nota(self):
        msg = _mensaje(
            "Alexander <gerenciatroquelesinc@gmail.com>", "Troquel urgente",
            "Cliente: Armonia impresores (fabricar cab 2)",
            adjuntos=[("modelo.pdf", _pdf_valido(1))],
            message_id="<alex2@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<alex2@x.com>")
        self.assertEqual(resultado.resultado, "ok")
        orden = OrdenProduccion.objects.get(numero=resultado.ordenes[0])
        self.assertEqual(orden.cliente.nombre, "Armonia impresores")
        self.assertEqual(orden.troquel_modelo.nota_cliente, "fabricar cab 2")


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class ProcesarCorreoRichardTests(TestCase):
    def test_pdf_multipagina_genera_una_orden_por_pagina(self):
        msg = _mensaje(
            "Elson <elsonmontes@impresosrichard.com>", "Catálogo", "cuerpo",
            adjuntos=[("catalogo_agosto.pdf", _pdf_valido(4))],
            message_id="<richard1@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<richard1@x.com>")
        self.assertEqual(resultado.resultado, "ok")
        self.assertEqual(len(resultado.ordenes), 4)
        referencias = sorted(OrdenProduccion.objects.filter(numero__in=resultado.ordenes).values_list("referencia", flat=True))
        self.assertEqual(referencias, [
            "TROQUEL 1 - catalogo_agosto", "TROQUEL 2 - catalogo_agosto",
            "TROQUEL 3 - catalogo_agosto", "TROQUEL 4 - catalogo_agosto",
        ])

    def test_pdf_y_cdr_juntos_solo_usa_el_pdf(self):
        msg = _mensaje(
            "Elson <elsonmontes@impresosrichard.com>", "Catálogo", "cuerpo",
            adjuntos=[("catalogo.pdf", _pdf_valido(2)), ("modelo.cdr", b"contenido cdr")],
            message_id="<richard2@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<richard2@x.com>")
        self.assertEqual(len(resultado.ordenes), 2)

    def test_solo_cdr_genera_una_orden(self):
        msg = _mensaje(
            "Elson <elsonmontes@impresosrichard.com>", "Modelo", "cuerpo",
            adjuntos=[("modelo.cdr", b"contenido cdr")],
            message_id="<richard3@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<richard3@x.com>")
        self.assertEqual(len(resultado.ordenes), 1)

    def test_pdf_corrupto_registra_error_y_no_marca_procesado(self):
        msg = _mensaje(
            "Elson <elsonmontes@impresosrichard.com>", "Catálogo malo", "cuerpo",
            adjuntos=[("malo.pdf", b"no es un pdf real")],
            message_id="<richard4@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<richard4@x.com>")
        self.assertEqual(resultado.resultado, "error")
        self.assertFalse(resultado.marcar_procesado)
        self.assertEqual(OrdenProduccion.objects.count(), 0)
        registro = CorreoProcesado.objects.get(message_id="<richard4@x.com>")
        self.assertEqual(registro.resultado, "error")
        # Debe poder reintentarse: no cuenta como "ya procesado".
        self.assertFalse(pipeline.correo_ya_procesado("<richard4@x.com>"))


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class ProcesarCorreoGraficasModernasTests(TestCase):
    def test_descarta_solo_el_adjunto_orden(self):
        msg = _mensaje(
            "Juan <diseno@graficasmodernas.com>", "Pedido", "cuerpo",
            adjuntos=[("pedido_orden.pdf", _pdf_valido(1)), ("troquel_real.pdf", _pdf_valido(1))],
            message_id="<gm1@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<gm1@x.com>")
        self.assertEqual(resultado.resultado, "ok")
        self.assertEqual(len(resultado.ordenes), 1)
        orden = OrdenProduccion.objects.get(numero=resultado.ordenes[0])
        self.assertEqual(orden.referencia, "troquel_real")

    def test_todos_los_adjuntos_son_orden(self):
        msg = _mensaje(
            "Juan <diseno@graficasmodernas.com>", "Pedido", "cuerpo",
            adjuntos=[("pedido_orden.pdf", _pdf_valido(1))],
            message_id="<gm2@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<gm2@x.com>")
        self.assertEqual(resultado.resultado, "omitido_orden")
        self.assertEqual(OrdenProduccion.objects.count(), 0)


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class ProcesarCorreoInmcorTests(TestCase):
    def test_varias_lineas_troquel_generan_varias_ordenes_mismo_archivo(self):
        msg = _mensaje(
            "Javier <javier.galindo@inmcor.com>", "Troqueles",
            "Buenos días\nTroquel: 1234\nTroquel: 5678\nGracias",
            adjuntos=[("diseno.pdf", _pdf_valido(1))],
            message_id="<inmcor1@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<inmcor1@x.com>")
        self.assertEqual(resultado.resultado, "ok")
        self.assertEqual(len(resultado.ordenes), 2)
        referencias = sorted(OrdenProduccion.objects.filter(numero__in=resultado.ordenes).values_list("referencia", flat=True))
        self.assertEqual(referencias, ["TROQUEL 1234", "TROQUEL 5678"])

    def test_sin_lineas_troquel_es_error(self):
        msg = _mensaje(
            "Javier <javier.galindo@inmcor.com>", "Troqueles", "Buenos días, adjunto diseño.",
            adjuntos=[("diseno.pdf", _pdf_valido(1))],
            message_id="<inmcor2@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<inmcor2@x.com>")
        self.assertEqual(resultado.resultado, "error")
        self.assertEqual(OrdenProduccion.objects.count(), 0)


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class ProcesarCorreoDryRunTests(TestCase):
    def test_dry_run_no_escribe_nada(self):
        msg = _mensaje(
            "Alguien <info@nuevaempresa.com.co>", "Troquel", "cuerpo",
            adjuntos=[("modelo.pdf", _pdf_valido(1))],
            message_id="<dry1@x.com>",
        )
        resultado = pipeline.procesar_correo(msg, "<dry1@x.com>", dry_run=True)
        self.assertEqual(resultado.resultado, "ok")
        self.assertEqual(Cliente.objects.count(), 0)
        self.assertEqual(OrdenProduccion.objects.count(), 0)
        self.assertEqual(CorreoProcesado.objects.count(), 0)
