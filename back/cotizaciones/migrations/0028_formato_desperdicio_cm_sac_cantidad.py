from django.db import migrations, models


def mm_a_cm(apps, schema_editor):
    """El desperdicio pasa de mm a cm (misma unidad que cuchilla_cm)."""
    FormatoCuchillas = apps.get_model("cotizaciones", "FormatoCuchillas")
    for f in FormatoCuchillas.objects.exclude(desperdicio_cm=0):
        f.desperdicio_cm = f.desperdicio_cm / 10
        f.save(update_fields=["desperdicio_cm"])


def cm_a_mm(apps, schema_editor):
    FormatoCuchillas = apps.get_model("cotizaciones", "FormatoCuchillas")
    for f in FormatoCuchillas.objects.exclude(desperdicio_cm=0):
        f.desperdicio_cm = f.desperdicio_cm * 10
        f.save(update_fields=["desperdicio_cm"])


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0027_ordenproduccion_remision_solicitada_en_and_more"),
    ]

    operations = [
        migrations.RenameField(
            model_name="formatocuchillas",
            old_name="desperdicio_mm",
            new_name="desperdicio_cm",
        ),
        migrations.RunPython(mm_a_cm, cm_a_mm),
        migrations.AddField(
            model_name="formatocuchillas",
            name="sac_cantidad",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
