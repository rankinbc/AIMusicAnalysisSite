# Story 12.2: Failure Visibility — Worker Health & Progress Storyline

Status: review

## Story

As a user waiting on an analysis,
I want stuck jobs to look different from healthy ones,
so that a dead worker never masquerades as 4 hours of progress.

## Background (audit evidence)

2026-07-10 full-app audit (`output/audit/2026-07-10_full-app-audit/findings.md` §1, P0-2):

- `scripts/start-spectr.ps1:309-315` warns-only when `python -c "import dramatiq"` fails, then opens a worker window that instantly errors. The launcher exits 0 and the summary shows green — a dead worker from minute zero.
- A stuck `pending` job is only failed after `PendingGraceMinutes` = 240 (`StaleJobReaper.cs`, `appsettings.json:32`). Until then the results page spinner is indistinguishable from healthy progress (`songs.$songId.results.$jobId.tsx:89-136` — bare status line + `<progress>` bar, no elapsed time, no phase storyline, no worker-down hint).
- Orphaned `multiprocessing-fork` "half-dead worker" hazard (heartbeat fresh, nothing draining) is already handled at stop-time by `Stop-Worker` (`start-spectr.ps1:143-175`) — do not re-solve.

**Already shipped — REUSE, do not reinvent (checkpoint 0d0f668, 2026-06-27):**

