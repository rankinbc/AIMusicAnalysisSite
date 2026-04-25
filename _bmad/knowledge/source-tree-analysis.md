# Source Tree Analysis — AI Music Analyzer

## Top-Level Structure

```
AIMusicAnalysisSite/
├── CLAUDE.md                        # Project rules and stack-specific constraints
├── HANDOFF.md                       # Session parachute — read first each session
├── README.md                        # Project overview and setup guide
├── .gitignore
│
├── components/                      # ALL runnable code — never break this rule
│   ├── api/                         # FastAPI backend (port 8000)
│   ├── analysis/                    # Python audio analysis library
│   ├── worker/                      # Celery async task worker
│   ├── frontend/                    # React 19 SPA (port 5173)
│   └── frontend-spectr/             # React 18 alternate SPA (port 5174)
│
├── data/                            # ALL inputs — never inside components
│   ├── uploads/                     # Staged audio files (pre-analysis)
│   ├── reference_library/           # Curated pro reference tracks by genre
│   └── models/                      # Cached ML model weights (TORCH_HOME)
│
├── output/                          # ALL generated artifacts
│   └── analysis_results/            # Per-job JSON analysis outputs
│
├── migrations/                      # Project-level Alembic placeholder (migrations live in api/)
├── schemas/                         # OpenAPI/TypeScript schema sharing (README only; not populated)
│
├── docker/
│   └── docker-compose.yml           # PostgreSQL 15 + Redis 7 for local dev
│
├── PRPs/                            # Feature planning documents
│   ├── features/                    # 13 active feature PRPs (gap-01 through gap-13)
│   ├── archive/                     # 14 completed PRPs
│   ├── source/INITIAL.md            # Source spec
│   └── templates/prp_base.md        # PRP template
│
├── _bmad/
│   └── knowledge/                   # AI documentation (this directory)
│
└── .claude/
    └── commands/                    # Claude slash commands (execute-prp, generate-prp, etc.)
```

## `components/api/` — FastAPI Backend

```
components/api/
├── Dockerfile                       # python:3.11-slim, exposes port 8000
├── alembic.ini                      # Alembic config (sync psycopg2 URL)
├── requirements.txt                 # Python dependencies
├── pytest.ini                       # asyncio_mode=auto
├── app/
│   ├── main.py                      # App factory, CORS middleware, router registration
│   ├── config.py                    # Pydantic BaseSettings (all env vars)
│   ├── db.py                        # AsyncSessionLocal, engine, get_session dependency
│   ├── models/
│   │   ├── __init__.py              # Re-exports all models
│   │   ├── user.py                  # User table (id, email, hashed_password, is_active)
│   │   ├── upload_job.py            # UploadJob table + JobStatus enum
│   │   └── analysis_result.py       # AnalysisResult table (JSONB, share_token)
│   ├── schemas/
│   │   ├── auth.py                  # RegisterRequest, LoginRequest, TokenResponse
│   │   ├── uploads.py               # UploadResponse
│   │   └── jobs.py                  # JobStatus, JobResult, JobSummary, TrackGroup, TrackVersionSummary
│   ├── routers/
│   │   ├── auth.py                  # /auth/* routes + get_current_user, get_current_user_sse deps
│   │   ├── uploads.py               # POST /uploads/ (magic byte validation, chunked write)
│   │   ├── jobs.py                  # GET /jobs/, /jobs/{id}/status, /jobs/{id}/stream, /jobs/{id}/results
│   │   ├── reports.py               # GET /reports/share/{token} (public, no auth)
│   │   ├── tracks.py                # GET /tracks/ (version history grouping)
│   │   └── experts.py               # POST /experts/{job_id}/triage, /experts/{job_id}/specialist/{name}
│   └── services/
│       ├── storage.py               # LocalStorage backend (1 MB chunked aiofiles write)
│       ├── celery_client.py         # dispatch_analysis_job() → send_task()
│       └── expert_service.py        # run_triage(), stream_specialist(), extract_specialists()
├── alembic/
│   └── versions/
│       ├── 001_initial_schema.py    # Creates users, upload_jobs, analysis_results tables
│       ├── 002_add_share_token.py   # Adds share_token to analysis_results
│       └── 003_add_track_name.py    # Adds track_name to upload_jobs
├── prompts/                         # 23 specialist markdown prompts for AI experts
└── tests/
    ├── test_auth.py                 # Health, register, login tests
    ├── test_uploads.py              # Magic byte validation, auth tests
    ├── test_experts_router.py       # Triage and specialist SSE tests
    └── test_expert_service.py       # Prompt loading, specialist extraction, Claude mocking
```

