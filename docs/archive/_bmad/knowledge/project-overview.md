# Project Overview — AI Music Analyzer

## Purpose

A music producer web app where users register, log in, upload audio files (MP3, FLAC, WAV up to 200 MB), and receive a comprehensive 7-phase analysis report with mix scores, genre detection, streaming readiness checks, stem clash detection, arrangement advice, and AI-powered specialist coaching.

## Architecture Summary

| Property | Value |
|----------|-------|
| **Repository type** | Monorepo — 5 components |
| **Primary language** | Python 3.11 (backend, pipeline, worker) + TypeScript/React 19 (frontend) |
| **Architecture pattern** | API-first, async job queue, SSE streaming |
| **Database** | PostgreSQL 15 |
| **Message broker** | Redis 7 |
| **ML runtime** | CPU (GPU optional for Demucs) |

## Components

| Component | Type | Entry point | Port |
|-----------|------|-------------|------|
| `components/api` | FastAPI REST API | `uvicorn app.main:app --port 8000` | 8000 |
| `components/analysis` | Python library (installable) | `pip install -e components/analysis` | — |
| `components/worker` | Celery task worker | `celery -A app.celery_app worker` | — |
| `components/frontend` | React 19 SPA | `npm run dev` | 5173 |
| `components/frontend-spectr` | React 18 SPA (alternate UI) | `npm run dev` | 5174 |

## Tech Stack Summary

### Python Backend (api + worker + analysis)
- **FastAPI** ≥ 0.115 — async REST API
- **SQLAlchemy 2.0** + **asyncpg** — async ORM (API)
- **psycopg2-binary** — sync driver for Alembic migrations
- **Alembic** — schema migrations (3 migrations: 001 initial, 002 share_token, 003 track_name)
- **Pydantic v2** + **pydantic-settings** — validation and config
- **PyJWT** — JWT auth (HS256, access + refresh tokens)
- **bcrypt** — password hashing
- **aiofiles** — chunked async file I/O
- **Celery** ≥ 5.3 + **Redis** — async task queue
- **Anthropic SDK** ≥ 0.40 — AI expert analysis (Claude)
- **librosa** ≥ 0.11, **pyloudnorm**, **scipy**, **numpy** < 2.0 — audio analysis
- **demucs** ≥ 4.0 (optional), **torch** ≥ 2.0 — stem separation

### Frontend (components/frontend)
- **React 19** + **Vite 8** + **TypeScript** (strict)
- **React Router v7** — SPA routing
- **Tailwind CSS v3** — utility styling
- **shadcn/ui** (Radix UI primitives) — component library
- **Recharts** — data visualization (BarChart, RadarChart, LineChart)
- **Axios** — HTTP client with auto-refresh interceptor
- **react-markdown** — expert analysis rendering
- **lucide-react** — icons

### Frontend Spectr (components/frontend-spectr)
- **React 18** + **Vite 6** + **JavaScript** (no TypeScript)
- No external UI library — inline styles + CSS variables
- Web Audio API — waveform decoding
- Native Fetch API + XHR for upload

### Infrastructure
- **PostgreSQL 15-alpine** — primary database (port 5432)
- **Redis 7-alpine** — Celery broker + result backend (port 6379)
- **Docker Compose** — local dev infrastructure

## Key Features (v1.1)

- **7-phase audio analysis pipeline**: LUFS/loudness, genre detection, genre-specific scoring, stem separation + clash detection, reference track comparison, genre gap analysis, arrangement advice
- **Streaming readiness**: Spotify, Apple Music, YouTube, Tidal, Amazon Music, SoundCloud, Beatport LUFS checks + True Peak + clipping detection
- **Coach persona**: Template-based natural-language coaching tips (up to 5 per analysis)
- **Danceability score**: 0–100, genre-aware (BPM 40%, rhythm density 40%, low-energy 20%)
- **AI Mix Experts**: 23 specialist Claude-powered deep-dives streamed via SSE
- **Shareable reports**: Public share link via UUID token
- **Analysis history**: Table of all past jobs with score/grade
- **Track version history**: Recharts LineChart tracking score across multiple uploads of the same track
- **Alternate UI**: `frontend-spectr` provides a richer, waveform-player-focused report view

## Operational Notes

- Workers run at `--concurrency=1` (Demucs is memory-heavy)
- Phase 4 (Demucs stem separation) takes 10–20 min on CPU for a 5-min track
- Phase 7 (all-in-one-fix arrangement detection) requires Docker on Windows
- `numpy<2.0` hard pin — never loosen
- PyJWT only — never `python-jose`
- `expire_on_commit=False` required on SQLAlchemy async_sessionmaker
- DB schema: two URLs — `asyncpg` for app, `psycopg2` for Alembic
