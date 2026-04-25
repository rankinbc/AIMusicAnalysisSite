# Project: AI Music Analyzer

A music producer web app where users register/log in, upload audio files (MP3, FLAC, WAV), and receive a comprehensive 7-phase analysis report. Built on top of an existing Python analysis pipeline wrapped as an installable package. React 19 SPA frontend, FastAPI backend, Celery worker for async processing, PostgreSQL for persistence, Redis for job queuing.

**Stack**: Python 3.11+ (FastAPI, Celery, SQLAlchemy 2.0, asyncpg) + React 19 + Vite 8 + TypeScript + Tailwind CSS v3 + shadcn/ui + Recharts + PostgreSQL 15 + Redis 7

---

## Project structure (STRICT — do not deviate)

```
AIMusicAnalysisSite/
├── CLAUDE.md
├── README.md
├── .gitignore
├── migrations/               (Alembic DB migrations — shared by api + worker)
├── schemas/                  (Shared OpenAPI/TypeScript schema files)
├── docker/                   (Docker Compose for local dev: PostgreSQL, Redis, allin1)
├── PRPs/
│   ├── v1_ai_music_analyzer.md
│   ├── archive/
│   ├── source/
│   │   └── INITIAL.md
│   ├── templates/
│   │   └── prp_base.md
│   └── README.md
├── .claude/
│   ├── settings.local.json
│   └── commands/
├── components/
│   ├── api/                  (FastAPI backend)
│   ├── analysis/             (Python audio analysis package)
│   ├── worker/               (Celery worker)
│   ├── shared/               (aimusic-shared: single-source ORM models for api + worker)
│   └── frontend/             (React SPA)
├── data/
│   ├── uploads/              (Staged audio uploads — dev local; S3 in prod)
│   ├── reference_library/    (Curated pro reference tracks by genre)
│   └── models/               (Cached ML model weights)
└── output/
    └── analysis_results/     (Per-job JSON results)
```

**Enforcement rules:**
- Components live in `components/<name>/` only — never loose at project root
- All inputs live in `data/<source>/` — never inside a component folder
- All outputs land in `output/<component>/<YYYY-MM-DD>_<description>/` — never at project root, never overwriting prior runs
- Never add a new top-level folder without updating this section first
- Never rename `components/`, `data/`, `output/`, or `PRPs/`
- `migrations/`, `schemas/`, `docker/`, and `reference_library/` are declared project-level folders — use each as described in its README

---

## Components

### api (api.md)

**Purpose**: FastAPI REST API. Handles user registration/login with JWT auth, audio file uploads (chunked multipart, up to 200 MB, optional `track_name` form field), Celery job dispatch, SSE job progress streaming, results retrieval (includes `share_token`), upload history per user, public share endpoint, track version grouping.
**Inputs**: `data/uploads/` (writes staged audio files here before Celery dispatch)
**Outputs**: reads from `output/analysis_results/` and PostgreSQL to serve results
**How to run**: `cd components/api && uvicorn app.main:app --reload --port 8000`

**Routes added in v1.1:**
- `GET /jobs` — paginated list (50) of current user's jobs with score/grade summaries
- `GET /reports/share/{token}` — public unauthenticated report access by share token
- `GET /tracks` — jobs grouped by `track_name` for version-history chart
- `GET /jobs/{id}/results` — now also returns `share_token`
- `POST /uploads/` — now accepts optional `track_name: str = Form(None)`

**DB columns added in v1.1:**
- `analysis_results.share_token` — UUID string, unique, indexed (migration 002)
- `upload_jobs.track_name` — nullable String(200), indexed (migration 003)