## `components/analysis/` — Audio Analysis Library

```
components/analysis/
├── pyproject.toml                   # hatchling build; pip install -e installs src/audio_analysis
├── src/audio_analysis/
│   ├── __init__.py                  # Exports: run_pipeline (sole public API)
│   ├── pipeline.py                  # Orchestrator: runs all 7 phases, computes scores, coaching
│   ├── schemas.py                   # TypedDicts: PipelineResult, PhaseResult
│   ├── models.py                    # Singleton model loader: get_model("demucs"|"openl3")
│   ├── converters.py                # to_wav(): any format → 44100 Hz WAV temp file
│   ├── coach.py                     # generate_coached_fixes(): template-based coaching voice
│   ├── phases/
│   │   ├── phase1_universal.py      # LUFS, RMS, BPM, bands, stereo, peak, key, mono compat
│   │   ├── phase2_genre.py          # Rules-based genre classifier (BPM thresholds)
│   │   ├── phase3_genre_specific.py # Genre-specific weighted scoring rubrics
│   │   ├── phase4_stems.py          # Demucs stem separation + frequency clash detection
│   │   ├── phase5_reference.py      # Reference track delta comparison
│   │   ├── phase6_gap.py            # Genre profile percentile gap analysis
│   │   └── phase7_arrangement.py    # Section structure violations + fixes
│   └── scorers/
│       └── danceability.py          # danceability_score(): BPM + rhythm + low-energy
└── tests/
    └── test_pipeline.py             # ~24 tests; mocks Demucs; synthetic sine WAV fixtures
```

## `components/worker/` — Celery Worker

```
components/worker/
├── requirements.txt                 # celery, redis, sqlalchemy, psycopg2-binary
├── pytest.ini                       # asyncio_mode=auto
├── Procfile                         # Start commands (solo pool for Windows)
├── app/
│   ├── celery_app.py                # Celery app config (broker, backend, include, task_track_started)
│   ├── tasks.py                     # run_analysis_pipeline task (bind=True, CustomTask base)
│   ├── progress.py                  # make_progress_cb(): dual-mode (Celery state + DB)
│   ├── signals.py                   # worker_ready → preload Demucs model singleton
│   └── db.py                        # Worker ORM models, update_job_phase(), finalize_job(), CustomTask engine lifecycle
└── tests/
    └── test_tasks.py                # 6 tests: callback, DB helpers, task execution, exception handling
```

## `components/frontend/` — React 19 SPA

