# Integration Architecture — AI Music Analyzer

## System Overview

```
Browser
  │
  ├──[HTTP/REST]──► components/frontend (React 19, :5173)
  │                        │
  │                        ├──[Vite proxy /api → :8000]──► components/api (FastAPI, :8000)
  │                        │                                       │
  │                        └──[EventSource SSE ?token=]──────────► │
  │                                                                 │
  │                                                        ┌────────┴────────┐
  │                                                        │                 │
  │                                               PostgreSQL 15         Redis 7
  │                                               (:5432)               (:6379)
  │                                                        │                 │
  │                                                        └────────┬────────┘
  │                                                                 │
  │                                                    components/worker (Celery)
  │                                                                 │
  │                                                                 ▼
  │                                                    components/analysis (library)
  │                                                                 │
  │                                                        data/uploads/
  │                                                        data/reference_library/
  │                                                        data/models/
  │                                                        output/analysis_results/
  │
  └──[HTTP/REST]──► components/frontend-spectr (React 18, :5174)
                           │
                           └──[Vite proxy /api → :8080]──► components/api
```

## Integration Points

### 1. Frontend → API (REST)

| From | To | Protocol | Auth | Description |
|------|----|----------|------|-------------|
| frontend (:5173) | api (:8000) | HTTP/REST via Vite proxy | Bearer JWT | All API calls proxied through `/api` prefix |
| frontend-spectr (:5174) | api (:8080) | HTTP/REST via Vite proxy | Bearer JWT (localStorage) | Same API, different proxy target config |

**Frontend proxy config** (`vite.config.ts`):
```typescript
'/api': {
  target: 'http://localhost:8000',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api/, ''),
  autoRewrite: true,   // Fixes trailing-slash redirect to preserve origin
}
```

**Frontend-spectr proxy config** (`vite.config.js`):
```javascript
'/api': {
  target: 'http://localhost:8080',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api/, ''),
}
```

**Auth flow**:
- `access_token` returned in response body → stored in React memory (`accessToken` state)
- `refresh_token` set as httpOnly cookie by API → auto-sent via `withCredentials: true`
- On 401, Axios interceptor calls `/auth/refresh` before retrying (dual-interceptor with `isRefreshing` flag + request queue)

### 2. Frontend → API (SSE Streaming)

| From | To | Protocol | Auth | Description |
|------|----|----------|------|-------------|
| frontend | api `/jobs/{id}/stream` | EventSource SSE | `?token=<jwt>` query param | Job progress streaming |
| frontend | api `/experts/{job_id}/specialist/{name}` | Fetch SSE | `Authorization: Bearer` header | AI expert streaming |

**Why two different auth methods**: EventSource API cannot set custom headers → token in query param. Fetch-based SSE can set headers → standard Bearer.

**SSE events (job progress)**:
```
data: {"job_id":"...","status":"PROCESSING","phase":2,"phase_name":"Genre Detection","pct":0.5}

event: complete
data: {"job_id":"..."}

event: error
data: {"error":"Analysis failed"}
```

**SSE events (expert specialist)**:
```
event: chunk
data: {"text":"...streaming text..."}

event: done
data: {}
```

### 3. API → PostgreSQL

| From | To | Protocol | Usage |
|------|----|----------|-------|
| api | PostgreSQL | asyncpg (async) | All route handlers: user CRUD, job state read, analysis results |
| api (Alembic) | PostgreSQL | psycopg2 (sync) | Schema migrations only |

**Connection setup** (`app/db.py`):
```python
engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
```

**Key constraint**: `expire_on_commit=False` required — without it, attribute access after `session.commit()` raises `MissingGreenlet` in async context.

### 4. API → Redis (Celery Dispatch)

| From | To | Protocol | Usage |
|------|----|----------|-------|
| api | Redis (:6379/0) | Celery broker | `dispatch_analysis_job()` → `send_task("app.tasks.run_analysis_pipeline", args=[...])`  |

**Dispatch** (`app/services/celery_client.py`):
```python
result = celery_app.send_task(
    "app.tasks.run_analysis_pipeline",
    args=[job_id, file_path, reference_path, user_id],
)
return result.id  # stored as UploadJob.task_id
```

**API never reads from Celery backend**: All job state is sourced from PostgreSQL, not `AsyncResult`. Redis result TTL (24h) would silently return PENDING for old jobs.

### 5. Worker → PostgreSQL

| From | To | Protocol | Usage |
|------|----|----------|-------|
| worker | PostgreSQL | psycopg2 (sync) | Writes job progress (`update_job_phase`), writes analysis results (`finalize_job`) |

**Engine lifecycle** (non-fork-safe):
```python
class CustomTask(Task):
    def before_start(self, ...):
        self._engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
        self._session = sessionmaker(self._engine, expire_on_commit=False)()

    def after_return(self, ...):
        self._session.close()
        self._engine.dispose()
```

**Critical**: Engine created per-task execution, not at module import (fork-safety).

### 6. Worker → Redis (Progress State)

| From | To | Protocol | Usage |
|------|----|----------|-------|
| worker | Redis (:6379/0) | Celery backend | `self.update_state(state="PROGRESS", meta={phase, pct, ...})` |

**Dual-mode progress**: Every phase tick writes to both Celery state (Redis) and PostgreSQL. API reads from PostgreSQL only (authoritative). Celery state for optional `AsyncResult` consumers.

