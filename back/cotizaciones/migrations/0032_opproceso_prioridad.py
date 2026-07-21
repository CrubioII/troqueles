from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0031_remision_mostrar_valores"),
    ]

    operations = [
        migrations.AddField(
            model_name="opproceso",
            name="prioridad",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
