# Development Guide

The canonical, always-current startup/restart/troubleshooting guide is
**[STARTUP.md](STARTUP.md)** — per project rules, boot knowledge lives ONLY
there. This file adds the development workflow around it.

## Prerequisites

Docker Desktop, .NET 10 SDK + `dotnet-ef` global tool, Node 20+, Python 3.11
(venv recommended). One-time installs and the full boot procedure: STARTUP.md
sections 2-4.

## Daily loop

```powershell
./scripts/start-spectr.ps1        # full stack restart (safe anytime)
./scripts/start-spectr.ps1 -StopOnly
```

Frontend http://localhost:5174 · BFF http://localhost:5000 (OpenAPI at
`/openapi/v1.json`) · verify per STARTUP.md section 5.

## Validation gates (run before committing)

```bash
# BFF
cd components/bff && dotnet build && dotnet test

# Frontend v2 — all four gates must pass
cd components/frontend-spectr-v2
npx tsc --noEmit && npm run lint && npm run build && npx vitest run

# Python
ruff check components/api/ components/analysis/src/ components/worker/ components/shared/
pytest -q components/analysis/tests/
pytest -q components/worker/tests/     # known flaky vs DB env; tests/llm/ subset is hermetic
pytest -q components/shared/tests/
```

## Schema changes

EF Core (components/bff/src/Spectr.Data) is canonical: entity + migration
first (`dotnet ef migrations add <Name> --project src/Spectr.Data
--startup-project src/Spectr.Bff`), then mirror in
`components/shared/aimusic_shared/models.py`. Apply locally with the launcher
or `dotnet ef database update` (BFF stopped). Legacy Alembic is frozen.

## Conventions that bite

- Frontend: TS strict + `verbatimModuleSyntax` (`import type` mandatory); CSS
  Modules only (no Tailwind); `fetcher.ts` for HTTP (no axios); access token
  never in localStorage.
- Worker: actors are sync `def`; queues are pinned (no `default`); sessions
  via `db_sync.py`.
- Analysis: `numpy<2.0` pin; convert to WAV 44.1 kHz before analysis;
  pyloudnorm needs `(samples, channels) float64`.
- Dev LLM: `components/worker/.env` sets `USE_CLAUDE_CLI=1` (subscription CLI,
  no API key); `LLM_FAKE=1` for zero-spend canned replies.
- Planning/workflow: features go through the PRP flow (`PRPs/` — see
  `PRPs/README.md`); CLAUDE.md carries per-component gotchas.

## Where things are

See `source-tree-analysis.md` (annotated tree + "critical folders for common
tasks") and `index.md` for the full documentation map.
