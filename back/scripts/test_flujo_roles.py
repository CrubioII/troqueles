"""Prueba end-to-end del flujo de producción completo con los 4 roles de Operador.

Crea (o reutiliza) 4 usuarios reales en la base de datos de desarrollo, uno por
rol (es_general, es_guillotina, es_estaciones, es_troquelador), y corre el
flujo real de una OP a través de la API (DRF APIClient + force_authenticate,
mismo código de permisos que producción) verificando:

  1. Segmentación de acceso: cada usuario solo puede tocar lo que le
     corresponde (403 en todo lo demás).
  2. El flujo de negocio completo funciona con varios operadores distintos
     registrando información sobre la MISMA OP, respetando el orden de la
     cadena: Guillotina (corte inicial) -> Impresora -> Laminadora ->
     Barnizadora -> Troquel (formato de cuchillas) -> Troqueladora ->
     Guillotina (corte final) -> Remisión.
  3. El formato de cuchillas se guarda parcialmente como borrador por un
     usuario general y se completa/envía por el troquelador.

No es un test de Django (no usa TestCase ni transacciones descartables): usa
la base de datos real de desarrollo, a propósito, para que los 4 usuarios y
la OP de prueba queden ahí para inspección manual. Se puede re-ejecutar
tantas veces como haga falta (limpia sus propios datos al iniciar).

Uso: back/.venv/bin/python back/scripts/test_flujo_roles.py
"""
import os
import sys
import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from cotizaciones.models import (
    Cliente, OrdenProduccion, PerfilOperador, FormatoCuchillas, Remision,
)

User = get_user_model()

FALLOS = []
PASOS = 0


def paso(desc):
    global PASOS
    PASOS += 1
    print(f"\n[{PASOS}] {desc}")


def check(cond, ok_msg, fail_msg):
    if cond:
        print(f"    OK  · {ok_msg}")
    else:
        print(f"    FAIL· {fail_msg}")
        FALLOS.append(fail_msg)
    return cond


def esperar(resp, status_esperado, contexto):
    ok = resp.status_code == status_esperado
    detalle = getattr(resp, "data", None)
    check(
        ok,
        f"{contexto} -> {resp.status_code}",
        f"{contexto} -> esperaba {status_esperado}, llegó {resp.status_code} ({detalle})",
    )
    return resp


# ─────────────── 1. Usuarios y roles ───────────────

def crear_usuario(username, campo_rol):
    user, _ = User.objects.get_or_create(
        username=username, defaults={"is_staff": False}
    )
    user.is_staff = False
    user.set_password("troqueles2026")
    user.save()
    perfil, _ = PerfilOperador.objects.get_or_create(user=user)
    for campo in ("es_general", "es_troquelador", "es_estaciones", "es_guillotina"):
        setattr(perfil, campo, campo == campo_rol)
    perfil.save()
    return user


paso("Creando/actualizando los 4 usuarios de prueba con sus roles")
u_general = crear_usuario("op_general_test", "es_general")
u_guillotina = crear_usuario("op_guillotina_test", "es_guillotina")
u_estaciones = crear_usuario("op_estaciones_test", "es_estaciones")
u_troquelador = crear_usuario("op_troquelador_test", "es_troquelador")
print(f"    op_general_test      (es_general)     id={u_general.id}")
print(f"    op_guillotina_test   (es_guillotina)  id={u_guillotina.id}")
print(f"    op_estaciones_test   (es_estaciones)  id={u_estaciones.id}")
print(f"    op_troquelador_test  (es_troquelador) id={u_troquelador.id}")

cliente, _ = Cliente.objects.get_or_create(
    nombre="Cliente Prueba Flujo Roles",
    defaults={"email": "cliente-prueba@example.com", "tipo": "final"},
)

# Limpieza de corridas anteriores: solo nuestras OPs de prueba (la remisión
# protege el borrado de la OP mientras exista, así que va primero).
_ops_previas = OrdenProduccion.objects.filter(cliente=cliente, referencia__startswith="TEST-FLUJO-ROLES")
Remision.objects.filter(orden__in=_ops_previas).delete()
_ops_previas.delete()

