import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Count


def backfill_op(apps, schema_editor):
    """Ata cada ítem a su OP donde no hay ambigüedad: remisiones de un solo ítem.

    Las remisiones consolidadas no dejaron rastro del origen de cada ítem, así
    que ahí se quedan sin OP: el Admin las ajusta a mano como hasta ahora.
    """
    RemisionItem = apps.get_model("cotizaciones", "RemisionItem")
    unicas = (
        RemisionItem.objects.values("remision_id")
        .annotate(n=Count("id"))
        .filter(n=1)
        .values_list("remision_id", flat=True)
    )
    for item in RemisionItem.objects.filter(remision_id__in=list(unicas)).select_related("remision"):
        item.op_id = item.remision.orden_id
        item.save(update_fields=["op"])


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0036_remision_generada_en_remision_generada_por"),
    ]

    operations = [
        migrations.AddField(
            model_name="remisionitem",
            name="op",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="remision_items",
                to="cotizaciones.ordenproduccion",
            ),
        ),
        migrations.RunPython(backfill_op, migrations.RunPython.noop),
    ]
