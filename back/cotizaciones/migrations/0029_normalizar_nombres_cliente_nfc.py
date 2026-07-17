import unicodedata

from django.db import migrations


def normalizar_nfc(apps, schema_editor):
    Cliente = apps.get_model("cotizaciones", "Cliente")
    for c in Cliente.objects.all():
        nfc = unicodedata.normalize("NFC", c.nombre).strip()
        if nfc != c.nombre:
            c.nombre = nfc
            c.save(update_fields=["nombre"])


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0028_formato_desperdicio_cm_sac_cantidad"),
    ]

    operations = [
        migrations.RunPython(normalizar_nfc, migrations.RunPython.noop),
    ]
