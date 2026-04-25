# Architecture — components/api

FastAPI async REST backend. Python 3.11+, SQLAlchemy 2.0, asyncpg, PyJWT, Celery client.

## App Factory (main.py)

**Lifespan:** async context manager — disposes async engine on shutdown.

**Middleware:**
- `CORSMiddleware`: allowlist from `settings.CORS_ALLOW_ORIGINS` (never `"*"` when credentials=True); allows credentials, all methods, all headers

**Registered routers:**
| Prefix | Module | Purpose |
|--------|--------|---------|
| `/auth` | `routers/auth` | Register, login, refresh, logout |
| `/uploads` | `routers/uploads` | Audio file uploads |
| `/jobs` | `routers/jobs` | Status polling, SSE streaming, results |
| `/reports` | `routers/reports` | Public share endpoint |
| `/tracks` | `routers/tracks` | Version history grouping |
| (none) | `routers/experts` | AI triage + specialist streaming |

**Health:** `GET /` → `{"status": "ok", "version": "1.0.0"}`

---

## Configuration (config.py)

Pydantic `BaseSettings` — all values from env vars.

| Setting | Env Var | Default | Notes |
|---------|---------|---------|-------|
| DATABASE_URL | DATABASE_URL | postgresql+asyncpg://… | SQLAlchemy async runtime |
| ALEMBIC_DATABASE_URL | ALEMBIC_DATABASE_URL | postgresql+psycopg2://… | Alembic sync migrations only |
| JWT_SECRET | JWT_SECRET | change-me-in-production | HS256 signing key |
| JWT_ACCESS_EXPIRE_MINUTES | JWT_ACCESS_EXPIRE_MINUTES | 30 | Access token TTL |
| JWT_REFRESH_EXPIRE_DAYS | JWT_REFRESH_EXPIRE_DAYS | 30 | Refresh cookie TTL |
| REDIS_URL | REDIS_URL | redis://localhost:6379/0 | Celery broker/backend |
| UPLOAD_DIR | UPLOAD_DIR | ../../data/uploads | Relative to app/ |
| RESULTS_DIR | RESULTS_DIR | ../../output/analysis_results | Expert reads JSON here |
| MAX_UPLOAD_BYTES | MAX_UPLOAD_BYTES | 209715200 | 200 MB |
| STORAGE_BACKEND | STORAGE_BACKEND | local | LocalStorage implementation |
| anthropic_api_key | ANTHROPIC_API_KEY | — | Required if USE_CLAUDE_CLI=false |
| use_claude_cli | USE_CLAUDE_CLI | false | true → subprocess to `claude` CLI |
| CORS_ALLOW_ORIGINS | CORS_ALLOW_ORIGINS | ["http://localhost:5173"] | Must include frontend port |

---

## Database Layer (db.py)

```python
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
```

**Critical:** `expire_on_commit=False` prevents `MissingGreenlet` after `session.commit()` in async context.

**Dependency:** `get_session()` — async generator yielding `AsyncSession` per request lifetime.

---

## Auth Router (routers/auth.py)

### Password & JWT Utilities

- `hash_password(password) → str` — bcrypt hash
- `verify_password(password, hashed) → bool`
- `create_access_token(sub) → str` — HS256, 30-min, `type="access"`
- `create_refresh_token(sub) → str` — HS256, 30-day, `type="refresh"`

### FastAPI Dependencies

- `get_current_user(token: Bearer, session)` — decodes JWT, validates `type="access"`, fetches User, checks `is_active`
- `get_current_user_sse(token: Query, session)` — same but reads token from `?token=` query param (EventSource cannot set headers)

### Routes

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | /auth/register | — | Creates user; sets httpOnly refresh cookie |
| POST | /auth/login | — | Verifies password; sets httpOnly refresh cookie |
| POST | /auth/refresh | Cookie | Reads httpOnly `refresh_token`; returns new access token |
| POST | /auth/logout | — | Deletes `refresh_token` cookie |

---

## Uploads Router (routers/uploads.py)

### Magic Byte Validation

Inspects first 12 bytes — never trusts `Content-Type` header:
- MP3: `\xff\xfb`, `\xff\xf3`, `\xff\xf2`, or `ID3` prefix
- FLAC: `fLaC`
- WAV: `RIFF`

Returns 415 if no match.

### POST /uploads/

1. Auth: `get_current_user`
2. Check file size ≤ MAX_UPLOAD_BYTES (413 if exceeded)
3. Validate magic bytes (415 if invalid)
4. Save file via `LocalStorage.save()` (1 MB chunked aiofiles writes, UUID-keyed filename)
5. Optionally save reference track with `ref_` prefix
6. Create `UploadJob` (status=PENDING, file_path, reference_path, track_name)
7. `await session.commit()`
8. `dispatch_analysis_job(job_id, file_path, reference_path, user_id)` → Celery
9. Update `job.task_id` with Celery task ID; commit
10. Return `{"job_id": str}`

---

## Jobs Router (routers/jobs.py)

### GET /jobs/

- Returns 50 most recent jobs for current user, ordered desc by `created_at`
- Left joins `AnalysisResult` to get `overall_score` and `grade`
- Returns `list[JobSummary]`

### GET /jobs/{job_id}/status

- IDOR guard: `WHERE user_id = current_user.id`
- Returns `JobStatusSchema` with `job_id, status, current_phase, phase_name, phase_pct`

### GET /jobs/{job_id}/stream (SSE)

**Auth:** `get_current_user_sse` (token from `?token=`)

