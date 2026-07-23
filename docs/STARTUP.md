# SPECTR — Startup, Restart & Troubleshooting Guide

**This is the canonical document for starting, stopping, and restarting the local
dev stack.** It is written so that an AI agent (or a human on a bad day) can bring
the stack up reliably without rediscovering old problems. If startup guidance here
conflicts with another doc, this file wins; fix the other doc.

Related docs (do not duplicate their content here):
- `docs/runbook.md` — production operations (deploy.sh, VPS, prod compose)
- `docs/launch-checklist.md` — go/no-go gates for launch
- `CLAUDE.md` — component architecture, gotchas, validation gates

---

## 1. Stack map

| Service | What | Port | Entry point |
|---|---|---|---|
| Postgres 16 | Docker container | 5432 | `docker/docker-compose.yml` service `postgres` |
| Redis 7 | Docker container (dramatiq broker) | 6379 | `docker/docker-compose.yml` service `redis` |
| BFF | .NET 10 minimal API | 5000 | `components/bff/src/Spectr.Bff` — `dotnet run` |
| Worker | Python dramatiq consumer | none | `components/worker` — Procfile command below |
| Frontend v2 | Vite dev server (React 19) | 5174 | `components/frontend-spectr-v2` — `npm run dev` |
| allin1 | One-shot `docker run` per track (structure detection) | none | image `allin1:latest` (built from `docker/allin1`) |
| MinIO (optional) | S3-compatible storage, off by default | 9000/9001 | compose service `minio` |

