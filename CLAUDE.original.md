Business Context
Advertising and graphic arts company (boxes, packaging, business cards, labels, bags). Core flow: Quote → Production Order → Remissions → Billing.
Business Flow

Client requests product → Quote created (status: draft)
Quote sent to client → status auto-changes to sent
Client approves → Quote locks and converts to Production Order (PO)
Client rejects → status rejected
PO is executed incrementally: workers log progress via Remissions
Remissions determine what to charge, when, and how much of the PO remains

Tech Stack

Backend: Django + Django REST Framework (API REST ready) — port 8000
Frontend: React + Vite + React Router (SPA) — port 5173, proxy /api/ → :8000

Dev workflow:
  cd back && .venv/bin/python manage.py runserver
  cd front && npm run dev

Frontend structure: front/src/
  main.jsx → App.jsx (routes) → pages/CotizacionList.jsx | pages/CotizacionEdit.jsx
  components/core.jsx (helpers, catalogs), components/sections.jsx, components/Icons.jsx, components/CotizacionModal.jsx
  api.js (all fetch helpers: getPapeles, getClientes, createCliente, updateCliente, getCotizaciones, getCotizacion, createCotizacion, updateCotizacion, cambiarEstado, enviarCotizacion)

PAPEL_CATALOG fetched from /api/papel/ (not hardcoded). PROCESS_GROUPS and PLIEGO_SIZES are static (UI logic).
Quote States
draft → sent → approved (converts to PO) or rejected

approved quotes are read-only and cannot be edited

Key Entities

Quote: client info, processes, prices, state
Production Order (PO): created from an approved quote
Remission: partial production delivery record, linked to a PO
Process: each product stage (printing, lamination, die-cut, finishing, etc.)

Cliente model fields: nombre, email, telefono, nit, tipo, creado
  — telefono and nit added in migration 0003
  — When saving a quote, existing clients are silently PATCHed with updated contact fields
  — New clients are created with all contact fields (nombre, email, telefono, nit, tipo)

Email sending: POST /api/cotizaciones/{id}/enviar/
  — Accepts: email (primary), extra_emails[] (CC list, not persisted), proc_rows, cost fields
  — Generates PDF via WeasyPrint (pre-warmed on startup to avoid cold-start delay)
  — Returns: { ok, enviado_a: [list of all recipients] }
  — Frontend: CotizacionModal.jsx — primary email pre-filled from clienteEmail, "+ Agregar destinatario" adds per-send extra recipients

Conventions

All code in English (variables, functions, comments, endpoints)
REST API follows standard Django REST Framework conventions
