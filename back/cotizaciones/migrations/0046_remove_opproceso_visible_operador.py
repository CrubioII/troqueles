from django.db import migrations


class Migration(migrations.Migration):
    """Toda OP creada entra directa y visible a la cola de su estación.

    La visibilidad manual del Admin (`visible_operador`) desaparece: ya no
    había ninguna pantalla que la marcara y las colas nunca la filtraron.
    """

    dependencies = [
        ("cotizaciones", "0045_remision_tiene_troquel"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="opproceso",
            name="visible_operador",
        ),
    ]