- `GET /api/health/worker` (`Endpoints/HealthEndpoints.cs`) — reads the max score of the `dramatiq:__heartbeats__` ZSET (written by dramatiq's Redis broker automatically; the worker needs no code), compares against `WorkerOptions.HeartbeatStaleSeconds` (60), returns `WorkerHealthDto(Healthy, LastHeartbeatAgeSeconds, QueueDepth)`.
- Frontend `useWorkerHealth()` (`api/hooks.ts:447`, 30s/10s adaptive poll) + `AppWorkerHealthNotice` + `WorkerHealthBanner` (`features/health/`) mounted in the `_app.tsx` shell (`:202`) — the global "worker offline" banner EXISTS. This story adds the per-job storyline + aggregation, not another banner.
- `StaleJobReaper` (`Services/StaleJobReaper.cs`) with the NFR16 split predicate (processing vs pending) and the `Max(PendingGraceMinutes, StaleJobMinutes)` clamp at `:67-68`.
- `JobStatusDto` already carries `CurrentPhase`, `PhasePct`, `DispatchedAt`, `StartedAt` (`DTOs/JobDtos.cs`) — elapsed time is computable client-side with zero backend change. Worker persists display-ready phase names (`pipeline.py` `PHASE_DEFS`: "Universal Mix Analysis", "Genre Detection", "Genre-Specific Scoring", "Stem Separation & Clash", "Reference Comparison", "Gap Analysis", "Arrangement Advice"; phase 8 ALS conditional, phase 9 "Mix Translation"; plus sentinels `queued`/`starting`/`complete`/`failed`).
- `/healthz` (`Program.cs:564-586`) — postgres + redis with 3s hard timeouts; it is the story-10.1 deploy smoke + external probe. Its 200/503 semantics MUST NOT change.
- Boot-validation precedent: `RequireSigningKey` (`Program.cs:48-72`) + the `App:FrontendOrigin` / `Admin:ApiKey` boot checks (`:84-97`).

## Acceptance Criteria

1. **Given** the worker launcher (`start-spectr.ps1`), **When** `import dramatiq` or `import audio_analysis` fails in the resolved `python`, **Then** the launcher fails loudly — red `Fail` entry (non-zero exit via the existing `$script:Errors` path), worker window NOT opened with a doomed command — never a warn-and-continue.
2. **Given** Development, **Then** an orphaned `pending` job (no live worker heartbeat) is failed by the reaper after ~5 minutes instead of 240 — without letting a merely-busy worker's queued jobs be false-failed (see Dev Notes: heartbeat-aware grace).
3. **Given** a job in progress, **Then** the results page narrates per-phase progress (phase storyline with the current phase highlighted) plus elapsed time, and shows an escalating hint: immediately when `useWorkerHealth` reports offline ("worker appears to be down"), and after a threshold of no progress ("taking longer than usual").
4. **Given** `GET /api/health/full` (new, anonymous, same group as `/api/health/worker`), **Then** it aggregates postgres / redis / worker-heartbeat / storage in one JSON with short per-probe timeouts, and the app shell shows a small status indicator in dev builds only (`import.meta.env.DEV`).
5. **Given** BFF boot, **Then** one Information-level startup summary logs the environment plus boolean config state — S3 configured?, Resend configured?, Stripe configured?, RateLimits enabled?, DevAutoVerify?, Worker reaper knobs, resolved `Storage:LocalRoot` — booleans/paths only, never secret values. The worker's boot (`dramatiq_app.py`) logs its own one-liner for worker-owned knobs (`LLM_FAKE`, metrics on?, queues consumed).

## Tasks / Subtasks

- [x] Task 1: Fail-loud launcher (AC: 1)
  - [x] `start-spectr.ps1` `Start-Apps` worker branch (`:308-318`): replace the warn with `python -c "import dramatiq, audio_analysis"` (still `2>$null`); on non-zero `$LASTEXITCODE`, capture the actual import error (re-run without suppression into a variable), `Fail` with it + the pip hint (`pip install -r components/worker/requirements.txt` and `pip install -e components/shared components/analysis`), and `return` from the worker branch WITHOUT `Start-InWindow` — the summary + `exit 1` machinery (`:334-372`) already exists.
  - [x] Keep BFF/frontend launches unaffected (a broken worker venv must not block frontend work); the red summary + exit 1 is the loud part.
  - [x] Note in the window-title era: `Show-Summary` should mention "Worker NOT started" when that Fail fired (it already lists `$script:Errors`; verify wording is self-explanatory).
- [x] Task 2: Heartbeat-aware pending grace (AC: 2)
  - [x] Add `WorkerOptions.PendingNoWorkerGraceMinutes` (default **240** = today's behavior; XML-doc the semantics). `appsettings.Development.json` gets `"Worker": { "PendingNoWorkerGraceMinutes": 5 }`.
  - [x] Extract the heartbeat read (max ZSET score → age seconds) from `HealthEndpoints.GetWorkerHealth` into a small shared service (e.g. `WorkerHeartbeat` with `Task<long?> AgeSecondsAsync()`), consumed by both the endpoint and the reaper — single source for the ZSET key + max-score rule.
  - [x] `StaleJobReaper.ReapAsync`: pending predicate becomes two-tier — (a) existing long grace always applies (clamped as today); (b) ADDITIONALLY, when the heartbeat is stale/absent (`age is null || age >= HeartbeatStaleSeconds`), pending jobs older than `PendingNoWorkerGraceMinutes` are failed. The short tier is NOT clamped by `StaleJobMinutes` (a dead worker can't be "still working on it"); the existing clamp on the long tier stays byte-identical.
  - [x] Redis read failure in the reaper = treat heartbeat as UNKNOWN → long-grace path only (fail-safe: never fast-fail on a probe error). Reaper keeps working if Redis is down (it's EF-only today — the heartbeat probe must be try/catch'd).
  - [x] Error message for the short tier can reuse the existing `worker_unavailable` code/message (the UI path is already wired for it).
  - [x] Tests: extend `StaleJobReaperTests` (constructor gains the heartbeat dependency — use a stub returning fresh/stale/null): pending young + stale heartbeat → survives; pending > 5 min + stale heartbeat → failed; pending > 5 min + FRESH heartbeat → survives (busy-worker case); processing behavior unchanged; heartbeat probe throws → long-grace only.
- [x] Task 3: Progress storyline on the results page (AC: 3)
  - [x] Replace `PhaseProgress` in `songs.$songId.results.$jobId.tsx` with a `ProgressStoryline` component (new file under `features/results/`): ordered phase list (the 7 base names above; render unknown/extra `currentPhase` values as an appended row so ALS phase 8 / Mix Translation / sentinel names never break it), current phase highlighted, completed phases checked (derive from `phasePct` + name match), overall `<progress>` retained.
  - [x] Elapsed time: tick from `startedAt ?? dispatchedAt` (client-side `useEffect` interval; `mono` class per style rules). Job polling already runs at 2s (`useJob`).
  - [x] Escalation hints (both keyed on real signals, not just time): (a) `useWorkerHealth().data?.healthy === false` → immediate "The analysis worker appears to be down — this job will resume or fail shortly." (reuses the shared 30s poll cache; do NOT add a new poll); (b) elapsed > threshold (10 min default; constant, not config) OR `status === 'pending'` for > 2 min → "Taking longer than usual." Include queueDepth when offline (the DTO carries it).
  - [x] Vitest: static renders for the states — pending+healthy, processing mid-phase, worker-offline hint, long-elapsed hint, unknown phase name tolerated.
- [x] Task 4: Aggregated health endpoint + dev shell indicator (AC: 4)
  - [x] `HealthEndpoints.cs`: add `GET /api/health/full` (same anonymous group): `{ status: "ok"|"degraded", checks: { postgres: bool, redis: bool, worker: { healthy, lastHeartbeatAgeSeconds, queueDepth }, storage: { mode: "local"|"s3", ok: bool } } }`. Probe patterns copied from `/healthz` (3s `CancellationTokenSource` / `WaitAsync` hard timeouts, catch-all per probe). `status` is "degraded" if postgres or redis fail; worker/storage state is informational (does NOT drive an HTTP 503 — this endpoint always returns 200 with the JSON so the frontend can render partial state; document that distinction vs `/healthz` in the XML-doc).
  - [x] Storage probe: local mode (`IMultipartObjectStore.IsConfigured == false`) → `Directory.Exists` on the resolved `Storage:LocalRoot`; S3 mode → `ObjectExistsAsync("healthcheck-probe", ct)` with the short timeout (a 404/`false` result still proves reachability — only a thrown connection error marks `ok:false`).
  - [x] Do NOT touch `/healthz` (`Program.cs:564`) — story-10.1 deploy contract.
  - [x] Frontend: tiny `DevHealthDot` (new, `features/health/`) polling `/health/full` at ~30s, gated `import.meta.env.DEV` at the call site in `_app.tsx` (nav area, next to the existing shell slots) — dot tone green/amber/red via the global `.dot[.tone]` utility classes, tooltip/title listing failing checks. Zero footprint in prod builds (conditional render keeps the query unmounted).
  - [x] Tests: BFF integration test for `/api/health/full` shape (postgres+redis up in the dev stack → ok; storage local mode ok). Vitest static render for the dot's three tones.
- [x] Task 5: Boot config summaries (AC: 5)
  - [x] BFF `Program.cs`, right after `var app = builder.Build()` (near the existing boot checks): one `app.Logger.LogInformation` block logging: environment name, `S3 configured: {bool}` (`S3StorageOptions.IsConfigured`), `Resend configured: {bool}` (`ResendOptions.IsConfigured`), `Stripe configured: {bool}` (`StripeOptions.IsConfigured`), `RateLimits enabled: {bool}`, `Auth:DevAutoVerify: {bool}`, `Worker: stale={m} pendingGrace={m} pendingNoWorker={m} heartbeatStale={s}`, `Storage:LocalRoot resolved: {absolute path}`. Booleans and paths ONLY — never key material (the RequireSigningKey precedent already screams if keys are bad; this summary is about the silent-degradation knobs).
  - [x] Worker `dramatiq_app.py`: after broker setup, `logging.getLogger(__name__).info(...)` one line: `LLM_FAKE={0|1}`, `WORKER_METRICS={0|1}`, `REDIS_URL host`, queues the process will consume. (Resolved storage-root logging is story 12-3 AC3 — leave it there to avoid double-implementation; do not log DATABASE_URL.)
- [x] Task 6: Validation gates (all)
  - [x] BFF: `dotnet build && dotnet test` (dev stack UP for real signal — suites silently no-op without Postgres, story 12-7).
  - [x] Frontend: `npx vite build` (routeTree.gen first), `npx tsc -b`, `npm run lint` + `lint:css`, `npx vitest run`.
  - [x] Worker (only `dramatiq_app.py` touched): `uvx ruff@0.15.11 check components/worker/` + `pytest -q components/worker/tests/`.
  - [x] Manual: `./scripts/start-spectr.ps1` with a deliberately broken venv (e.g. `pip uninstall dramatiq` in a scratch venv or rename) → red summary + exit 1, no worker window; then restore and verify full happy boot including both boot summaries.

## Dev Notes

### Verified code anchors (2026-07-10 — re-verify before large refactors)

- **Launcher:** `scripts/start-spectr.ps1` — worker branch `:308-318`; `Fail` helper `:76` appends `$script:Errors` → `Show-Summary` red list + `exit 1` (`:334-372`). `Stop-Worker` orphan-fork handling `:143-175` (leave alone). `Start-InWindow` `:275-292`.
- **Reaper:** `Services/StaleJobReaper.cs` — `ReapAsync` internal (unit-testable without the 60s timer); split predicate `:84-95`; clamp `:67-68`; `worker_unavailable` error code `:90` (deliberately ≠ `invalid_file` — credit-reversal trigger; keep it that way). 60s `PeriodicTimer`, first sweep at startup.
- **Knobs:** `Options/WorkerOptions.cs` — `StaleJobMinutes=30`, `PendingGraceMinutes=240`, `HeartbeatStaleSeconds=60`. `appsettings.json:31-33`. NOTE: `scripts/recover-jobs.ps1` reads WorkerOptions out of appsettings (per the class XML-doc) — adding a key is additive-safe, but do not RENAME existing keys.
- **Heartbeat:** `dramatiq:__heartbeats__` ZSET, unix-ms scores, written by dramatiq's Redis broker itself — max score = freshest worker (`HealthEndpoints.cs:31-45`). BFF already holds `IConnectionMultiplexer` via DI.
- **Health endpoints:** `Endpoints/HealthEndpoints.cs` (`/api/health/worker`, anonymous group `/health` under the `/api` prefix — mapped `Program.cs:543`); deploy probe `/healthz` `Program.cs:564-586` (DO NOT MODIFY).
- **Job DTO/poll:** `DTOs/JobDtos.cs` (`CurrentPhase`, `PhasePct`, `DispatchedAt`, `StartedAt`); frontend `useJob` polls 2s while active (`api/hooks.ts:461`); results route `src/routes/_app/songs.$songId.results.$jobId.tsx` (`PhaseProgress` at `:114-136` is the component to replace; styles in `routes/_app/results.module.css`).
- **Worker health frontend:** `api/hooks.ts:447` `useWorkerHealth` (shared TanStack Query cache — a second consumer costs no extra requests); `features/health/AppWorkerHealthNotice.tsx` + `WorkerHealthBanner.tsx`; shell mount `_app.tsx:202`.
- **Phase names:** `components/analysis/src/audio_analysis/pipeline.py:29-41` `PHASE_DEFS`; worker persists them via `_report_progress` (`tasks_dramatiq.py:206-216`, overall pct = `(phase-1+frac)/total_phases`, total 7 or 8 with ALS). Sentinels written elsewhere: `queued`, `starting`, `complete`, `failed`, `"Arrangement"` (structure_actor).
- **Boot checks precedent:** `Program.cs:48-97` (RequireSigningKey + FrontendOrigin + Admin key). Options with `IsConfigured`: `S3StorageOptions` (`ServiceUrl` non-empty), `ResendOptions.cs:25`, `StripeOptions.cs:35`.
- **Storage:** `Services/IMultipartObjectStore.cs` — `IsConfigured`, `ObjectExistsAsync` (HEAD; catches only S3 404 → the health probe must catch connection exceptions itself). Local root config `Storage:LocalRoot` (`"../../../../data"` from the BFF csproj dir — resolve to absolute for the log line).
- **Worker boot:** `components/worker/app/dramatiq_app.py` — obs logging configured at `:39`; `LLM_FAKE` read via `app/llm` settings (`llm_fake`, env `LLM_FAKE`); `WORKER_METRICS` at `:47`.

### Design decision — AC2 (read before coding)

The naive fix (set `PendingGraceMinutes=5` in Development) does NOT work: the clamp at `StaleJobReaper.cs:67-68` raises it back to `StaleJobMinutes` (30), and removing the clamp would false-fail queued jobs behind any legitimately busy single-concurrency worker (one 10-min structure job → the next queued job dies at 5 min). The heartbeat is the discriminator dramatiq gives us for free: **busy worker = fresh heartbeat = long grace; dead worker = stale/no heartbeat = short grace.** Hence `PendingNoWorkerGraceMinutes` (default 240 → zero prod behavior change; dev 5). Restart windows are covered: `start-spectr.ps1` runs `recover-jobs.ps1` at launch, and a worker restarting within 60s keeps its heartbeat fresh enough. NFR16 ("pending survives worker restarts") is preserved — the fast path only fires when nothing is alive to resume the queue.

### Constraints & gotchas

- **Never change `/healthz` semantics** — deploy.sh probes it in-network (story 10.1); worker/storage state must not 503 it. That's WHY `/api/health/full` is a sibling, always-200.
- **Reaper must stay Redis-optional**: today it needs only EF. The heartbeat probe is best-effort (try/catch → unknown → long grace). Never let a Redis outage stop the processing-job reap.
- **`ObjectExistsAsync` only catches S3 404** — a connection-refused MinIO throws; the storage health probe wraps it (that thrown path is exactly what audit P1-3 hit; 12-3 handles the upload-path fix — do not fix `useMixUpload` fallback here).
- **Test-suite ripple (12-1 lesson):** `WebApplicationFactory` runs env=Development, so `appsettings.Development.json` additions load in EVERY BFF integration test. `StaleJobReaper` is a registered `BackgroundService` — it runs inside the factory host with a first sweep at startup. Adding the short-grace tier with a 5-min dev default could reap test-seeded pending jobs older than 5 min IF no heartbeat stub exists (tests have no worker → heartbeat null → stale). Audit existing tests that seed `pending` jobs with backdated `DispatchedAt` (search `DispatchedAt` in `components/bff/tests/`) and either keep seeded timestamps fresh or stub the heartbeat service in the factory.
- **`StaleJobReaperTests.cs:27` constructs options directly** (`StaleJobMinutes=30, PendingGraceMinutes=240`) — constructor change ripples here; extend, don't fork.
- **Frontend conventions:** TS strict + `verbatimModuleSyntax` (`import type`), CSS Modules + global `.dot[.tone]`/`.mono` utilities, no new deps, fetcher-only HTTP, Sonner only for transient toasts (the storyline hints are inline UI, not toasts).
- **PS1 conventions:** `Fail`/`Warn`/`Good`/`Info` helpers only; the resolved-python nuance (venv vs system) is why the import check must run the SAME `python` the window would use (bare `python` from PATH — matching current behavior at `:309-311`).
- **Caveman/prose rule:** all code, comments, and this story's outputs written normal — no compressed prose in committed artifacts.
- **12-8 AC3 pairing:** the "How analysis works" link belongs to story 12-8 — leave an obvious slot in `ProgressStoryline` (e.g. footer row) but do not build it.
- **Known BFF parallel-run flakes** (CoachStream etc.) — re-run before diagnosing failures.

### Testing standards

- BFF: xunit in `components/bff/tests/Spectr.Bff.Tests/` — reaper unit tests via direct `ReapAsync` (existing pattern); endpoint shape via `WebApplicationFactory` integration style. Run with the dev stack up (Postgres+Redis) or the suite false-greens (story 12-7).
- Frontend: vitest + jsdom static-render style (`src/**/__tests__/`), mock `fetcher`/hooks per existing utilities (see `VerifyEmailBanner.test.tsx` from 12-1 for the shell-component pattern).
- Worker: pytest under `components/worker/tests/`; the dramatiq_app change is import-time logging — assert via caplog only if cheap, otherwise cover by ruff + existing import test.

### Previous story intelligence (12-1)

- Verify story anchors against the working tree before coding — 12-1 found one stale anchor (profile DTO) and corrected additively.
- Dev-only config keys: comment them in the JSON (`"// Auth"` style) and guard in code on `IHostEnvironment.IsDevelopment()` when behavior-changing; `PendingNoWorkerGraceMinutes` is a plain tunable (defaults preserve prod), so config-only is fine — no env guard needed.
- Full-gate order that works: `vite build` BEFORE `tsc -b` (routeTree.gen), then lints, then vitest.
- BFF 350/350 was green at 12-1 close with live PG+Redis; frontend 699/699.

### Project Structure Notes

- New BFF service file: `Services/WorkerHeartbeat.cs` (or fold into an existing small service — NOT a new endpoint group; `/health/full` joins `HealthEndpoints.cs`).
- New frontend files: `features/results/ProgressStoryline.tsx` (+ module CSS + test), `features/health/DevHealthDot.tsx` (+ test). Shell edit confined to `_app.tsx` + layout module CSS.
- No DB migrations. New config key `Worker:PendingNoWorkerGraceMinutes` (appsettings.json default 240 + Development override 5); no new env vars, no root `.env.example` change (that's 12-3).

### References

- [Source: output/audit/2026-07-10_full-app-audit/findings.md §1 P0-2 (+P1-3 boundary note)]
- [Source: PRPs/epics.md — Epic 12, Story 12.2]
- [Source: PRPs/stories/3-5-upload-and-job-persistence-resilience-verified.md — NFR16 reaper split predicate origin]
- [Source: PRPs/stories/10-1-production-deploy-topology.md — /healthz deploy contract]
- [Source: PRPs/stories/10-3-observability-stack.md — obs.py logging + metrics conventions]
- [Source: PRPs/stories/12-1-analysis-dispatch-unblocked-in-dev-and-verify-gate-ux.md — dev-config patterns + test-ripple lesson]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- BFF full suite: 355/355 passed (live Postgres+Redis), ~1m22s.
- Frontend: vite build OK, `tsc -b` clean, eslint/lint:css/lint:prices clean, vitest 709/709.
- Worker: `uvx ruff@0.15.11 check components/worker/` clean; pytest 583 passed / 3 xfailed via the `%TEMP%\spectr-lock-venv` lock venv.
- One tsc fix during gates: `queueDepth?: number` needed `| undefined` under `exactOptionalPropertyTypes`.

### Implementation Plan / decisions

- **AC1**: widened the launcher import check to `import dramatiq, audio_analysis` (this machine's system python imports dramatiq but NOT audio_analysis — the exact audit P0 case); on failure the actual import error is captured via an unsuppressed re-run and the worker branch `Fail`s without `Start-InWindow`. BFF/frontend launches unaffected.
- **AC2**: heartbeat read extracted to `IWorkerHeartbeat`/`WorkerHeartbeat` (singleton; ZSET max-score rule shared by `/api/health/worker` and the reaper). Reaper's pending predicate gained an UNCLAMPED third arm gated on `workerDead` (heartbeat null or ≥ HeartbeatStaleSeconds). Probe exceptions → liveness UNKNOWN → long-grace only (reaper stays Redis-optional). `PendingNoWorkerGraceMinutes` default 240 (prod no-op), Development override 5.
- **Test-ripple guard (12-1 lesson)**: `TestEnv.cs` `[ModuleInitializer]` pins `Worker__PendingNoWorkerGraceMinutes=240` for the whole test process (env vars load after appsettings.Development.json), so every factory host's background reaper keeps the long grace; the fast tier is unit-tested via explicit options + a heartbeat stub. Audited `DispatchedAt` seeding — only StaleJobReaperTests backdates timestamps.
- **AC3**: `ProgressStoryline` split container (elapsed tick + shared `useWorkerHealth` cache) / `ProgressStorylineView` (presentational, static-render tested). Unknown in-flight phase names render as an appended current row; base rows check off by overall pct in that case. Sentinels (`queued`/`starting`/`complete`/`failed`) never render as phases. Offline hint immediate; "taking longer than usual" at >10 min elapsed or pending >2 min. 12-8 link slot left as a comment.
- **AC4**: `/api/health/full` joins the same anonymous `/health` group; always HTTP 200 (`status` degraded only on postgres/redis failure; worker/storage informational) — `/healthz` untouched. Storage probe: local = `Directory.Exists(Path.GetFullPath(LocalRoot))` (mirrors LocalDiskFileStorage resolution); S3 = `ObjectExistsAsync` where a 404/false still proves reachability. `DevHealthDot` mounted in `_app.tsx` behind `import.meta.env.DEV` (query stays unmounted in prod builds); tones via global `.dot`/`.dot orange`/`.dot red`.
- **AC5**: BFF summary logged right after `builder.Build()` — booleans/paths only. Worker one-liner at the bottom of `dramatiq_app.py`: LLM_FAKE (via pydantic settings truthiness), WORKER_METRICS, redis host:port (never the full URL — may embed a password), declared queues. Storage-root line deliberately left to story 12-3.

### Completion Notes List

- All 5 ACs implemented and verified; all validation gates green (BFF 355/355, frontend 709/709 + 4 lints, worker ruff + 583 pass).
- Manual launcher gate executed for real on 2026-07-10: broken case (system python missing audio_analysis) → red `Worker NOT started: … ModuleNotFoundError: No module named 'audio_analysis'` + pip hint, exit 1, no worker window; happy case (lock venv on PATH) → all three components launched, exit 0. Apps stopped afterwards; docker infra left up.
- Boot summaries verified live: BFF logs `Boot config: env=Development | S3 configured: False | … | Worker: stale=30m pendingGrace=240m pendingNoWorker=5m heartbeatStale=60s | Storage:LocalRoot resolved: <repo>\data`; worker logs `Boot config: LLM_FAKE=0 WORKER_METRICS=0 redis=localhost:6379 queues=analysis-free,analysis-paid,coach,maintenance`.
- `/api/health/full` verified against the running BFF: `{"status":"ok","checks":{"postgres":true,"redis":true,"worker":{"healthy":false,"lastHeartbeatAgeSeconds":156,"queueDepth":402},"storage":{"mode":"local","ok":true}}}`; `/healthz` still `{"status":"ok"}`.
- FINDING for the user: the dev Redis carries a ~402-message analysis backlog from the dead-worker era, and the system `python` on PATH cannot import `audio_analysis` — the worker only runs from a prepared venv. Draining/purging that backlog and fixing the default python env are outside this story's scope.

### File List

- scripts/start-spectr.ps1 (modified — fail-loud worker import check)
- components/bff/src/Spectr.Bff/Services/WorkerHeartbeat.cs (new)
- components/bff/src/Spectr.Bff/Services/StaleJobReaper.cs (modified)
- components/bff/src/Spectr.Bff/Options/WorkerOptions.cs (modified)
- components/bff/src/Spectr.Bff/Endpoints/HealthEndpoints.cs (modified)
- components/bff/src/Spectr.Bff/Program.cs (modified — IWorkerHeartbeat DI + boot summary)
- components/bff/src/Spectr.Bff/appsettings.json (modified)
- components/bff/src/Spectr.Bff/appsettings.Development.json (modified)
- components/bff/tests/Spectr.Bff.Tests/StaleJobReaperTests.cs (modified — heartbeat stub + 3 new tests)
- components/bff/tests/Spectr.Bff.Tests/TestEnv.cs (new — module-initializer env pin)
- components/bff/tests/Spectr.Bff.Tests/HealthEndpointsTests.cs (new)
- components/frontend-spectr-v2/src/features/results/ProgressStoryline.tsx (new)
- components/frontend-spectr-v2/src/features/results/ProgressStoryline.module.css (new)
- components/frontend-spectr-v2/src/features/results/__tests__/ProgressStoryline.test.tsx (new)
- components/frontend-spectr-v2/src/features/health/DevHealthDot.tsx (new)
- components/frontend-spectr-v2/src/features/health/__tests__/DevHealthDot.test.tsx (new)
- components/frontend-spectr-v2/src/routes/_app/songs.$songId.results.$jobId.tsx (modified — PhaseProgress → ProgressStoryline)
- components/frontend-spectr-v2/src/routes/_app.tsx (modified — DevHealthDot mount)
- components/frontend-spectr-v2/src/api/hooks.ts (modified — useFullHealth)
- components/frontend-spectr-v2/src/api/types.ts (modified — FullHealthResponse)
- components/worker/app/dramatiq_app.py (modified — boot config one-liner)
- PRPs/sprint-status.yaml (modified — story status)
- PRPs/stories/12-2-failure-visibility-worker-health-and-progress-storyline.md (this file)

### Change Log

- 2026-07-10: Story 12.2 implemented — fail-loud launcher, heartbeat-aware two-tier pending reap (`PendingNoWorkerGraceMinutes`, dev 5 min), ProgressStoryline with elapsed time + escalating hints, `/api/health/full` + DevHealthDot (dev builds only), BFF + worker boot config summaries. All gates green; status → review.
