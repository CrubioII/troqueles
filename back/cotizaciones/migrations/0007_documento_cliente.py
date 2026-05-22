from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('cotizaciones', '0006_cotizacion_margen'),
    ]

    operations = [
        migrations.CreateModel(
            name='DocumentoCliente',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('numero', models.CharField(blank=True, max_length=20, unique=True)),
                ('fecha', models.DateField()),
                ('tiempo_entrega', models.CharField(blank=True, default='8 días hábiles', max_length=200)),
                ('condicion_pago', models.CharField(choices=[('mismo', 'Mismo día'), ('8', '8 días'), ('30', '30 días'), ('custom', 'Personalizado')], default='30', max_length=20)),
                ('condicion_custom', models.CharField(blank=True, default='', max_length=300)),
                ('nota', models.TextField(blank=True, default='En la presente cotización No incluye el impuesto del IVA, el cliente debe suministrar el diseño de logotipo e impresión.')),
                ('estado', models.CharField(choices=[('borrador', 'Borrador'), ('enviado', 'Enviado')], default='borrador', max_length=20)),
                ('creado', models.DateTimeField(auto_now_add=True)),
                ('modificado', models.DateTimeField(auto_now=True)),
                ('cliente', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='documentos', to='cotizaciones.cliente')),
            ],
            options={
                'ordering': ['-creado'],
            },
        ),
        migrations.CreateModel(
            name='DocumentoClienteItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('referencia', models.CharField(max_length=300)),
                ('descripcion', models.TextField(blank=True, default='')),
                ('tamano_display', models.CharField(blank=True, default='', max_length=200)),
                ('cantidad', models.PositiveIntegerField(default=0)),
                ('valor_unitario', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('valor_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('orden', models.PositiveSmallIntegerField(default=0)),
                ('cotizacion', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='documento_items', to='cotizaciones.cotizacion')),
                ('documento', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='cotizaciones.documentocliente')),
            ],
            options={
                'ordering': ['orden', 'id'],
            },
        ),
    ]
