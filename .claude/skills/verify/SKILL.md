---
name: verify
description: How to verify changes in this repo end-to-end (Django API + React UI). Build/launch/drive recipe with auth handles.
---

# Verifying changes in troqueles

Django REST backend (back/, port 8000, SQLite dev DB) + React/Vite frontend (front/, port 5173, proxies /api → :8000). Auth is JWT (simplejwt).

## Launch

- The user usually already has both dev servers running (:8000 and :5173, check with `lsof -i :8000 -sTCP:LISTEN`). Django runserver autoreloads backend edits; Vite HMR picks up frontend edits — the running servers serve your new code.
- To guarantee fresh backend code without touching the user's server: `cd back && .venv/bin/python manage.py runserver 8001 --noreload` (background). Note :5173 always proxies to :8000.

## API surface (fastest)

Mint JWTs directly — no passwords needed:

```bash
cd back && .venv/bin/python manage.py shell -c "
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth.models import User
print(AccessToken.for_user(User.objects.get(username='operador')))"
```

Dev DB users: `operador` (non-staff), `admin` (staff). Then `curl -H "Authorization: Bearer $TOK" http://localhost:8000/api/...`.

Gotcha: list endpoints are paginated (`{count, next, previous, results}`) — parse `results`, not a bare array. Custom actions like `produccion_pendientes` return bare arrays.

## UI surface

Playwright (install in the scratchpad, not the project: `npm i playwright && npx playwright install chromium`). For login create a throwaway user with a known password via `manage.py shell` (`u.set_password(...)`), delete it after. Login page: placeholders `nombre de usuario` / `••••••••`. Operator troqueles flow lives at `/produccion/troqueles`; admin review at `/produccion/troqueles/revision`. Form inputs use class `.input` (no label-for associations — target by placeholder, role, or position).

## Test data & cleanup

Dev DB is the real working DB — create test rows through the API, capture ids, and delete them afterwards (as admin via API, or `manage.py shell`). OPs with an active troquel process: `OrdenProduccion.objects.filter(procesos__proceso_id='troquel', procesos__active=True, procesos__completado=False)`.
