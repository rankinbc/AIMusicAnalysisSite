# api

**Purpose**: FastAPI REST API backend. Handles user registration and login with JWT auth (access token in Authorization Bearer header, refresh token in httpOnly cookie via PyJWT). Accepts multipart audio file uploads (MP3/FLAC/WAV up to 200 MB) using chunked XHR reads to disk via aiofiles. Dispatches Celery tasks to Redis broker after files are staged. Exposes an SSE endpoint for live job progress. Exposes job status and results endpoints. Stores all job state in PostgreSQL via SQLAlchemy 2.0 async (asyncpg driver). CORS configured for React dev server (localhost:5173). Manages upload history per user account.

**Inputs**: `data/uploads/` — staged audio files written here before Celery dispatch

**Outputs**: `output/analysis_results/` — completed results read from here and served to the frontend

**Pattern**: `api.md`

**Stack**: Python 3.11+ / FastAPI / SQLAlchemy 2.0 async (asyncpg) / PostgreSQL / Alembic / Celery / Redis / PyJWT / aiofiles

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
  routers/         auth.py, uploads.py, jobs.py
  services/
    storage.py     AudioStorage protocol: LocalStorage (dev) / S3Storage (prod)
    celery_client.py  Task dispatch helpers (routes never import worker directly)
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
cp components/api/.env.example components/api/.env  # then fill in secrets
# Run Alembic initial migration once DB is up:
cd components/api && alembic upgrade head
```

---

**To extend this component**: edit `PRPs/source/INITIAL.md` and run `/generate-prp`. Don't modify files here directly for new work — let the PRP drive it.
