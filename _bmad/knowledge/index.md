# AI Music Analyzer — Knowledge Base Index

Master navigation index for the AI Music Analyzer monorepo. Read this first to orient, then follow links to specific documents.

**Stack:** Python 3.11+ (FastAPI, Celery, SQLAlchemy 2.0) + React 19 + TypeScript + Vite 8 + Tailwind CSS v3 + PostgreSQL 15 + Redis 7

---

## Project Overview

- **[project-overview.md](project-overview.md)** — What the app does, 5-component summary table, full tech stack, v1.1 feature set, key operational notes (Demucs performance, Windows constraints)

---

## System Architecture

- **[integration-architecture.md](integration-architecture.md)** — ASCII system diagram, all 9 integration points, complete upload-to-report data flow, config consistency requirements, failure modes table
- **[source-tree-analysis.md](source-tree-analysis.md)** — Annotated directory tree for all 5 components with critical path annotations and entry points

---

## Component Architecture (Deep Dives)

| Component | Port | Architecture Doc | Inventory |
|-----------|------|-----------------|-----------|
| **api** (FastAPI backend) | 8000 | [architecture-api.md](architecture-api.md) | — |
| **analysis** (pipeline library) | — | [architecture-analysis.md](architecture-analysis.md) | — |
| **worker** (Celery) | — | [architecture-worker.md](architecture-worker.md) | — |
| **frontend** (React 19) | 5173 | [architecture-frontend.md](architecture-frontend.md) | [component-inventory-frontend.md](component-inventory-frontend.md) |
| **frontend-spectr** (React 18) | 5174 | [architecture-frontend-spectr.md](architecture-frontend-spectr.md) | [component-inventory-frontend-spectr.md](component-inventory-frontend-spectr.md) |

---

## API Reference

- **[api-contracts-api.md](api-contracts-api.md)** — All 14 endpoints: auth, uploads, jobs, reports, tracks, experts. Full PipelineResult TypeScript schema. Phase 1 data shape. SSE event formats.
- **[data-models-api.md](data-models-api.md)** — PostgreSQL tables (users, upload_jobs, analysis_results), JobStatus enum, migration history (001–003), connection config

---

## Development

- **[development-guide.md](development-guide.md)** — Prerequisites, first-time setup, 4-terminal daily start, port consistency table, all validation gates, DB migration commands, common issues table, full env vars reference

---

## Quick Reference by Part

### API (components/api/)

**Entry:** `components/api/app/main.py`

**Auth dependency:** `routers/auth.py:get_current_user` (Bearer) / `get_current_user_sse` (?token=)

**Key files:**
- Routes: `routers/{auth,uploads,jobs,reports,tracks,experts}.py`
- Models: `models/{user,upload_job,analysis_result}.py`
- Services: `services/{storage,celery_client,expert_service}.py`
- Config: `app/config.py` (Pydantic BaseSettings)
- DB: `app/db.py` (AsyncSessionLocal with expire_on_commit=False)

**Run:** `cd components/api && uvicorn app.main:app --port 8000 --reload`

**Critical gotchas:**
- Two database URLs: `+asyncpg` for app, `+psycopg2` for Alembic
- `expire_on_commit=False` required on async_sessionmaker
- Never `await file.read()` on uploads — use 1 MB chunks
- IDOR prevention: all queries scoped to `WHERE user_id = current_user.id`
- `USE_CLAUDE_CLI=true` in dev skips Anthropic API key requirement

---

### Analysis Library (components/analysis/)

**Entry:** `components/analysis/src/audio_analysis/__init__.py` → `run_pipeline()`

**Install:** `pip install -e components/analysis`

**7 phases:**
1. Universal Mix Analysis — LUFS, RMS, BPM, 7 bands, stereo, key, true peak, clipping, mono compat
2. Genre Detection — BPM-based classification (trance/house/techno/dnb/other)
3. Genre-Specific Scoring — weighted rubrics per genre, produces total_score 0–100
4. Stem Separation — Demucs htdemucs_ft; 10–20 min CPU; graceful fallback
5. Reference Comparison — delta vs optional reference track
6. Gap Analysis — percentile vs `data/reference_library/{genre}/` profiles
7. Arrangement Advice — 8-bar rule, energy contrast, EDM section completeness (Docker/Linux only)

**Critical gotchas:**
- `numpy<2.0` hard pin (librosa + numba + soundfile break on 2.x)
- pyloudnorm needs `(samples, channels)` float64 — librosa gives `(channels, samples)` float32: always `.T.astype(float)`
- `TORCH_HOME=data/models` to cache weights in repo
- All input converted to 44100 Hz WAV via `converters.to_wav()` before any phase
- Model singleton: `models.get_model("demucs")` — never load inside per-call code path

---

### Worker (components/worker/)

**Entry:** `components/worker/app/celery_app.py`

**Task:** `app.tasks.run_analysis_pipeline(job_id, file_path, reference_path, user_id)`