Legacy v1 (being phased out, NOT part of normal startup): FastAPI `api` on :8000
(`cd components/api && uvicorn app.main:app --reload --port 8000`) and vanilla
`frontend-spectr` (also binds :5174 — see problem #12). Do not start these unless
explicitly working on v1.

Startup order matters: **Docker infra first** (postgres + redis healthy), then
migrations, then BFF / worker / frontend in any order. All three apps are
DB/Redis-dependent at boot.

---

## 2. The one command (use this)

From the repo root, in PowerShell:

```powershell
./scripts/start-spectr.ps1
```

This is a full **restart**: it stops anything already running first, so it is safe
to run at any time and is the default answer to "start the app", "restart the
app", or "the stack is in a weird state".

What it does, in order:
1. **Stop apps** — BFF by port 5000 + `dotnet run` host by cmdline; worker via
   tree-kill of dramatiq masters + sweep of orphaned `multiprocessing-fork`
   children (see problem #3); frontend by port 5174.
2. **Start infra** — `docker compose up -d postgres redis` ONLY (never the
   compose app services, which need `JWT_KEY` + image builds). Waits up to 60 s
   for both healthchecks.
3. **Preflight** — Docker reachable + TCP probes to localhost:5432 and :6379
   from the host. On failure the apps are NOT launched (exit code 1).
4. **EF migrations** — `dotnet ef database update` (BFF owns the schema).
5. **Job recovery** — `scripts/recover-jobs.ps1` fails jobs the killed worker
   abandoned (`processing` → `failed`, `error_code=worker_unavailable`).
   `pending` jobs are left alone — their Redis messages resume on worker start.
6. **Launch** BFF, worker, frontend, each in its own `-NoExit` PowerShell window
   with live logs. Close a window to stop that one service.

Flags:

| Flag | Effect |
|---|---|
| `-StopOnly` | Stop apps + infra, don't relaunch. The clean "shut it all down". |
| `-SkipInfra` | Don't touch Docker (preflight still validates ports 5432/6379) |
| `-RecreateInfra` | `compose down` (volumes preserved) then `up -d` — fresh containers |
| `-SkipMigrations` | Skip `dotnet ef database update` |
| `-SkipRecovery` | Skip orphaned-job recovery |

Environment overrides: `$env:SPECTR_PYTHON` — absolute path to a specific
`python.exe` (e.g. a venv's); the launcher uses it for BOTH the dependency
import check and the worker window. Set it when the PATH `python` is not the
one with the worker deps installed.

Exit code 0 = clean; 1 = at least one component failed (details printed in red).

---

## 3. Fresh machine / first run

Prerequisites: Docker Desktop, .NET 10 SDK + `dotnet tool install --global dotnet-ef`,
Node 20+, Python 3.11 (venv strongly recommended).

One-time installs (order matters — `shared` first):

```bash
pip install -e components/shared
pip install -e components/analysis
pip install -r components/worker/requirements.txt
cd components/frontend-spectr-v2 && npm install
```

Install into the interpreter the launcher will use (the PATH `python`, or set
`$env:SPECTR_PYTHON`). The launcher refuses to start the worker if that
interpreter cannot `import dramatiq, audio_analysis` — and prints the fix.

Optional but recommended for full analysis output: build the allin1 image
(~10 min, ~4 GB) — without it, phase-1 structure detection is unavailable and
Phase 7 arrangement stays "not assessed" (see problem #10):

```bash
docker build -t allin1:latest docker/allin1
```

---

## 4. Manual boot (when you need one component at a time)

```powershell
# 1. Infra — postgres + redis only
docker compose -f docker/docker-compose.yml up -d postgres redis

# 2. Schema (run with the BFF stopped — file locks)
cd components/bff
dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff

# 3. BFF (:5000) — Development env is REQUIRED (see problem #11)
cd components/bff/src/Spectr.Bff
$env:ASPNETCORE_ENVIRONMENT='Development'; dotnet run

# 4. Worker — the FULL Procfile form is canonical (short forms drop the queue set)
cd components/worker
python -m dramatiq app.dramatiq_app --processes 1 --threads 1 --queues coach analysis-paid analysis-free maintenance

# 5. Frontend (:5174)
cd components/frontend-spectr-v2
npm run dev
```

To stop components manually, prefer `./scripts/start-spectr.ps1 -StopOnly`.
If you must kill the worker by hand, NEVER just kill the process whose cmdline
contains "dramatiq" — that orphans its fork (problem #3). Tree-kill instead:

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'dramatiq' } |
  ForEach-Object { taskkill /F /T /PID $_.ProcessId }
# then sweep orphans from previous bad kills:
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'multiprocessing-fork' -and
                 -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } |
  Stop-Process -Force
```

---

## 5. Verifying the stack is actually up

Do all of these before declaring success — several failure modes look "up":

1. **Frontend**: `curl -f http://localhost:5174` (or open it).
2. **BFF**: `curl -f http://localhost:5000/healthz` (liveness) and
   `http://localhost:5000/openapi/v1.json`. Dev-only aggregate:
   `GET /api/health/full` (DB, Redis, storage, worker heartbeat).
   In the BFF boot log, eyeball `S3 configured: {bool}` and the resolved
   `Storage:LocalRoot` (must point at the repo's `data/`, not `components/data/`).
3. **Worker**: in its window, find the single `Boot config:` line — check
   redis host:port, the four queues, and `storage_root=` (must be the repo
   `data/` path — NEVER `/data` on a native run, problem #7).
4. **Worker is CONSUMING, not just alive**: a fresh heartbeat does not prove
   consumption (problem #3). If jobs are queued, confirm the queue is draining:

   ```powershell
   docker compose -f docker/docker-compose.yml exec redis redis-cli LLEN dramatiq:analysis-paid
   docker compose -f docker/docker-compose.yml exec redis redis-cli LLEN dramatiq:analysis-free
   ```

   Numbers should trend to 0 within seconds. `GET /api/health/worker` reports
   heartbeat age + queue depth but can be fooled by a half-dead worker.
5. **End-to-end**: upload a track; a healthy worker takes an ~8-min track
   through all phases in ~75 s (structure detection continues in background).
6. Frontend shell shows the DevHealthDot (dev builds) — red means a probe failed.

---

## 6. Common problems (all previously encountered — check here FIRST)

### #1 Bare `docker` silently no-ops in PowerShell
A 0-byte extensionless `C:\WINDOWS\system32\docker` shadows the real CLI on this
box. In a pipeline, bare `docker …` is treated as a document and does nothing
(`$LASTEXITCODE` unset; or "Cannot run a document in the middle of a pipeline").
**Fix**: resolve explicitly — `$d = (Get-Command docker.exe).Source; & $d compose …`.
`start-spectr.ps1` already does this; do the same in any ad-hoc command.

### #2 Ports 5000/5432/6379 squatted by a dead PID → reboot
When the WSL2/Docker Desktop backend wedges, a dead `wslrelay.exe` leaves zombie
`[::1]:<port>` LISTEN sockets on 5000/5432/6379 (one dead PID owns all three;
`Get-NetTCPConnection` shows a LISTEN whose PID `Get-Process` can't find).
Nothing clears them — not `wsl --shutdown`, not killing WSLService, not bouncing
WinNAT. **Only a reboot fixes it.** Docker is ALSO down in this state, so IPv4
workarounds are pointless (Postgres/Redis are gone too). Recovery: reboot →
start Docker Desktop → `./scripts/start-spectr.ps1`.

### #3 Half-dead worker: heartbeat fresh, queue not draining
The dramatiq worker is TWO processes: a master (`python -m dramatiq …`) and a
child forked via multiprocessing whose cmdline contains `--multiprocessing-fork`
but NOT "dramatiq". Killing only the master orphans the child, which keeps
refreshing `dramatiq:__heartbeats__` while consuming nothing. Symptoms: uploads
stuck at "pending 0%" forever; fix-rack GET returns 204 forever; health endpoint
says healthy. **Fix**: `./scripts/start-spectr.ps1` (its stop phase tree-kills
masters and sweeps orphans), or the manual tree-kill in section 4. The restarted
worker recovers the unacked backlog automatically.

### #4 Uploads stuck at `pending`, empty `final_json` → worker not running
If a new job sits at `status: pending`, `current_phase: ""`, the worker is down
or half-dead (#3). Confirm: `LLEN dramatiq:analysis-paid` / `analysis-free`
non-zero and NOT draining. Restart via the launcher. Note tier routing:
pro/credits jobs → `analysis-paid`, free/anon → `analysis-free`.

### #5 `dotnet build` fails: file lock on `Spectr.Bff.exe`
A BFF instance is still running and holds `bin/Debug/net10.0/Spectr.Bff.exe`.
**Fix**: `./scripts/start-spectr.ps1 -StopOnly` (kills by port AND the
`dotnet run` host by cmdline), then build.

### #6 Launcher refuses to start the worker (import check)
`python` on PATH cannot `import dramatiq, audio_analysis` (the system python
typically can't). **Fix**: install the deps into that interpreter (section 3),
or point `$env:SPECTR_PYTHON` at the prepared venv's `python.exe`. The launcher
intentionally fails loud here rather than opening a worker window that dies
instantly.

### #7 Every job fails file resolution / uploads "vanish"
The worker's `storage_root` is wrong. `/data` is valid ONLY inside the compose
container; a native Windows run must use the absolute repo path. The committed
`components/worker/.env` pins `STORAGE_LOCAL_ROOT=C:/Users/badmin/projects/AIMusicAnalysisSite/data`
— **machine-specific**: on a different clone path, update it (or delete the line;
the built-in default resolves the repo `data/`). Check the worker's boot
`storage_root=` line; it warns if the directory doesn't exist.

### #8 Worker fork dies silently after audio work (OpenMP abort)
librosa (numba) and torch/demucs each ship an OpenMP runtime; loading both in
one process aborts it ("OMP: Error #15 … libiomp5md.dll already initialized") —
no traceback, master left half-alive, queue stops draining (looks like #3).
**Fix (already in `components/worker/.env` — do not remove)**:
`KMP_DUPLICATE_LIB_OK=TRUE`, `OMP_NUM_THREADS=1`, `MKL_NUM_THREADS=1`,
`NUMBA_NUM_THREADS=1`.

### #9 Old Redis backlog replays on worker start
After a dead-worker period the dev Redis can hold hundreds of stale messages
that all replay at once. The launcher's recovery step fails orphaned
`processing` jobs; if you need a full purge (dev only — destroys ALL queued
jobs): `docker compose -f docker/docker-compose.yml exec redis redis-cli FLUSHDB`.

### #10 Analysis output thin / arrangement stuck "analyzing" or "not assessed"
Structure detection runs allin1 in a Docker container (`allin1:latest`), not
in-process. If Docker is down or the image isn't built, Phase 7 arrangement is
"not assessed" (non-fatal, rest of the analysis is fine). Build:
`docker build -t allin1:latest docker/allin1`. CPU runs take ~6-7 min per full
track in the background (deferred — doesn't block the main pipeline); timeout is
env-tunable via `ALLIN1_TIMEOUT` (default 1800 s). `ALLIN1_USE_GPU=1` for GPU.

### #11 BFF must run with `ASPNETCORE_ENVIRONMENT=Development`
`appsettings.json` deliberately carries no signing keys; dev keys live in
`appsettings.Development.json`. Non-Development environments refuse to boot
without real keys, and dev-only endpoints (e.g. `/api/auth/dev-login`) 404.
`dotnet run` picks Development up from `Properties/launchSettings.json`, but
**passing `--urls` on the command line bypasses the launch profile and flips
you to Production** — if you need a custom URL, set `$env:ASPNETCORE_URLS`
plus `$env:ASPNETCORE_ENVIRONMENT='Development'` instead.

### #12 Port 5174 collision: legacy frontend vs v2
Legacy `components/frontend-spectr` ALSO binds 5174 (proxying to :8000). If the
wrong frontend answers on 5174, you'll see the old UI or dead `/api` calls.
Only one can run; the launcher's stop phase kills whatever holds 5174. Don't
start the legacy frontend unless working on v1.

### #13 Coach shows "offline" while using the Claude CLI
With `USE_CLAUDE_CLI=1` (subscription auth, dev-only) the LLM spend gate is
bypassed, but a stale `analyses.degradation_notice` with `reason='tier_budget'`
makes the BFF return `coach_offline` before the worker is touched. Diagnose:
`SELECT degradation_notice::text, count(*) FROM analyses WHERE degradation_notice IS NOT NULL GROUP BY 1`.
Clear stale rows:
`UPDATE analyses SET degradation_notice = NULL WHERE degradation_notice->>'reason'='tier_budget'`.
Also note: coach STREAMING is SDK-only — it needs a real `ANTHROPIC_API_KEY`
even in CLI mode; specialist verdicts work via the CLI.

### #14 Compose refuses even `down` without JWT_KEY
The compose file substitutes `${JWT_KEY}` for its app services, so bare
`docker compose -f docker/docker-compose.yml down` can fail on a machine with
no root `.env`. **Fix**: root `.env` (from `.env.example`) or prefix inline:
`$env:JWT_KEY='devkey'; docker compose -f docker/docker-compose.yml down`.
The launcher avoids this entirely by naming `postgres redis` explicitly.

### #15 `dotnet ef database update` warns `PendingModelChangesWarning`
Entity edits exist with no migration scaffolded yet. The applied schema is
current; EF just refuses to validate the drifted model. Non-fatal — the
launcher warns and continues. Scaffold when ready:
`dotnet ef migrations add <Name> --project src/Spectr.Data --startup-project src/Spectr.Bff`.

### #16 Legacy uvicorn orphans holding :8000 (v1 only)
`uvicorn --reload` spawns a child via `multiprocessing.spawn`; killing the
parent leaves the child on the port, and `Get-Process` can't see spawn workers.
Use `tasklist` + WMI (`Get-CimInstance Win32_Process`) to find and kill both.

---

## 7. Environment / config reality map

A fresh clone boots with working defaults; `.env` files are only needed for
non-default settings. Who reads what:

| Consumer | Reads | Notes |
|---|---|---|
| BFF | `appsettings.json` + `appsettings.Development.json` + `Properties/launchSettings.json` | Does NOT read any `.env`. Shell env vars in double-underscore form (`Jwt__Key`, `Storage__LocalRoot`) override. |
| Worker | `components/worker/.env` (dotenv, loaded by `app/dramatiq_app.py`) | This repo has a committed one: machine-specific `STORAGE_LOCAL_ROOT` (#7), OpenMP stability block (#8), `USE_CLAUDE_CLI=1` + `LLM_FAKE=0` (dev LLM via Claude CLI subscription). `LLM_FAKE=1` = canned replies, zero spend. |
| docker compose | root `.env` (`${VAR}` substitution) | `JWT_KEY` etc. Needed for compose app services and even `down` (#14). Root `.env.example` is the canonical secret inventory. |
| Frontend v2 | `.env.local` (optional) | All optional in dev. |

Other startup-relevant env: `$env:SPECTR_PYTHON` (launcher's worker
interpreter), `TORCH_HOME=data/models` (model cache location),
`ALLIN1_TIMEOUT` / `ALLIN1_USE_GPU` (#10).

Dev conveniences already on in Development: `Auth:DevAutoVerify` (registration
auto-verifies; verification links also print to the BFF console).

**MinIO / S3 is strictly optional.** Default is local-disk storage: with all
`Storage__S3__*` unset the BFF answers 501 `presigned_unavailable` and the
frontend transparently uses the proxy upload path. To exercise the presigned
path: `docker compose -f docker/docker-compose.yml up -d minio` and set the
`Storage__S3__*` vars (root `.env.example`; `ServiceUrl` is the on/off switch).
S3 configured but MinIO down returns a typed 503 `storage_unreachable` and the
client falls back to the proxy path — uploads keep working, but you're then
testing the proxy path, not the presigned one.

---

## 8. Production

Not covered here — see `docs/runbook.md` (`./deploy.sh <sha>` / `redeploy` /
`rollback`, `infra/compose.prod.yml`, boot-time EF migrations, two-pool worker
topology W1 `worker-paid` / W2 `worker-free`). Note `docker/docker-compose.prod.yml`
is only a DEV prod-parity overlay for the queue split — the real prod stack is
`infra/compose.prod.yml`.
