from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0038_formatocuchillas_cuchilla_tipo"),
    ]

    operations = [
        migrations.AddField(
            model_name="formatocuchillas",
            name="observaciones",
            field=models.TextField(blank=True, default=""),
        ),
    ]
