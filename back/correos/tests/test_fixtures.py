"""Prueba de extremo a extremo contra archivos .eml REALES.

Los fixtures en tests/fixtures/*.eml son capturas reales del buzón
produccion@troquelesink.com (paso manual M11 de la especificación, ya
recolectado). Las aserciones de este archivo están construidas leyendo el
contenido real de cada correo (remitente, cuerpo, adjuntos), no inventadas.
"""
import email
import os

from django.test import TestCase, override_settings

from cotizaciones.models import OrdenProduccion
from correos import pipeline

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _cargar(nombre_archivo):
    with open(os.path.join(FIXTURES_DIR, nombre_archivo), "rb") as f:
        return email.message_from_binary_file(f)


@override_settings(TELEGRAM_TOKEN="", TELEGRAM_CHAT_ID="")
class FixturesEndToEndTests(TestCase):
    def test_inmcor_una_orden_por_linea_troquel_mismo_archivo(self):
        # Correo real: 2 líneas "Troquel: nnnn" en el cuerpo, un solo PDF
        # adjunto (image001.jpg se descarta por extensión).
        mensaje = _cargar("InmcorVariosTroquelesElaboracion de troqueles 3245 - 3246.eml")
        resultado = pipeline.procesar_correo(mensaje, "<fixture-inmcor-real@inmcor.com>")
        self.assertEqual(resultado.resultado, "ok")
        ordenes = OrdenProduccion.objects.filter(numero__in=resultado.ordenes)
        self.assertEqual(
            sorted(ordenes.values_list("referencia", flat=True)),
            ["TROQUEL 3245", "TROQUEL 3246"],
        )
        self.assertTrue(all(o.cliente.nombre == "Inmcor" for o in ordenes))
        # Las dos órdenes comparten el mismo PDF (spec 6.7) — Django les da
        # rutas de almacenamiento distintas para no pisarse, pero el
        # contenido subido es idéntico.
        contenidos = {o.troquel_modelo.archivo.read() for o in ordenes}
        self.assertEqual(len(contenidos), 1)

    def test_richard_pdf_de_dos_paginas_genera_dos_ordenes(self):
        mensaje = _cargar("TEST IMPRESOS RICHARD 8495 IMPRESOS RICHARD - CUADERNO 2026_TROQUELES.eml")
        resultado = pipeline.procesar_correo(mensaje, "<fixture-richard-real@impresosrichard.com>")
        self.assertEqual(resultado.resultado, "ok")
        self.assertEqual(len(resultado.ordenes), 2)
        ordenes = OrdenProduccion.objects.filter(numero__in=resultado.ordenes)
        self.assertTrue(all(o.cliente.nombre == "Impresos Richard" for o in ordenes))
        self.assertEqual(
            sorted(ordenes.values_list("referencia", flat=True)),
            [
                "TROQUEL 1 - 8495 IMPRESOS RICHARD - CUADERNO 2026_TROQUELES",
                "TROQUEL 2 - 8495 IMPRESOS RICHARD - CUADERNO 2026_TROQUELES",
            ],
        )

    def test_graficas_modernas_descarta_solo_el_archivo_orden(self):
        # 3 adjuntos reales: un PNG (descartado por extensión), un PDF
        # "...TROQUEL.pdf" (válido) y un PDF "...ORDEN.pdf" (descartado por
        # la regla filtra_orden). El nombre del PDF válido llega con un
        # salto de línea incrustado por el plegado del header — se limpia
        # en imap_client.extraer_adjuntos.
        mensaje = _cargar("GraficasModernasOP 38476-10 PT 011902 - PT 011570 - PT 011564 - PT 011566 ORDEN.eml")
        resultado = pipeline.procesar_correo(mensaje, "<fixture-gm-real@graficasmodernas.com>")
        self.assertEqual(resultado.resultado, "ok")
        self.assertEqual(len(resultado.ordenes), 1)
        orden = OrdenProduccion.objects.get(numero=resultado.ordenes[0])
        self.assertEqual(orden.cliente.nombre, "Graficas Modernas")
        self.assertNotIn("\n", orden.referencia)
        self.assertTrue(orden.referencia.endswith("TROQUEL"))
        self.assertNotIn("ORDEN", orden.referencia)

    def test_preprensa_inalmega_cotizacion_se_omite_riesgo_aceptado(self):
        # Riesgo conocido y aceptado (ver reglas/cotizacion.py): este correo
        # es en realidad un reenvío con instrucciones de troquel, pero trae
        # "COTIZACIÓN" en el asunto (MIME-encoded, iso-8859-1) y por eso se
        # omite igual que una cotización real.
        mensaje = _cargar(
            "PrepensaInalmegaTestRV SOLICITUD COTIZACIÓN TROQUEL PARA MICROCORRUGADO_ "
            "5335169 ARTE 27594 MICRO DISPLAY MIL USOS 12x10 FC.eml"
        )
        resultado = pipeline.procesar_correo(mensaje, "<fixture-inalmega-real@inalmega.com>")
        self.assertEqual(resultado.resultado, "omitido_cotizacion")
        self.assertEqual(OrdenProduccion.objects.count(), 0)

    def test_alexander_iphone_texto_partido_resuelve_cliente_real(self):
        # Correo real de Alexander desde iPhone: "Cliente:Gestion publicitaria"
        # (sin espacio tras los dos puntos) en un bloque text/plain separado
        # de la firma "Enviado desde mi iPhone" — el bug real de n8n perdía
        # esta línea al quedarse solo con el último bloque.
        mensaje = _cargar("iphonePartidoAlex.eml")
        resultado = pipeline.procesar_correo(mensaje, "<fixture-alexander-real@gmail.com>")
        self.assertEqual(resultado.resultado, "ok")
        orden = OrdenProduccion.objects.get(numero=resultado.ordenes[0])
        self.assertEqual(orden.cliente.nombre, "Gestion publicitaria")
        self.assertEqual(orden.troquel_modelo.nota_cliente, "")
