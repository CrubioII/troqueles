#!/bin/sh
# Ejecutar migraciones de Django en Supabase
python manage.py migrate --noinput

# Crear superusuario administrador si no existe
python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); User.objects.filter(username='admin').exists() or User.objects.create_superuser('admin', 'admin@troqueles.ink', 'admin123')"

# Poblar datos demo para el cliente
python manage.py seed_dashboard_demo --clear

# Iniciar el servidor web de producción Gunicorn
gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 3 --timeout 120
