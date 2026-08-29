"""Puebla Cliente.nombre_normalizado y fusiona duplicados antes de aplicar el
índice único (migración siguiente). Sin esto, 0042 falla en cualquier base
con dos clientes cuyo nombre solo difiere en tildes/mayúsculas/espacios.

La lógica de normalización se repite aquí (en vez de importar
cotizaciones.models.normalizar_nombre_cliente) a propósito: las migraciones
deben quedar congeladas en el tiempo y no romperse si el modelo cambia
después.
"""
import re
import unicodedata

from django.db import migrations


def normalizar(nombre):
    nfc = unicodedata.normalize("NFC", nombre or "").lower()
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFD", nfc) if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"\s+", " ", sin_tildes).strip()


def poblar_y_fusionar(apps, schema_editor):
    Cliente = apps.get_model("cotizaciones", "Cliente")

    grupos = {}
    for cliente in Cliente.objects.order_by("creado", "id"):
        clave = normalizar(cliente.nombre)
        grupos.setdefault(clave, []).append(cliente)

    for clave, clientes in grupos.items():
        principal, *duplicados = clientes
        for dup in duplicados:
            dup.cotizaciones.update(cliente=principal)
            dup.ordenes.update(cliente=principal)
            dup.remisiones.update(cliente=principal)
            dup.documentos.update(cliente=principal)
            cambios = []
            for campo in ["email", "telefono", "nit", "direccion", "ciudad"]:
                if not getattr(principal, campo) and getattr(dup, campo):
                    setattr(principal, campo, getattr(dup, campo))
                    cambios.append(campo)
            if cambios:
                Cliente.objects.filter(pk=principal.pk).update(
                    **{campo: getattr(principal, campo) for campo in cambios}
                )
            dup.delete()
        Cliente.objects.filter(pk=principal.pk).update(nombre_normalizado=clave)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('cotizaciones', '0041_cliente_nombre_normalizado_and_more'),
    ]

    operations = [
        migrations.RunPython(poblar_y_fusionar, noop),
    ]
