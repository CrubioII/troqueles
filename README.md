# 🖨️ Troqueles INK — Sistema de Cotizaciones y Producción

[![Django](https://img.shields.io/badge/Django-4.x-092E20.svg)](https://www.djangoproject.com/)
[![DRF](https://img.shields.io/badge/Django_REST_Framework-3.x-A30000.svg)](https://www.django-rest-framework.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg)](https://vitejs.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](https://www.python.org/)

## 📋 Descripción

**Troqueles INK** es un sistema de gestión interno para una empresa de artes gráficas y publicidad especializada en la producción de cajas, empaques, tarjetas, etiquetas y bolsas. El sistema digitaliza el flujo operativo completo desde la cotización hasta la facturación, permitiendo controlar costos, tiempos y entregas de forma centralizada.

## ✨ Flujo Principal del Negocio

```
Cliente solicita producto
        ↓
  📄 Cotización (borrador)
        ↓
  📤 Enviada al cliente
        ↓
  ✅ Aprobada → se convierte a Orden de Producción
  ❌ Rechazada → cerrada
        ↓
  🏭 Orden de Producción (ejecutada por trabajadores)
        ↓
  📦 Remisiones (entregas parciales de la OP)
        ↓
  🧾 Facturación al cierre
```

## 🧩 Módulos del Sistema

### 📄 Cotizaciones
- Creación con cliente vinculado o nuevo
- Calculadora automática de pliegos de papel y costos
- Gestión de procesos de producción (impresión tiro/retiro, laminado, troquel, acabados, etc.)
- Panel de liquidación con precios editables y margen de ganancia configurable
- Envío por correo con PDF generado automáticamente (WeasyPrint)
- Estados: Borrador → Enviada → Aprobada / Rechazada → Convertida a OP

### 🏭 Órdenes de Producción
- Generadas automáticamente al aprobar una cotización
- Seguimiento de avance por proceso
- Panel de progreso para operadores

### 📦 Remisiones
- Registro de entregas parciales
- Trazabilidad de la producción en curso
- Generadas al cierre de la Orden de Producción

### 👥 Clientes
- Base de datos de clientes con NIT/cédula, correo y teléfono
- Tipo de cliente: Final o Terciario (con comisión automática)
- Vinculación automática a cotizaciones y órdenes

## 🛠️ Stack Tecnológico

| Capa | Tecnología | Puerto |
|------|-----------|--------|
| Backend API | Django + Django REST Framework | `:8000` |
| Frontend SPA | React 18 + Vite + React Router | `:5173` |
| Base de datos | SQLite (dev) | — |
| Generación PDF | WeasyPrint | — |
| Autenticación | JWT / Session auth | — |

## 🚀 Instalación y Desarrollo

### Prerrequisitos

- Python 3.11+
- Node.js 18+
- pip y npm

### Backend (Django)

```bash
cd back
python -m venv .venv
source .venv/bin/activate       # Linux/Mac
# .venv\Scripts\activate        # Windows

pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

El API queda disponible en `http://localhost:8000/api/`

### Frontend (React + Vite)

```bash
cd front
npm install
npm run dev
```

La app queda disponible en `http://localhost:5173`

> El frontend tiene proxy configurado: `/api/` → `localhost:8000`

## 📁 Estructura del Proyecto

```
troqueles/
├── back/                          # Backend Django
│   ├── core/                      # App principal
│   │   ├── models.py              # Cliente, Cotización, OrdenProduccion, Remision
│   │   ├── serializers.py         # DRF serializers
│   │   ├── views.py               # ViewSets y endpoints
│   │   └── migrations/            # Migraciones de base de datos
│   ├── troqueles/                 # Configuración del proyecto Django
│   └── manage.py
│
└── front/                         # Frontend React
    └── src/
        ├── pages/
        │   ├── CotizacionList.jsx     # Listado de cotizaciones
        │   ├── CotizacionEdit.jsx     # Editor de cotización
        │   ├── OrdenList.jsx          # Listado de órdenes de producción
        │   ├── OrdenEdit.jsx          # Vista de OP y remisiones
        │   └── DocumentoClienteEdit.jsx
        ├── components/
        │   ├── sections.jsx           # Secciones del editor (datos, papel, procesos…)
        │   ├── LiquidationPanel.jsx   # Panel de liquidación sticky
        │   ├── CotizacionModal.jsx    # Modal de envío de cotización por correo
        │   ├── core.jsx               # Helpers, catálogos y componentes base
        │   └── Icons.jsx              # Iconografía SVG
        ├── api.js                     # Todas las llamadas al backend
        ├── styles.css                 # Estilos globales (design system propio)
        └── App.jsx                    # Rutas principales
```

## 🎨 Design System

El proyecto usa un sistema de diseño propio basado en CSS variables:

- **Paleta cálida**: tonos crema (`#FAF7F1`), tinta (`#1B1816`) y acento naranja (`#B8541C`)
- **Tipografía**: Inter (UI) + JetBrains Mono (números y valores)
- **Componentes**: `.btn`, `.badge`, `.section`, `.liq`, `.proc-row`, `.chip-toggle`, etc.
- **Responsive**: diseño adaptativo para móvil, tablet y desktop

## 🔌 API REST — Endpoints Principales

| Método | Endpoint | Descripción |
|--------|---------|-------------|
| `GET/POST` | `/api/cotizaciones/` | Listar / crear cotizaciones |
| `GET/PUT` | `/api/cotizaciones/{id}/` | Ver / editar cotización |
| `POST` | `/api/cotizaciones/{id}/enviar/` | Enviar cotización por correo con PDF |
| `GET/POST` | `/api/ordenes/` | Listar / crear órdenes de producción |
| `GET/POST` | `/api/clientes/` | Gestión de clientes |
| `GET/POST` | `/api/papel/` | Catálogo de papeles administrable |

## 🧮 Calculadora de Pliegos

El sistema calcula automáticamente:

- **Unidades por pliego**: distribución óptima (normal y rotado) del molde en el pliego
- **Pliegos necesarios**: `⌈(cantidad + sobrante) / unidades_por_pliego⌉`
- **Costo de papel**: `pliegos × precio_pliego`
- **Costo total OP**: papel + todos los procesos activos
- **Valor unitario**: `costos_totales / cantidad × (1 + margen%)`
- **Diagrama visual** del pliego con distribución de moldes

## 🔐 Roles

| Rol | Permisos |
|-----|---------|
| **Administrador** | Crear, editar, eliminar cotizaciones; cambiar estados; ver liquidación; editar precios |
| **Operador** | Ver cotizaciones y órdenes; registrar avance de producción |

## 📦 Scripts Disponibles

```bash
# Backend
python manage.py runserver          # Servidor de desarrollo
python manage.py migrate            # Aplicar migraciones
python manage.py makemigrations     # Crear nuevas migraciones

# Frontend
npm run dev                         # Servidor de desarrollo con HMR
npm run build                       # Build de producción
npm run preview                     # Vista previa del build
npm run lint                        # Linting con ESLint
```

## 📄 Licencia

Uso interno — Troqueles INK © 2025

---

<div align="center">
  <p>Desarrollado para digitalizar el flujo operativo de Troqueles INK</p>
  <p>Backend · Django REST Framework &nbsp;|&nbsp; Frontend · React + Vite</p>
</div>
