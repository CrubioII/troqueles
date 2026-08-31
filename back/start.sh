#!/bin/sh
# Ejecutar migraciones de Django en Supabase
python manage.py migrate --noinput

# Crear superusuario administrador si no existe
python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); User.objects.filter(username='admin').exists() or User.objects.create_superuser('admin', 'admin@troqueles.ink', 'admin123')"

# Volcar el entorno del contenedor a un archivo que cron pueda cargar
# (cron arranca con un entorno vacío, no hereda las App Settings de Azure)
python -c "
import os, shlex
with open('/app/.env.cron', 'w') as f:
    for k, v in os.environ.items():
        f.write(f'export {k}={shlex.quote(v)}\n')
"
chmod 600 /app/.env.cron

# Registrar y arrancar el cron job de procesamiento de correos
cp /app/crontab /etc/cron.d/procesar-correos
chmod 0644 /etc/cron.d/procesar-correos
touch /var/log/procesar_correos.log
cron

# Iniciar el servidor web de producción Gunicorn
gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 3 --threads 4 --worker-class gthread --timeout 120