**Gotchas:**
- **PyJWT not python-jose**: `python-jose` is abandoned and incompatible with Python 3.10+. Use `import jwt` from `PyJWT`. Never add python-jose to requirements.
- **Two database URLs**: `DATABASE_URL=postgresql+asyncpg://` for SQLAlchemy 2.0 async runtime; `ALEMBIC_DATABASE_URL=postgresql+psycopg2://` for Alembic migrations (async driver fails in Alembic's sync runner).
- **`async_sessionmaker` must set `expire_on_commit=False`**: without this, any ORM attribute access after `session.commit()` raises `MissingGreenlet` in async context.
- **Chunk-read UploadFile — never `await file.read()` on large uploads**: read in 1 MB chunks via aiofiles. A single `await file.read()` loads 200 MB into memory.
- **Job state lives in PostgreSQL, not Celery AsyncResult**: routes must query the `upload_jobs` table. Never poll `AsyncResult` from Redis in route handlers.
- **CORS `allow_origins` must be an explicit list — never `"*"` when `allow_credentials=True`**: browser blocks credentialed requests to wildcard origin.
- **Magic byte validation for audio**: inspect the first 4-12 bytes, not `Content-Type` header (easily spoofed). MP3: `FF FB`/`ID3`, FLAC: `fLaC`, WAV: `RIFF`.
- **SSE requires specific `Access-Control-Allow-Origin` (not `*`) and `credentials: true`**: `EventSource` with cookies follows the same CORS rules as credentialed fetch.
- **Authorization at query level**: all queries on user-owned resources must include `WHERE owner_id = current_user.id` — never fetch-all-then-filter in Python (IDOR vulnerability).
- **Celery tasks must be `def`, not `async def`**: wrap async code with `asyncio.run()` inside sync task body.

### analysis (analysis.md)

**Purpose**: Installable Python package (`pip install -e components/analysis`) containing all 7-phase audio analysis pipeline. Exposes `run_pipeline(file_path, reference_path=None, progress_cb=None)`. Copied and adapted from the existing AbletonAIAnalysis codebase.
**Inputs**: `data/uploads/` (audio files), `data/reference_library/` (curated reference tracks), `data/models/` (ML model weights)
**Outputs**: structured dict returned by `run_pipeline()`; per-job JSON written to `output/analysis_results/`
**How to run**: `pip install -e components/analysis` then `python -c "from audio_analysis import run_pipeline; print(run_pipeline('path/to/track.wav'))"`

**New outputs added in v1.1 (all from phase1 + pipeline root):**
- `phase1`: `true_peak_db` (4× oversampled dBTP), `peak_dbfs`, `clipping_detected` (bool), `clipped_sample_count`, `duration_seconds`, `detected_key` (chroma_cqt pitch class string e.g. "A#"), `mono_compatibility` (0.0–1.0 RMS ratio), `low_energy` (20–200 Hz RMS float)
- pipeline root: `danceability_score` (int 0–100, genre-aware), `coach_name`, `coach_intro`, `coached_fixes` (list[str], max 5)

**New modules added in v1.1:**
- `coach.py` — `generate_coached_fixes(analysis: dict) -> dict`; template-based coaching voice referencing measured values
- `scorers/danceability.py` — `danceability_score(bpm, onset_density, low_energy, genre) -> int`; weights: BPM 40%, rhythm density 40%, low-freq energy 20%

**Gotchas:**
- **numpy<2.0 hard pin**: librosa, numba, and soundfile all have numpy 2.x incompatibilities. Never loosen without testing all three packages together.
- **pyloudnorm axis order — silent bug**: librosa loads audio as `(channels, samples) float32`. pyloudnorm expects `(samples, channels) float64`. Always `audio.T.astype(float)` before passing to pyloudnorm or LUFS values are silently wrong with no exception raised.
- **Phase 4 uses fast spectral analysis by default (`USE_DEMUCS = False`)**: librosa STFT clash detection runs in ~1–2 s. Demucs (`_demucs_analyze`) is preserved in `phase4_stems.py` but disabled — flip `USE_DEMUCS = True` only after raising worker `soft_time_limit` to ≥ 1800 s and installing demucs. The demucs path takes **10–20 min CPU** for a 5-min track.
- **torchopenl3 not openl3**: original `openl3` requires TensorFlow, which conflicts with the PyTorch stack. Use `torchopenl3` exclusively.
- **all-in-one-fix not allin1**: `allin1` depends on NATTEN which has no Windows wheels. Use `all-in-one-fix`. Phase 1 structure detection requires Docker or WSL2 on Windows hosts.
- **Always convert input to WAV at 44100 Hz first**: MP3 decoding introduces ±70 ms variance in beat/structure detection. Call `converters.to_wav()` before any phase.
- **Singleton model loading**: load weights once per process via `models.get_model(name)`. Never load inside a per-call code path.
- **TORCH_HOME env var**: set `TORCH_HOME=data/models` to cache demucs/torchopenl3 weights under the project instead of `~/.cache/torch`.

### worker (automation.md)

**Purpose**: Celery worker. Picks up upload jobs from Redis, calls `analysis.run_pipeline()` with a progress callback, writes per-phase results to PostgreSQL, stores final JSON to `output/analysis_results/`. Partial-failure tolerant: failed phases are recorded and the job continues.
**Inputs**: `data/uploads/` (reads file path from job payload)
**Outputs**: `output/analysis_results/` (final JSON), PostgreSQL `analysis_results` table
**How to run**:
- Windows: `cd components/worker && celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo`
- Linux: `cd components/worker && celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=prefork`

**Gotchas:**
- **Single monolithic bound task, not a chain**: partial-failure tolerance requires one `@app.task(bind=True)` with internal per-phase `try/except`. A Celery chain aborts on first failure.
- **SQLAlchemy engine must NOT be created at module import time**: engine creation is not fork-safe. Create inside `CustomTask.before_start`, close in `after_return`.
- **concurrency=1 always**: Demucs is memory-heavy. `--pool=solo` on Windows; `--pool=prefork` on Linux. Never raise concurrency without profiling GPU/RAM headroom.
- **Write canonical results to PostgreSQL, not Celery result backend**: Redis `result_expires` (default 1 day) purges blobs silently — `AsyncResult` returns `PENDING` even for completed jobs after expiry. PostgreSQL is source of truth.
- **`task_track_started=True` required in Celery config**: without it, `PENDING` means both "queued" and "never dispatched".
- **`update_state` PROGRESS is overwritten on completion**: after task returns `SUCCESS`, `info` becomes the return value. API must branch: `if state == 'SUCCESS'` read return value; else read `info` for phase progress.
- **Demucs model pre-loaded in `worker_ready` signal**: not per-task. Model reference survives across tasks in same worker process.
- **Temp stem files cleaned in `finally` block**: do not rely on OS cleanup. Phase 4 writes multi-GB temp files.
- **`share_token` must be passed explicitly to `AnalysisResult()` constructor**: `mapped_column(default=…)` does NOT fire during SQLAlchemy autoflush — only on `session.add()` + explicit `session.flush()`. Always pass `share_token=str(uuid.uuid4())` in the constructor call.
- **`session.rollback()` before the FAILED status update**: a failed INSERT poisons the session with `PendingRollbackError`. Without rollback, the subsequent `UPDATE upload_jobs SET status=FAILED` also fails silently and the job is stuck in PROCESSING forever.

### shared (aimusic-shared)

**Purpose**: Single-source-of-truth Python package for all SQLAlchemy ORM models shared between `api` and `worker`. Contains `Base`, `JobStatus`, `User`, `UploadJob`, `AnalysisResult`. Both components import from here — model drift between api and worker is impossible.
**Package**: `aimusic-shared` (`pip install -e components/shared`)
**Key file**: `components/shared/aimusic_shared/models.py` — **add DB columns here first, then write an Alembic migration. Never define ORM models in api or worker directly.**
**How to run**: install only — no server. `pip install -e components/shared`

**Gotchas:**
- **Install before api and worker**: both `components/api/requirements.txt` and `components/worker/requirements.txt` list `aimusic-shared>=0.1.0`. Run `pip install -e components/shared` first in any fresh environment.
- **api re-exports `Base` for backward compat**: `components/api/app/db.py` does `from aimusic_shared.models import Base` and re-exports it. Don't duplicate `Base` in api.

### frontend (dashboard.md — React stack override)

**Purpose**: React 19 + Vite 8 SPA. Auth screens, upload page (drag-drop, progress bar, optional reference track, optional track name), job progress page (SSE-driven 7-phase display), interactive report page (mix score A-F with color-coded score, BPM+Key+Mono metadata bar, danceability score, coach panel, streaming readiness with technical checks, frequency chart, stereo gauges, stem clash table, reference delta, genre radar, arrangement advisor, Copy Link button). History page, track version history page with Recharts LineChart, public shared report page.
**Inputs**: none (calls `api` via REST + SSE)
**Outputs**: none (renders in browser)
**How to run**: `cd components/frontend && npm run dev` (Vite dev server on port 5173, proxies `/api` to `localhost:8000`)

**Routes added in v1.1:**
- `/history` — table of all past jobs with status/score/grade (protected)
- `/tracks` — track version history: Recharts LineChart + version table grouped by track name (protected)
- `/reports/share/:token` — public unauthenticated shared report view

**Components added in v1.1:**
- `features/report/CoachPanel.tsx` — coach avatar + numbered fix list
- `pages/HistoryPage.tsx` — job history table
- `pages/TrackHistoryPage.tsx` — track version chart + table
- `pages/SharedReportPage.tsx` — public report via share token

**StreamingReadiness now accepts** `truePeakDb` and `clippingDetected` props and renders True Peak (<-1.0 dBTP) and No Clipping rows in addition to platform LUFS rows. Platforms: Spotify, Apple Music, YouTube, Tidal, Amazon Music, SoundCloud, Beatport.

**Gotchas:**
- **Access token in React state ONLY — never localStorage**: localStorage is readable by any injected script (XSS). Refresh token is in httpOnly cookie set server-side — never touched by JS.
- **Axios dual-interceptor: `isRefreshing` flag + request queue**: concurrent 401s must issue only one `/auth/refresh`. Add `_retry` flag to `AxiosRequestConfig` to prevent infinite loop on refresh failure.
- **XHR not fetch for upload progress**: Fetch API has no upload progress events. Register `xhr.upload.addEventListener('progress', cb)` before `xhr.open()`. Use `File.slice()` for chunking — never `FileReader.readAsArrayBuffer()` on 200 MB.
- **EventSource requires specific CORS origin (not `*`)**: `withCredentials: true` on EventSource. The API SSE endpoint must set explicit origin, not wildcard.
- **Tailwind safelist for dynamic Recharts class names**: grade colors (A=green → F=red), pass/fail badges, and phase animation classes are runtime-computed strings — add to `safelist` in `tailwind.config.ts` or Tailwind purges them.
- **Silent refresh before protected routes render**: `AuthContext` calls `/auth/refresh` on mount and sets `isLoading=true` until complete. `ProtectedLayout` shows a loader (not redirect) while loading to prevent flash-of-redirect for valid sessions.
- **SSE hook cleanup is mandatory**: `useJobStream` must call `eventSource.close()` in `useEffect` cleanup — navigating away leaves dangling EventSource otherwise.

---

## Validation gates

```bash
# Python lint + type check (all components)
ruff check components/api/ components/analysis/src/ components/worker/ components/shared/
mypy components/api/app/ components/worker/app/ --ignore-missing-imports

# Install shared + analysis packages (one-time; shared must come first)
pip install -e components/shared
pip install -e components/analysis

# API tests
pytest -q components/api/tests/

# Analysis tests (mocks heavy models)
pytest -q components/analysis/tests/

# Worker tests (mocks analysis + DB)
pytest -q components/worker/tests/

# Frontend type-check + lint
cd components/frontend && npm run type-check && npm run lint

# Frontend build smoke test
cd components/frontend && npm run build

# DB migrations (requires PostgreSQL running)
alembic -c migrations/alembic.ini upgrade head

# Integration: API + worker + frontend (requires Docker services up)
docker compose -f docker/docker-compose.yml up -d
cd components/api && uvicorn app.main:app --port 8000 &
cd components/worker && celery -A app.celery_app worker --pool=solo --concurrency=1 &
cd components/frontend && npm run dev &
curl -f http://localhost:5173 && echo "Frontend OK"
curl -f http://localhost:8000/docs && echo "API OK"
```

---

## Stack-specific rules

**Python (api, analysis, worker)**
- Python 3.11+. Format with `ruff format`. Lint with `ruff check`. Type-check with `mypy`.
- Pydantic v2 only. SQLAlchemy 2.0 only. Never use sync SQLAlchemy calls in async routes.
- No `python-jose` anywhere. JWT = PyJWT only.
- Pin `numpy<2.0` in `components/analysis/pyproject.toml` — do not loosen.
- `asyncio.run()` to call async code from within sync Celery tasks.
- All env vars via `pydantic_settings.BaseSettings`. No hardcoded secrets.
- Tests with `pytest` + `pytest-asyncio` (asyncio_mode = "auto"). Never mock to pass — fix the underlying issue.

**TypeScript / React (frontend)**
- React 19 + Vite 8 + TypeScript strict mode.
- Feature-based folder layout under `src/features/`. No type-based layout at root.
- Tailwind CSS v3 for styling. shadcn/ui for primitive components. Recharts for all charts.
- Axios for HTTP. `apiClient.ts` is the single Axios instance — never create another.
- All file upload via XHR (`useFileUpload` hook). All job progress via SSE (`useJobStream` hook).
- No inline styles unless absolutely required (Recharts customization).
- `npm run type-check` must pass before committing frontend changes.

**Windows dev note**
- allin1/all-in-one-fix structure detection (Phase 1) requires Docker on Windows. Run `docker compose -f docker/docker-compose.yml up -d` before starting the worker.
- Celery worker on Windows must use `--pool=solo`.
- **uvicorn `--reload` orphan processes**: `uvicorn --reload` spawns a child process via `multiprocessing.spawn`. Killing the parent leaves the child holding the port. It does NOT appear in `Get-Process -Name python` or `tasklist` with a recognizable command line. Use `netstat -ano | findstr :8000` to find the PID, then `Stop-Process -Id <PID> -Force`.

---

# CLAUDE.md — Project Rules

Language-agnostic defaults. Append your stack-specific section at the end.

---

### Session Start

- **Read `.scaffolding/manifest.json` first if it exists.** Check `lifecycle.stage`:
  - `"plan"` — the v1 implementation plan is written at `PRPs/v1_ai_music_analyzer.md` but hasn't been executed. Components are stubs. Tell the user: "**This project is at stage 1 of 2 (planned). Components are stubs — not yet runnable.** Next step: `/execute-prp PRPs/v1_ai_music_analyzer.md`." Never suggest running component entry commands; they won't work yet.
  - `.scaffolding/` missing entirely — the project is fully built. Entry commands in CLAUDE.md's "How to run" are runnable.
- If `HANDOFF.md` exists, read it first — a previous session paused mid-work.
- Consult `PRPs/README.md` if the PRP workflow comes up.

### Context Discipline

- **Scout files >400 lines before full-reading.** Grep for the target section first; Read only the slice you need.
- **Dispatch sub-agents for multi-file research and web lookups.**
- **Externalize multi-step plans to files.** Write PRPs under `PRPs/`.
- **Propose `/handoff` proactively** when context is heavy or the user's about to pause.

### Code

- **No file over ~500 lines.** Split when approaching the limit.
- **Organize by feature**, following the language's conventions.
- **Externalize config and secrets** via env vars. Never hardcode credentials.

### Testing

- **Unit tests for new features.** At minimum: one expected-use, one edge case, one failure case.
- **When you change logic**, update affected tests.

### Docs

- **Update `README.md`** when features change or setup changes.
- **Comment the non-obvious why**, not what the code does.

### AI Behavior

- **Ask if uncertain** — don't assume missing context.
- **No hallucinated libraries or APIs** — verify packages exist before using them.
- **Confirm file paths and symbols** before referencing them.
- **Don't delete or overwrite existing code** without explicit instruction.

### Workflow

- **Default to the PRP workflow for new work.** New features go through `/new-feature` → `/generate-prp` → `/execute-prp`. Trivial fixes (typos, one-line bug fixes) don't need a PRP.

### Project Cleanliness

- **Respect the project structure** declared at the top of this file.
- **Tool caches outside the project.** Set `TORCH_HOME=data/models` in `.env` to control model cache location.
- **Generated artifacts** always land under `output/<component>/<date>_<description>/`.
- **Output rotation.** Keep the latest ~5 runs; move older to `output/<component>/_archive/`.
- **PRP lifecycle.** Active plans live in `PRPs/`. On successful `/execute-prp`, the command moves the PRP to `PRPs/archive/<date>_<slug>.md`.

### Task Completion

- **PRP workflow**: validation gates passing = work is done.
