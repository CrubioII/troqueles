from django.db import migrations, models


def copy_gan_legacy(apps, schema_editor):
    """Preserva el texto libre del `gan` viejo en `gan_legacy` y deja `gan`
    en `[]` para todas las filas: el valor previo no trae tipo (ojo de
    pescado/gancho/ventanera), así que no se puede mapear automáticamente a
    una fila estructurada, y además el JSONField exige contenido JSON válido
    (el CharField vacío por defecto no lo es)."""
    FormatoCuchillas = apps.get_model("cotizaciones", "FormatoCuchillas")
    for formato in FormatoCuchillas.objects.all():
        if formato.gan:
            formato.gan_legacy = formato.gan
        formato.gan = "[]"
        formato.save(update_fields=["gan_legacy", "gan"])


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0047_cotizacion_papel_manual_nombre_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="formatocuchillas",
            name="gan_legacy",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.RunPython(copy_gan_legacy, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="formatocuchillas",
            name="gan",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
