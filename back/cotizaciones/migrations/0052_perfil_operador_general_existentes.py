from django.conf import settings
from django.db import migrations


def marcar_general(apps, schema_editor):
    """Antes de este cambio todo Operador tenía acceso sin restricciones:
    preservar ese comportamiento para las cuentas ya existentes marcándolas
    es_general=True. Los usuarios que se creen de aquí en adelante nacen sin
    perfil (sin acceso) hasta que se les asigne un rol a mano en el admin."""
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    PerfilOperador = apps.get_model("cotizaciones", "PerfilOperador")
    for user in User.objects.filter(is_staff=False):
        PerfilOperador.objects.get_or_create(user=user, defaults={"es_general": True})


def revertir(apps, schema_editor):
    PerfilOperador = apps.get_model("cotizaciones", "PerfilOperador")
    PerfilOperador.objects.filter(es_general=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0051_perfil_operador"),
    ]

    operations = [
        migrations.RunPython(marcar_general, revertir),
    ]
