FROM python:3.11-slim-bookworm

# Evitar que Python escriba archivos .pyc y habilitar el buffer de salida
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Configurar el directorio de trabajo
WORKDIR /app

# Instalar dependencias del sistema requeridas para weasyprint
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    # Dependencias de WeasyPrint
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    gobject-introspection \
    libglib2.0-0 \
    libcairo2 \
    libgirepository-1.0-1 \
    # Fuentes tipográficas básicas para generar PDFs con WeasyPrint
    fonts-dejavu-core \
    fontconfig \
    # Utilidad de diagnóstico
    curl \
    && rm -rf /var/lib/apt/lists/*

# Actualizar la caché de fuentes
RUN fc-cache -f -v

# Copiar requirements.txt e instalar dependencias de Python
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código fuente del backend al contenedor
COPY . /app/

# Crear directorios para estáticos y multimedia
RUN mkdir -p /app/staticfiles /app/media

# Recolectar archivos estáticos para WhiteNoise
RUN SECRET_KEY=temp-secret-key-for-collectstatic python manage.py collectstatic --no-input

# Dar permisos de ejecución al script de inicio y convertir finales de línea Windows a Unix (CRLF -> LF)
RUN chmod +x /app/start.sh && sed -i 's/\r$//' /app/start.sh

# Exponer el puerto por defecto
EXPOSE 8000

# Iniciar la aplicación usando el script
CMD ["/app/start.sh"]
