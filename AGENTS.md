Business Context
Advertising/graphic arts company (boxes, packaging, cards, labels, bags). Core flow: Quote → Production Order → Remissions → Billing.
Business Flow

Client requests product → Quote created (status: draft)
Quote sent to client → status auto-changes to sent
Client approves → Quote locks, converts to Production Order (PO)
Client rejects → status rejected
PO executed incrementally: workers log progress via Remissions
Remissions determine what to charge, when, how much PO remains

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

PAPEL_CATALOG fetched from /api/papel/ (not hardcoded). PROCESS_GROUPS and PLIEGO_SIZES static (UI logic).
Quote States
draft → sent → approved (converts to PO) or rejected

approved quotes read-only, cannot be edited

Production Orders without money (Operador role)
  — Operador creates POs (direct PO or die task), but never sees or writes money: costs, rates, charge modes, paper prices, margin, totals, abono/saldo and payment terms are stripped on read AND ignored on write
  — Single source of truth: OP_CAMPOS_DINERO / OP_CAMPOS_COMERCIALES / PROCESO_EXTRAS_DINERO in serializers.py; UI side is the `showMoney` prop threaded through components/sections.jsx (shared by CotizacionEdit and OrdenEdit — see front/src/lib/opQuoteShared.js)
  — Write protection is not optional: the Operador's form posts zeros where he saw nothing, so unprotected fields would wipe the Admin's rates on the first autosave
  — He creates and edits **direct POs only** — a PO born from a quote is Admin's (403, and the screen is read-only for him). Deleting POs and the liquidación panel stay Admin-only
  — Die task: "+ Nueva tarea de troquel" in his Troqueles queue (same modal as Admin) creates the PO with `troquel` active and uploads the model — POST /api/troquel-modelos/ is the one non-Admin action on that viewset
  — Quotes stay fully Admin-only. CotizacionEdit has "+ Nueva cotización" in its topbar: flushes autosave and blanks the form in place (no round trip through the list)

Key Entities

Quote: client info, processes, prices, state
Production Order (PO): created from approved quote
Remission: partial production delivery record, linked to PO
Process: each product stage (printing, lamination, die-cut, finishing, etc.)

Cliente model fields: nombre, email, telefono, nit, tipo, creado
  — telefono and nit added in migration 0003
  — On quote save, existing clients silently PATCHed with updated contact fields
  — New clients created with all contact fields (nombre, email, telefono, nit, tipo)

Email sending: POST /api/cotizaciones/{id}/enviar/
  — Accepts: email (primary), extra_emails[] (CC list, not persisted), proc_rows, cost fields
  — Generates PDF via WeasyPrint (pre-warmed on startup to avoid cold-start delay)
  — Returns: { ok, enviado_a: [list of all recipients] }
  — Frontend: CotizacionModal.jsx — primary email pre-filled from clienteEmail, "+ Agregar destinatario" adds per-send extra recipients

Production Chain (Operador machine stations)

Sequential chain of machine stations that a PO's processes flow through, one station at a time: Impresora → Laminadora → Barnizadora → Troqueladora.
  — back/cotizaciones/chain.py is the single source of truth for station order, which proceso_ids belong to each station, and hard-blocking logic (a PO only enters a station's queue once every active process from an earlier station is completed)
  — `troquel` (die model fabrication) is NOT part of the chain — separate formato de cuchillas flow

RegistroProceso model (back/cotizaciones/models.py): append-only log, one row per Operador submission at a station
  — Saving a row marks the matching OpProceso completed=True; the PO then automatically advances to the next station's queue (no Admin action needed)
  — Snapshots cantidad_esperada at submit time since the Admin can edit the PO later
  — API: /api/registros-proceso/ (RegistroProcesoViewSet, back/cotizaciones/views.py) — list/create open to any authenticated user (Operador), edit/delete admin-only
  — GET /api/ordenes/?estacion={id} — a station's queue
  — Queue visibility is never toggled: every PO/process created enters its station's queue directly (there is no `visible_operador` flag — removed in migration 0046)
  — Queue order = `OpProceso.prioridad` (1 = first, null last). Reordered by dragging rows in the UI (`front/src/hooks/useDragOrder.js`), persisted via POST /api/ordenes/procesos/{proceso_id}/prioridades/ or /api/ordenes/estaciones/{estacion_id}/prioridades/ (body `{orden_ids: [...]}`) — admin-only (403 for Operador); the Operador's queue screens (EstacionMaquina.jsx, Troqueles.jsx) render read-only order, no drag handle or priority buttons
  — Frontend: pages/EstacionMaquina.jsx (shared screen for all 4 stations, driven by an `estacion` prop), components/RegistroProceso.jsx (form + history)

Operador's remisiones queue (Troqueles.jsx › tab "Remisiones", the pre-generation OP picker — NOT the Historial tab, which stays an unmutable log): each OP has a "Descartar" button
  — `OrdenProduccion.remision_descartada_operador_en` — not a delete: the OP stays intact with its formato de cuchillas aprobado, it just drops out of the Operador's `remisionables_operador` queue; the Admin keeps managing it same as always (unaffected by this flag)
  — GET /api/ordenes/remisionables_operador/ filters it out; POST .../descartar_remisionable_operador/ (body `{orden_id}`) sets the discard timestamp — open to Operador and Admin
  — No undo surfaced yet: once discarded it's Admin's from then on
  — Historial › Remisiones (PDF / Devolver) is untouched by this — it stays a plain log of already-generated remisiones, no discard action there

Notificacion model: Admin-facing alerts generated by the production flow (currently: cantidad_realizada below cantidad_esperada at a station)
  — destinatario=None means broadcast to all admins (read by any admin marks it read for all); FK exists to target individual admins later without a migration
  — API: /api/notificaciones/ — Frontend: components/Notificaciones.jsx

Conventions

All code in English (variables, functions, comments, endpoints)
REST API follows standard Django REST Framework conventions