c_general = APIClient(SERVER_NAME="localhost")
c_general.force_authenticate(user=u_general)
c_guillotina = APIClient(SERVER_NAME="localhost")
c_guillotina.force_authenticate(user=u_guillotina)
c_estaciones = APIClient(SERVER_NAME="localhost")
c_estaciones.force_authenticate(user=u_estaciones)
c_troquelador = APIClient(SERVER_NAME="localhost")
c_troquelador.force_authenticate(user=u_troquelador)


# ─────────────── 3. op_general crea la OP directa ───────────────

paso("op_general_test crea la OP directa con toda la cadena + troquel activos")
payload_op = {
    "fecha": "2026-09-03",
    "cliente": cliente.id,
    "referencia": "TEST-FLUJO-ROLES-001",
    "cantidad": 1000,
    "sobrante": 0,
    "corte_inicial_active": True,
    "corte_final_active": True,
    "procesos": [
        {"proceso_id": "corteInicial", "active": True},
        {"proceso_id": "impresion", "active": True},
        {"proceso_id": "laminado", "active": True},
        {"proceso_id": "uvTotal", "active": True},
        {"proceso_id": "troquel", "active": True},
        {"proceso_id": "troquelado", "active": True},
        {"proceso_id": "corteFinal", "active": True},
    ],
}
resp = c_general.post("/api/ordenes/", payload_op, format="json")
esperar(resp, 201, "op_general_test POST /api/ordenes/")
op_id = resp.data["id"] if resp.status_code == 201 else None
if op_id:
    print(f"    OP creada: {resp.data.get('numero')} (id={op_id})")
else:
    print("    No se pudo crear la OP, abortando el resto del flujo.")
    print(f"\n{'='*60}\nRESULTADO: {len(FALLOS)} fallo(s) de {PASOS} paso(s)\n{'='*60}")
    for f in FALLOS:
        print(f"  - {f}")
    sys.exit(1)


# ─────────────── 3b. Segmentación de acceso (negativos, sobre la OP real) ───────────────

paso("Verificando que cada rol NO pueda tocar estaciones ajenas (sobre la OP real)")
# Guillotina no debería poder registrar en impresora
resp = c_guillotina.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "impresora", "proceso_id": "impresion",
}, format="json")
esperar(resp, 403, "op_guillotina_test POST registros-proceso estacion=impresora")

# Estaciones no debería poder registrar en guillotina
resp = c_estaciones.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "guillotina", "proceso_id": "corteInicial",
}, format="json")
esperar(resp, 403, "op_estaciones_test POST registros-proceso estacion=guillotina")

# Troquelador no debería poder registrar en NINGUNA estación de cadena
for est, pid in [
    ("guillotina", "corteInicial"), ("impresora", "impresion"),
    ("laminadora", "laminado"), ("barnizadora", "uvTotal"),
    ("troqueladora", "troquelado"),
]:
    resp = c_troquelador.post("/api/registros-proceso/", {
        "orden": op_id, "estacion": est, "proceso_id": pid,
    }, format="json")
    esperar(resp, 403, f"op_troquelador_test POST registros-proceso estacion={est}")

# Guillotina y Estaciones no deberían poder tocar el módulo Troqueles
resp = c_guillotina.post("/api/formatos-cuchillas/", {"orden": op_id}, format="json")
esperar(resp, 403, "op_guillotina_test POST formatos-cuchillas")
resp = c_estaciones.post("/api/formatos-cuchillas/", {"orden": op_id}, format="json")
esperar(resp, 403, "op_estaciones_test POST formatos-cuchillas")

# Estaciones y Guillotina no deberían ver remisionables de troquel
resp = c_estaciones.get("/api/ordenes/remisionables_operador/")
esperar(resp, 403, "op_estaciones_test GET remisionables_operador")
resp = c_guillotina.get("/api/ordenes/remisionables_operador/")
esperar(resp, 403, "op_guillotina_test GET remisionables_operador")

# Guillotina y Troquelador no deberían ver remisionables de cadena (es_general only)
resp = c_guillotina.get("/api/ordenes/remisionables_produccion/")
esperar(resp, 403, "op_guillotina_test GET remisionables_produccion")
resp = c_troquelador.get("/api/ordenes/remisionables_produccion/")
esperar(resp, 403, "op_troquelador_test GET remisionables_produccion")
resp = c_estaciones.get("/api/ordenes/remisionables_produccion/")
esperar(resp, 403, "op_estaciones_test GET remisionables_produccion (no es_general)")


