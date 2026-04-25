name: "v1 AI Music Analyzer — Full Build"
description: |
  Multi-component v1 implementation plan. Builds all 4 components from scaffold stubs to working code.
  
  Full build:    /execute-prp PRPs/v1_ai_music_analyzer.md
  Single component: /execute-prp PRPs/v1_ai_music_analyzer.md --component <name>
  Components: api | analysis | worker | frontend

---

## Goal

Deliver a working music producer web app where users can register, log in, upload audio files (MP3/FLAC/WAV up to 200 MB), watch 7-phase analysis progress in real time, and view a comprehensive interactive report covering loudness, frequency balance, stereo health, genre scoring, stem separation, reference comparison, and arrangement advice.

## Why

- Independent producers lack access to professional analysis tools without expensive software or mastering engineers
- All analysis logic already exists in `AbletonAIAnalysis` — this project wraps it in a web-accessible, async, multi-user platform
- Target users: electronic music producers at all skill levels (trance, house, techno, drum & bass focus)

## What

- **Auth**: register + login + JWT (access token Bearer, refresh token httpOnly cookie)
- **Upload**: drag-drop audio file + optional reference track, with XHR progress bar
- **Processing**: async Celery job, 7-phase pipeline, SSE live progress stream
- **Report**: mix score A-F, top 3 fixes, genre badge, LUFS streaming table, frequency chart, stereo gauges, stem clash, reference delta, genre radar, arrangement advisor

### Success Criteria

- [ ] Users can register and log in; JWT refresh works silently on page reload
- [ ] Audio files upload to `data/uploads/` with progress bar; magic bytes validated
- [ ] Celery job is dispatched on upload; job ID returned immediately
- [ ] All 7 analysis phases run sequentially; per-phase progress visible via SSE
- [ ] Failed phases are recorded but job continues (partial-failure tolerance)
- [ ] Analysis results stored in PostgreSQL and `output/analysis_results/`
- [ ] Report page renders all sections with real data from the API
- [ ] `ruff check`, `mypy`, `pytest`, `npm run type-check`, `npm run build` all pass
- [ ] Docker Compose starts PostgreSQL, Redis, and allin1 container cleanly

---

## All Needed Context

### Documentation & References

```yaml
- file: CLAUDE.md
  why: Project structure rules, per-component gotchas, validation gates — read before touching any component

- file: .scaffolding/manifest.json
  why: Component list, data sources, lifecycle state

- url: https://fastapi.tiangolo.com/tutorial/request-files/
  why: UploadFile, multipart, chunked reading pattern

- url: https://fastapi.tiangolo.com/tutorial/cors/
  why: CORSMiddleware — allow_credentials + wildcard incompatibility

- url: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
  why: async_sessionmaker, AsyncSession, expire_on_commit=False, relationship loading

- url: https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/
  why: PyJWT auth pattern (updated to PyJWT in 2025, not python-jose)

- url: https://docs.celeryq.dev/en/stable/userguide/tasks.html
  why: bind=True, update_state, before_start/after_return, task_track_started, async def warning

- url: https://docs.celeryq.dev/en/stable/userguide/configuration.html
  why: task_track_started, result_expires, result_backend, broker_url

- url: https://github.com/facebookresearch/demucs/blob/main/docs/api.md
  why: demucs.api.Separator constructor, separate_audio_file, callback, segment parameter

- url: https://librosa.org/doc/main/changelog.html
  why: 0.11 breaking changes — FFT backend switch, YIN/PYIN win_length removal

- url: https://ui.shadcn.com/docs/components/radix/chart
  why: Recharts wrapper pattern for all report visualizations

- url: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload
  why: XHR upload progress events — must register before xhr.open()

- url: https://www.robinwieruch.de/react-router-private-routes/
  why: React Router v7 Outlet-based auth guard pattern
```

### Current Codebase tree (stubs — post-scaffold)

```
AIMusicAnalysisSite/
├── components/
│   ├── api/
│   │   ├── README.md, requirements.txt, .env.example, Dockerfile, alembic.ini
│   │   ├── alembic/env.py, alembic/versions/
│   │   └── app/
│   │       ├── main.py, config.py, db.py, worker.py
│   │       ├── models/ (user.py, upload_job.py, analysis_result.py)
│   │       ├── schemas/ (auth.py, uploads.py, jobs.py)
│   │       ├── routers/ (auth.py, uploads.py, jobs.py)
│   │       └── services/ (storage.py, celery_client.py)
│   ├── analysis/
│   │   ├── README.md, pyproject.toml, .env.example
│   │   └── src/audio_analysis/
│   │       ├── __init__.py, pipeline.py, schemas.py, models.py, converters.py
│   │       └── phases/ (phase1_universal.py ... phase7_arrangement.py)
│   ├── worker/
│   │   ├── README.md, requirements.txt, .env.example, Procfile
│   │   └── app/
│   │       ├── celery_app.py, tasks.py, progress.py, db.py, signals.py
│   └── frontend/
│       ├── README.md, package.json, vite.config.ts, tsconfig.json, tailwind.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx, App.tsx, index.css
│           ├── lib/apiClient.ts
│           ├── contexts/AuthContext.tsx
│           ├── types/api.ts
│           ├── components/ui/ProtectedLayout.tsx
│           └── features/ (auth/, upload/, analysis/, report/)
├── data/ (uploads/, reference_library/, models/)
├── output/analysis_results/
├── migrations/, schemas/, docker/
└── PRPs/, CLAUDE.md, README.md, .gitignore
```

