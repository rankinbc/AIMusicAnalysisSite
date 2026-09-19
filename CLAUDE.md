# Project: AI Music Analyzer (SPECTR)

A music producer web app where users register/log in, upload audio files (MP3, FLAC, WAV), and receive a comprehensive 7-phase analysis report plus on-demand AI specialist verdicts. Users can also "listen" to their track through a real-time Web Audio DSP chain (EQ, compressor, saturation, M/S width, pitch).

Single-user tool: there is no sharing, no profiles, no rooms — see `PRPs/solo-fork-strip-social.md`. `solo` is the main development + deploy branch; `master` is the frozen archive of the social build.

**v2 stack (current — primary):**
- **`bff/`** — ASP.NET Core .NET 10 minimal-API BFF (EF Core 10, Npgsql, PyJWT-style JWT bearer, IFileStorage, dramatiq job queue dispatcher)
- **`frontend-spectr-v2/`** — React 19 + Vite 6 + TypeScript strict + TanStack Router + TanStack Query + CSS Modules + Radix UI + WaveSurfer + Recharts + Sonner. CSS Modules + `tokens.css`. No Tailwind, no shadcn.
- **`worker/`** — Python dramatiq worker (replaces Celery). Actors: `analyze_audio_job` (7-phase pipeline — 8 with .als), `run_specialist` (on-demand AI verdict)
- **`shared/`** — `aimusic-shared` Python package: single-source SQLAlchemy ORM models for the worker (BFF has parallel EF Core entities that mirror this)
- **`analysis/`** — `audio_analysis` Python package (7-phase pipeline, installable)

**v1 stack (legacy — being phased out):**
- **`api/`** — FastAPI REST API. Still hosts the verdict pipeline + Anthropic API client. Will fold into BFF/worker once dramatiq has the verdict actor pattern stabilized.

Both legacy frontends (`frontend-spectr/` vanilla JSX, and the never-built
`frontend/` TS/Tailwind placeholder) were **deleted 2026-07-28**. The v2
frontend is the only one. They remain in git history if anything is needed back.

Postgres 16 + Redis 7 are shared. Both stacks talk to the same DB.

---

## Starting / stopping / restarting the app — READ `docs/STARTUP.md` FIRST

**When asked to start, stop, restart, or debug startup of the stack, follow
`docs/STARTUP.md` — it is the single canonical startup guide. Do not improvise
commands from memory or from the per-component notes below.**

- Default action for "start the app" / "restart the app" / "stack is broken":
  `./scripts/start-spectr.ps1` from the repo root (safe to run anytime — it
  stops everything first, brings up Docker infra, migrates, recovers orphaned
  jobs, launches BFF + worker + frontend in their own windows). Teardown:
  `-StopOnly`.
- Before declaring the stack "up", run the verification steps in STARTUP.md
  section 5 (a fresh worker heartbeat does NOT prove the worker is consuming).
- If anything fails, check STARTUP.md section 6 ("Common problems") BEFORE
  diagnosing from scratch — every entry there has actually happened on this
  machine (zombie WSL ports, half-dead worker forks, docker CLI shadowing,
  OpenMP silent fork death, storage-root misconfig, etc.).
- Keep STARTUP.md current: any newly discovered startup failure mode or changed
  boot procedure gets added there (not to this file, not to a new doc).

---

## Project structure (STRICT — do not deviate)

