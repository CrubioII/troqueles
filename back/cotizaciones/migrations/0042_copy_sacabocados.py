from django.db import migrations


def copy_sacabocados(apps, schema_editor):
    FormatoCuchillas = apps.get_model("cotizaciones", "FormatoCuchillas")

    qs = FormatoCuchillas.objects.exclude(sac_medida="").exclude(sac_medida__isnull=True) | \
        FormatoCuchillas.objects.filter(sac_cantidad__gt=0)
    for formato in qs.distinct():
        formato.sacabocados = [{"medida": formato.sac_medida, "cantidad": int(formato.sac_cantidad)}]
        formato.save(update_fields=["sacabocados"])


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0041_formatocuchillas_sacabocados"),
    ]

    operations = [
        migrations.RunPython(copy_sacabocados, migrations.RunPython.noop),
    ]