### Desired Codebase tree (what /execute-prp produces)

```
components/
├── api/app/
│   ├── main.py              — FastAPI app with CORS, routers, lifespan
│   ├── config.py            — pydantic Settings (DATABASE_URL, REDIS_URL, JWT_SECRET, etc.)
│   ├── db.py                — async engine, async_sessionmaker(expire_on_commit=False)
│   ├── worker.py            — Celery app instance (broker=Redis, backend=Redis)
│   ├── models/
│   │   ├── user.py          — User ORM (id, email, hashed_password, created_at)
│   │   ├── upload_job.py    — UploadJob ORM (id, user_id, status, phase, pct, file_path, reference_path, created_at)
│   │   └── analysis_result.py — AnalysisResult ORM (job_id, phase_results JSON, final_json, created_at)
│   ├── schemas/
│   │   ├── auth.py          — RegisterRequest, LoginResponse, TokenResponse
│   │   ├── uploads.py       — UploadResponse (job_id)
│   │   └── jobs.py          — JobStatus, JobProgress, JobResult
│   ├── routers/
│   │   ├── auth.py          — POST /auth/register, POST /auth/login, POST /auth/refresh, POST /auth/logout
│   │   ├── uploads.py       — POST /uploads (chunked file write + Celery dispatch)
│   │   └── jobs.py          — GET /jobs/{id}/status, GET /jobs/{id}/stream (SSE), GET /jobs/{id}/results
│   └── services/
│       ├── storage.py       — StorageBackend protocol, LocalStorage, S3Storage
│       └── celery_client.py — dispatch_analysis_job(job_id, file_path, reference_path, user_id)
├── analysis/src/audio_analysis/
│   ├── __init__.py          — exports run_pipeline
│   ├── pipeline.py          — run_pipeline(): calls phases 1-7 sequentially with progress_cb
│   ├── converters.py        — to_wav(input_path) -> tmp WAV path at 44100 Hz
│   ├── models.py            — get_model(name) singleton loader for demucs, torchopenl3
│   ├── schemas.py           — PipelineResult TypedDict, PhaseResult TypedDict
│   └── phases/
│       ├── phase1_universal.py  — LUFS, 7-band EQ, stereo, transients, BPM, structure
│       ├── phase2_genre.py      — BPM+sidechain+kick pattern → genre classification
│       ├── phase3_genre_specific.py — trance/house/techno/dnb DNA scoring
│       ├── phase4_stems.py      — demucs separation + frequency clash detection
│       ├── phase5_reference.py  — per-stem delta vs reference track (if provided)
│       ├── phase6_gap.py        — percentile ranking vs reference_library profiles
│       └── phase7_arrangement.py — section lengths, 8-bar rule, energy contrast
├── worker/app/
│   ├── celery_app.py        — Celery instance with task_track_started=True
│   ├── tasks.py             — run_analysis_pipeline: single bound task, 7-phase loop
│   ├── progress.py          — make_progress_cb(task, job_id, session) factory
│   ├── db.py                — sync psycopg2 engine for Celery (not asyncpg)
│   └── signals.py           — worker_ready: pre-load demucs model
└── frontend/src/
    ├── lib/apiClient.ts     — Axios instance + dual interceptors (Bearer + 401 queue-replay)
    ├── contexts/AuthContext.tsx — access token state, silent refresh on mount
    ├── features/auth/       — Login.tsx, Register.tsx (form → POST /auth/login)
    ├── features/upload/
    │   ├── UploadPage.tsx   — drag-drop + file picker, optional reference upload
    │   └── useFileUpload.ts — XHR upload with File.slice() chunking + progress events
    ├── features/analysis/
    │   ├── JobProgressPage.tsx — 7-phase progress bars driven by SSE
    │   └── useJobStream.ts  — EventSource wrapper with cleanup
    └── features/report/
        ├── ReportPage.tsx   — assembles all report sections from API result
        ├── MixScore.tsx     — A-F grade + top 3 fixes
        ├── StreamingReadiness.tsx — LUFS table: Spotify/Apple/YouTube targets + pass/fail
        ├── FrequencyChart.tsx — 7-band BarChart (Recharts)
        ├── StemClash.tsx    — clash pairs table with severity + EQ fix suggestions
        ├── ReferenceComparison.tsx — per-metric delta table (conditional render)
        ├── GenreRadar.tsx   — RadarChart: percentile vs genre profile
        └── ArrangementAdvisor.tsx — ordered fix list, section violations
```

### Known Gotchas

