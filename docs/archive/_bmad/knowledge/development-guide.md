# Development Guide — AI Music Analyzer

## Prerequisites

- Python 3.11+
- Node.js 20+ / npm
- Docker Desktop (for PostgreSQL, Redis, and Phase 7 on Windows)
- Git

## First-Time Setup

### 1. Start Infrastructure
```bash
docker compose -f docker/docker-compose.yml up -d
# PostgreSQL 15 on :5432, Redis 7 on :6379
```

### 2. Install Python Dependencies
```bash
# API
pip install -r components/api/requirements.txt

# Analysis library (editable install — required for worker)
pip install -e components/analysis

# Worker
pip install -r components/worker/requirements.txt
```

### 3. Configure Environment
```bash
# Copy and edit API env
cp components/api/.env.example components/api/.env
```

Required `.env` values (`components/api/.env`):
```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/music_analyzer
ALEMBIC_DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/music_analyzer
JWT_SECRET=change-me-in-production
REDIS_URL=redis://localhost:6379/0
STORAGE_BACKEND=local
UPLOAD_DIR=../../data/uploads
MAX_UPLOAD_BYTES=209715200
CORS_ALLOW_ORIGINS=["http://localhost:5173"]
USE_CLAUDE_CLI=true
```

### 4. Run Database Migrations
```bash
cd components/api
alembic upgrade head
# Expected: "003 (head)"
```

### 5. Install Frontend Dependencies
```bash
cd components/frontend && npm install
```

## Daily Development Start

### Check for Port Conflicts First
```powershell
# In PowerShell — check if port 8000 is free
netstat -ano | Select-String ":8000 "
# If occupied by another app, either stop it or change API port
```

### Start Services (4 terminals)

**Terminal 1 — API:**
```bash
cd components/api
python -m uvicorn app.main:app --port 8000 --reload
# Verify: http://localhost:8000/docs
```

**Terminal 2 — Worker:**
```bash
cd components/worker
python -m celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo
# Windows requires --pool=solo
# Linux: --pool=prefork
```

**Terminal 3 — Frontend:**
```bash
cd components/frontend
npm run dev
# Vite serves on :5173, proxies /api → :8000
```

**Terminal 4 — Docker (if not already running):**
```bash
docker compose -f docker/docker-compose.yml up -d
```

## Port Configuration Consistency

These three settings MUST stay in sync:

| Setting | File | Current Value |
|---------|------|---------------|
| Frontend port | `components/frontend/vite.config.ts` → `server.port` | `5173` |
| Proxy target | `components/frontend/vite.config.ts` → `proxy['/api'].target` | `http://localhost:8000` |
| CORS origins | `components/api/.env` → `CORS_ALLOW_ORIGINS` | includes `http://localhost:5173` |

## Validation Gates

```bash
# Python lint (run from project root)
ruff check components/api/app/ components/analysis/src/ components/worker/app/

# Python type check
mypy components/api/app/ components/worker/app/ --ignore-missing-imports

# API tests
cd components/api && pytest -q

# Analysis tests
cd components/analysis && pytest -q

# Worker tests
cd components/worker && pytest -q

# Frontend type check (MUST pass before commit)
cd components/frontend && npm run type-check

# Frontend lint
cd components/frontend && npm run lint

# Frontend build smoke test
cd components/frontend && npm run build
```

## Database Migrations

```bash
cd components/api

# Check current state
alembic current          # Should show: 003 (head)

# Apply all pending migrations
alembic upgrade head

# Create new migration
alembic revision --autogenerate -m "description"
# Then edit the generated file in alembic/versions/

# Rollback one step
alembic downgrade -1
```

## Audio Analysis Package

```bash
# Install / reinstall after adding new modules
pip install -e components/analysis

# Test the pipeline directly (requires audio file)
python -c "
from audio_analysis import run_pipeline
result = run_pipeline('path/to/track.flac')
print('Score:', result['overall_score'])
print('Grade:', result['grade'])
"

# With optional ML extras (Demucs)
pip install -e components/analysis[ml]
```

**Key env var for ML models:**
```bash
export TORCH_HOME=data/models   # Cache demucs weights in repo, not ~/.cache
```

## Frontend Alternate (frontend-spectr)

```bash
cd components/frontend-spectr
npm install
npm run dev
# Serves on :5174, proxies /api → :8080 (check vite.config.js if API port differs)
```

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| API returns 500 on all auth routes | `.env` has placeholder DB credentials | Set `DATABASE_URL=postgresql+asyncpg://postgres:postgres@...` |
| Upload progress stalls at ~32% | Vite proxy TCP flow control | Expected for large FLAC; upload still completes (200 OK returned) |
| SSE stream never updates | EventSource blocked or port mismatch | Check CORS origins in `.env` match frontend port |
| Worker processes task but DB not updated | Engine created at import (fork-unsafe) | Engine must be created in `CustomTask.before_start()` |
| `MissingGreenlet` error after DB commit | Missing `expire_on_commit=False` | Set on `async_sessionmaker` |
| Arrangement analysis shows "Enable Docker" | `all_in_one_fix` not available on Windows | Run Phase 7 in Docker or WSL2 |
| Demucs very slow | CPU-only mode | Expected: 10-20 min/5-min track; GPU optional |
| `numpy` compatibility errors | numpy 2.x installed | Pin `numpy<2.0` and reinstall |

## Running Tests

```bash
# All Python tests
pytest components/api/tests/ components/analysis/tests/ components/worker/tests/ -v

# With coverage
pytest components/api/tests/ --cov=components/api/app --cov-report=term-missing

# Single test file
pytest components/api/tests/test_auth.py -v
```

## Adding a New Feature (PRP Workflow)

```bash
# Edit the initial spec
# nano PRPs/source/INITIAL.md

# Generate a PRP
/generate-prp PRPs/source/INITIAL.md

# Execute the PRP
/execute-prp PRPs/<slug>.md
```

## Environment Variables Reference

### API (`components/api/.env`)
| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | Yes | `postgresql+asyncpg://...` | Async, for SQLAlchemy |
| `ALEMBIC_DATABASE_URL` | Yes | `postgresql+psycopg2://...` | Sync, for Alembic only |
| `JWT_SECRET` | Yes | `change-me-in-production` | Change before production |
| `JWT_ACCESS_EXPIRE_MINUTES` | No | `30` | Access token lifetime |
| `JWT_REFRESH_EXPIRE_DAYS` | No | `30` | Refresh token lifetime |
| `REDIS_URL` | Yes | `redis://localhost:6379/0` | Celery broker |
| `CORS_ALLOW_ORIGINS` | Yes | `["http://localhost:5173"]` | Must match frontend port |
| `UPLOAD_DIR` | No | `../../data/uploads` | Relative to api/ dir |
| `MAX_UPLOAD_BYTES` | No | `209715200` | 200 MB |
| `USE_CLAUDE_CLI` | No | `false` | `true` for dev (no API key) |
| `ANTHROPIC_API_KEY` | Prod only | — | Required if `USE_CLAUDE_CLI=false` |

### Worker (`components/worker/.env`)
| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `REDIS_URL` | Yes | `redis://localhost:6379/0` | Celery broker + backend |
| `DATABASE_URL` | Yes | `postgresql+psycopg2://...` | psycopg2 sync driver |
| `RESULTS_DIR` | No | `../../output/analysis_results` | JSON artifact output |
