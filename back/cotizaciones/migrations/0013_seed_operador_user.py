from django.contrib.auth.hashers import make_password
from django.db import migrations


def create_operador(apps, schema_editor):
    User = apps.get_model("auth", "User")
    if not User.objects.filter(username="operador").exists():
        User.objects.create(
            username="operador",
            password=make_password("123"),
            is_staff=False,
            is_superuser=False,
            is_active=True,
        )


def delete_operador(apps, schema_editor):
    User = apps.get_model("auth", "User")
    User.objects.filter(username="operador").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("cotizaciones", "0012_preciotroquel_troquelmodelo_formatocuchillas"),
    ]

    operations = [
        migrations.RunPython(create_operador, delete_operador),
    ]