```python
# ---- PROJECT-WIDE ----
# CRITICAL: never use python-jose — it's abandoned. JWT = PyJWT only (import jwt)
# CRITICAL: numpy<2.0 — librosa/numba/soundfile all break on numpy 2.x
# CRITICAL: Celery tasks must be sync def — wrap async code with asyncio.run()
# CRITICAL: allin1 (structure detection) requires Docker on Windows — no NATTEN Windows wheels
# PATTERN: audio files always converted to 44100 Hz WAV before any analysis phase

# ---- API ----
# CRITICAL: DATABASE_URL=postgresql+asyncpg:// for runtime; separate ALEMBIC_DATABASE_URL=postgresql+psycopg2:// for migrations
# CRITICAL: async_sessionmaker must set expire_on_commit=False or MissingGreenlet on attribute access after commit
# CRITICAL: chunk-read UploadFile — never await file.read() in one shot for large files
# CRITICAL: job state in PostgreSQL, NOT AsyncResult — never poll Redis from route handlers
# CRITICAL: CORS allow_origins must be list, never "*" when allow_credentials=True
# GOTCHA: magic byte validation — not Content-Type (trivially spoofed)
# GOTCHA: SSE CORS needs specific origin + credentials=True on EventSource
# GOTCHA: all user resource queries need WHERE owner_id = current_user.id (IDOR prevention)

# ---- ANALYSIS ----
# CRITICAL: pyloudnorm axis order — librosa loads (channels, samples) float32
#           pyloudnorm expects (samples, channels) float64
#           always: audio.T.astype(float) before passing — wrong order = wrong LUFS, no exception
# CRITICAL: use torchopenl3 not openl3 (TensorFlow conflict with torch stack)
# CRITICAL: use all-in-one-fix not allin1 (NATTEN no Windows wheels)
# CRITICAL: demucs via Python API (demucs.api.Separator) not subprocess
# GOTCHA: demucs htdemucs_ft takes 10-20 min CPU for 5-min track — set worker task timeout >=30 min
# GOTCHA: model weights loaded once per process (module-level singleton) — not per call
# GOTCHA: set TORCH_HOME=data/models to cache weights locally

# ---- WORKER ----
# CRITICAL: single bound @app.task(bind=True) not a chain — partial failure needs per-phase try/except
# CRITICAL: SQLAlchemy engine NOT at module import time — create in before_start (not fork-safe)
# CRITICAL: task_track_started=True in Celery config or PENDING is ambiguous
# CRITICAL: write results to PostgreSQL not Celery result backend (Redis result_expires purges after 1 day)
# GOTCHA: update_state PROGRESS is overwritten by SUCCESS — API must handle both state shapes
# GOTCHA: temp stem files must be cleaned in finally block, not relying on OS
# GOTCHA: Windows = --pool=solo; Linux = --pool=prefork

# ---- FRONTEND ----
# CRITICAL: access token in React state ONLY — not localStorage (XSS)
# CRITICAL: XHR not fetch for upload progress — Fetch has no upload progress events
# CRITICAL: register xhr.upload.addEventListener('progress') BEFORE xhr.open() and xhr.send()
# CRITICAL: EventSource needs withCredentials:true + API must set specific CORS origin (not *)
# GOTCHA: isRefreshing flag + _retry on request config prevents infinite 401 loop
# GOTCHA: Tailwind safelist required for runtime-computed grade/pass-fail class names
# GOTCHA: useJobStream must close EventSource in useEffect cleanup
# GOTCHA: silent refresh on AuthContext mount (call /auth/refresh before rendering protected routes)
```

---

## Implementation Blueprint

### Build order

Build in this sequence — each component depends on the previous:

1. **`analysis`** — no imports from other components; must be installable before api/worker can import it
2. **`api`** — imports from `audio_analysis` package (for validation); defines DB schema (Alembic migrations run here)
3. **`worker`** — imports from `audio_analysis` and uses api's DB models; Celery app must share config with api
4. **`frontend`** — depends on api endpoints being defined; generate TypeScript types from OpenAPI schema

---

### Component: analysis (patterns/analysis.md)

**Purpose**: 7-phase audio analysis Python package. Must be installable as `pip install -e components/analysis`.
**Inputs**: `data/uploads/`, `data/reference_library/`, `data/models/`
**Outputs**: structured dict returned from `run_pipeline()`
**Entry command**: `pip install -e components/analysis`

#### Tasks

