from django.db import migrations


def _rename_tipo(apps, old, new):
    FormatoCuchillas = apps.get_model("cotizaciones", "FormatoCuchillas")
    for formato in FormatoCuchillas.objects.exclude(cauchos=[]):
        cambiado = False
        for fila in formato.cauchos:
            if isinstance(fila, dict) and fila.get("tipo") == old:
                fila["tipo"] = new
                cambiado = True
        if cambiado:
            formato.save(update_fields=["cauchos"])


def grupolam_to_blucolan(apps, schema_editor):
    _rename_tipo(apps, "grupolam", "blucolan")


def blucolan_to_grupolam(apps, schema_editor):
    _rename_tipo(apps, "blucolan", "grupolam")


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0022_delete_preciotroquel_and_more"),
    ]

    operations = [
        migrations.RunPython(grupolam_to_blucolan, blucolan_to_grupolam),
    ]
