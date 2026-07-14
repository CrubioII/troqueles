# Troqueles — Architecture

Advertising/graphic-arts management system (boxes, packaging, cards, labels, bags).
Core business flow: **Quote → Production Order (OP) → Remissions → Billing**.

## System overview

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (React SPA)   │  HTTPS │  Backend (Django + DRF)      │
│  Azure Static Web Apps  │ ─────► │  Azure App Service (Docker)  │
│  delightful-sky-…       │  /api  │  troqueles-api-jp            │
└─────────────────────────┘        └──────┬────────────────┬──────┘
                                          │                │
                                 Postgres │ (pooler)       │ media files
                                          ▼                ▼
                               ┌────────────────┐  ┌────────────────┐
                               │ Supabase       │  │ Azure Blob     │
                               │ AWS us-east-2  │  │ Storage        │
                               └────────────────┘  └────────────────┘
```

## Tech stack

| Layer | Technology | Where |
|---|---|---|
| Frontend | React + Vite + React Router (SPA) | Azure Static Web Apps |
| Backend | Django + Django REST Framework | Azure App Service (Linux container, plan B1, **Always On enabled**) |
| Database | PostgreSQL (Supabase, **AWS us-east-2**, session pooler on port 5432) | cross-cloud from the API |
| File storage | Azure Blob Storage (`django-storages`), container `media` | prod only; local disk in dev |
| Auth | JWT (`djangorestframework-simplejwt`), Bearer tokens | access 60 min, refresh 7 days |
| PDF | WeasyPrint (quotes/remissions), pre-warmed at worker boot | |
| Web server | gunicorn `--workers 3 --threads 4 --worker-class gthread` | `back/start.sh` |

## Repository layout

```
back/                       Django project
  config/settings.py        env-driven: Postgres if DB_* vars set, else SQLite
  config/urls.py            /admin, /api/auth/, /api/
  cotizaciones/             single Django app with all domain models
    models.py               Cliente, Papel, Cotizacion, DocumentoCliente,
                            OrdenProduccion, OpProceso, RegistroMaquina,
                            TroquelModelo, FormatoCuchillas, Remision(+Item)
    views.py                all ViewSets + PDF/email actions
    sync_views.py           GET /api/sync/ — cheap per-resource versions (polling)
    dashboard_views.py      GET /api/dashboard/stats/
    auth_views.py           login (JWT with role/username claims), refresh, me
  start.sh                  migrate + ensure superuser + gunicorn
  Dockerfile                installs Pango/Cairo for WeasyPrint

front/                      React SPA
  src/api.js                every fetch helper; BASE = VITE_API_URL || '/api';
                            apiFetch() adds Bearer token, auto-refreshes on 401
  src/context/AuthContext.jsx  session restore by decoding JWT claims locally
                            (no network); /auth/me/ only as fallback
  src/lib/useSyncPolling.js polling hook (see "Real-time updates" below)
  src/pages/                one page per module (list pages poll via sync)
  src/components/           core.jsx helpers, sections, modals, Troquel.jsx
```

## Domain flow

1. Client requests product → **Cotizacion** created (`draft`)
2. Quote emailed (`POST /api/cotizaciones/{id}/enviar/`, WeasyPrint PDF) → `sent`
3. Client approves → quote locks, converts to **OrdenProduccion** (OP)
4. OP executed incrementally; operators log progress:
   - **RegistroMaquina** — per-machine runs (troquel, guillotina)
   - **FormatoCuchillas** — knife/blade format per OP; operator submits once,
     admin reviews (`pendiente → aprobado/rechazado`)
   - **TroquelModelo** — die model per OP (file upload → Azure Blob),
     admin-editable cost line items (`costos_items`)
5. **Remision** records partial deliveries → determines billing
   - Operator can request sending a remision; blocked until the troquel has
     prices (`/api/ordenes/remisiones_solicitadas/` lists blocked requests)

## Auth

- `POST /api/auth/login/` → `{access, refresh, role, username}`.
- Tokens carry custom claims `role` (`admin`|`operador`) and `username`
  (`CustomTokenSerializer.get_token`), so the SPA restores the session by
  decoding the stored access token **without any network request**.
- `GET /api/auth/me/` remains as fallback for tokens minted before the claims
  existed.
- DRF default: `IsAuthenticated`; admin-only endpoints use `_require_admin`.

## Real-time updates (sync polling)

Instead of each list page re-downloading its full payload every 5 s (the old
`usePolling`), pages use `useSyncPolling(loaders, {enabled})`:

- Every **10 s** the hook fetches `GET /api/sync/` (~300 B), which returns one
  opaque version string per resource, computed from stateless aggregates
  (count + max id/timestamp) — one indexed query per resource.
- A page's loader re-runs **only when its resource's version changed**.
- Safety net: full refresh every 6th tick (~60 s) and on tab re-focus, which
  covers writes that bypass `auto_now` (e.g. `queryset.update()`).

Sync keys: `cotizaciones`, `ordenes`, `remisiones`, `clientes`, `registros`,
`formatos_pendientes`, `remisiones_solicitadas`. Defined in
`back/cotizaciones/sync_views.py`; consumed by the 9 list pages in
`front/src/pages/`.

## Deployment

- **Push to `main` deploys everything** (GitHub Actions):
  - `.github/workflows/deploy-backend.yml` → builds Docker image, pushes to
    ACR `troquelesregistryjp.azurecr.io/troqueles-back:latest`, App Service
    `troqueles-api-jp` (resource group `troqueles-rg`) pulls it.
  - `.github/workflows/azure-static-web-apps-*.yml` → builds & deploys the SPA.
- Production config lives in App Service **application settings** (not in the
  repo `.env`): `DEBUG=False`, `DB_*` (Supabase pooler),
  `AZURE_STORAGE_CONNECTION_STRING`, `CORS_ALLOWED_ORIGINS` (must contain the
  Static Web Apps origin), `ALLOWED_HOSTS`, email settings.
- `start.sh` runs `migrate` and ensures the admin superuser on every container
  start, then launches gunicorn.

## Dev workflow

```sh
cd back  && .venv/bin/python manage.py runserver   # :8000 (SQLite locally)
cd front && npm run dev                            # :5173, proxies /api → :8000
```

## Known constraints / gotchas

- **DB is cross-cloud** (API in Azure South Central US, Postgres in AWS
  us-east-2): every query pays ~30-40 ms RTT. Persistent connections
  (`CONN_MAX_AGE=600`) remove the per-request TLS handshake; keep queries per
  request low. Moving DB and API to the same region is the next big win.
- gunicorn 3 workers × 4 threads → up to ~12 persistent DB connections against
  the Supabase session pooler; keep within its pool limits if scaling up.
- `front/dist/` is committed; `npm run build` output rides along with pushes.
- No automated test suite exists (as of 2026-07). Verify with the repo's
  `verify` skill (`.claude/skills/verify/SKILL.md`) or manual API calls.