```yaml
Task A1:
CREATE components/analysis/pyproject.toml:
  - hatchling build backend
  - package: audio_analysis, version: 0.1.0
  - dependencies: librosa>=0.11,<1.0; soundfile; scipy; numpy<2.0; pyloudnorm; torchopenl3; faiss-cpu; scikit-learn; matchering
  - optional extras [ml]: demucs>=4.0; torch>=2.0; torchaudio; all-in-one-fix
  - optional extras [dev]: pytest; ruff; mypy
  - src layout: packages = [{include = "audio_analysis", from = "src"}]

Task A2:
CREATE components/analysis/src/audio_analysis/converters.py:
  - to_wav(input_path: str | Path, target_sr: int = 44100) -> Path
  - loads with soundfile (or pydub fallback for MP3)
  - writes to tempfile.mkstemp suffix='.wav'
  - returns Path to temp WAV
  - CRITICAL: caller must delete temp file in finally block

Task A3:
CREATE components/analysis/src/audio_analysis/models.py:
  - _MODELS: dict = {} — module-level singleton registry
  - get_model(name: Literal["demucs", "openl3"]) -> Any
  - "demucs": demucs.api.Separator(model="htdemucs_ft", segment=7)
  - "openl3": torchopenl3 model loader
  - thread-safe lazy init with threading.Lock

Task A4:
CREATE components/analysis/src/audio_analysis/schemas.py:
  - PhaseResult TypedDict: {phase: int, name: str, status: "ok"|"failed"|"skipped", data: dict, error: str|None}
  - PipelineResult TypedDict: {file_path: str, phases: list[PhaseResult], overall_score: float, grade: str, top_fixes: list[str]}

Task A5:
CREATE components/analysis/src/audio_analysis/phases/phase1_universal.py:
  - analyze(wav_path: Path, progress_cb) -> dict
  - Load audio with librosa (sr=44100, mono=False)
  - LUFS: audio.T.astype(float) → pyloudnorm.Meter(44100).integrated_loudness()
  - Frequency: 7-band energy via librosa.amplitude_to_db(librosa.feature.melspectrogram())
  - Stereo: phase correlation (np.corrcoef on L/R channels), width estimate
  - Transients: librosa.onset.onset_detect() → density + attack character
  - BPM: librosa.beat.tempo()
  - Structure: all_in_one_fix.analyze(wav_path) — wrapped in try/except ImportError for Windows fallback

Task A6:
CREATE components/analysis/src/audio_analysis/phases/phase2_genre.py:
  - classify(wav_path, phase1_result, progress_cb) -> dict
  - Rules-based: BPM range + sidechain presence + kick pattern frequency → genre
  - Returns: {genre: str, confidence: float, bpm: float}

Task A7:
CREATE components/analysis/src/audio_analysis/phases/phase3_genre_specific.py:
  - score(wav_path, genre, progress_cb) -> dict
  - Dispatch to genre-specific scorer: trance_dna(), house_score(), techno_score(), dnb_score()
  - Returns composite score dict with sub-scores

Task A8:
CREATE components/analysis/src/audio_analysis/phases/phase4_stems.py:
  - analyze(wav_path, progress_cb) -> dict
  - Load demucs model via models.get_model("demucs")
  - separator.separate_audio_file(wav_path, callback=...) → stems dict
  - Per-stem metrics: peak dB, RMS, dominant freq, panning
  - Clash detection: compare frequency profiles between stem pairs
  - CRITICAL: write stems to tempfile.TemporaryDirectory, clean up in finally

Task A9:
CREATE components/analysis/src/audio_analysis/phases/phase5_reference.py:
  - compare(wav_path, reference_path, phase1_result, progress_cb) -> dict
  - Returns None if reference_path is None (phase skipped)
  - Per-feature delta: LUFS, RMS, stereo width, per-band energy
  - Severity: |delta| → "ok" < 1dB < "minor" < 3dB < "moderate" < 6dB < "significant"

Task A10:
CREATE components/analysis/src/audio_analysis/phases/phase6_gap.py:
  - analyze(wav_path, genre, phase1_result, progress_cb) -> dict
  - Load reference library profiles from data/reference_library/<genre>/
  - Build feature vector from phase1_result
  - Percentile rank per feature using scikit-learn
  - Z-score distance from genre mean

Task A11:
CREATE components/analysis/src/audio_analysis/phases/phase7_arrangement.py:
  - advise(structure_result, genre, progress_cb) -> dict
  - 8-bar rule compliance (section lengths divisible by 8 bars)
  - Energy contrast between sections
  - Missing sections detection
  - Returns ordered list of fix recommendations

Task A12:
CREATE components/analysis/src/audio_analysis/pipeline.py:
  - run_pipeline(file_path: str, reference_path: str|None=None, progress_cb=None) -> PipelineResult
  - Convert to WAV (converters.to_wav)
  - Run phases 1-7 in sequence; each phase wrapped in try/except
  - Failed phase: record PhaseResult(status="failed", error=str(exc)), continue
  - progress_cb(phase, phase_name, pct) called at start + end of each phase
  - Compute overall_score (weighted average of non-failed phases), grade (A-F), top_fixes
  - Clean up temp WAV in finally

Task A13:
CREATE components/analysis/src/audio_analysis/__init__.py:
  - from .pipeline import run_pipeline
  - __version__ = "0.1.0"

Task A14:
MODIFY components/analysis/tests/test_pipeline.py:
  - Generate synthetic 5-second sine WAV in tmp_path fixture (numpy sine → soundfile.write)
  - Mock demucs.api.Separator, all_in_one_fix.analyze, torchopenl3 model
  - Test run_pipeline returns PipelineResult with all 7 phases
  - Test that a phase exception doesn't abort pipeline (partial failure)
  - Test pyloudnorm shape contract explicitly
```

