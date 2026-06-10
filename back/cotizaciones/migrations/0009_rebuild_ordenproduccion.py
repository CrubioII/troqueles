from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Reconstruye el módulo de Órdenes de Producción.

    Elimina los modelos viejos (con estados/operarios) y sus datos, y crea la
    nueva estructura que espeja Cotizacion. También amplía Cotizacion con
    tipo_facturacion y la opción de pago a 60 días.
    """

    dependencies = [
        ("cotizaciones", "0008_ordenproduccion_opproceso"),
    ]

    operations = [
        migrations.DeleteModel(name="OpProceso"),
        migrations.DeleteModel(name="OrdenProduccion"),
        migrations.AddField(
            model_name="cotizacion",
            name="tipo_facturacion",
            field=models.CharField(
                choices=[("op", "Solo OP"), ("remision", "Remisión"), ("factura", "Factura")],
                default="factura",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="cotizacion",
            name="condicion_pago",
            field=models.CharField(
                choices=[
                    ("mismo", "Mismo día"),
                    ("8", "8 días"),
                    ("30", "30 días"),
                    ("60", "60 días"),
                    ("custom", "Personalizado"),
                ],
                default="30",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="documentocliente",
            name="condicion_pago",
            field=models.CharField(
                choices=[
                    ("mismo", "Mismo día"),
                    ("8", "8 días"),
                    ("30", "30 días"),
                    ("60", "60 días"),
                    ("custom", "Personalizado"),
                ],
                default="30",
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name="OrdenProduccion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("numero", models.CharField(blank=True, max_length=20, unique=True)),
                ("fecha", models.DateField()),
                ("referencia", models.CharField(max_length=300)),
                ("cantidad", models.PositiveIntegerField()),
                ("sobrante", models.PositiveIntegerField(default=0)),
                (
                    "tipo_cliente",
                    models.CharField(
                        choices=[("final", "Cliente Final"), ("terciario", "Cliente Terciario")],
                        default="final",
                        max_length=20,
                    ),
                ),
                ("molde_ancho", models.DecimalField(decimal_places=2, default=0, max_digits=7)),
                ("molde_alto", models.DecimalField(decimal_places=2, default=0, max_digits=7)),
                ("pliego_tipo", models.CharField(default="70x100", max_length=20)),
                ("pliego_w", models.DecimalField(decimal_places=2, default=70, max_digits=7)),
                ("pliego_h", models.DecimalField(decimal_places=2, default=100, max_digits=7)),
                ("precio_pliego", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("costo_papel_override", models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ("corte_inicial_active", models.BooleanField(default=False)),
                ("corte_inicial_precio", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("corte_final_active", models.BooleanField(default=False)),
                ("corte_final_precio", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("valor_unitario_override", models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ("valor_total_override", models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ("total_costos_override", models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ("subtotal_override", models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ("margen", models.DecimalField(decimal_places=2, default=80, max_digits=6)),
                ("abono", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                (
                    "condicion_pago",
                    models.CharField(
                        choices=[
                            ("mismo", "Mismo día"),
                            ("8", "8 días"),
                            ("30", "30 días"),
                            ("60", "60 días"),
                            ("custom", "Personalizado"),
                        ],
                        default="mismo",
                        max_length=20,
                    ),
                ),
                ("condicion_custom", models.CharField(blank=True, default="", max_length=300)),
                (
                    "tipo_facturacion",
                    models.CharField(
                        choices=[("op", "Solo OP"), ("remision", "Remisión"), ("factura", "Factura")],
                        default="factura",
                        max_length=20,
                    ),
                ),
                ("observaciones", models.TextField(blank=True, default="")),
                ("creado", models.DateTimeField(auto_now_add=True)),
                ("modificado", models.DateTimeField(auto_now=True)),
                (
                    "cliente",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="ordenes",
                        to="cotizaciones.cliente",
                    ),
                ),
                (
                    "cotizacion",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="ordenes",
                        to="cotizaciones.cotizacion",
                    ),
                ),
                (
                    "papel",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        to="cotizaciones.papel",
                    ),
                ),
            ],
            options={"ordering": ["-creado"]},
        ),
        migrations.CreateModel(
            name="OpProceso",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("proceso_id", models.CharField(max_length=50)),
                ("active", models.BooleanField(default=False)),
                ("costo", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("costo_override", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("extras", models.JSONField(blank=True, default=dict)),
                (
                    "orden",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="procesos",
                        to="cotizaciones.ordenproduccion",
                    ),
                ),
            ],
            options={
                "ordering": ["proceso_id"],
                "unique_together": {("orden", "proceso_id")},
            },
        ),
    ]
