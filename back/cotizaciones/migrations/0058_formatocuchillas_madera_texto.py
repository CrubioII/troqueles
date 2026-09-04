from django.db import migrations, models


def limpiar_ceros(apps, schema_editor):
    """Los valores decimales viejos llegan como texto ("0.00", "35.00").

    Un cero era "sin dato" en el campo numérico, así que se deja vacío; el resto
    pierde los decimales sobrantes para que se lea como lo escribiría el operador.
    """
    FormatoCuchillas = apps.get_model("cotizaciones", "FormatoCuchillas")
    for f in FormatoCuchillas.objects.exclude(madera="").iterator():
        try:
            valor = float(f.madera)
        except ValueError:
            continue  # ya es texto libre
        f.madera = "" if valor == 0 else ("%g" % valor)
        f.save(update_fields=["madera"])


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0057_registroproceso_tipo_metalizado_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="formatocuchillas",
            name="madera_cm",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.RenameField(
            model_name="formatocuchillas",
            old_name="madera_cm",
            new_name="madera",
        ),
        migrations.RunPython(limpiar_ceros, migrations.RunPython.noop),
    ]