**Validation:**
```bash
pip install -e components/analysis
ruff check components/analysis/src/
mypy components/analysis/src/ --ignore-missing-imports
pytest components/analysis/tests/ -v
python -c "from audio_analysis import run_pipeline; print('import OK')"
```

---

### Component: api (patterns/api.md)

**Purpose**: FastAPI backend — auth, upload, job dispatch, SSE, results.
**Inputs**: `data/uploads/`
**Outputs**: reads `output/analysis_results/` and PostgreSQL to serve results
**Entry command**: `cd components/api && uvicorn app.main:app --reload --port 8000`

#### Tasks

```yaml
Task B1:
CREATE components/api/app/config.py:
  - pydantic_settings.BaseSettings
  - DATABASE_URL: str (postgresql+asyncpg://)
  - ALEMBIC_DATABASE_URL: str (postgresql+psycopg2://)
  - REDIS_URL: str
  - JWT_SECRET: str; JWT_ACCESS_EXPIRE_MINUTES: int = 30; JWT_REFRESH_EXPIRE_DAYS: int = 30
  - CORS_ALLOW_ORIGINS: list[str] = ["http://localhost:5173"]
  - UPLOAD_DIR: Path = Path("../../data/uploads")
  - RESULTS_DIR: Path = Path("../../output/analysis_results")
  - MAX_UPLOAD_BYTES: int = 200 * 1024 * 1024

Task B2:
CREATE components/api/app/db.py:
  - create_async_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
  - async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
  - async def get_session() -> AsyncGenerator[AsyncSession, None]
  - Base = DeclarativeBase()

Task B3:
CREATE components/api/app/models/user.py:
  - User(Base): id UUID pk, email str unique, hashed_password str, created_at, is_active bool
  - relationship: jobs (back_populates="user")

Task B4:
CREATE components/api/app/models/upload_job.py:
  - UploadJob(Base): id UUID pk, user_id FK(users.id), status enum(PENDING/PROCESSING/COMPLETE/FAILED)
  - current_phase int, phase_name str, phase_pct float
  - file_path str, reference_path str|None
  - created_at, started_at, completed_at
  - task_id str (Celery task ID)

Task B5:
CREATE components/api/app/models/analysis_result.py:
  - AnalysisResult(Base): id UUID pk, job_id FK(upload_jobs.id) unique
  - phase_results JSON (list of PhaseResult dicts)
  - final_json JSON (full PipelineResult)
  - created_at

Task B6:
CREATE Alembic migration:
  - alembic revision --autogenerate -m "initial_schema"
  - Creates users, upload_jobs, analysis_results tables
  - Run: alembic -c components/api/alembic.ini upgrade head

Task B7:
CREATE components/api/app/services/storage.py:
  - StorageBackend Protocol: save(file: UploadFile) -> str, get_path(key: str) -> Path
  - LocalStorage: writes chunks (1 MB) via aiofiles to UPLOAD_DIR/<uuid>_<filename>
  - factory get_storage() -> StorageBackend (reads settings.STORAGE_BACKEND)

Task B8:
CREATE components/api/app/worker.py:
  - celery_app = Celery("tasks", broker=settings.REDIS_URL, backend=settings.REDIS_URL)
  - celery_app.conf.task_track_started = True
  - celery_app.conf.result_expires = 86400  # 1 day

Task B9:
CREATE components/api/app/routers/auth.py:
  - POST /auth/register: validate email unique, hash password (bcrypt), create User, return access token
  - POST /auth/login: verify credentials, return access token in body + set refresh token httpOnly cookie
  - POST /auth/refresh: read refresh token cookie, validate, return new access token
  - POST /auth/logout: clear refresh token cookie
  - Helper: create_access_token(sub: str) -> str via PyJWT
  - Helper: get_current_user(token: str = Depends(oauth2_scheme)) -> User

Task B10:
CREATE components/api/app/routers/uploads.py:
  - POST /uploads: 
    - Depend on current_user
    - Validate magic bytes (first 12 bytes: MP3=FF FB/ID3, FLAC=fLaC, WAV=RIFF)
    - Check Content-Length <= MAX_UPLOAD_BYTES
    - Chunk-write main file via LocalStorage.save()
    - Optionally handle reference file upload (same validation)
    - Create UploadJob row (status=PENDING)
    - Dispatch celery task: celery_client.dispatch_analysis_job(job_id, file_path, reference_path, user_id)
    - Return {"job_id": str(job.id)}

Task B11:
CREATE components/api/app/routers/jobs.py:
  - GET /jobs/{id}/status: return UploadJob status, phase, pct (WHERE user_id = current_user.id)
  - GET /jobs/{id}/stream: SSE EventSource endpoint
    - StreamingResponse with media_type="text/event-stream"
    - Poll UploadJob row every 1s; emit "data: {json}\n\n" with phase progress
    - Emit "event: complete\ndata: {job_id}\n\n" when status=COMPLETE
    - Emit "event: error\ndata: {msg}\n\n" when status=FAILED
    - Include CORS headers: Access-Control-Allow-Origin: {specific origin}, credentials: true
  - GET /jobs/{id}/results: return AnalysisResult.final_json (WHERE job user_id = current_user.id)

Task B12:
CREATE components/api/app/main.py:
  - FastAPI app with lifespan (create tables on startup in dev)
  - CORSMiddleware: allow_origins=settings.CORS_ALLOW_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
  - Include routers: auth (prefix=/auth), uploads (prefix=/uploads), jobs (prefix=/jobs)
  - Root GET / returns {"status": "ok", "version": "1.0.0"}

Task B13:
MODIFY components/api/tests/test_auth.py:
  - httpx.AsyncClient(app=app, base_url="http://test") fixture
  - test_register_success, test_register_duplicate_email
  - test_login_success_returns_access_token, test_login_sets_refresh_cookie
  - test_refresh_returns_new_token, test_logout_clears_cookie

Task B14:
MODIFY components/api/tests/test_uploads.py:
  - test_upload_valid_mp3_returns_job_id
  - test_upload_invalid_magic_bytes_rejected
  - test_upload_too_large_rejected
  - test_upload_requires_auth
```

