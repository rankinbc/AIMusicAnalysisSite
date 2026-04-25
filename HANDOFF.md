# HANDOFF — AI Music Analyzer Dev Session

## What was built
All 4 components are fully implemented and the smoke test passed end-to-end:
- `components/analysis` — 7-phase audio pipeline (installable package)
- `components/api` — FastAPI backend (auth, upload, SSE, results)
- `components/worker` — Celery worker (runs pipeline, writes DB + JSON)
- `components/frontend` — React 19 SPA (auth, upload, progress, report)

## Current state
The code works. All problems are port conflicts — the user has many other apps running on the usual dev ports. Every session ends up on a different port and breaks config.

## The one config that must match everywhere

| Service  | Port | Config location |
|----------|------|-----------------|
| API      | pick a free one (8090, 9000, 9001 were free last check) | `components/api/.env` → `CORS_ALLOW_ORIGINS` |
| Frontend | pick a free one (3000 was free) | `components/frontend/vite.config.ts` → `server.port` + `proxy.target` |
| Worker   | n/a  | `components/worker/app/celery_app.py` |

**They must be consistent**: frontend proxy target = API port, CORS origin = frontend port.

## Correct .env values (components/api/.env)
```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/music_analyzer
ALEMBIC_DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/music_analyzer
JWT_SECRET_KEY=change-me-in-production
REDIS_URL=redis://localhost:6379/0
STORAGE_BACKEND=local
UPLOAD_DIR=../../data/uploads
MAX_UPLOAD_BYTES=209715200
CORS_ALLOW_ORIGINS=["http://localhost:3000"]   ← UPDATE to match frontend port
```

The .env had placeholder credentials (`user:password`, `aimusicdb`) which caused 500s. The correct credentials are `postgres:postgres` / `music_analyzer`. **Verify this file before starting.**

## How to start cleanly (do this first)

1. **Find free ports:**
   ```powershell
   netstat -ano | Select-String ":(3000|8090|9000|9001) "
   ```

2. **Kill stale processes:**
   ```powershell
   Get-Process python* | Stop-Process -Force
   # Only do this if safe — user has other Python apps running
   ```
   Safer: identify specific PIDs with `wmic process where "commandline like '%uvicorn%'" get processid,commandline`

3. **Start API** (from `components/api/`):
   ```bash
   python -m uvicorn app.main:app --port <API_PORT>
   ```

4. **Start worker** (from `components/worker/`):
   ```bash
   python -m celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo
   ```

5. **Update vite.config.ts** proxy target to `http://localhost:<API_PORT>` and port to `<FRONTEND_PORT>`

6. **Update .env** `CORS_ALLOW_ORIGINS=["http://localhost:<FRONTEND_PORT>"]`

7. **Start frontend** (from `components/frontend/`):
   ```bash
   npm run dev -- --port <FRONTEND_PORT> --strictPort
   ```

8. **Docker services must be running:**
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```

## Known bugs fixed this session
- `celery_app.py` was missing `include=["app.tasks"]` — tasks never registered ✓
- SSE endpoint used `get_current_user` (header auth) — EventSource can't send headers. Fixed with `get_current_user_sse` (query param `?token=`) ✓
- Vite proxy `followRedirects: true` buffered entire upload body, stalling XHR progress. Replaced with `autoRewrite: true` ✓
- `.env` had placeholder DB credentials overriding config.py defaults → 500s on all auth endpoints ✓
- FastAPI trailing-slash redirects (e.g. `/jobs` → `/jobs/`) used absolute backend URL, browser followed to port 8080 without auth header → 401s. `autoRewrite: true` fixes this ✓
- SSE `done` detection relied solely on named `event: complete` which was dropped when server closed connection. Added `status === 'COMPLETE'` detection in `onmessage` handler ✓

## Remaining UX issue
XHR upload progress stalls at ~32% for large files (FLAC) when going through the Vite proxy — the proxy's TCP flow control pauses the browser's send window. The upload DOES complete (200 OK returned, file lands in `data/uploads/`). The fix attempted was bypassing the proxy for uploads (direct to API port) but CORS complexity got messy. 

**Simplest remaining fix**: change the upload progress UI to show an indeterminate spinner when progress hasn't changed in 3 seconds, so users know it's still working.

## What the user wants
To use the app to analyze their music. They upload FLAC files. The pipeline runs in ~5-10 seconds on their machine (no GPU). The report shows mix score, genre, EQ bands, etc.
