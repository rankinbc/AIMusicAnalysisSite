# SPECTR — AI Music Analyzer

A music producer web app for uploading audio files (MP3, FLAC, WAV) and receiving a comprehensive multi-phase analysis report. Loudness/LUFS with streaming-platform targets, frequency balance, stereo health, genre detection + scoring, stem separation + clash detection, reference-track comparison, arrangement advice, plus on-demand AI specialist verdicts.

Also includes a **Listen** page with a real-time Web Audio DSP chain — EQ, compressor, saturation, M/S width, pitch — so producers can A/B mix decisions in-browser without leaving the report.

---

## Stack

**v2 (primary):**

| Component | Purpose | Tech |
|---|---|---|
| `bff/` | Auth, songs/versions, upload, audio streaming, job dispatch, verdict routes | ASP.NET Core .NET 10, EF Core 10, Npgsql, dramatiq job queue (Redis), JWT bearer |
| `frontend-spectr-v2/` | React 19 SPA — auth, library, results, AI Coach, Listen DSP page | React 19 + Vite 6 + TypeScript strict + TanStack Router + CSS Modules + Radix UI + WaveSurfer + Recharts |
| `worker/` | dramatiq worker — runs 7-phase analysis + on-demand specialist verdicts | Python 3.11+ / dramatiq / SQLAlchemy 2 sync (psycopg2) / Anthropic CLI |
| `shared/` | `aimusic-shared` — SQLAlchemy ORM models (worker side) | Python / SQLAlchemy 2 / Pydantic v2 |
| `analysis/` | `audio_analysis` — installable 7-phase pipeline package | Python / librosa / Demucs / torchopenl3 / pyloudnorm |

**v1 (legacy, still running):**

| Component | Purpose | Tech |
|---|---|---|
| `api/` | FastAPI — still owns the verdict pipeline + Anthropic CLI client | FastAPI / asyncpg / Celery (deprecated path) |
| `frontend-spectr/` | Vanilla JSX SPA | Plain React without TS / Tailwind |

Both stacks share the same PostgreSQL 16 + Redis 7. BFF owns the canonical schema via EF Core migrations; the shared SQLAlchemy ORM in `aimusic_shared/models.py` mirrors those entities for the worker.

---

## Project structure

```
AIMusicAnalysisSite/
├── components/
│   ├── bff/                  # .NET 10 BFF (primary backend)
│   ├── frontend-spectr-v2/   # React 19 + TS SPA (primary frontend)
│   ├── worker/               # dramatiq worker
│   ├── analysis/             # 7-phase audio analysis package
│   ├── shared/               # aimusic-shared ORM models
│   ├── api/                  # FastAPI legacy (verdict pipeline)
│   └── frontend-spectr/      # vanilla JSX legacy SPA
├── data/                     # runtime data (gitignored except reference_library)
├── docker/                   # docker compose: postgres, redis
├── migrations/               # placeholder — canonical schema is EF Core in bff/src/Spectr.Data
├── output/                   # per-job analysis artifacts (gitignored; a few reference samples committed)
└── PRPs/                     # plan-research-prompt docs (slice plans + archive)
```

---

## Analysis phases

1. **Universal mix analysis** — Loudness/LUFS, 7-band frequency balance, stereo, transients, BPM (~30s)
2. **Genre auto-detection** — Trance / House / Techno / Drum & Bass / Other (~5s)
3. **Genre-specific scoring** — DNA score, sidechain, supersaw, energy curves (~10s)
4. **Stem separation + clash detection** — Demucs 4-stem split, frequency masking (~10-20 min CPU)
5. **Reference track comparison** — Per-feature delta vs. uploaded reference (~60s)
6. **Genre profile gap analysis** — Percentile ranking vs. curated reference library (~5s)
7. **Arrangement advisor** — Section length, energy contrast, flow issues (~10s)

After the pipeline runs, the user can click any of 26 specialist tiles on the Results page to run an on-demand AI verdict (Loudness, Low End, Stereo Field, etc.) — wraps the Anthropic `claude` CLI via the worker.

---

## How to run (v2 stack)

```bash
# 1. Start local services
docker compose -f docker/docker-compose.yml up -d  # PostgreSQL + Redis

# 2. BFF schema (canonical)
cd components/bff
dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff

# 3. Install Python packages (one-time)
pip install -e components/shared       # shared FIRST
pip install -e components/analysis
pip install -r components/worker/requirements.txt

# 4. Start each process (separate terminals)
cd components/bff/src/Spectr.Bff       && dotnet run            # :5000
cd components/worker                    && python -m dramatiq app.dramatiq_app
cd components/frontend-spectr-v2        && npm install && npm run dev   # :5174
```

Frontend: http://localhost:5174 · BFF OpenAPI: http://localhost:5000/openapi/v1.json

---

## Validation (before committing)

```bash
# BFF
cd components/bff && dotnet build && dotnet test

# v2 frontend — 4 gates
cd components/frontend-spectr-v2
npx tsc --noEmit
npm run lint        # --max-warnings 0
npm run build
npx vitest run

# Python
ruff check components/api/ components/analysis/src/ components/worker/ components/shared/
pytest -q components/analysis/tests/
pytest -q components/worker/tests/
pytest -q components/api/tests/        # legacy verdict pipeline
```

---

## Developing with Claude

This project follows the **PRP workflow** (plan-research-prompt). For new features:

```
/new-feature                              # guided interview
# or manually:
edit PRPs/source/INITIAL.md
/generate-prp                             # → PRPs/<slug>.md
/execute-prp PRPs/<slug>.md
```

Archived plans live in `PRPs/archive/`. Each one is a small slice (auth, library, results, verdicts, UI fidelity, Listen DSP, pitch tool, etc.).

Project rules + per-component gotchas live in [`CLAUDE.md`](./CLAUDE.md).

---

## Reopening in Claude Code

```
cd C:\claude-workspace\AIMusicAnalysisSite && claude
```