**Validation:**
```bash
cd components/api && ruff check app/ && mypy app/
cd components/api && pytest tests/ -v --asyncio-mode=auto
cd components/api && uvicorn app.main:app --port 8000 &
sleep 2 && curl -f http://localhost:8000/ && echo "API OK" && kill %1
alembic -c components/api/alembic.ini upgrade head
```

---

### Component: worker (patterns/automation.md)

**Purpose**: Celery worker that drives the 7-phase pipeline with partial-failure tolerance.
**Inputs**: `data/uploads/` (path from job payload)
**Outputs**: `output/analysis_results/` (JSON), PostgreSQL
**Entry command**: `cd components/worker && celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo`

#### Tasks

```yaml
Task C1:
CREATE components/worker/app/celery_app.py:
  - Celery("worker", broker=REDIS_URL, backend=REDIS_URL)
  - task_track_started = True
  - result_expires = 86400
  - task_serializer = "json"
  - worker_prefetch_multiplier = 1

Task C2:
CREATE components/worker/app/db.py:
  - sync psycopg2 engine (not asyncpg — Celery is synchronous)
  - Session = sessionmaker(engine, expire_on_commit=False)
  - CustomTask base class:
      before_start: self._session = Session()
      after_return: self._session.close()
  - helper update_job_phase(session, job_id, phase, phase_name, pct, status=None)
  - helper save_phase_result(session, job_id, phase_idx, phase_result_dict)
  - helper finalize_job(session, job_id, pipeline_result_dict)

Task C3:
CREATE components/worker/app/progress.py:
  - make_progress_cb(task, job_id, session) -> Callable
  - Returns lambda(phase, phase_name, pct):
      task.update_state(state='PROGRESS', meta={'phase': phase, 'phase_name': phase_name, 'total_phases': 7, 'pct': pct})
      update_job_phase(session, job_id, phase, phase_name, pct)
      session.commit()

Task C4:
CREATE components/worker/app/signals.py:
  - @signals.worker_ready.connect
  - Calls models.get_model("demucs") to pre-load weights at worker startup
  - Log: "Demucs model loaded — worker ready"

Task C5:
CREATE components/worker/app/tasks.py:
  - @celery_app.task(bind=True, base=CustomTask, soft_time_limit=3600, time_limit=3900)
  - def run_analysis_pipeline(self, job_id: str, file_path: str, reference_path: str|None, user_id: str)
  
  Algorithm:
    session = self._session
    update_job_phase(session, job_id, 0, "starting", 0.0, status="PROCESSING")
    progress_cb = make_progress_cb(self, job_id, session)
    
    phase_results = []
    for phase_fn, phase_num, phase_name in PHASES:
        try:
            progress_cb(phase_num, phase_name, 0.0)
            result = phase_fn(wav_path, ..., progress_cb)
            phase_results.append(PhaseResult(phase=phase_num, name=phase_name, status="ok", data=result))
            progress_cb(phase_num, phase_name, 1.0)
        except Exception as exc:
            phase_results.append(PhaseResult(phase=phase_num, name=phase_name, status="failed", error=str(exc)))
            log.exception(f"Phase {phase_num} failed")
    
    pipeline_result = assemble_result(phase_results)
    finalize_job(session, job_id, pipeline_result)
    write_json_artifact(job_id, pipeline_result)  # output/analysis_results/
    
    return pipeline_result  # becomes AsyncResult.result on SUCCESS

Task C6:
MODIFY components/worker/tests/test_tasks.py:
  - Mock audio_analysis.run_pipeline to return fixed PipelineResult
  - Mock DB session (in-memory SQLite or MagicMock)
  - test_task_runs_all_phases_on_success
  - test_task_continues_after_phase_failure (assert all 7 phase_results recorded)
  - test_task_writes_result_to_db
```

