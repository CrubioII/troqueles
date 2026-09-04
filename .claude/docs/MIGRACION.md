# Migración del procesador de correos de troqueles (n8n → Django)

Reemplaza el workflow n8n "Troqueles Upload Troquel Task v1.8". Lee
`produccion@troquelesink.com` por IMAP una vez al día, resuelve qué cliente
envió cada correo, crea las `OrdenProduccion` + `TroquelModelo`
correspondientes y notifica por Telegram. Vive en la app `correos/`, rama
`feat/procesar-correos-troqueles`.

## Cómo correrlo

```bash
cd back
.venv/bin/python manage.py procesar_correos            # real
.venv/bin/python manage.py procesar_correos --dry-run   # simula, no escribe nada
```

Variables de entorno (`back/config/settings.py`):

| Variable | Default | Uso |
|---|---|---|
| `IMAP_HOST` | `mail.spacemail.com` | confirmado correcto contra producción |
| `IMAP_PORT` | `993` | |
| `IMAP_USER` | `produccion@troquelesink.com` | |
| `IMAP_PASSWORD` | `""` | debe configurarse, no tiene default real |
| `IMAP_CARPETA_COTIZAR` | `Cotizar` | ya existe en el buzón, verificado |
| `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` | `""` | si están vacíos, `telegram.notificar` no hace nada (no revienta) |
| `BATCH_DIAS_ATRAS` | `3` | ventana de búsqueda IMAP (`SINCE`) |
| `BATCH_DRY_RUN` | `false` | default del flag `--dry-run` |

## Estructura

- `models.py` — `CorreoProcesado`: registro de dedup, único por `message_id`. Un resultado `error` NO cuenta como procesado (se reintenta al día siguiente dentro de `BATCH_DIAS_ATRAS`).
- `reglas/cuerpo.py` — limpia el cuerpo del correo (firma, disclaimers, HTML→texto) para guardar en `OrdenProduccion.observaciones`.
- `reglas/cotizacion.py` — cualquier palabra que empiece por "cotiza" en asunto o cuerpo omite el correo (no crea orden, mueve a `Cotizar`). Se evalúa antes que cualquier otra regla.
- `reglas/adjuntos.py` — filtra por extensión (`.pdf`, `.ai`, `.cdr`) y detecta archivos "...orden" (regla de Graficas Modernas).
- `reglas/clientes.py` — **única fuente de verdad** para resolver el cliente. Cadena de prioridad: Alexander (por correo o nombre) → tabla `REGLAS_EXCLUSIVAS` (11 clientes con reglas propias) → dominio propio → alias del remitente → parte local del correo → `"Unresolved"` + alerta. Nunca usa un valor por defecto plausible cuando no puede resolver (ver incidente OP-0550/OP-0557 documentado en el código).
- `pdf_utils.py` — conteo/split de PDF para Impresos Richard (una orden por página).
- `imap_client.py` — IMAP con `BODY.PEEK[]` (nunca marca `\Seen` al leer), recoge TODOS los bloques de texto de un correo (no solo el último).
- `telegram.py` — 6 formatos de notificación.
- `pipeline.py` — orquesta todo lo anterior para un correo.
- `management/commands/procesar_correos.py` — entrypoint, corre el loop sobre los correos recientes.
- `cotizaciones/models.py` — `Cliente.nombre_normalizado` (único, normaliza acentos/mayúsculas/espacios) + migraciones `0041`–`0043` para fusionar duplicados existentes antes de aplicar el índice único.

## M1 — Spacemail acepta keywords personalizados: confirmado

Conectado por IMAP con credenciales reales. `PERMANENTFLAGS` trae `\*` →
el servidor acepta keywords arbitrarios. Se usa el keyword `procesado`
(no hace falta el respaldo `\Flagged`). La carpeta `Cotizar` ya existe con
el nombre exacto que espera `IMAP_CARPETA_COTIZAR`. También existe una
carpeta `Procesado` no usada por este código (queda ahí de antes).

## M3 — nombres de cliente verificados contra producción

Se consultó `cotizaciones_cliente` en la base real. De los 11 clientes con
regla propia, 9 coincidían exactamente. Se encontraron y corrigieron 2
grafías equivocadas en `reglas/clientes.py`:

