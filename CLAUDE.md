# Project: AI Music Analyzer (SPECTR)

A music producer web app where users register/log in, upload audio files (MP3, FLAC, WAV), and receive a comprehensive 7-phase analysis report plus on-demand AI specialist verdicts. Users can also "listen" to their track through a real-time Web Audio DSP chain (EQ, compressor, saturation, M/S width, pitch).

**v2 stack (current — primary):**
- **`bff/`** — ASP.NET Core .NET 10 minimal-API BFF (EF Core 10, Npgsql, PyJWT-style JWT bearer, IFileStorage, dramatiq job queue dispatcher)
- **`frontend-spectr-v2/`** — React 19 + Vite 6 + TypeScript strict + TanStack Router + TanStack Query + CSS Modules + Radix UI + WaveSurfer + Recharts + Sonner. CSS Modules + `tokens.css`. No Tailwind, no shadcn.
- **`worker/`** — Python dramatiq worker (replaces Celery). Actors: `analyze_audio_job` (7-phase pipeline), `run_specialist` (on-demand AI verdict)
- **`shared/`** — `aimusic-shared` Python package: single-source SQLAlchemy ORM models for the worker (BFF has parallel EF Core entities that mirror this)
- **`analysis/`** — `audio_analysis` Python package (7-phase pipeline, installable)

**v1 stack (legacy — being phased out):**
- **`api/`** — FastAPI REST API. Still hosts the verdict pipeline + Anthropic API client. Will fold into BFF/worker once dramatiq has the verdict actor pattern stabilized.
- **`frontend-spectr/`** — vanilla JSX SPA. Used by older flows; v2 frontend is the new path forward.

Postgres 16 + Redis 7 are shared. Both stacks talk to the same DB.

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
│   ├── bff/                  (PRIMARY — .NET 10 BFF: auth, songs, versions, jobs, results, verdicts, audio streaming)
│   ├── frontend-spectr-v2/   (PRIMARY — React 19 + Vite 6 + TS strict SPA: full producer UI + Listen DSP page)
│   ├── worker/               (dramatiq worker: analyze_audio_job + run_specialist actors)
│   ├── analysis/             (Python audio analysis package — 7-phase pipeline)
│   ├── shared/               (aimusic-shared: SQLAlchemy ORM models — worker side only; BFF has parallel EF Core entities)
│   ├── api/                  (LEGACY — FastAPI; still hosts verdict pipeline + Anthropic CLI client until migration completes)
│   └── frontend-spectr/      (LEGACY — vanilla JSX SPA)
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

### bff (NEW — PRIMARY backend)

**Purpose**: ASP.NET Core .NET 10 minimal-API gateway. Owns auth (JWT bearer + refresh-token httpOnly cookie), songs/versions CRUD, audio upload (multipart, ≤250 MB), audio streaming for the Listen page (Range-enabled), analysis job dispatch via dramatiq, results retrieval, verdict listing + per-specialist on-demand `/run/{slug}` dispatch.
**Inputs**: PostgreSQL (EF Core 10 + Npgsql) + Redis (dramatiq broker) + `IFileStorage` (LocalDisk dev / R2 prod)
**Outputs**: HTTP/JSON to the frontend; dramatiq messages on the `default` queue
**How to run**: `cd components/bff/src/Spectr.Bff && dotnet run` (listens on `http://localhost:5000`)