**Validation:**
```bash
cd components/worker && ruff check app/
cd components/worker && python -c "from app.celery_app import celery_app; print('Celery OK')"
cd components/worker && celery -A app.celery_app inspect registered --timeout 5 2>/dev/null || echo "Note: Redis needed for inspect"
cd components/worker && pytest tests/ -v
```

---

### Component: frontend (patterns/dashboard.md — React stack)

**Purpose**: React 19 SPA — auth, upload, progress, interactive report.
**Inputs**: none (calls api)
**Outputs**: none (renders in browser)
**Entry command**: `cd components/frontend && npm run dev`

#### Tasks

```yaml
Task D1:
MODIFY components/frontend/src/lib/apiClient.ts:
  - Axios.create({baseURL: '/api', withCredentials: true})
  - Request interceptor: if accessToken, add Authorization: Bearer {token}
  - Response interceptor:
      on 401: if !config._retry → set _retry=true, await refreshToken(), replay original request
      if _retry already true → clear token, redirect to /login
  - isRefreshing flag + queue of pending resolvers for concurrent 401 handling
  - refreshToken(): POST /auth/refresh → update accessToken in AuthContext

Task D2:
MODIFY components/frontend/src/contexts/AuthContext.tsx:
  - accessToken state (string|null) — in memory only
  - isLoading state (starts true)
  - On mount: call POST /auth/refresh; set accessToken from response; set isLoading=false
  - login(email, password): POST /auth/login → set accessToken
  - logout(): POST /auth/logout → clear accessToken
  - Expose: {accessToken, isLoading, login, logout}

Task D3:
MODIFY components/frontend/src/components/ui/ProtectedLayout.tsx:
  - if isLoading: render <Spinner /> (not Navigate — prevents flash of redirect)
  - if !accessToken: <Navigate to="/login" replace state={{from: location}} />
  - else: <Outlet />

Task D4:
MODIFY components/frontend/src/features/auth/Login.tsx:
  - email + password form → AuthContext.login() → navigate to /upload
  - Error: display "Invalid credentials" on 401
  
Task D5:
MODIFY components/frontend/src/features/auth/Register.tsx:
  - email + password + confirm form → POST /auth/register → navigate to /login

Task D6:
MODIFY components/frontend/src/features/upload/useFileUpload.ts:
  - Returns {progress, status, jobId, upload, cancel}
  - upload(file, referenceFile?):
      const xhr = new XMLHttpRequest()
      const fd = new FormData()
      fd.append('file', file)
      if referenceFile: fd.append('reference', referenceFile)
      xhr.upload.addEventListener('progress', e => setProgress(e.loaded/e.total))  ← BEFORE open
      xhr.open('POST', '/api/uploads')
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
      xhr.onload = () => setJobId(JSON.parse(xhr.response).job_id)
      xhr.send(fd)
  - GOTCHA: addEventListener before open+send — no exceptions, just silently no events

Task D7:
MODIFY components/frontend/src/features/upload/UploadPage.tsx:
  - Drag-drop zone (accept MP3/FLAC/WAV, max 200 MB) + file picker
  - Optional reference track upload (same constraints)
  - Show upload progress bar (useFileUpload.progress 0-100%)
  - On jobId received: navigate to /jobs/{jobId}

Task D8:
MODIFY components/frontend/src/features/analysis/useJobStream.ts:
  - useJobStream(jobId) -> {phase, phaseName, pct, done, error}
  - new EventSource(`/api/jobs/${jobId}/stream`, {withCredentials: true})
  - On message: parse JSON → update phase state
  - On event "complete": set done=true, close EventSource
  - On event "error": set error, close EventSource
  - useEffect cleanup: eventSource.close()  ← CRITICAL

Task D9:
MODIFY components/frontend/src/features/analysis/JobProgressPage.tsx:
  - useJobStream(jobId from params)
  - Render 7 phase rows: phase name + animated progress bar
  - Active phase: animate-pulse; completed: checkmark; pending: grey
  - On done: navigate to /jobs/{jobId}/report
  - On error: show error message

Task D10:
MODIFY components/frontend/src/features/report/ReportPage.tsx:
  - On mount: GET /api/jobs/{jobId}/results → store result
  - Render all sub-components passing relevant slices of result

Task D11:
MODIFY components/frontend/src/features/report/MixScore.tsx:
  - Large A-F grade (color: A=green, B=lime, C=yellow, D=orange, F=red — all in tailwind safelist)
  - Overall score as RadialBar (Recharts)
  - Top 3 fixes as numbered list

Task D12:
MODIFY components/frontend/src/features/report/StreamingReadiness.tsx:
  - Table: Platform | Target LUFS | Your LUFS | Status
  - Spotify: -14, Apple: -16, YouTube: -14
  - Status: PASS (green) or FAIL (red) badges — in tailwind safelist

Task D13:
MODIFY components/frontend/src/features/report/FrequencyChart.tsx:
  - Recharts BarChart: 7 bands on X axis, energy dB on Y axis
  - ReferenceLine at 0 dB for balance reference
  - Color bars by severity: ok=blue, muddy/harsh=orange

Task D14:
MODIFY remaining report sub-components (StemClash, ReferenceComparison, GenreRadar, ArrangementAdvisor):
  - StemClash: table of clash pairs (stems, frequency range, severity, EQ suggestion)
  - ReferenceComparison: conditionally rendered delta table; skip if no reference uploaded
  - GenreRadar: Recharts RadarChart — features as axes, user vs genre mean
  - ArrangementAdvisor: ordered list of fix recommendations with section timestamps

Task D15:
CREATE components/frontend/src/App.tsx:
  - React Router v7 routes:
      /login → Login
      /register → Register
      / → ProtectedLayout → /upload → UploadPage
      /jobs/:id → ProtectedLayout → JobProgressPage
      /jobs/:id/report → ProtectedLayout → ReportPage

Task D16:
CREATE docker/docker-compose.yml:
  services:
    postgres:
      image: postgres:15
      environment: POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
      ports: 5432:5432
      volumes: postgres_data:/var/lib/postgresql/data
    redis:
      image: redis:7-alpine
      ports: 6379:6379
    allin1:
      image: mir-aidj/all-in-one:latest  (or build from Dockerfile)
      volumes: ./data/models:/models
      ports: 8765:8765  (HTTP API)
```