- `Prepensa Inalmega` → **`Preprensa Inalmega`** (con "re").
- `Gráficas Modernas` → **`Graficas Modernas`** (sin tilde, así está en la BD).

Además se corrigió un typo no bloqueante: `elsonmontes@impresosrichard.com`
→ `nelsonmontes@impresosrichard.com` (el dominio ya cubría el match, pero
la dirección específica estaba mal escrita).

### Duplicado real encontrado y fusionado en producción

Existían **dos** clientes de Inalmega:

| id | nombre | creado | email | órdenes | remisiones |
|---|---|---|---|---|---|
| 295 | Prepensa Inalmega | 2026-08-27 | preprensa@inalmega.com | 16 | 0 |
| 232 | Preprensa Inalmega | 2026-07-18 | gerenciatroquelesinc@gmail.com | 3 | 1 |

Este NO lo iba a arreglar la migración `0042` automática — esa solo funde
variantes de acento/mayúsculas/espacios, y "Prepensa" vs "Preprensa"
difieren en letras reales. Se fusionó a mano, en producción, con permiso
explícito del usuario:

1. Las 16 órdenes de `295` se reasignaron a `232` (el registro más antiguo,
   con el nombre correcto).
2. El email de `232` se corrigió de `gerenciatroquelesinc@gmail.com`
   (gmail personal de Alexander, claramente un dato de relleno) a
   `preprensa@inalmega.com` (el contacto real de Inalmega).
3. Se borró el cliente `295`.

Resultado verificado post-commit: `232` — "Preprensa Inalmega" —
19 órdenes + 1 remisión. `295` ya no existe.

**Pendiente de la misma revisión (no tocado):** dos registros
`Juan Carlos Arias` (id 272 y 273, mismo email, creados con 1 segundo de
diferencia) — este SÍ lo va a fundir la migración `0042` automática porque
son duplicados exactos después de normalizar, así que no requiere acción
manual.

## Bugs reales encontrados al probar contra `.eml` capturados (no sintéticos)

Los fixtures sintéticos que se generaron al principio de la migración
fueron reemplazados por correos reales capturados del buzón (quedan en
`tests/fixtures/`). Probar contra ellos —en vez de datos inventados—
encontró dos bugs que las pruebas sintéticas nunca hubieran visto:

1. **Duplicación de órdenes de Inmcor.** El texto de búsqueda (usado para
   detectar líneas `Troquel: nnnn`) concatena el bloque de texto plano y el
   HTML-como-texto del correo, porque hace falta para el caso de un correo
   de iPhone con el cuerpo partido en dos bloques `text/plain` distintos.
   Pero en un correo `multipart/alternative` normal (texto plano y HTML son
   dos representaciones del MISMO contenido), esa concatenación duplicaba
   cada línea `Troquel: nnnn` y generaba el doble de órdenes. Se corrigió
   deduplicando los números encontrados en `pipeline._tareas_inmcor`,
   preservando el orden de aparición.
2. **Salto de línea incrustado en un nombre de adjunto.** Un correo real de
   Graficas Modernas traía el header `Content-Disposition` plegado en dos
   líneas; al decodificarlo, el nombre del archivo quedaba con un `\n`
   literal en el medio (ej. `"...PT 011570\n - PT 011564..."`). Eso se
   habría guardado tal cual en `OrdenProduccion.referencia`. Se corrigió
   colapsando cualquier espacio en blanco (incluidos saltos de línea) a un
   solo espacio en `imap_client.extraer_adjuntos`.

## Estado de las pruebas

126/126 tests pasando (`manage.py test correos`), `manage.py check` sin
issues, `makemigrations --check` sin cambios pendientes. Dos commits en la
rama:

- `feat(correos): batch de procesamiento de correos de troqueles (reemplaza n8n)`
- `fix(correos): deduplicar líneas "Troquel: nnnn" al construir órdenes de Inmcor`

## Decisiones tomadas sin instrucción explícita del spec (pendientes de tu confirmación)

- **`cantidad=1`** en cada `OrdenProduccion` creada por este flujo. El spec
  nunca definió qué cantidad usar para una orden de fabricación de troquel
  (no hay tiraje/cantidad de producto en estos correos, a diferencia de una
  cotización). Documentado en el código (`pipeline._crear_ordenes`) como
  algo a confirmar.