**Key routes (v2):**
- Auth: `POST /api/auth/{login,register,refresh,logout}`, `GET /api/auth/me`
- Songs/versions: `GET/POST /api/songs`, `GET/POST/DELETE /api/versions/{id}` (chunked multipart upload)
- Audio: `GET /api/versions/{id}/audio` — streams the original upload with `Accept-Ranges: bytes`. Accepts JWT via `Authorization` header OR `?t=<jwt>` query param (since `<audio>` / `EventSource` can't attach headers — whitelisted to paths matching `/audio`).
- Jobs/results: `GET /api/jobs/{id}`, `GET /api/jobs/{id}/results`
- Verdicts: `GET /api/reports/{job_id}/verdicts` (list + routing plan), `POST /api/reports/{job_id}/verdicts/run/{slug}` (on-demand specialist), `POST /api/verdicts/{id}/{dismiss,applied}`, `POST /api/verdicts/{id}/feedback`

**Gotchas:**
- **EF Core 10 migrations require a manual partial-index step**: `add Initial` can't fluently express `CREATE UNIQUE INDEX ... WHERE is_current`. Append the raw SQL to `Up()` / `Down()` after scaffolding. See `bff/README.md`. Without it the library can have two `is_current=true` rows per song.
- **dramatiq wire format is HASH + LIST + per-message redis_message_id**: queue is `dramatiq:<queue>.msgs` HASH (message_id → JSON payload) + `dramatiq:<queue>` LIST (message_ids, RPUSH/LPOP). The payload's `message.options.redis_message_id` field is read by the Python broker — must match the LIST/HASH key. `IJobQueue.EnqueueAsync` uses `StackExchange.Redis` MULTI/EXEC to keep them in lockstep.
- **Audio streaming uses query-param JWT** because HTMLMediaElement.src can't attach headers. The token still flows through the same `JwtBearer` pipeline (`OnMessageReceived` reads `?t=` when path contains `/audio`). Tokens in URLs leak into server logs — pre-public exposure, swap to a short-lived HMAC-signed audio URL.
- **`Storage:LocalRoot` must resolve to repo-root `data/`, not `components/data/`**: previous off-by-one bug from `"../../../data"` resolution. Current config uses `"../../../../data"` from the BFF csproj directory.
- **NuGet audit gating**: set `<NuGetAuditMode>direct</NuGetAuditMode>` in `Directory.Build.props` — without it, transitive CVEs in Serilog deps fail the build.
- **CORS allowCredentials + explicit origins (not `*`)**: BFF allows only `http://localhost:5174` (Vite dev). Frontend uses `credentials: 'include'` for the refresh-cookie flow.
- **Routing plan is persisted in both `analyses.routing_plan` AND `verdicts_payload.routing_plan`**: the parallel column is the lookup path; the embedded JSON copy survives cache reset.

### frontend-spectr-v2 (NEW — PRIMARY frontend)

**Purpose**: React 19 + Vite 6 + TypeScript strict SPA. Auth, library (grid card view + filter pills + VersionArc per song), song detail (cover hero + ProgressTimeline + VersionList + DeltaCard placeholder), results page (VerdictHero with grade pill + 4-metric grid + ResultsTabs 5-tab strip: AI Coach with CoachChat + TranceBot avatar + filter pills + FeaturedVerdictCard list + collapsible Specialist roster; Analysis tab with PipelineDial + phase-by-phase status + unlock zones; Spectrum, Reference, Arrangement tabs), Listen page (real Web Audio DSP chain + 8 preview tools).
**Inputs**: BFF `/api/*` REST + a couple of SSE endpoints
**Outputs**: browser
**How to run**: `cd components/frontend-spectr-v2 && npm run dev` (Vite dev server on port 5174, proxies `/api/*` to BFF on `:5000`)

**Stack rules:**
- **TypeScript strict + `verbatimModuleSyntax`**: `import type` mandatory for type-only imports.
- **CSS Modules + `src/styles/{tokens.css,global.css}`**. No Tailwind. Utility primitives `.card`, `.pill[.tone]`, `.dot[.tone]`, `.btn[.primary/.ghost/.sm]`, `.label`, `.mono` are global classes (ported from the mockup `styles.css`); component-specific styles live in `*.module.css`. Don't reach for inline styles unless the value is dynamic (color computed from grade, etc).
- **TanStack Router file-based routes** under `src/routes/`. `_app/*` is auth-gated via `beforeLoad`; `_public/*` is anon. The `_app` route's `beforeLoad` short-circuits during the silent-refresh boot (`isLoading=true`) to avoid flash-of-redirect.
- **`apiClient` via `src/api/fetcher.ts`**: single fetch wrapper with 401 → silent refresh + retry. Access token kept in module state ONLY (never localStorage); refresh token in httpOnly cookie. Don't reach for `localStorage` for auth.
- **No new top-level layout state**: feature folders (`features/results/`, `features/listen/`, `features/player/`) own their pieces.

**Listen page DSP chain (`features/listen/useAudioGraph.ts`)**: a Web Audio graph that wraps the page's single `<audio>` element:
`MediaElementSource → 8× BiquadFilter (eq) → DynamicsCompressor → makeup gain → WaveShaper-parallel (sat dry+wet) → ChannelSplitter → 4-gain M/S matrix → ChannelMerger → master bypass lane → AnalyserNode (FFT) + ChannelSplitter → 2× AnalyserNode (L/R time-domain) → destination`. Tool toggles change params, not topology. Spectrum bars + meter rail read from `getByteFrequencyData` / `getFloatTimeDomainData` via a per-page rAF loop.

**Pitch tool**: when enabled, the hook fetches the audio URL, decodes to `AudioBuffer` (cached), disconnects MediaElementSource, plays via `AudioBufferSourceNode.detune`. Note: Web Audio's detune scales playbackRate, so **pitch+tempo are coupled** for now; true tempo-safe pitch shift needs an AudioWorklet phase vocoder.

**Gotchas:**
- **`useAudioGraph` returns a memoized handle via `useMemo(() => ({...}), [])`**: returning a fresh object every render caused every `[graph]`-dep effect to re-fire, kicking off duplicate `enterPitchMode` decodes mid-flight. All hook methods close over refs, never React state, so freezing identity is safe.
- **AudioContext must be created on a user gesture** (Chrome/Safari autoplay policy). Call `graph.ensureContext()` from the play button's click handler BEFORE `audio.play()`.
- **TanStack Router child routes need `<Outlet />` in the parent**: `songs.$songId.tsx` was rendering its own detail UI even when `/songs/$id/results/$jobId` was active. Pattern: check `useChildMatches().length > 0` and return `<Outlet />` early when a child is active.
- **Access token rotation can re-mount the `<audio>` element**: the `audioUrl` memo embeds the access token (`?t=`), so a silent refresh changes it, swapping the audio src and resetting `<audio>.currentTime`. Position state for the Listen page is therefore tracked off the audio graph's `pitchCurrentTime()` in pitch mode and the audio element's `timeupdate` event otherwise.
- **`<audio>` requires `crossOrigin="anonymous"`** to feed `MediaElementSource`. BFF must set permissive CORS on the audio response (already configured for `localhost:5174`).
- **`React.useState` initial value isn't recomputed after a token refresh**: derived state like `duration` is set by the MediaElement's `durationchange` event — initial value comes from `phase1?.duration_seconds`. Don't expect React state to track the live audio property without an explicit handler.

### api (LEGACY — api.md)

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

**Routes added in v1.2 (verdict pipeline):**
- `POST /api/reports/{job_id}/verdicts/generate` — start or return cached verdicts
- `GET /api/reports/{job_id}/verdicts/stream` — SSE per-event verdict stream
- `GET /api/reports/{job_id}/verdicts` — final ranked verdicts (with user state overlay)
- `POST /api/verdicts/{id}/dismiss` and `POST /api/verdicts/{id}/feedback`
- `GET /reports/share/{token}` — extended with `verdicts` field (user_state stripped)

**DB columns added in v1.2 (verdict pipeline):**
- `analysis_results.verdicts_payload` JSONB (immutable verdict cache, migration 006)
- `analysis_results.verdicts_generated_at`, `verdicts_prompt_version_set`, `verdicts_model`
- `verdict_validation_failures` table (ops/regression tracking, migration 006)
- `verdict_user_state` table (per-user dismiss/feedback, migration 007)

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
- **`USE_CLAUDE_CLI=true` required for verdict pipeline in v1**: the Anthropic API transport (`ApiClient`) is a stub. The CLI is wrapped via `subprocess.run` inside `asyncio.to_thread`; concurrent calls serialize on `asyncio.Semaphore(1)` because the CLI is not concurrency-safe.
- **Specialist slugs are snake_case, prompt files are PascalCase**: mapping in `app/verdict_pipeline/prompt_loader.py::SLUG_TO_FILENAME`. Triage routing plans use slugs.
- **Validator overwrites priority_score and may downgrade severity**: never trust LLM-supplied score. The Python formula in `aimusic_shared/verdicts/scoring.py` is authoritative. Severity downgrade uses a **moderate-severity baseline** to compute the band ceiling — without this, category weights (e.g. `low_end=1.3`) inflate any critical claim into the critical band, defeating the downgrade.
- **Verdict cache key must include every prompt's frontmatter version**: bumping a single prompt version invalidates only that specialist's cache contribution. The full set is stored as `analysis_results.verdicts_prompt_version_set`.

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

### worker (automation.md — NOW DRAMATIQ)

**Purpose**: Dramatiq worker. Pulls actor invocations from a Redis `default` queue, runs them, writes results to Postgres. Two actors:
- `analyze_audio_job(job_id)` — drives the 7-phase pipeline via `audio_analysis.run_pipeline()`, writes `analyses` row, flips `analysis_jobs.status` to `complete` / `failed`. Partial-failure tolerant (per-phase try/except).
- `run_specialist(analysis_id, specialist_slug, focus)` — on-demand AI verdict generation. Wraps the Anthropic `claude` CLI via subprocess (gated by `asyncio.Semaphore(1)`; CLI is not concurrency-safe). Validates verdict JSON via Pydantic + the moderate-baseline severity downgrade in `aimusic_shared.verdicts.scoring`.

**Inputs**: `analysis_jobs.version_id → song_versions.file_path` resolved against `$STORAGE_LOCAL_ROOT` (defaults to repo `data/`); specialist prompts at `components/worker/prompts/experts/*.md`.
**Outputs**: PostgreSQL `analyses.final_json` + `analyses.verdicts_payload` (canonical); optional JSON dump under `$RESULTS_DIR`.
**How to run**: `cd components/worker && python -m dramatiq app.dramatiq_app`. The Procfile is the canonical entrypoint and is wired into the docker-compose `worker` service.

**Gotchas:**
- **Dramatiq wire format**: messages are stored as `dramatiq:<queue>.msgs` HASH (message_id → JSON) + `dramatiq:<queue>` LIST (message_id only, RPUSH/LPOP). The payload's `message.options.redis_message_id` MUST match the LIST/HASH key. The BFF's `IJobQueue` writes both atomically via MULTI/EXEC.
- **Sync session pattern**: dramatiq actors are sync `def`, so the worker uses SQLAlchemy 2.0 sync (psycopg2 driver) via `db_sync.py`. The async session pattern from the FastAPI api does NOT work here.
- **3-phase tx pattern**: `analyze_audio_job` (1) loads the job + flips to `processing`, commits. (2) Runs the pipeline (no DB writes — slow phase). (3) New session, inserts `analyses`, flips `analysis_jobs` to `complete`. Without this, long-running phase 4 (Demucs) holds a transaction open and blocks other queries.
- **`run_specialist` writes a fail-marker on exception**: a sentinel verdict with `headline='Specialist failed'` and the error reason is written so the frontend's `data-failed` UI state has something to render. The actor itself doesn't raise.
- **Specialist slugs are snake_case, prompt files are PascalCase**: mapping in `components/worker/app/verdict_lib/prompt_loader.py::SLUG_TO_FILENAME`. Triage routing plans use slugs.
- **Demucs pre-loaded at worker startup**, not per-task. Model reference survives across actor invocations.
- **concurrency=1 always**: Demucs is memory-heavy. `--processes 1 --threads 1` for dramatiq.

### shared (aimusic-shared)

**Purpose**: Single-source-of-truth Python package for all SQLAlchemy ORM models shared between `api` and `worker`. Contains `Base`, `JobStatus`, `User`, `UploadJob`, `AnalysisResult`. Both components import from here — model drift between api and worker is impossible.
**Package**: `aimusic-shared` (`pip install -e components/shared`)
**Key file**: `components/shared/aimusic_shared/models.py` — **add DB columns here first, then write an Alembic migration. Never define ORM models in api or worker directly.**
**How to run**: install only — no server. `pip install -e components/shared`

**Gotchas:**
- **Install before api and worker**: both `components/api/requirements.txt` and `components/worker/requirements.txt` list `aimusic-shared>=0.1.0`. Run `pip install -e components/shared` first in any fresh environment.
- **api re-exports `Base` for backward compat**: `components/api/app/db.py` does `from aimusic_shared.models import Base` and re-exports it. Don't duplicate `Base` in api.

### frontend-spectr (LEGACY — vanilla JSX, kept for reference)

The original vanilla-JSX SPA. The v2 frontend at `components/frontend-spectr-v2/` is the new path. Don't add new features here without flagging — the v2 frontend supersedes it. Some helpers and Anthropic-CLI verdict UI still live here pending migration.

### frontend (placeholder — TS/Tailwind/shadcn stack — never built)

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

**Components added in v1.2 (verdict pipeline):**
- `features/verdicts/VerdictsPanel.tsx` — replaces ExpertsPanel on report pages
- `features/verdicts/SummaryCard.tsx` — top-3 + release-readiness banner
- `features/verdicts/VerdictCard.tsx`, `EvidenceChips.tsx`, `FixSummary.tsx`,
  `SeverityBadge.tsx`, `VerdictSkeleton.tsx`, `VerdictList.tsx`
- `features/verdicts/useVerdictStream.ts` — SSE hook for verdict events
- `types/verdicts.ts` — hand-mirrored from Pydantic (`components/shared/aimusic_shared/verdicts/models.py`); regenerate via `npm run gen-types` (note: pydantic2ts CLI currently fails on Windows — hand-edit instead)

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
# ── v2 stack — primary ──────────────────────────────────────────

# BFF — .NET build + tests
cd components/bff && dotnet build && dotnet test

# v2 frontend — all four gates
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run lint    # --max-warnings 0
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run

# Worker tests (dramatiq actors)
pytest -q components/worker/tests/

# ── shared Python ───────────────────────────────────────────────

# Install shared + analysis packages (one-time; shared must come first)
pip install -e components/shared
pip install -e components/analysis

# Python lint + type check
ruff check components/api/ components/analysis/src/ components/worker/ components/shared/
mypy components/api/app/ components/worker/app/ --ignore-missing-imports

# Analysis tests (mocks heavy models)
pytest -q components/analysis/tests/

# Shared model tests
pytest -q components/shared/tests/

# ── legacy api (still runs the verdict pipeline) ────────────────

pytest -q components/api/tests/
pytest -q components/api/tests/verdict_pipeline/

# ── DB migrations ───────────────────────────────────────────────
# BFF owns the canonical schema via EF Core 10:
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
# Legacy Alembic migrations are frozen for the FastAPI api:
alembic -c migrations/alembic.ini upgrade head

# ── Integration: BFF + dramatiq + v2 frontend ───────────────────
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &
cd components/worker && python -m dramatiq app.dramatiq_app &
cd components/frontend-spectr-v2 && npm run dev &
curl -f http://localhost:5174 && echo "Frontend OK"
curl -f http://localhost:5000/openapi/v1.json && echo "BFF OK"
```

---

## Stack-specific rules

**C# / .NET (bff)**
- .NET 10. Format with `dotnet format`. Build with `dotnet build`. Test with `dotnet test`.
- EF Core 10 + Npgsql. Snake_case column mapping. Migrations live in `Spectr.Data/Migrations/`.
- JWT bearer auth via `Microsoft.AspNetCore.Authentication.JwtBearer`. Refresh token in httpOnly cookie. NEVER store access tokens in localStorage on the frontend side.
- Minimal-API endpoints under `Spectr.Bff/Endpoints/*Endpoints.cs`. Each file groups one resource.
- DTOs in `Spectr.Bff/DTOs/` — record types preferred.
- IFileStorage abstraction: `LocalDiskFileStorage` (dev) / R2 (prod via signed URLs). Don't bypass the interface.
- `<NuGetAuditMode>direct</NuGetAuditMode>` in `Directory.Build.props` — without it transitive CVEs fail the build.
- **Stripe.net SDK gotcha (52.x, story 2.1)**: in the 2024 API restructure, per-item billing periods moved `CurrentPeriodEnd` and `Price` from `Stripe.Subscription` to `Stripe.SubscriptionItem`. Read them via `stripeSub.Items.Data[0]`, not directly off the subscription. Any new consumer of `Stripe.Subscription` must follow the same pattern. Also: every mutating Stripe call (customer/session/subscription create + update) MUST carry an `IdempotencyKey` in `RequestOptions` — derived deterministically from the user id + operation so retries don't duplicate side effects.
- **Webhook idempotency pattern** (story 2.1): all webhook handlers use `INSERT … ON CONFLICT (id) DO NOTHING` on the dedupe table (e.g. `webhook_events`). The duplicate-skip MUST be conditional on `processed_at IS NOT NULL` — skipping on row existence alone strands events whose first dispatch failed.
- **Shared error envelope** (story 2.1): `Endpoints/ErrorEnvelope.cs` — call `ErrorEnvelope.Build(status, code, message, details)` from any endpoint group. Don't add per-file copies.

**Python (analysis, worker, legacy api)**
- Python 3.11+. Format with `ruff format`. Lint with `ruff check`. Type-check with `mypy`.
- Pydantic v2 only. SQLAlchemy 2.0 only. Worker uses sync sessions (psycopg2); legacy api uses async (asyncpg).
- No `python-jose` anywhere. JWT = PyJWT only.
- Pin `numpy<2.0` in `components/analysis/pyproject.toml` — do not loosen.
- Dramatiq actors are sync `def`. To call async code, wrap with `asyncio.run()` inside the actor body.
- All env vars via `pydantic_settings.BaseSettings`. No hardcoded secrets.
- Tests with `pytest` + `pytest-asyncio` (asyncio_mode = "auto"). Never mock to pass — fix the underlying issue.

**TypeScript / React (frontend-spectr-v2)**
- React 19 + Vite 6 + TypeScript strict + `verbatimModuleSyntax`.
- Feature-based folder layout under `src/features/`. No type-based layout at root.
- **CSS Modules + `src/styles/{tokens.css,global.css}` + global utility classes** (`.card`, `.pill[.tone]`, `.btn`, `.label`, `.mono`). NO Tailwind. NO styled-components. NO shadcn/MUI/Chakra.
- Recharts for charts. WaveSurfer.js v7 for waveform UI. Sonner for toasts.
- Custom `fetcher.ts` for HTTP — single instance, owns 401-retry-with-refresh. Don't introduce axios.
- All file upload via XHR (`useFileUpload` hook). Job progress via SSE / TanStack Query polling.
- No inline styles unless dynamic (color-from-grade, etc).
- All four gates must pass before committing: `tsc --noEmit`, `npm run lint --max-warnings 0`, `npm run build`, `npx vitest run`.

**Windows dev note**
- allin1/all-in-one-fix structure detection (Phase 1) requires Docker on Windows. Run `docker compose -f docker/docker-compose.yml up -d` before starting the worker.
- BFF on Windows: file locks on `bin/Debug/net10.0/Spectr.Bff.exe` block `dotnet build` if the BFF is running. Stop the running BFF process first (`Stop-Process -Id <PID> -Force`).
- **uvicorn `--reload` orphan processes** (legacy api): `uvicorn --reload` spawns a child process via `multiprocessing.spawn`. Killing the parent leaves the child holding the port. Use `tasklist` + `wmic` (not `Get-Process` — it can't see spawn workers). See `memory/feedback_zombie_uvicorn_processes.md`.

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

---

## Stems integration (added 2026-04-26)

Optional stems upload (1–30 FLAC/WAV files) unlocks per-stem analysis.
The flow is asynchronous from the user's perspective: upload → server
auto-matches stems to roles + .als track names → user confirms via
`POST /uploads/{job_id}/stems/confirm` → Celery dispatches with
`stem_paths` forwarded. Without stems the flow is bit-for-bit
unchanged (immediate Celery dispatch).

All stem logic lives in `audio_analysis.stems` (a single import
boundary). Phases 4 and 5 call into it conditionally; existing fields
in their results are unchanged. Three new verdict specialists
(`stem_balance`, `stem_stereo_width`, `stem_reference_delta`) are
gated by Triage so they only run when `phase4.stems.status == "ok"`.

Curated reference library has pre-computed Demucs caches at
`data/reference_library/_stems_cache/<track_id>.stems.json`. Build them
offline:
```
python -m audio_analysis.reference_library.pre_demucs \
    --library data/reference_library/ --out data/reference_library/_stems_cache/
```
We never run Demucs at request time on user-uploaded references.

Stale `AWAITING_STEM_MAPPING` jobs (>24h) are auto-failed by an hourly
beat task that also purges their upload directories.

**Frontend integration is deferred** — the actual frontend in this
branch (`components/frontend-spectr/`) is vanilla `.jsx` (no
TypeScript / Tailwind / shadcn / vitest / Playwright). A separate
follow-up plan will wire the upload + mapping + report UI to the
backend changes that are now in place.
