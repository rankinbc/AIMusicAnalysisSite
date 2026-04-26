# api

**Purpose**: FastAPI REST API backend. Handles user registration and login with JWT auth (access token in Authorization Bearer header, refresh token in httpOnly cookie via PyJWT). Accepts multipart audio file uploads (MP3/FLAC/WAV up to 200 MB) using chunked XHR reads to disk via aiofiles. Dispatches Celery tasks to Redis broker after files are staged. Exposes an SSE endpoint for live job progress. Exposes job status and results endpoints. Stores all job state in PostgreSQL via SQLAlchemy 2.0 async (asyncpg driver). CORS configured for React dev server (localhost:5173). Manages upload history per user account.

**Inputs**: `data/uploads/` — staged audio files written here before Celery dispatch

**Outputs**: `output/analysis_results/` — completed results read from here and served to the frontend

**Pattern**: `api.md`

**Stack**: Python 3.11+ / FastAPI / SQLAlchemy 2.0 async (asyncpg) / PostgreSQL / Alembic / Celery / Redis / PyJWT / aiofiles / Anthropic SDK

## How to run

```bash
# From the project root — starts the API in dev mode
cd components/api && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
# Health check
curl http://127.0.0.1:8000/
```

## Structure

```
app/
  main.py          FastAPI factory — CORS middleware, router includes
  config.py        Pydantic Settings — all env vars in one place
  db.py            Async SQLAlchemy engine + async_sessionmaker (expire_on_commit=False)
  worker.py        Celery app instance (tasks are regular def, not async def)
  models/          SQLAlchemy ORM: User, UploadJob, AnalysisResult
  schemas/         Pydantic v2 request/response DTOs
  routers/         auth.py, uploads.py, jobs.py, experts.py
  services/
    storage.py          AudioStorage protocol: LocalStorage (dev) / S3Storage (prod)
    celery_client.py    Task dispatch helpers (routes never import worker directly)
    expert_service.py   Claude API wrapper — triage routing + specialist SSE streaming
alembic/           Alembic migration environment (sync psycopg2 URL)
alembic.ini        Alembic config — points at ALEMBIC_DATABASE_URL
tests/             Pytest stubs — /execute-prp writes real tests here
requirements.txt   Pinned dependencies
.env.example       Secret key template — copy to .env before running
Dockerfile         Container image — scaffolded stub
```

## First-run setup

```bash
pip install -r components/api/requirements.txt
cp components/api/.env.example components/api/.env  # fill in secrets, including ANTHROPIC_API_KEY
# Run Alembic initial migration once DB is up:
cd components/api && alembic upgrade head
```

---

**To extend this component**: edit `PRPs/source/INITIAL.md` and run `/generate-prp`. Don't modify files here directly for new work — let the PRP drive it.

---

## Stems upload (added 2026-04-26)

`POST /uploads/` accepts an optional multipart `stems[]` field (1–30
FLAC or WAV files, ≤100 MB each, ≤1 GB total) plus optional
`reference_stems[]` with the same constraints.

Flow when stems are present:

1. Magic-byte validation (FLAC or WAV only — lossy formats give bad
   band-energy numbers and confident bad advice).
2. Files persisted to `data/uploads/`. Job stored with status
   `AWAITING_STEM_MAPPING`. **Celery is NOT dispatched yet.**
3. Server runs `propose_mapping` — auto-matches stems to roles via
   filename keywords + spectral fingerprint, and to .als track names
   via fuzzy match if an `als` file was uploaded. The proposal is
   returned in the response.
4. Frontend confirms via `POST /uploads/{job_id}/stems/confirm` with
   `{"mappings": [{"file": ..., "role": ..., "als_track": ...|null}]}`.
5. On confirm: validates (no unmapped files, no duplicate roles),
   persists `stem_paths`, transitions job to `PENDING`, dispatches
   Celery with stem_paths forwarded.
6. Beat task `expire_stale_stem_mappings_task` (hourly) auto-fails
   any job left in `AWAITING_STEM_MAPPING` for >24h and purges files.

`GET /jobs/{job_id}/status` re-serves `proposed_mapping` and
`als_track_names` while the job is still `AWAITING_STEM_MAPPING`, so
the frontend can recover the mapping screen after a reload.

Three new verdict specialists (`StemBalance`, `StemStereoWidth`,
`StemReferenceDelta`) at `prompts/experts/`. Triage-LLM gating:
they're listed as routable in `Triage.md` but only when stem data is
present. Existing `FrequencyCollisionDetection` and `FrequencyBalance`
prompts have stem-aware sections that activate when the data exists
and gracefully fall back when it doesn't.