# ─────────────── 4. Guillotina: corte inicial ───────────────

paso("op_guillotina_test registra el corte inicial (Guillotina)")
resp = c_guillotina.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "guillotina", "proceso_id": "corteInicial",
    "cantidad_realizada": 1000, "tamano": "pliego", "observaciones": "Corte inicial ok",
}, format="json")
esperar(resp, 201, "op_guillotina_test POST registros-proceso corteInicial")


# ─────────────── 5. Estaciones: impresora, laminadora, barnizadora ───────────────

paso("op_estaciones_test registra Impresora")
resp = c_estaciones.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "impresora", "proceso_id": "impresion",
    "cantidad_realizada": 1000, "tamano": "pliego",
    "tiro_active": True, "tiro_colores_num": 4, "tiro_colores_desc": "CMYK",
}, format="json")
esperar(resp, 201, "op_estaciones_test POST registros-proceso impresion")

paso("op_estaciones_test registra Laminadora")
resp = c_estaciones.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "laminadora", "proceso_id": "laminado",
    "cantidad_realizada": 1000, "tamano": "pliego", "tipo_laminado": "mate",
}, format="json")
esperar(resp, 201, "op_estaciones_test POST registros-proceso laminado")

paso("op_estaciones_test registra Barnizadora")
resp = c_estaciones.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "barnizadora", "proceso_id": "uvTotal",
    "cantidad_realizada": 1000, "tamano": "pliego",
}, format="json")
esperar(resp, 201, "op_estaciones_test POST registros-proceso uvTotal")

paso("op_estaciones_test NO puede saltarse a Troqueladora (falta el troquel registrado)")
resp = c_estaciones.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "troqueladora", "proceso_id": "troquelado",
    "cantidad_realizada": 1000,
}, format="json")
esperar(resp, 409, "op_estaciones_test POST registros-proceso troquelado (sin troquel_modelo)")


# ─────────────── 6. Troquel: borrador por general, envío por troquelador ───────────────

paso("op_general_test guarda un AVANCE PARCIAL del formato de cuchillas (borrador)")
resp = c_general.post("/api/formatos-cuchillas/", {
    "orden": op_id,
    "cuchilla_cm": 120.5,
    "cuchilla_puntos": "2",
    "observaciones": "Avance inicial cargado por el usuario general.",
}, format="json")
esperar(resp, 201, "op_general_test POST formatos-cuchillas (borrador)")
formato_id = resp.data.get("id") if resp.status_code == 201 else None
check(
    resp.status_code == 201 and resp.data.get("estado") == "borrador",
    f"formato queda en estado={resp.data.get('estado')!r}",
    f"formato no quedó en borrador: {resp.data.get('estado')!r}",
)

if formato_id:
    paso("op_troquelador_test NO puede registrar en estaciones, pero SÍ completa y envía el formato")
    resp = c_troquelador.patch(f"/api/formatos-cuchillas/{formato_id}/", {
        "cuchilla_tipo": "doble_bisel",
        "grafa_cm": 40, "grafa_puntos": "2", "grafa_altura": "23.4",
        "ch_cm": 10, "ch_medida": "4x4",
        "sacabocados": [{"medida": "3", "cantidad": 2}],
        "cauchos": [{"tipo": "verde", "cm": 15}],
        "observaciones": "Completado y enviado por el troquelador.",
        "enviar": True,
    }, format="json")
    esperar(resp, 200, "op_troquelador_test PATCH formatos-cuchillas (enviar=true)")
    check(
        resp.status_code == 200 and resp.data.get("estado") == "aprobado",
        f"formato queda enviado, estado={resp.data.get('estado')!r}",
        f"formato no quedó enviado: {resp.data.get('estado')!r}",
    )

    formato_db = FormatoCuchillas.objects.filter(pk=formato_id).first()
    check(
        formato_db and formato_db.operador_id == u_troquelador.id,
        "el operador estampado en el formato es el troquelador (último que guardó)",
        f"operador estampado inesperado: {formato_db.operador_id if formato_db else None}",
    )

    op_check = OrdenProduccion.objects.get(pk=op_id)
    proceso_troquel = op_check.procesos.filter(proceso_id="troquel").first()
    check(
        proceso_troquel is not None and proceso_troquel.completado,
        "el proceso 'troquel' de la OP quedó completado",
        "el proceso 'troquel' de la OP NO quedó completado tras enviar el formato",
    )
    check(
        getattr(op_check, "troquel_modelo", None) is not None,
        "se creó/sincronizó TroquelModelo (necesario para habilitar Troqueladora)",
        "no existe troquel_modelo tras enviar el formato de cuchillas",
    )
