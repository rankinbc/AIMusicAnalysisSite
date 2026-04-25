

> First time here? Read `.scaffolding/README.md` for first-run setup notes (auto-deleted by `/execute-prp` on successful build).

# AI Music Analyzer

A music producer web app for uploading audio files (MP3, FLAC, WAV) and receiving a comprehensive, multi-phase analysis report. Covers loudness/LUFS with streaming platform targets, frequency balance, stereo health, genre detection, genre-specific scoring, stem separation + clash detection, reference track comparison, and arrangement advice.

Built on an existing Python analysis pipeline wrapped as an installable package, with a React SPA frontend and async job processing.

---

## Project structure

```
AIMusicAnalysisSite/
├── components/
│   ├── api/                  FastAPI backend (auth, upload, job queue, results)
│   ├── analysis/             Python audio analysis package (7-phase pipeline)
│   ├── worker/               Celery worker (orchestrates analysis jobs)
│   └── frontend/             React 19 SPA (upload, progress, report)
├── data/
│   ├── uploads/              Staged audio file uploads (dev local)
│   ├── reference_library/    Curated pro reference tracks (by genre)
│   └── models/               Cached ML model weights
├── output/
│   └── analysis_results/     Per-job analysis JSON artifacts
├── migrations/               Alembic DB schema migrations
├── schemas/                  Shared OpenAPI/TypeScript schema files
└── docker/                   Docker Compose for local dev services
```

---

## Components

| Component | Purpose | Pattern |
|---|---|---|
| `api` | FastAPI backend: auth, file upload, job dispatch, SSE progress, results | api.md |
| `analysis` | 7-phase Python analysis package, installed as editable package | analysis.md |
| `worker` | Celery worker: drives analysis pipeline, reports progress, stores results | automation.md |
| `frontend` | React 19 SPA: auth, upload, progress, interactive report | dashboard.md (React) |

---

## Analysis phases

1. **Universal mix analysis** — Loudness/LUFS, 7-band frequency balance, stereo health, transients, BPM (~30s)
2. **Genre auto-detection** — Trance, House, Techno, Drum & Bass, Other (~5s)
3. **Genre-specific scoring** — DNA score, sidechain, supersaw, energy curves (~10s)
4. **Stem separation + clash detection** — Demucs 4-stem split, frequency masking report (~10-20 min CPU)
5. **Reference track comparison** — Per-feature delta vs. uploaded reference (~60s)
6. **Genre profile gap analysis** — Percentile ranking vs. curated reference library (~5s)
7. **Arrangement advisor** — Section length, energy contrast, 8-bar rule, flow issues (~10s)

---

## How to run

```bash
# 1. Start local services (PostgreSQL, Redis)
docker compose -f docker/docker-compose.yml up -d

# 2. Install Python packages
pip install -r components/api/requirements.txt
pip install -r components/worker/requirements.txt
pip install -e components/analysis

# 3. Run DB migrations
alembic -c migrations/alembic.ini upgrade head

# 4. Start each process (separate terminals)
cd components/api    && uvicorn app.main:app --reload --port 8000
cd components/worker && celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo
cd components/frontend && npm install && npm run dev
```

Frontend: http://localhost:5173 | API docs: http://localhost:8000/docs

---

## How to develop with Claude

**Initial v1 build** (components are currently stubs):
```
/execute-prp PRPs/v1_ai_music_analyzer.md
```

**Build one component at a time:**
```
/execute-prp PRPs/v1_ai_music_analyzer.md --component api
/execute-prp PRPs/v1_ai_music_analyzer.md --component analysis
/execute-prp PRPs/v1_ai_music_analyzer.md --component worker
/execute-prp PRPs/v1_ai_music_analyzer.md --component frontend
```

**Adding features after v1 build:**
```
/new-feature    # guided interview → fills PRPs/source/INITIAL.md → generates + executes PRP
```
Or manually: edit `PRPs/source/INITIAL.md` → `/generate-prp` → `/execute-prp PRPs/<slug>.md`

---

## How to reopen this project in Claude Code

```
cd C:\claude-workspace\AIMusicAnalysisSite && claude
```
