# SPECTR dev setup

Fresh-clone to running stack, and the env-file reality map. Operational
runbook (prod): `docs/runbook.md`. Component detail + validation gates:
`CLAUDE.md`. Story: 12.3 (audit finding P1-5).

## Prerequisites

- Docker Desktop (postgres + redis containers; also allin1 structure detection on Windows)
- .NET 10 SDK (`dotnet`), plus the EF tool: `dotnet tool install --global dotnet-ef`
- Node 20+ (`npm`)
- Python 3.11 (a venv is strongly recommended)

One-time installs:

```bash
# Python packages — shared MUST come first
pip install -e components/shared
pip install -e components/analysis
pip install -r components/worker/requirements.txt

# Frontend deps
cd components/frontend-spectr-v2 && npm install
```

The worker window launched by the start script uses the `python` on PATH —
install the worker deps into that interpreter (or activate the venv before
launching). The launcher fails loudly if `python` cannot
`import dramatiq, audio_analysis` (story 12.2).

## One-command boot

```powershell
./scripts/start-spectr.ps1
```

What it does, in order: stop any running SPECTR components → start Docker
infra (postgres + redis only — NOT MinIO, NOT the app compose services) →
preflight (Docker reachable + TCP 5432/6379 accept connections; on failure
the apps are NOT launched and the summary exits red — story 12.3) → apply EF
Core migrations → recover jobs orphaned by the killed worker → launch BFF,
worker, and frontend in three PowerShell windows.

Flags: `-StopOnly` (teardown), `-SkipInfra` (leave Docker alone; preflight
still validates the ports), `-RecreateInfra` (compose down + up, volumes
preserved), `-SkipMigrations`, `-SkipRecovery`.

## Manual boot order

```bash
# 1. Infra
docker compose -f docker/docker-compose.yml up -d postgres redis

# 2. Schema (BFF owns it via EF Core)
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff

# 3. Apps, each in its own terminal
cd components/bff/src/Spectr.Bff && dotnet run                                   # :5000 (Development env required)
cd components/worker && python -m dramatiq app.dramatiq_app --processes 1 --threads 1 --queues coach analysis-paid analysis-free maintenance
cd components/frontend-spectr-v2 && npm run dev                                  # :5174
```

The BFF must run in the Development environment (story 4.1): `dotnet run`
picks it up from `Properties/launchSettings.json`; outside that, set
`ASPNETCORE_ENVIRONMENT=Development`. Production-shaped environments refuse
to boot without real signing keys.

## Env-file reality map

A fresh clone has NO `.env` anywhere — only `.env.example` files — and that
is fine for local dev. Every component boots with working defaults. Who reads
what:

| Consumer | Reads | Notes |
|---|---|---|
| BFF (ASP.NET) | `appsettings.json` + `appsettings.Development.json` + `Properties/launchSettings.json` | Does NOT read any `.env`. Dev signing keys live in the Development json. Env vars in double-underscore form (`Jwt__Key`) override config if set in the shell. |
| Worker (python) | `components/worker/.env` if present (dotenv, loaded by `app/dramatiq_app.py`) | Copy from `components/worker/.env.example` only when you need non-default DB/Redis/LLM settings. WARNING: never set `STORAGE_LOCAL_ROOT=/data` on a native run — that value is compose-only (see below). |
| docker compose | root `.env` (its own `${VAR}` substitution) | Needed for the compose-run app services and prod, not for the native dev loop. The root `.env.example` is the canonical secret inventory (AR40). |

Boot-config summaries to eyeball (story 12.2/12.3): the BFF logs
`S3 configured: {bool}` plus its resolved `Storage:LocalRoot` at startup; the
worker logs one `Boot config:` line with `LLM_FAKE`, redis host:port, queues,
and its resolved `storage_root=` + `results_dir=` (and warns if the root
directory does not exist — the classic symptom of a compose-only
`STORAGE_LOCAL_ROOT=/data` leaking into a native run).

## Email verification in dev (story 12.1)

`Auth:DevAutoVerify` is on in Development: registration auto-verifies, so the
second-analysis verify gate (403 `email_verification_required`) never blocks
local dev. The verification link is also printed to the BFF console for
staging-like testing of the resend/banner UX.

## LLM spend

`LLM_FAKE=1` is the dev default: canned verdict/coach replies, no network,
zero API spend. Set `LLM_FAKE=0` plus `ANTHROPIC_API_KEY` (worker env) to hit
the real API. Budget ceilings: `components/worker/.env.example`.

## MinIO / S3 (strictly optional)

Default is local-disk storage — all `Storage__S3__*` unset means the BFF
answers 501 `presigned_unavailable` and the frontend uses the proxy upload
path transparently. To exercise the presigned path:

```bash
docker compose -f docker/docker-compose.yml up -d minio
```

and set the `Storage__S3__*` env vars for the BFF (see root `.env.example`;
`ServiceUrl` is the on/off switch). Since story 12.3, S3 configured but MinIO
down returns a typed 503 `storage_unreachable` and the client falls back to
the proxy path — uploads keep working, but you are then testing the proxy
path, not the presigned one.

## Health checks

- `GET /healthz` — liveness.
- `GET /api/health/full` — dev-only aggregate (DB, Redis, storage, worker heartbeat).
- DevHealthDot — dev-only status dot in the frontend shell header (story 12.2), red on probe failure.

## Troubleshooting

- **Launcher refuses to start the worker** — the PATH `python` cannot import
  `dramatiq`/`audio_analysis`. Install worker deps into that interpreter or
  activate the right venv first (the system python typically cannot import
  `audio_analysis`).
- **`dotnet build` fails with a file lock on `Spectr.Bff.exe`** — a BFF is
  still running. `./scripts/start-spectr.ps1 -StopOnly` (or stop the PID).
- **Worker seems alive but nothing processes** — orphaned
  `multiprocessing-fork` python whose dramatiq master died keeps the
  heartbeat fresh. The start script's stop phase sweeps these; run
  `-StopOnly` then start again.
- **Uploads "vanish" / jobs fail file resolution** — check the worker's boot
  `storage_root=` line. If it says `/data` on a native Windows run, delete
  `STORAGE_LOCAL_ROOT` from `components/worker/.env`.
- **Old queue backlog after a dead-worker period** — the dev Redis can carry
  hundreds of stale messages that replay on worker start (12.2 finding). The
  launcher's job recovery fails orphaned `processing` jobs; a full purge is
  `docker compose -f docker/docker-compose.yml exec redis redis-cli FLUSHDB`
  (dev only — nukes all queued jobs).