**Generator loop:**
1. Validates job ownership before streaming begins
2. Opens fresh `AsyncSession` each 1-second poll (outside request scope)
3. Emits JSON event: `{job_id, status, phase, phase_name, pct}`
4. On `COMPLETE`: emits `event: complete` then breaks
5. On `FAILED`: emits `event: error` then breaks

**CORS headers:** Reflects request Origin if in allowlist; sets `Access-Control-Allow-Credentials: true`

### GET /jobs/{job_id}/results

- IDOR guard; requires job `status == COMPLETE`
- Returns `{job_id, result: dict, share_token}` where `result` is `AnalysisResult.final_json`

---

## Reports Router (routers/reports.py)

### GET /reports/share/{share_token}

- No authentication required
- Fetches `AnalysisResult` by `share_token` (indexed)
- Returns `{result: dict}` or 404

---

## Tracks Router (routers/tracks.py)

### GET /tracks/

- Fetches all jobs with non-null `track_name` for current user, ordered by name then `created_at`
- Groups with `itertools.groupby()`
- Extracts `overall_score` and `grade` from each `AnalysisResult.final_json`
- Returns `list[TrackGroup]`

---

## Experts Router (routers/experts.py)

### Path Traversal Guard

```python
path = (RESULTS_DIR / f"{job_id}.json").resolve()
if not path.is_relative_to(RESULTS_DIR.resolve()):
    raise HTTPException(400, "Invalid job ID")
```

### POST /experts/{job_id}/triage

- Loads `{RESULTS_DIR}/{job_id}.json` from disk
- Calls `run_triage(analysis_json)` — single blocking Claude call
- Returns `{text: str, recommended_specialists: list[str]}`

### POST /experts/{job_id}/specialist/{specialist_name}

- Validates `specialist_name` in `VALID_SPECIALISTS` set (23 names)
- Returns `EventSourceResponse` streaming Claude text chunks
- Events: `chunk` (text) and `done` (completion)

---

## Service Layer

### services/storage.py — LocalStorage

- `save(file: UploadFile, prefix: str = "") → str` — key
  - Generates UUID-based key: `{uuid}_{prefix}{safe_filename}`
  - Streams upload in 1 MB chunks via aiofiles (never loads full file)
- `get_path(key: str) → Path`

### services/celery_client.py

```python
def dispatch_analysis_job(job_id, file_path, reference_path, user_id) -> str:
    result = celery_app.send_task(
        "app.tasks.run_analysis_pipeline",
        args=[job_id, file_path, reference_path, user_id],
    )
    return result.id
```

### services/expert_service.py

**Mode switching:** `settings.use_claude_cli` selects between subprocess (dev) and Anthropic SDK (prod).

**Dev mode** (`use_claude_cli=True`):
- `_cli_run(prompt_path, user_message)` → async subprocess to `claude` CLI
- `_cli_stream(prompt_path, user_message)` → async subprocess, parses `--output-format stream-json` lines

**Prod mode** (`use_claude_cli=False`):
- `_api_run(prompt, user_message)` → `AsyncAnthropic().messages.create()` with prompt caching
- `_api_stream(prompt, user_message)` → `AsyncAnthropic().messages.stream()` with prompt caching
- Both use `cache_control: {"type": "ephemeral"}` on system prompt for cache hits

**Public API:**
- `run_triage(analysis_json: dict) → {"text": str, "recommended_specialists": list[str]}`
- `stream_specialist(specialist: str, analysis_json: dict)` → async generator of SSE dicts

**VALID_SPECIALISTS (23):** LowEnd, FrequencyBalance, Dynamics, StereoPhase, Loudness, Sections, TranceArrangement, StemReference, HarmonicAnalysis, ClarityAnalysis, SpatialAnalysis, SurroundCompatibility, PlaybackOptimization, OverallScore, GainStagingAudit, StereoFieldAudit, FrequencyCollisionDetection, DynamicsHumanizationReport, SectionContrastAnalysis, DensityBusynessReport, ChordHarmonyAnalysis, DeviceChainAnalysis, PriorityProblemSummary

---

## Pydantic Schemas

### schemas/auth.py
- `RegisterRequest(email: EmailStr, password: str)`
- `LoginRequest(email: EmailStr, password: str)`
- `TokenResponse(access_token: str, token_type: str = "bearer")`

### schemas/uploads.py
- `UploadResponse(job_id: str)`

### schemas/jobs.py
- `JobStatusSchema(job_id, status, current_phase, phase_name, phase_pct)`
- `JobResult(job_id, result: dict[str, Any])`
- `JobSummary(job_id, status, filename, created_at, score, grade)`
- `TrackVersionSummary(job_id, filename, score, grade, created_at)`
- `TrackGroup(track_name, version_count, latest_score, latest_grade, versions: list[TrackVersionSummary])`

---

## Key Architectural Patterns

| Pattern | Implementation |
|---------|---------------|
| IDOR prevention | All DB queries scoped to `WHERE user_id = current_user.id` |
| Async sessions | `AsyncSession` with `expire_on_commit=False` |
| SSE polling | Fresh session per 1s poll (outside request scope) |
| File upload | 1 MB chunked aiofiles, UUID keys, magic byte validation |
| JWT refresh | httpOnly cookie (30d) + Bearer access token (30min) |
| Celery dispatch | Synchronous `send_task()`; state tracked in PostgreSQL only |
| Claude dev mode | Subprocess to `claude` CLI avoids API key requirement |
| Prompt caching | `cache_control: ephemeral` on system prompts reduces API cost |
