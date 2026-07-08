from django.db import migrations

# Últimos precios globales conocidos (COP por cm), usados como fallback
# si la tabla PrecioTroquel no tiene la fila correspondiente.
DEFAULT_PRECIOS = {"corte": 12, "score": 18, "hendido": 25, "caucho": 40}


def copy_precios_and_cauchos(apps, schema_editor):
    PrecioTroquel = apps.get_model("cotizaciones", "PrecioTroquel")
    TroquelModelo = apps.get_model("cotizaciones", "TroquelModelo")
    FormatoCuchillas = apps.get_model("cotizaciones", "FormatoCuchillas")

    precios = dict(DEFAULT_PRECIOS)
    precios.update({p.tipo: p.precio_unitario for p in PrecioTroquel.objects.all()})

    TroquelModelo.objects.update(
        precio_corte=precios["corte"],
        precio_score=precios["score"],
        precio_hendido=precios["hendido"],
        precio_caucho=precios["caucho"],
    )

    for formato in FormatoCuchillas.objects.filter(caucho_cm__gt=0):
        formato.cauchos = [{"tipo": "verde", "cm": float(formato.caucho_cm)}]
        formato.save(update_fields=["cauchos"])


class Migration(migrations.Migration):

    dependencies = [
        ("cotizaciones", "0020_formatocuchillas_cauchos_formatocuchillas_ch_cm_and_more"),
    ]

    operations = [
        migrations.RunPython(copy_precios_and_cauchos, migrations.RunPython.noop),
    ]