else:
    print("    Sin formato_id, se omiten los pasos de envío del troquel.")


# ─────────────── 7. Estaciones: Troqueladora (ya con troquel registrado) ───────────────

paso("op_estaciones_test registra Troqueladora (ahora sí, con troquel ya fabricado)")
resp = c_estaciones.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "troqueladora", "proceso_id": "troquelado",
    "cantidad_realizada": 1000, "tamano": "pliego",
}, format="json")
esperar(resp, 201, "op_estaciones_test POST registros-proceso troquelado")


# ─────────────── 8. Guillotina: corte final ───────────────

paso("op_guillotina_test registra el corte final (Guillotina)")
resp = c_guillotina.post("/api/registros-proceso/", {
    "orden": op_id, "estacion": "guillotina_final", "proceso_id": "corteFinal",
    "cantidad_realizada": 1000, "tamano": "pliego", "observaciones": "Corte final ok",
}, format="json")
esperar(resp, 201, "op_guillotina_test POST registros-proceso corteFinal")

op_final = OrdenProduccion.objects.get(pk=op_id)
progreso = None
try:
    from cotizaciones.serializers import _orden_progreso
    progreso = _orden_progreso(op_final)
except Exception as e:
    print(f"    (no se pudo calcular progreso: {e})")
check(
    progreso is not None and progreso.get("porcentaje") == 100,
    f"progreso de la OP = {progreso}",
    f"la OP no llegó a 100%: {progreso}",
)
check(
    Remision.objects.filter(orden=op_final).exists(),
    "la remisión se auto-creó (pendiente) al llegar la OP a 100%",
    "no se creó la remisión automática al completar la OP",
)


# ─────────────── 9. op_general genera y descarga la remisión ───────────────

paso("op_general_test ve la OP en su cola de remisionables de troquel")
resp = c_general.get("/api/ordenes/remisionables_operador/")
esperar(resp, 200, "op_general_test GET remisionables_operador")
en_cola = any(o.get("id") == op_id for o in (resp.data or []))
check(en_cola, "la OP de prueba aparece en remisionables_operador", "la OP de prueba NO aparece en remisionables_operador")

paso("op_general_test consolida la remisión de la OP")
resp = c_general.post("/api/ordenes/consolidar_remision_operador/", {
    "orden_ids": [op_id], "observaciones": "Remisión de prueba flujo de roles.",
}, format="json")
esperar(resp, 200, "op_general_test POST consolidar_remision_operador")
remision_id = resp.data.get("remision_id") if resp.status_code == 200 else None

if remision_id:
    paso("op_general_test descarga el PDF de la remisión")
    resp = c_general.post("/api/ordenes/remision_operador_pdf/", {
        "remision_id": remision_id,
    }, format="json")
    ok_pdf = resp.status_code == 200 and resp.get("Content-Type") == "application/pdf"
    check(
        ok_pdf,
        f"PDF generado ({len(resp.content) if hasattr(resp, 'content') else '?'} bytes)",
        f"no se pudo generar el PDF de remisión: status={resp.status_code}",
    )
else:
    print("    Sin remision_id, se omite la descarga del PDF.")


# ─────────────── Resumen ───────────────

print(f"\n{'='*60}")
print(f"RESULTADO: {len(FALLOS)} fallo(s) de {PASOS} paso(s) verificados")
print(f"{'='*60}")
if FALLOS:
    for f in FALLOS:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("Todos los pasos pasaron.")
    sys.exit(0)