### 7. Worker → Analysis Library

| From | To | Protocol | Usage |
|------|----|----------|-------|
| worker | audio_analysis | Python import | `from audio_analysis import run_pipeline` |

**Call site** (`tasks.py`):
```python
pipeline_result = run_pipeline(
    file_path=file_path,
    reference_path=reference_path,
    progress_cb=progress_cb,   # Updates DB + Celery on each phase
)
```

**`run_pipeline` is synchronous** — called directly from sync Celery task (no `asyncio.run()` needed).

### 8. Worker → Shared File System

| From | To | Description |
|------|----|-------------|
| api (write) | `data/uploads/` | Saves uploaded audio files (1 MB chunks via aiofiles) |
| worker (read) | `data/uploads/` | Reads audio file by path from UploadJob.file_path |
| analysis (read) | `data/reference_library/` | Reads reference genre profiles for Phase 6 gap analysis |
| analysis (read/write) | `data/models/` | Loads/caches ML model weights (TORCH_HOME) |
| worker (write) | `output/analysis_results/` | Writes per-job JSON analysis file (`{job_id}.json`) |
| api/experts (read) | `output/analysis_results/` | Experts endpoints read `{job_id}.json` for Claude prompts |

**Path traversal guard** in experts router:
```python
path = (RESULTS_DIR / f"{job_id}.json").resolve()
if not path.is_relative_to(RESULTS_DIR.resolve()):
    raise HTTPException(400, "Invalid job ID")
```

### 9. API → Anthropic (Claude)

| From | To | Protocol | Usage |
|------|----|----------|-------|
| api (expert_service) | Anthropic API | HTTPS | Triage + specialist streaming |

**Two modes** (configurable via `USE_CLAUDE_CLI`):
- **Production** (`USE_CLAUDE_CLI=false`): Anthropic SDK with `ANTHROPIC_API_KEY`, uses prompt caching
- **Dev** (`USE_CLAUDE_CLI=true`): Subprocess call to `claude` CLI (uses local subscription, no API key needed)

## Data Flow: Upload to Report

```
1. User uploads audio file
   Browser → POST /api/uploads/ (multipart, Bearer token)
   
2. API validates + stores file
   validate magic bytes → LocalStorage.save() → data/uploads/{uuid}_{filename}
   Create UploadJob (status=PENDING) → PostgreSQL
   dispatch_analysis_job(job_id, file_path) → Redis queue
   Return {job_id}

3. Frontend streams progress
   Browser → GET /api/jobs/{id}/stream?token=...  (EventSource)
   API polls PostgreSQL every 1s → SSE events to browser

4. Worker processes job
   Celery picks task from Redis
   CustomTask.before_start() → create DB engine/session
   run_analysis_pipeline(job_id, file_path, ...)
     → run_pipeline(file_path, reference_path, progress_cb)
       [phase 1] phase1_universal.analyze() → LUFS, bands, BPM, key, etc.
       [phase 2] phase2_genre.classify() → genre, confidence
       [phase 3] phase3_genre_specific.score() → total_score, sub_scores
       [phase 4] phase4_stems.analyze() → stems, clashes (Demucs — slow)
       [phase 5] phase5_reference.compare() → deltas vs reference
       [phase 6] phase6_gap.analyze() → percentile, gaps
       [phase 7] phase7_arrangement.advise() → violations, fixes
       + danceability_score + coached_fixes
       → PipelineResult
     finalize_job() → write AnalysisResult to PostgreSQL + JSON to disk
   CustomTask.after_return() → close DB engine

5. Frontend detects completion
   SSE event: status=COMPLETE → navigate to /jobs/{id}/report

6. Frontend fetches results
   GET /api/jobs/{id}/results
   → {job_id, result: PipelineResult, share_token}

7. User views report
   ReportPage renders all sections from PipelineResult
   "Copy Link" → /reports/share/{share_token} (public URL)
```

## Config Consistency Requirements

These three values MUST stay in sync:

| Setting | File | Value |
|---------|------|-------|
| Frontend dev port | `components/frontend/vite.config.ts` → `server.port` | `5173` |
| API CORS origins | `components/api/.env` → `CORS_ALLOW_ORIGINS` | must include frontend port |
| Proxy target | `components/frontend/vite.config.ts` → `proxy['/api'].target` | must be API port |

**Port 8000 is currently used by another app on this machine.** If it conflicts, update proxy target AND restart the API on a free port (8090, 9000, 9001 are typically free).

## Failure Modes & Fallbacks

| Failure | Behavior |
|---------|----------|
| Phase 4 (Demucs) unavailable | Returns `{"stems": {}, "clashes": [], "error": "demucs not available"}` — pipeline continues |
| Phase 7 (all-in-one-fix) unavailable | Returns empty sections → Arrangement Advisor shows "Enable Docker..." message |
| Analysis fails entirely | Worker sets `status=FAILED` in PostgreSQL; SSE broadcasts `event: error` |
| Anthropic API unavailable | Expert triage returns 500; `USE_CLAUDE_CLI=true` bypasses this in dev |
| Redis unavailable | Celery task dispatch fails at upload time (500 returned to user) |
| PostgreSQL unavailable | All API routes return 500; worker cannot update progress |