```
components/frontend/
├── vite.config.ts                   # Port 5173, proxy /api → localhost:8000
├── tailwind.config.ts               # Safelist: grade colors, badges, animation classes
├── tsconfig.json                    # Strict mode, @ path alias
├── package.json                     # React 19, Vite 8, Recharts, shadcn/ui, Axios
└── src/
    ├── main.tsx                     # React DOM entry point
    ├── App.tsx                      # React Router routes (public + ProtectedLayout-wrapped)
    ├── types/
    │   └── api.ts                   # All TypeScript interfaces (TokenResponse, PipelineResult, etc.)
    ├── lib/
    │   └── apiClient.ts             # Axios instance, interceptors, setAccessToken/getAccessToken
    ├── contexts/
    │   └── AuthContext.tsx          # Auth state, silent refresh on mount, login/logout/register
    ├── features/
    │   ├── auth/
    │   │   ├── Login.tsx            # Login form
    │   │   ├── Register.tsx         # Register form
    │   │   ├── ProtectedLayout.tsx  # Auth guard (shows loader during refresh, redirects if no token)
    │   │   └── useAuth.ts           # Re-export of useAuth hook
    │   ├── upload/
    │   │   ├── UploadPage.tsx       # Drag-drop upload, track name, reference track, progress bar
    │   │   └── useFileUpload.ts     # XHR upload hook (progress events, FormData, Bearer token)
    │   ├── analysis/
    │   │   ├── JobProgressPage.tsx  # 7-phase animated progress display
    │   │   └── useJobStream.ts      # EventSource SSE hook (?token= query param, done detection)
    │   ├── report/
    │   │   ├── ReportPage.tsx       # Full report layout (all sections, share button)
    │   │   ├── MixScore.tsx         # Grade badge + color-coded score + top 3 fixes
    │   │   ├── StreamingReadiness.tsx # LUFS per platform + True Peak + Clipping rows
    │   │   ├── FrequencyChart.tsx   # Recharts BarChart (7 frequency bands)
    │   │   ├── StereoGauges.tsx     # Stereo correlation + width display
    │   │   ├── StemClash.tsx        # Frequency clash table
    │   │   ├── ReferenceComparison.tsx # Delta metrics vs reference track
    │   │   ├── GenreRadar.tsx       # Recharts RadarChart vs genre mean
    │   │   ├── ArrangementAdvisor.tsx  # Violations + fixes list
    │   │   └── CoachPanel.tsx       # Coach avatar + numbered tips
    │   └── experts/
    │       ├── ExpertsPanel.tsx     # Entry point: Run Triage button + TriageView
    │       ├── TriageView.tsx       # Triage report + recommended specialists list
    │       ├── SpecialistCard.tsx   # Run/Cancel/Expand per specialist
    │       ├── ExpertOutput.tsx     # Streaming markdown output + loading cursor
    │       └── useExpertAnalysis.ts # State mgmt: runTriage(), runSpecialist(), cancelSpecialist()
    └── pages/
        ├── HistoryPage.tsx          # Job history table (status, score, grade, date)
        ├── TrackHistoryPage.tsx     # Version tracking: LineChart + version table
        └── SharedReportPage.tsx     # Public report via share token (no auth, native fetch)
```

## `components/frontend-spectr/` — Alternate React 18 SPA

```
components/frontend-spectr/
├── vite.config.js                   # Port 5174, proxy /api → localhost:8080
├── package.json                     # React 18, Vite 6 (no TypeScript)
└── src/
    ├── main.jsx                     # React DOM entry point
    ├── App.jsx                      # State machine: login → upload → processing → results
    ├── api/
    │   ├── client.js                # XHR upload, EventSource SSE, fetch API calls, localStorage token
    │   └── adapter.js               # Raw API response → UI-consumable shape transformer
    ├── components/
    │   ├── LoginPage.jsx            # Auth (sign-in / create-account toggle)
    │   ├── UploadPage.jsx           # Drag-drop + genre selector + reference track + waveform preview
    │   ├── ProcessingPage.jsx       # Live 7-phase checklist with SSE progress
    │   ├── ResultsPage.jsx          # Full report with sticky player footer
    │   ├── ScoreRing.jsx            # Animated SVG circular progress ring
    │   ├── ResultsSections.jsx      # FixCard, LoudnessStats, StreamingTable, FrequencyBars, etc.
    │   ├── StickyPlayer.jsx         # Fixed audio player with waveform scrubbing
    │   └── primitives.jsx           # Shared UI helpers: sevColor, gradeColor, WaveformSVG, EQLoader
    └── hooks/
        └── useWaveform.js           # Web Audio API decoding → normalized peak array
```

## Critical Path Annotations

- **Entry point (API)**: `components/api/app/main.py` → `FastAPI()` app factory
- **Entry point (frontend)**: `components/frontend/src/main.tsx` → `ReactDOM.createRoot`
- **Entry point (worker)**: `components/worker/app/celery_app.py` → `Celery(...)` instance
- **Entry point (analysis)**: `components/analysis/src/audio_analysis/__init__.py` → `run_pipeline`
- **Auth dependency (most routes)**: `components/api/app/routers/auth.py:get_current_user`
- **Auth dependency (SSE)**: `components/api/app/routers/auth.py:get_current_user_sse`
- **Job dispatch**: `components/api/app/services/celery_client.py:dispatch_analysis_job`
- **Job execution**: `components/worker/app/tasks.py:run_analysis_pipeline`
- **Pipeline core**: `components/analysis/src/audio_analysis/pipeline.py:run_pipeline`
