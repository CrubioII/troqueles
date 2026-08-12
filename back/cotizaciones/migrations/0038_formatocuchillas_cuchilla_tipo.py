from django.db import migrations, models


def split_precio_cuchilla(apps, schema_editor):
    """El precio de cuchilla por cliente pasa a ser uno por tipo.

    Sin esto, el primer formato que elija un tipo saldría con precio 0 aunque el
    cliente ya tuviera precio de cuchilla acordado.
    """
    Cliente = apps.get_model("cotizaciones", "Cliente")
    for cliente in Cliente.objects.exclude(precios_troquel={}):
        precios = cliente.precios_troquel or {}
        base = precios.get("cuchilla")
        if not base:
            continue
        nuevos = {
            k: base
            for k in ("cuchilla:doble_bisel", "cuchilla:bohler")
            if not precios.get(k)
        }
        if nuevos:
            precios.update(nuevos)
            cliente.precios_troquel = precios
            cliente.save(update_fields=["precios_troquel"])


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0037_remisionitem_op"),
    ]

    operations = [
        migrations.AddField(
            model_name="formatocuchillas",
            name="cuchilla_tipo",
            field=models.CharField(
                blank=True,
                choices=[("doble_bisel", "Doble bisel"), ("bohler", "Bohler")],
                default="",
                max_length=12,
            ),
        ),
        migrations.RunPython(split_precio_cuchilla, migrations.RunPython.noop),
    ]
