#!/bin/sh
# Lanzado por cron (ver /app/crontab). Cron arranca con un entorno vacio,
# asi que carga las variables que start.sh volco en /app/.env.cron al iniciar
# el contenedor.
. /app/.env.cron
cd /app
exec python manage.py procesar_correos "$@"
