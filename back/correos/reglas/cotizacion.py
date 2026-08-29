"""Detección de correos de cotización — sección 6.4 de la especificación.

Regla deliberadamente amplia: cualquier palabra que empiece por "cotiza" en
asunto o cuerpo, venga de quien venga, hace que el correo no se procese
(no se crea orden, no se sube archivo). Se evalúa ANTES que cualquier otra
regla, incluida la de Alexander (ver reglas/clientes.py).

Riesgo conocido y aceptado: correos de Preprensa Inalmega como "para su ayuda
con la cotización del troquel" dejan de generar órdenes bajo esta regla. Por
eso el resumen diario de Telegram debe listar cada correo omitido por
cotización durante las primeras semanas (ver pipeline.py / telegram.py).
"""
import re

_PATRON_COTIZA = re.compile(r"\bcotiza\w*", re.IGNORECASE)


def es_cotizacion(asunto, cuerpo):
    texto = f"{asunto or ''} {cuerpo or ''}"
    return bool(_PATRON_COTIZA.search(texto))
