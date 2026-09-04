#!/bin/sh
# Supervisor del listener IMAP IDLE (ver correos/management/commands/escuchar_correos.py).
# Lanzado en segundo plano por start.sh. Carga las variables que start.sh volco
# en /app/.env.cron, igual que el job de cron.
#
# El comando ya reintenta solo con backoff ante errores de IMAP; este bucle es
# la segunda red, para cuando el proceso muere del todo (OOM, kill, un bug).
. /app/.env.cron
cd /app

while true; do
    python manage.py escuchar_correos
    echo "[supervisor] el listener termino; reiniciando en 30s"
    sleep 30
done