- Un correo con `resultado='error'` en `CorreoProcesado` NO cuenta como "ya
  procesado" para el dedup — puede reintentarse. Esto resuelve una
  contradicción aparente del spec entre "no reprocesar en silencio" y
  "un error debe poder reintentarse".
- Richard: adjuntos no-PDF (si no hay ningún PDF en el correo) generan una
  orden cada uno, sin combinar. El spec decía "se tratan como una sola
  orden" sin ser 100% explícito sobre si es una orden por archivo o todos
  combinados en una.

## Lo que falta — no lo hizo el agente

Del listado original de pasos manuales (M1–M12) y la sección 15 del spec:

- **M2** — host/puerto ya estaban bien (`mail.spacemail.com:993`), no
  requería cambios.
- **M4** — la carpeta `Cotizar` ya existía (confirmado por el usuario y
  vía `LIST` en M1).
- **M5** — corregir a mano las órdenes históricas OP-0550/OP-0557 en el
  admin de Django. No se tocó.
- **M6–M9** — crear el Container Apps Environment, dar permiso `AcrPull`,
  configurar secretos en Key Vault, y actualizar el pipeline de CI para
  desplegar el job junto con el App Service. Nada de esto existe todavía;
  el comando funciona local pero no tiene dónde correr en producción.
- **M10** — correr la migración `0041`–`0043` (`nombre_normalizado`
  único) contra la base de producción. El duplicado de Inalmega que
  bloqueaba esto ya se resolvió a mano (ver arriba); falta aplicar las
  migraciones en sí.
- **M11** — ✅ hecho por el usuario: los fixtures reales ya están en
  `tests/fixtures/`.
- **M12** — apagar la instancia EC2 / el workflow n8n viejo. Mientras
  ambos sigan corriendo contra el mismo buzón, se van a duplicar órdenes
  entre los dos sistemas.
- **Sección 15 (preguntas abiertas del spec):** límite de `max_length` de
  `referencia` (resultó no ser problema, el campo tiene 300 caracteres);
  casos límite adicionales de Graficas Modernas; si la detección de
  cotización debería revisar también nombres de adjuntos; si debería haber
  una alerta por PDFs de Impresos Richard con demasiadas páginas. Ninguna
  se decidió en silencio — siguen abiertas.

## Antes de activarlo en producción

1. Aplicar M10 (migraciones `0041`–`0043`) contra la base real.
2. Resolver M6–M9 (infraestructura + CI).
3. Apagar el workflow n8n / la instancia EC2 (M12) antes o al mismo tiempo
   que se activa el nuevo comando, para no duplicar órdenes.
4. Confirmar el criterio de `cantidad=1`.

## Cómo corre hoy (supera a M6–M9)

M6–M9 planteaba un Azure Container Apps Job. No se hizo: el procesamiento
vive dentro del mismo contenedor del App Service, arrancado por `start.sh`.

- **En vivo:** `escuchar_correos` mantiene una conexión IMAP IDLE y ejecuta
  el lote a los segundos de que entra un correo. Existe porque el cliente
  perdía urgencia con la corrida diaria: la urgencia de un troquel se decide
  por fuera del correo (llamada, WhatsApp), así que no hay nada que detectar
  — hay que eliminar la latencia. Spacemail no ofrece webhooks; IDLE es su
  único mecanismo de empuje (confirmado: el servidor lo anuncia en su
  CAPABILITY). Supervisado por `run_escuchar_correos.sh`, log en
  `/var/log/escuchar_correos.log`.
- **Respaldo:** `procesar_correos --no-resumen` por cron cada media hora, y
  la corrida diaria 10:00 UTC (5:00 a.m. Bogotá) que manda el resumen de
  Telegram. Log en `/var/log/procesar_correos.log`.
- El lote en sí es uno solo (`correos/runner.py`), con un advisory lock de
  Postgres (`correos/locking.py`) que evita que dos disparos se pisen: la
  deduplicación de `CorreoProcesado` no alcanza porque se graba *después*
  de crear las órdenes.
- Requisito de infraestructura: **Always On** en el App Service. Sin eso el
  contenedor se descarga por inactividad y el listener muere hasta la
  siguiente petición HTTP.