**Run (Windows):** `cd components/worker && celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo`

**Critical gotchas:**
- Engine created in `CustomTask.before_start()`, disposed in `after_return()` — never at module import (fork-safety)
- `concurrency=1` always — Demucs RAM requirements
- `--pool=solo` on Windows (prefork requires OS fork)
- PostgreSQL is authoritative; never read job state from Celery `AsyncResult`
- `task_track_started=True` required in Celery config

---

### Frontend (components/frontend/)

**Entry:** `components/frontend/src/main.tsx`

**Run:** `cd components/frontend && npm run dev` (Vite dev server :5173, proxies /api → :8000)

**Key hooks:**
- `useFileUpload` — XHR upload with progress (not Axios/Fetch)
- `useJobStream` — EventSource SSE with `?token=` auth
- `useExpertAnalysis` — triage + specialist streaming via Fetch ReadableStream

**Key pages:** Upload → `/jobs/:id` (progress) → `/jobs/:id/report` (results)

**Protected pages:** History (`/history`), Track History (`/tracks`)

**Public pages:** `/reports/share/:token` (SharedReportPage, no auth)

**Critical gotchas:**
- Access token in React state ONLY (never localStorage)
- Axios dual-interceptor: `isRefreshing` flag + request queue for concurrent 401s
- SSE auth via `?token=` query param (EventSource cannot set headers)
- Tailwind safelist required for runtime-computed class names (grade colors, badges)
- Silent refresh on mount: `isLoading=true` until refresh attempt completes

---

### Frontend-Spectr (components/frontend-spectr/)

**Entry:** `components/frontend-spectr/src/main.jsx`

**Run:** `cd components/frontend-spectr && npm run dev` (Vite dev server :5174, proxies /api → :8080)

**Different from main frontend:**
- State-machine routing in App.jsx (no React Router)
- JavaScript only (no TypeScript)
- Token stored in `localStorage['spectr_token']` (not React state)
- Proxy targets `localhost:8080` (not 8000) — update if needed
- No silent refresh (no httpOnly cookie pattern)
- Richer visual design: animated ScoreRing, StickyPlayer with Web Audio waveform, TranceDNA visualization

---

## Cross-Cutting Integration Points

### Upload → Analysis → Report Flow

```
POST /api/uploads/ → job_id
  ↓ SSE: GET /api/jobs/:id/stream?token=...
  ↓ Celery worker: run_pipeline() → finalize_job()
  ↓ SSE event: complete
  ↓ GET /api/jobs/:id/results
  ↓ ReportPage renders all sections
```

### Share Link Flow
```
GET /api/jobs/:id/results → { share_token }
  ↓ /reports/share/:share_token
  ↓ GET /api/reports/share/:token (no auth)
```

### AI Expert Flow
```
POST /api/experts/:job_id/triage → { text, recommended_specialists }
  ↓ for each specialist:
  POST /api/experts/:job_id/specialist/:name (SSE stream)
  ↓ expert_service.py reads {job_id}.json from output/analysis_results/
  ↓ calls Claude (CLI or Anthropic SDK)
```

### Progress Architecture (SSE)
```
Celery task → progress_cb() →
  DB: update_job_phase() + commit     (authoritative)
  Redis: task.update_state("PROGRESS") (optional consumer)
  ↑
API polls DB every 1s → SSE events to browser EventSource
```

---

## Database State

**Current migration head:** `003`

**Tables:** `users`, `upload_jobs` (with `track_name`), `analysis_results` (with `share_token`)

**Run migrations:** `cd components/api && alembic upgrade head`

**DB URLs:**
- App (async): `postgresql+asyncpg://postgres:postgres@localhost:5432/music_analyzer`
- Alembic (sync): `postgresql+psycopg2://postgres:postgres@localhost:5432/music_analyzer`

---

## Infrastructure

**Docker:** PostgreSQL 15 (:5432) + Redis 7 (:6379)
```bash
docker compose -f docker/docker-compose.yml up -d
```

**Port map:**
| Service | Port |
|---------|------|
| Frontend | 5173 |
| Frontend-Spectr | 5174 |
| API | 8000 |
| PostgreSQL | 5432 |
| Redis | 6379 |

---

## Validation Gates (CI / Pre-Commit)

```bash
# Python
ruff check components/api/app/ components/analysis/src/ components/worker/app/
mypy components/api/app/ components/worker/app/ --ignore-missing-imports
pytest -q components/api/tests/ components/analysis/tests/ components/worker/tests/

# Frontend
cd components/frontend && npm run type-check && npm run lint && npm run build
```

All gates must pass before committing. TypeScript type-check is mandatory.

---

## PRPs / Feature Planning

Active feature plans: `PRPs/features/gap-01` through `gap-13` (13 pending)

Completed plans: `PRPs/archive/` (14 completed)

Workflow: edit `PRPs/source/INITIAL.md` → `/generate-prp` → `/execute-prp`