**Validation:**
```bash
cd components/frontend && npm install
cd components/frontend && npm run type-check
cd components/frontend && npm run lint
cd components/frontend && npm run build && echo "Build OK"
```

---

## Validation Loop

### Level 1: Lint + type check

```bash
# Python
ruff check components/api/ components/analysis/src/ components/worker/
mypy components/api/app/ components/analysis/src/ components/worker/app/ --ignore-missing-imports

# TypeScript
cd components/frontend && npm run type-check && npm run lint
```

### Level 2: Unit tests per component

```bash
pip install -e components/analysis
pytest components/api/tests/ -v --asyncio-mode=auto
pytest components/analysis/tests/ -v
pytest components/worker/tests/ -v
```

### Level 3: Integration smoke

```bash
# Start services
docker compose -f docker/docker-compose.yml up -d
sleep 5

# Run DB migrations
alembic -c components/api/alembic.ini upgrade head

# Start API + worker (background)
cd components/api && uvicorn app.main:app --port 8000 &
cd components/worker && celery -A app.celery_app worker --pool=solo --concurrency=1 &

# Register + login + upload flow
TOKEN=$(curl -s -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}' | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

JOB=$(curl -s -X POST http://localhost:8000/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@data/uploads/test.mp3" | python -c "import sys,json; print(json.load(sys.stdin)['job_id'])")

echo "Job dispatched: $JOB"
sleep 5
curl -s http://localhost:8000/jobs/$JOB/status -H "Authorization: Bearer $TOKEN"

# Frontend build
cd components/frontend && npm run build && echo "Frontend build OK"
```

---

## Final Validation Checklist

- [ ] `ruff check` passes on all Python components
- [ ] `mypy` passes on all Python components
- [ ] `npm run type-check` passes on frontend
- [ ] `npm run build` succeeds
- [ ] `pytest components/api/tests/` all pass
- [ ] `pytest components/analysis/tests/` all pass
- [ ] `pytest components/worker/tests/` all pass
- [ ] `pip install -e components/analysis` succeeds
- [ ] Alembic migrations run cleanly against PostgreSQL
- [ ] `uvicorn app.main:app` starts without errors
- [ ] `GET /` returns `{"status": "ok"}`
- [ ] `GET /docs` loads the OpenAPI UI
- [ ] Celery worker starts without import errors
- [ ] Register + login + upload integration smoke passes
- [ ] Frontend dev server starts on port 5173
- [ ] `.scaffolding/manifest.json` lifecycle flipped to `"built"`

---

## Anti-Patterns to Avoid

1. **python-jose anywhere**: use PyJWT only (`import jwt`). python-jose is abandoned and breaks on Python 3.10+.
2. **numpy>=2.0**: pin `numpy<2.0` in analysis package. Breaking changes in librosa/numba/soundfile.
3. **`await file.read()` for large uploads**: always chunk-read UploadFile — one call loads 200 MB into memory.
4. **Job state from `AsyncResult`**: write all state to PostgreSQL. Redis result_expires silently purges after 1 day.
5. **`localStorage` for access token**: XSS-accessible. Access token lives in React state only.
6. **Celery chain for 7-phase pipeline**: chains abort on first failure. Use single bound task with per-phase try/except.

---

## Context pointers

- `CLAUDE.md` — structural rules + full per-component gotcha list (read before implementing any component)
- `PRPs/README.md` — PRP workflow reference
- `.scaffolding/manifest.json` — component list, entry commands, build order
- `components/analysis/README.md` — analysis package install + Windows note
- `components/worker/README.md` — Celery start commands (Windows vs Linux)
- `components/frontend/README.md` — Vite dev server + build commands
