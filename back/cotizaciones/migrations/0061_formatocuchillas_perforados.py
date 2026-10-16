from django.db import migrations, models


def copy_perforados(apps, schema_editor):
    formato_model = apps.get_model("cotizaciones", "FormatoCuchillas")
    for formato in formato_model.objects.exclude(perfo_cm=0):
        if formato.perfo_medida:
            formato.perforados = [{"medida": formato.perfo_medida, "cm": float(formato.perfo_cm)}]
            formato.save(update_fields=["perforados"])


class Migration(migrations.Migration):
    dependencies = [("cotizaciones", "0060_alter_registroproceso_tamano")]

    operations = [
        migrations.AddField(
            model_name="formatocuchillas",
            name="perforados",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(copy_perforados, migrations.RunPython.noop),
    ]