```
AIMusicAnalysisSite/
├── CLAUDE.md
├── README.md
├── .gitignore
├── schemas/                  (Shared OpenAPI/TypeScript schema files)
├── docker/                   (Docker Compose for local dev: PostgreSQL, Redis, allin1)
├── docs/                     (Ops docs: STARTUP.md ← canonical startup guide, runbook.md, launch-checklist.md; plus generated project knowledge — index.md is the master doc index)
├── infra/                    (Production compose stack + deploy tooling — see docs/runbook.md)
├── scripts/                  (Local dev orchestration scripts — e.g. start-spectr.ps1 stack launcher)
├── _bmad/                    (BMad workflow tooling config — core/config.yaml; committed project config)
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
│   └── workerdash/           (Standalone local dramatiq worker dashboard — see its README)
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
- `schemas/`, `docker/`, `docs/`, `infra/`, `scripts/`, and `reference_library/` are declared project-level folders — use each as described in its README
- Startup/restart/troubleshooting knowledge lives ONLY in `docs/STARTUP.md` — never scatter boot instructions across new docs
- `scripts/` holds local dev orchestration (stack launch/stop, DB reset, etc.) — not application code and not generated artifacts

---

## Components

### bff (NEW — PRIMARY backend)

**Purpose**: ASP.NET Core .NET 10 minimal-API gateway. Owns auth (JWT bearer + refresh-token httpOnly cookie), songs/versions CRUD, audio upload (multipart, ≤250 MB), audio streaming for the Listen page (Range-enabled), analysis job dispatch via dramatiq, results retrieval, verdict listing + per-specialist on-demand `/run/{slug}` dispatch.
**Inputs**: PostgreSQL (EF Core 10 + Npgsql) + Redis (dramatiq broker) + `IFileStorage` (LocalDisk dev / R2 prod)
**Outputs**: HTTP/JSON to the frontend; dramatiq messages tier-routed onto `analysis-free`/`analysis-paid` (+ `coach`, `maintenance`) — there is NO `default` queue (story 2.5)
**How to run**: `cd components/bff/src/Spectr.Bff && dotnet run` (listens on `http://localhost:5000`)

