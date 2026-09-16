#!/bin/sh
# Lanzado por cron (ver /app/crontab). Cron arranca con un entorno vacio,
# asi que carga las variables que start.sh volco en /app/.env.cron al iniciar
# el contenedor.
. /app/.env.cron
cd /app
# Bound the whole batch, including storage uploads and database calls.
exec timeout --kill-after=30s 30m python manage.py procesar_correos "$@"
