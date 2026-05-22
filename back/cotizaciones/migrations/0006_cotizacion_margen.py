from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cotizaciones', '0005_corte_inicial_final'),
    ]

    operations = [
        migrations.AddField(
            model_name='cotizacion',
            name='margen',
            field=models.DecimalField(decimal_places=2, default=80, max_digits=6),
        ),
    ]
