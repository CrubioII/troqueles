# Performance overhaul — 2026-07-14

## Symptoms (production)

- Every API GET took ~1 s; login felt slow.
- Network tab showed the SPA re-downloading `formatos-cuchillas?estado=pendiente`
  and `ordenes/remisiones_solicitadas/` every 5 seconds, plus OPTIONS preflights.
- `POST /api/troquel-modelos/` (file upload) took 9.5 s.

## Root causes found

1. **New TLS DB connection per request.** `CONN_MAX_AGE` was unset (Django
   default 0) and the DB is Supabase in AWS us-east-2 while the API runs in
   Azure South Central US — each request paid a cross-cloud TCP+TLS handshake
   before its first query.
2. **N+1 queries** in the two most-polled endpoints:
   - `FormatoCuchillasViewSet` serializer read `orden.cliente.nombre` and
     `revisado_por.username` without joins → 2 extra queries per row.
   - `remisiones_solicitadas` called `_troquel_costos_total(op)` per row, each
     doing its own `TroquelModelo` query.
3. **Blind 5 s polling** — `usePolling` re-downloaded full list payloads every
   5 s on 9 pages; `AdminTroqueles` polled two endpoints unconditionally.
4. **Login/startup waterfall** — the SPA awaited `POST /auth/refresh/` then
   `GET /auth/me/` sequentially before rendering any route.
5. **3 sync gunicorn workers, no threads** — one slow blob upload blocked a
   third of total capacity; polling traffic starved the rest (explains the
   9.5 s POST more than the upload itself).
6. **Always On disabled** on the App Service → container slept after ~20 min
   idle; first request after idle paid container boot + migrate + WeasyPrint
   warmup.

## Fixes applied

### Backend

| File | Change |
|---|---|
| `back/config/settings.py` | `CONN_MAX_AGE: 600` + `CONN_HEALTH_CHECKS: True` (Postgres branch); `CORS_PREFLIGHT_MAX_AGE = 86400` |
| `back/cotizaciones/views.py` | `FormatoCuchillasViewSet` now `select_related("orden", "orden__cliente", "operador", "revisado_por")`; `remisiones_solicitadas` batches all `TroquelModelo` rows in one query |
| `back/cotizaciones/sync_views.py` (new) | `GET /api/sync/` — per-resource version strings from cheap aggregates (~300 B, ~5 ms) |
| `back/cotizaciones/urls.py` | route for `/api/sync/` |
| `back/cotizaciones/auth_views.py` | JWT access/refresh tokens carry `role` + `username` claims |
| `back/start.sh` | gunicorn `--workers 3 --threads 4 --worker-class gthread` (12 concurrent requests instead of 3) |

### Frontend

| File | Change |
|---|---|
| `front/src/lib/useSyncPolling.js` (new) | replaces `usePolling` (deleted): 10 s tick fetches only `/api/sync/`; reloads a list only when its version changed; full refresh every ~60 s and on tab focus as safety net |
| `front/src/pages/*` (9 pages) | migrated to `useSyncPolling` with the right sync key, keeping each page's `enabled` gating (Troqueles ×2, TroquelRevision, OrdenList, ProduccionGeneral, CotizacionList, Remisiones, ClienteList, Guillotina) |
| `front/src/api.js` | added `getSync()` |
| `front/src/context/AuthContext.jsx` | session restored by decoding JWT claims locally — zero network requests on startup; `/auth/me/` only for pre-claims tokens |

### Azure (portal/CLI, not code)

- **Always On enabled** on `troqueles-api-jp` (2026-07-14).
- Verified `DEBUG=False` and `CORS_ALLOWED_ORIGINS` already correct.

## Verification results

- `formatos-cuchillas?estado=pendiente`: 3 queries (was 2 + 2·N).
- `remisiones_solicitadas`: 3 queries (was 2 + N).
- `/api/sync/`: 8 queries (auth + 7 aggregates), ~5 ms locally; signatures
  stable across reads, change on create/delete (tested with a Cliente).
- Login token verified to carry `role`/`username` claims.
- Frontend builds; `manage.py check` clean. (No test suite exists.)

## Expected impact

- GETs: ~1 s → roughly network RTT (~150-300 ms from Colombia).
- Steady-state polling traffic reduced ~90% (one ~300 B request/10 s instead
  of multiple full payloads every 5 s).
- App startup with a valid session: 2 sequential requests → 0.
- No more cold starts; uploads no longer block a whole worker.

## Future recommendations (not done)

- Host DB and API in the same cloud/region (biggest remaining latency lever).
- Code-split the frontend bundle (788 kB minified, Vite warns >500 kB).
- If real push is ever needed, that means Django Channels + ASGI + Redis —
  deliberately avoided for now as overkill.