**Key routes (v2):**
- Auth: `POST /api/auth/{login,register,refresh,logout}`, `GET /api/auth/me`
- Songs: `GET/POST /api/songs`, `GET/PATCH/DELETE /api/songs/{id}` (+ `/permanent`, `/restore`, `/tags`)
- Versions: `POST /api/versions` (chunked multipart upload), `GET/PATCH/DELETE /api/versions/{id}`, plus per-version sub-resources: `/analyze`, `/set-current`, `/notes` CRUD, `/rating`, `/als` (upload + download), `/reference`, `/files`, and the stems flow `/stems/{stage,classify,confirm}` + `GET /stems` + `GET /stems/{stemId}/audio` (see VersionEndpoints.cs for the full surface)
- Audio: `GET /api/versions/{id}/audio` — streams the original upload with `Accept-Ranges: bytes`. Accepts JWT via `Authorization` header OR `?t=<jwt>` query param (since `<audio>` / `EventSource` can't attach headers — whitelisted to paths matching `/audio`).
- Jobs/results: `GET /api/jobs/{id}`, `GET /api/jobs/{id}/results`
- Verdicts: `GET /api/reports/{job_id}/verdicts` (list + routing plan), `POST /api/reports/{job_id}/verdicts/run/{slug}` (on-demand specialist), `POST /api/verdicts/{id}/{dismiss,applied}`, `POST /api/verdicts/{id}/feedback`
- Anon funnel (story 6.3): `POST /api/anon/analyses` (multipart proxy ≤250 MB, mints the `spectr_device` cookie, song-less/version-less `AnalysisJob { DeviceId, FilePath }` — the worker resolves audio from `job.file_path` when `version_id` is null), `GET /api/anon/jobs/current|{id}|{id}/results` (device-cookie-scoped). One active analysis per device (409 `anon_active_analysis`); registration claims the device server-side (4.5) and re-parents jobs/analyses/conversations. Anon storage keys `audio/anon/{deviceId}/{jobId}/` are deleted by the 72h purge.

**Gotchas:**
- **EF Core 10 migrations require a manual partial-index step**: `add Initial` can't fluently express `CREATE UNIQUE INDEX ... WHERE is_current`. Append the raw SQL to `Up()` / `Down()` after scaffolding. See `bff/README.md`. Without it the library can have two `is_current=true` rows per song.
- **dramatiq wire format is HASH + LIST + per-message redis_message_id**: queue is `dramatiq:<queue>.msgs` HASH (message_id → JSON payload) + `dramatiq:<queue>` LIST (message_ids, RPUSH/LPOP). The payload's `message.options.redis_message_id` field is read by the Python broker — must match the LIST/HASH key. `IJobQueue.EnqueueAsync` uses `StackExchange.Redis` MULTI/EXEC to keep them in lockstep.
- **Audio streaming uses query-param JWT** because HTMLMediaElement.src can't attach headers. The token still flows through the same `JwtBearer` pipeline (`OnMessageReceived` reads `?t=` when path contains `/audio`). Tokens in URLs leak into server logs — pre-public exposure, swap to a short-lived HMAC-signed audio URL.
- **`Storage:LocalRoot` must resolve to repo-root `data/`, not `components/data/`**: previous off-by-one bug from `"../../../data"` resolution. Current config uses `"../../../../data"` from the BFF csproj directory.
- **NuGet audit gating**: set `<NuGetAuditMode>direct</NuGetAuditMode>` in `Directory.Build.props` — without it, transitive CVEs in Serilog deps fail the build.
- **CORS allowCredentials + explicit origins (not `*`)**: BFF allows only `http://localhost:5174` (Vite dev). Frontend uses `credentials: 'include'` for the refresh-cookie flow.
- **Routing plan is persisted in both `analyses.routing_plan` AND `verdicts_payload.routing_plan`**: the parallel column is the lookup path; the embedded JSON copy survives cache reset.
- **`analyze` deferral flag on `POST /versions/` and `POST /versions/{id}/als`**: optional form field, `bool?` defaulting to true. The unified-upload flow sends `analyze=false` so the version/.als is created WITHOUT enqueuing `analyze_audio_job`; a single analysis is dispatched downstream by `/stems/confirm` (stems) or `/versions/{id}/analyze` (no stems). Declared `bool?` not `bool` — an absent minimal-API form field binds a non-nullable bool to `false`, which would break every existing caller that omits it; `?? true` preserves back-compat. `UploadResponse.JobId` / `AlsUploadResponse.ReanalysisJobId` are now `Guid?` (null when deferred).
- **Per-phase re-run** — `POST /api/reports/{jobId}/phases/{phase}/rerun` (`ReportPhaseEndpoints.cs`) re-runs ONE analysis phase in place. Server accepts phase 2–8 (rejects 1 = full re-analyze). It creates a lightweight re-run `AnalysisJob` (progress vehicle) and enqueues the `rerun_phase` worker actor, which calls `audio_analysis.rerun_single_phase(...)` — runs just that phase, merges it into the EXISTING `analyses.final_json`, re-derives the rollups, and writes back to the **same** analysis row (never a 2nd `analyses` row). The pipeline was refactored into `run_single_phase` + `finalize_result` (+ `rerun_single_phase`) with `run_pipeline` output guarded byte-identical by the golden snapshots. Frontend: NO live UI surface currently exposes per-phase re-run — the old buttons lived in the orphaned `AnalysisTab` (deleted, story 12.5); the endpoint + `rerun_phase` actor remain for a future surface.

### frontend-spectr-v2 (NEW — PRIMARY frontend)

**Purpose**: React 19 + Vite 6 + TypeScript strict SPA. Auth, library (grid card view + filter pills + VersionArc per song), song detail (cover hero + ProgressTimeline + VersionList + CompareDialog version-delta), results page (SongHeader with add-input chips + ResultsTabs: AI Coach (CoachChat + Specialist roster + Fix Rack) / Findings / Project (or ProjectUnlock with .als upload CTA) / Reference / Track Info / Debug (dev builds only)), Listen rack page (`features/listen-rack/` — rack + visuals + rail; the Web Audio DSP engine `useAudioGraph` still lives in `features/listen/`).
**Inputs**: BFF `/api/*` REST + a couple of SSE endpoints
**Outputs**: browser
**How to run**: `cd components/frontend-spectr-v2 && npm run dev` (Vite dev server on port 5174, proxies `/api/*` to BFF on `:5000`)

**Stack rules:**
- **TypeScript strict + `verbatimModuleSyntax`**: `import type` mandatory for type-only imports.
- **CSS Modules + `src/styles/{tokens.css,global.css}`**. No Tailwind. Utility primitives `.card`, `.pill[.tone]`, `.dot[.tone]`, `.btn[.primary/.ghost/.sm]`, `.label`, `.mono` are global classes (ported from the mockup `styles.css`); component-specific styles live in `*.module.css`. Don't reach for inline styles unless the value is dynamic (color computed from grade, etc).
- **TanStack Router file-based routes** under `src/routes/`. `_app/*` is auth-gated via `beforeLoad`; `_public/*` is anon. The `_app` route's `beforeLoad` short-circuits during the silent-refresh boot (`isLoading=true`) to avoid flash-of-redirect.
- **`apiClient` via `src/api/fetcher.ts`**: single fetch wrapper with 401 → silent refresh + retry. Access token kept in module state ONLY (never localStorage); refresh token in httpOnly cookie. Don't reach for `localStorage` for auth.
- **No new top-level layout state**: feature folders (`features/results/`, `features/listen-rack/` (page), `features/listen/` (DSP engine + shared audio pieces)) own their pieces.

**Listen DSP chain (`features/listen/useAudioGraph.ts` — the ENGINE; the live page is `features/listen-rack/ListenRackPage.tsx`)**: a Web Audio graph that wraps the page's single `<audio>` element:
`MediaElementSource → 8× BiquadFilter (eq) → DynamicsCompressor → makeup gain → WaveShaper-parallel (sat dry+wet) → ChannelSplitter → 4-gain M/S matrix → ChannelMerger → master bypass lane → AnalyserNode (FFT) + ChannelSplitter → 2× AnalyserNode (L/R time-domain) → destination`. Tool toggles change params, not topology. Spectrum bars + meter rail read from `getByteFrequencyData` / `getFloatTimeDomainData` via a per-page rAF loop.

**Pitch tool**: when enabled, the hook fetches the audio URL, decodes to `AudioBuffer` (cached), disconnects MediaElementSource, plays via `AudioBufferSourceNode.detune`. Note: Web Audio's detune scales playbackRate, so **pitch+tempo are coupled** for now; true tempo-safe pitch shift needs an AudioWorklet phase vocoder.

**Gotchas:**
- **`useAudioGraph` returns a memoized handle via `useMemo(() => ({...}), [])`**: returning a fresh object every render caused every `[graph]`-dep effect to re-fire, kicking off duplicate `enterPitchMode` decodes mid-flight. All hook methods close over refs, never React state, so freezing identity is safe.
- **AudioContext must be created on a user gesture** (Chrome/Safari autoplay policy). Call `graph.ensureContext()` from the play button's click handler BEFORE `audio.play()`.
- **TanStack Router child routes need `<Outlet />` in the parent**: `songs.$songId.tsx` was rendering its own detail UI even when `/songs/$id/results/$jobId` was active. Pattern: check `useChildMatches().length > 0` and return `<Outlet />` early when a child is active.
- **Access token rotation can re-mount the `<audio>` element**: the `audioUrl` memo embeds the access token (`?t=`), so a silent refresh changes it, swapping the audio src and resetting `<audio>.currentTime`. Position state for the Listen page is therefore tracked off the audio graph's `pitchCurrentTime()` in pitch mode and the audio element's `timeupdate` event otherwise.
- **`<audio>` requires `crossOrigin="anonymous"`** to feed `MediaElementSource`. BFF must set permissive CORS on the audio response (already configured for `localhost:5174`).
- **`React.useState` initial value isn't recomputed after a token refresh**: derived state like `duration` is set by the MediaElement's `durationchange` event — initial value comes from `phase1?.duration_seconds`. Don't expect React state to track the live audio property without an explicit handler.
- **`UnifiedUploadDialog` is the entry point for NEW uploads** (library "+ New song" / song-detail "+ Add version"): mix required; stems/.als/reference optional; "Review stem roles before analyzing" checkbox (default off). It uploads the mix + .als with `analyze=false` and dispatches a SINGLE analysis via `/stems/confirm` (stems) or `/versions/{id}/analyze` (no stems); reference uploads run their own `run_reference_analyzer` and never touch the track's analysis. The standalone `UploadVersionDialog`/`AlsUploadDialog`/`StemsUploadDialog`/`ReferenceUploadDialog` remain for adding assets to an already-analyzed version. **Orchestration calls stage/classify/confirm/analyze via `fetcher` directly with the just-created versionId** — NOT via the `useStemStaging`/`useConfirmStems` hooks, because those capture `versionId` at render time (which is `''` until the mix upload returns), so calling them in the same async tick would hit a stale-closure empty id. `useStemProposals` is the exception — it's render-driven, safe for the review-step polling. Pure path/payload decisions live in `unified-upload-helpers.ts` (`decideDispatchPath`, `buildAutoConfirmPayload`).

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

**Purpose**: Installable Python package (`pip install -e components/analysis`) containing the full analysis pipeline (7 base phases; 8 with an .als project). Exposes `run_pipeline(file_path, reference_path=None, progress_cb=None)`. Copied and adapted from the existing AbletonAIAnalysis codebase.
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

**Purpose**: Dramatiq worker. Pulls actor invocations from four Redis queues (`coach`, `analysis-paid`, `analysis-free`, `maintenance` — see Queue topology below), runs them, writes results to Postgres. Core actors (the full roster also includes run_triage, run_reference_analyzer, classify_stems, rerun_phase, structure detection, sweep_retention, send_email, coach_reply, generate_fix_rack, delete_account_data):
- `analyze_audio_job(job_id)` — drives the analysis pipeline (7 base phases, 8 with .als) via `audio_analysis.run_pipeline()`, writes `analyses` row, flips `analysis_jobs.status` to `complete` / `failed`. Partial-failure tolerant (per-phase try/except).
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
- **Two-pass Problem engine (`verdict_lib/rule_engine.py`) — LIVE on the degraded/free path**: a deterministic IDENTIFY-tier engine emitting Problem records (Verdicts with `fix=None`). `degraded.run_rule_engine_for_analysis` calls `evaluate_problems` (validated + persisted with the Problem columns); the legacy flat `@rule`/`evaluate_rules` path was RETIRED 2026-07-23 (v3 closeout) — `evaluate_problems` is the sole rule path, and the schema-contract lint + inspector tooling read the `_SINGLES` registry (`(slug, fn)` tuples). New rules register via `@single` (Tier-A/B/S/P, one metric → one Problem) + `@composite` (Tier-C, corroborated multi-metric); `evaluate_problems` runs singles → composites → `suppression.apply` (each composite absorbs its child singles, with a `related_verdict_ids` audit trail). Thresholds are **genre-relative**, resolved from `verdict_lib/config/genre-profiles.json` via `genre_config` (same measured value → different severity per genre; `rule-bindings.json` maps rule→profile path + `genre_map`). Rules carry a `data_tier` (audio_only / stems / project_midi) and **never grade absent data** (guard inputs → `None`); `suspected=True` flags placeholder thresholds pending a measured spectral corpus (`config/genre-ref-values.md` is the provenance). **Persistence**: 8 IDENTIFY columns (`problem_id`/`kind`/`source`/`data_tier`/`fixable`/`suspected`/`where`/`refines`) on the `verdicts` table — EF `Verdict.cs` (canonical) → `aimusic_shared.models.Verdict` mirror → both worker mappers (`degraded._to_row`, `verdict_actor._persist_verdict`) → `VerdictDto`. The idempotency guard keys on `source == "rule_engine"` (NOT exact `specialist`, now `rule_engine.<slug>`). **Runs on every completed analysis** — `tasks_dramatiq.analyze_audio_job` Phase C2 calls `run_rule_engine_for_analysis(analysis_id)` after the `analyses` row commits (idempotent + best-effort: a failure never undoes the analysis), so it's no longer degraded-only. Plans: `PRPs/problem-engine-mixcoach-rules.md` + `PRPs/problem-engine-reconcile-persist.md`.
- **Queue topology (AR23 / D4 — shipped in story 2.5)**: four queues, **no `default`**. Prod runs two pools (process separation is the FR34 starvation guarantee, NOT intra-worker priority — `--queues` is an unordered set): **W1 `worker-paid`** consumes `coach analysis-paid`; **W2 `worker-free`** consumes `analysis-free maintenance`. Dev = TWO workers launched by `scripts/start-spectr.ps1` — a coach-only worker + an analysis worker for the other three queues — because a single one-thread all-queues worker parks every coach reply behind the running batch job for minutes (docs/STARTUP.md #3b) (`docker/docker-compose.prod.yml` is the prod overlay). `analyze_audio_job` is **tier-routed by the BFF** (`DispatchAnalysisAsync`: pro/credits → `analysis-paid`, free/anon → `analysis-free`) but **declares `analysis-free`** because it is the sole declarer of that queue (a Dramatiq consumer only attaches to a *declared* queue; dispatch is by `actor_name` so the one actor is consumed from both lanes — do NOT change its decorator to `analysis-paid` or every free job is orphaned). The 5 auxiliary actors (`run_triage`, `run_specialist`, `run_reference_analyzer`, `classify_stems`, `rerun_phase`) are on `analysis-paid`. `maintenance` carries the housekeeping actors: `sweep_retention` (story 3.4), `send_email` (story 4.2), `delete_account_data`. An enforcement test (`tests/test_actor_queues.py`) asserts no actor and no BFF enqueue site targets `default`.

### shared (aimusic-shared)

**Purpose**: Single-source-of-truth Python package for all SQLAlchemy ORM models shared between `api` and `worker`. Contains `Base`, `JobStatus`, `User`, `UploadJob`, `AnalysisResult`. Both components import from here — model drift between api and worker is impossible.
**Package**: `aimusic-shared` (`pip install -e components/shared`)
**Key file**: `components/shared/aimusic_shared/models.py` — **add DB columns here first, then write an Alembic migration. Never define ORM models in api or worker directly.**
**How to run**: install only — no server. `pip install -e components/shared`

**Gotchas:**
- **Install before api and worker**: both `components/api/requirements.txt` and `components/worker/requirements.txt` list `aimusic-shared>=0.1.0`. Run `pip install -e components/shared` first in any fresh environment.
- **api re-exports `Base` for backward compat**: `components/api/app/db.py` does `from aimusic_shared.models import Base` and re-exports it. Don't duplicate `Base` in api.

### workerdash (dev ops tool)

**Purpose**: Standalone local web dashboard for the dramatiq worker: queue
contents with song/version context, worker health (healthy/half-dead/dead),
cancel / bring-to-front / retry job actions, worker restart per STARTUP.md.
Also provides an Operations tab with searchable run history (list/drill-down),
per-run file access (audio, .als, JSON report, coach transcript), and LLM
token/cost breakdown via `llm_calls` rollup.
**Inputs**: Redis (dramatiq wire format), PostgreSQL (read + job-row updates), local disk or S3 for file serving (`STORAGE_LOCAL_ROOT`, optional `S3_*` env vars)
**Outputs**: http://127.0.0.1:5999 (localhost only, no auth)
**How to run**: `cd components/workerdash && python -m workerdash`

---

## Validation gates

```bash
# ── v2 stack — primary ──────────────────────────────────────────

# BFF — .NET build + tests
cd components/bff && dotnet build && dotnet test

# v2 frontend — all four gates
cd components/frontend-spectr-v2 && npx tsc -b   # NOT --noEmit: the root tsconfig is a
                                                #  solution file ("files": []), so --noEmit checks nothing
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

# ── Integration: BFF + dramatiq + v2 frontend ───────────────────
# Start the stack per docs/STARTUP.md (canonical):  ./scripts/start-spectr.ps1
curl -f http://localhost:5174 && echo "Frontend OK"
curl -f http://localhost:5000/healthz && echo "BFF OK"
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
- **Feature flags are read by BOTH services with a 60s cache (story 2.6 / AR35)**: the `feature_flags` table is the live, no-redeploy knob store. BFF side = `EntitlementService.GetFlagsAsync()` (60s `IMemoryCache`); worker side = `app/feature_flags.py` (60s TTL, fail-open, SQLAlchemy Core `text()` — no shared ORM model). Seed new flags via an idempotent `INSERT … ON CONFLICT DO NOTHING` migration; never hardcode tier numbers in code.
- **Tier-aware coach caps + two-guard model (story 2.6 / FR15)**: the BFF gates coach message COUNT, the worker LLM gateway gates SPEND (USD) — independently, neither knows the other. COUNT: `CoachCapService` (scoped) resolves per tier — free = per-analysis (`coach_free_followups` flag, counts user `coach_messages` in the conversation); pro = pooled MONTHLY across analyses (`coach_pro_monthly` flag, counts `coach_message` usage_events for the period); credits = unlimited. `CoachConversationEndpoints.PostMessage` writes a `coach_message` usage_event in the SAME `SaveChanges` as the message rows (append-only meter, the pooled-count source of truth). `CoachCapsDto.Scope` ∈ {analysis,month,unlimited} + `ResetsAt` tell the frontend which FR15 chip grammar to render. SPEND: `worker/app/llm/budget.py` resolves each per-tier/global monthly ceiling from feature_flags (`llm_budget_{free,pro,global}_usd`) → env fallback (None-check, so `0` hard-stops a tier).
- **`credits_enabled` kill switch (added 2026-07-23)**: turns the ENTIRE credit system on/off live. Precedence: `Credits:Enabled` config key (env `Credits__Enabled`) → `credits_enabled` feature-flag row → default ON; only an explicit `"false"` disables. When off, `EntitlementService.ComputeAsync` short-circuits to a premium DTO (`Tier="pro"`, unlimited analyses/coach, all feature bits, `CreditsEnabled=false`) and `CoachCapService.ResolveAsync` returns unlimited — the ONLY two flag-read sites; every downstream gate (dispatch caps, abuse arms, credit spend, `analysis-paid` routing, worker `job.tier`, frontend paywalls) inherits via the DTO with zero per-site conditionals. Frontend hides billing/tier UI off `EntitlementsDto.creditsEnabled` (Billing stays reachable so a live Stripe subscriber can always cancel). **Currently seeded `'false'`** (credits OFF — everyone premium); flip via `UPDATE feature_flags SET value='true' WHERE name='credits_enabled'` (≤60s propagation, no restart). The test suite pins `Credits__Enabled=true` process-wide (`TestProcessBaseline` in TestSupport.cs) so the DB seed can't flip tier-sensitive tests into premium mode — kill-switch tests opt out per-factory via `UseSetting("Credits:Enabled","false")`.

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
- All four gates must pass before committing: `tsc -b` (NOT `--noEmit`), `npm run lint --max-warnings 0`, `npm run build`, `npx vitest run`.

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

**Frontend integration** landed later in `frontend-spectr-v2/` — see the
bulk-stems section below. (The original note here deferred it because the
only frontend at the time was the vanilla-JSX `frontend-spectr/`, since
deleted.)

### Bulk stem upload + audio-content classification (added 2026-06-16, v2)

The v2 stack replaces the one-file-per-role stems UI with a single drag-drop
zone (up to **100** stems). Flow: **stage → classify → poll → confirm**.
- BFF (`VersionEndpoints.cs`): `POST /versions/{id}/stems/stage` (multi-file,
  appends to `song_versions.stem_paths_raw`), `POST .../stems/classify`
  (enqueues the `classify_stems` dramatiq actor), `GET .../stems` (poll
  proposals; `classified=true` once every row has a `detected_role`),
  `POST .../stems/confirm` (writes `stem_paths` role→[paths] groups +
  `stem_analysis_mode`, dispatches `analyze_audio_job`), `GET .../stems/{stemId}/audio`.
  The legacy role-keyed `POST /stems` endpoint is kept.
- **Classification is a Python worker actor** (`classify_stems`) — the BFF is
  .NET and can't run it in-process. It's audio-content based (not filename).
- Classifier lives in `audio_analysis.stems` as an **import-light** module
  (librosa only, NO demucs/torch): `classify_stems(paths) -> [StemProposal]`
  plus a tuning CLI: `python -m audio_analysis.stems.classify <dir>`.
- `stem_paths` value shape widened from `{role: "path"}` to `{role: ["path",…]}`;
  the phase4/phase5 coercion accepts **both** (old rows still analyze). Grouped
  mode (default) sums each role's stems into a bus; `per_stem` mode (opt-in,
  `song_versions.stem_analysis_mode`) analyzes each stem individually with
  capped pairwise clash.
- Frontend: `StemsUploadDialog.tsx` (drag-drop, local-blob preview, editable
  detected roles, mode toggle) + hooks `useStemStaging` / `useClassifyStems` /
  `useStemProposals` / `useConfirmStems`.
- **EF gotcha:** a write-path version lookup must NOT use `db.Songs.AsNoTracking()`
  in its join — `AsNoTracking()` anywhere makes the WHOLE query no-tracking, so
  `SaveChanges` silently drops the update. (The legacy `UploadStems` POST `/stems`
  has this latent bug and never persisted in v2; the new flow uses a tracked lookup.)
- **Follow-ups:** BFF endpoint integration tests (not done); fix the legacy `/stems`
  endpoint's AsNoTracking bug if it's kept (not done). ~~Cleanup of abandoned
  `audio/stems/{versionId}/` staging dirs~~ — DONE (audit wave 2): the nightly
  `sweep_retention` purges staging abandoned >24 h before confirm
  (`_purge_abandoned_stem_staging`, window via `RETENTION_STAGED_STEMS_HOURS`).
