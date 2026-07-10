# Story 12.3: Upload Robustness & Dev Bootstrap

Status: review

## Story

As a developer setting up the stack,
I want uploads to degrade gracefully and setup to be one documented path,
so that a missing MinIO or missing .env never hard-fails the flow.

## Background (audit evidence)

2026-07-10 full-app audit (`output/audit/2026-07-10_full-app-audit/findings.md` §1, P1-3 + P1-5):

- **P1-3**: the presigned-upload fallback only triggers on HTTP 501 (`useMixUpload.ts:149`). `S3StorageOptions.IsConfigured` is just "ServiceUrl non-empty" (`Services/S3StorageOptions.cs:31`), and the root `.env.example:40` ships `Storage__S3__ServiceUrl=http://localhost:9000` uncommented while `start-spectr.ps1` never starts MinIO. Result: S3 env set + MinIO down → `InitiateMultipartAsync` throws connection-refused → unhandled 500 → NO fallback → upload dead.
- **P1-5**: fresh-clone reality at audit time — no `.env` anywhere (only `.env.example` files), Docker cold, no repo venv, all ports closed. No document explains boot order, who reads which env file, the verify-gate dev behavior (12-1), or `LLM_FAKE`.
- **Ruled-out note worth keeping true**: storage roots match by default (BFF `../../../../data` == worker `parents[3]/data` on Windows); the only break is `components/worker/.env` carrying the compose-only `STORAGE_LOCAL_ROOT=/data` on a native run — currently invisible because the worker never logs its resolved root.

**Already shipped — REUSE, do not reinvent:**

- 501 `presigned_unavailable` contract + legacy-proxy fallback: `UploadEndpoints.cs` (all 4 routes gate on `store.IsConfigured`), `useMixUpload.ts` (mix), `attachment-upload-helpers.ts` + `UnifiedUploadDialog.tsx:448,489,541` (als/reference/stems). The fallback MACHINERY exists — this story only broadens WHEN it fires.
- AR38 error envelope: `Endpoints/ErrorEnvelope.cs` — `ErrorEnvelope.Build(status, code, message)`; frontend `extractApiError` + `ApiError` (`fetcher.ts:9-13,122`, story 12-1) already surface `code`/message.
- Worker boot one-liner (story 12-2): `dramatiq_app.py:88-110` — the resolved-storage-root line was DELIBERATELY left out of 12-2 for this story (see its comment "the resolved storage root is story 12-3's line").
- Worker storage-root resolution: `tasks_dramatiq.py:48-73` (`_resolve_local_root`, `LOCAL_ROOT`, `RESULTS_DIR`) + tests `test_local_root.py`. The Windows repo-root fallback already works — do not change resolution, only log it.
- Launcher plumbing: `start-spectr.ps1` — `Fail`/`Warn`/`Good`/`Info` helpers append `$script:Errors` → `Show-Summary` + `exit 1`; `Test-Docker` (`:178`); infra healthcheck wait (`:210-222`); 12-2's fail-loud worker import check (`:308-328`).
- BFF boot config summary (story 12-2): `Program.cs:456-458` logs `S3 configured: {bool}` + resolved `Storage:LocalRoot` — dev-setup.md should point at it, not duplicate it.

## Acceptance Criteria

1. **Given** `Storage:S3` is configured (ServiceUrl set) but unreachable (MinIO down), **When** `POST /uploads/init` fails on connection, **Then** the BFF returns 503 with machine-readable code `storage_unreachable` (never an unhandled 500), **And** the client falls back to the legacy proxy upload on any init-stage failure of the presigned path (501 as today, plus 503/5xx/network errors raised by init) — for the mix path AND the attachment paths (als/reference/stems). A failure AFTER parts have been uploaded (complete stage) still surfaces as an error, never a silent re-upload.
2. **Given** a fresh clone, **Then** `docs/dev-setup.md` exists and documents: prerequisites, one-command boot (`scripts/start-spectr.ps1`) + manual boot order, the "no `.env` exists by default" reality and exactly who reads which env file (BFF = appsettings + launchSettings, NOT repo `.env`; worker = `components/worker/.env` via dotenv; docker compose = its own substitutions), the verify-gate dev behavior (12-1 `Auth:DevAutoVerify`), `LLM_FAKE`, and MinIO as strictly optional (S3 vars empty = local mode). The root `.env.example` no longer ships an active `Storage__S3__ServiceUrl` value (commented out with a "start MinIO first" note).
3. **Given** `components/worker/.env`, **Then** it never carries the compose-only `STORAGE_LOCAL_ROOT=/data` on native runs (`.env.example` gains an explicit warning; boot warns when the resolved root does not exist), **And** the worker logs its resolved storage root (+ results dir) at startup on the existing 12-2 boot-config line.
4. **Given** the start script, **Then** a preflight check verifies Docker is reachable and Postgres (5432) + Redis (6379) accept TCP before launching the app components; on preflight failure the apps are NOT launched and the summary is red (exit 1). The `-SkipInfra` path runs the same preflight (it validates the "already running" assumption instead of trusting it).

## Tasks / Subtasks

- [x] Task 1: BFF — configured-but-unreachable S3 answers 503 `storage_unreachable` (AC: 1)
  - [x] `UploadEndpoints.Init` (`UploadEndpoints.cs:127-128`): wrap the two store calls (`InitiateMultipartAsync` + `PresignPartUrlsAsync`) in try/catch. Catch `Exception` except `OperationCanceledException`; log the error; return `ErrorEnvelope.Build(503, "storage_unreachable", "Upload storage is unreachable; falling back to standard upload.")`. (Presigning itself is CPU-only, but the lazy `AmazonS3Client` creation can also throw on malformed config — one guard covers both.)
  - [x] `UploadEndpoints.AttachmentInit`: same guard around its `PresignPutUrl`/store calls.
  - [x] `UploadEndpoints.Complete`: wrap `CompleteMultipartAsync`/`ObjectExistsAsync` in the same catch but return 503 `storage_unreachable` WITHOUT any fallback semantics (bytes are already in the bucket or lost; the client must show the error, not silently re-upload the file via proxy).
  - [x] Do NOT touch `IsConfigured` (no reachability probe inside the options — a per-request network probe on every upload would be worse than the try/catch; the audit offered probe OR broadened fallback, we take broadened fallback + honest 503).
  - [x] BFF test: register a throwing `IMultipartObjectStore` stub (IsConfigured=true, `InitiateMultipartAsync` throws `HttpRequestException`) via `WebApplicationFactory` service override → `POST /api/uploads/init` returns 503 with `code == "storage_unreachable"` in the envelope. Same-style test for `/uploads/attachments/init`.
- [x] Task 2: Frontend — broaden the fallback trigger, shared predicate (AC: 1)
  - [x] New helper in `src/features/upload/` (e.g. `presigned-fallback.ts`): `export function shouldFallBackToProxy(e: unknown): boolean` — true for `ApiError` with `status === 501`, `status === 503`, or `status >= 500`; also true for non-ApiError network failures (`TypeError` from fetch). False for all 4xx (entitlement 409, validation 400, verify-gate 403 must propagate — story 12-1's error UX depends on it).
  - [x] `useMixUpload.ts`: restructure so the fallback decision applies ONLY to init-stage failures. Hoist the `/uploads/init` call out of `uploadPresigned` (or tag its error): on init failure where `shouldFallBackToProxy(e)` → set `presignedAvailable.current = false`, clear error state, run `legacy.upload` (exactly the current 501 branch at `:149-153`, with the broadened predicate). Failures from part PUTs or `/uploads/complete` keep today's behavior: abort best-effort + surface the error (`:126-136`), NO proxy fallback.
  - [x] `UnifiedUploadDialog.tsx:448,489,541`: replace the three `if (!(e instanceof ApiError && e.status === 501)) throw e;` checks with `if (!shouldFallBackToProxy(e)) throw e;`. These sites wrap `uploadAttachmentPresigned`/stems init — single-PUT paths where init failure means zero bytes uploaded, so the broadened predicate is safe there as-is.
  - [x] Session cache semantics unchanged: any fallback-triggering init failure sets `presignedAvailable.current = false` for the rest of the session (page reload re-probes) — one slow failed probe per session, not per upload.
  - [x] Vitest: unit tests for `shouldFallBackToProxy` (501/503/500/network → true; 400/403/409 → false). `useMixUpload`-level test (or helper-level if the hook resists jsdom): init 503 → legacy path called; complete-stage error → NO legacy call + error surfaced. Extend `attachment-upload-helpers.test.ts` fallback-contract case to the new predicate.
- [x] Task 3: env-file truth pass (AC: 2, 3)
  - [x] Root `.env.example:38-47`: comment out `Storage__S3__ServiceUrl` (empty/commented = local mode) and add: "Uncomment ONLY with MinIO running: `docker compose -f docker/docker-compose.yml up -d minio`. With ServiceUrl set but MinIO down, uploads now fall back to the proxy path (story 12.3) — but you're testing the wrong path." Keep the other `Storage__S3__*` keys as-is (inert without ServiceUrl).
  - [x] `components/worker/.env.example`: add a `STORAGE_LOCAL_ROOT` entry, commented out, with the warning: compose-only value is `/data`; NEVER set it on native Windows runs (the built-in default resolves the repo `data/` dir — `tasks_dramatiq.py:48-64`); setting `/data` natively makes every job fail file-resolution.
- [x] Task 4: Worker — resolved storage root on the boot line + missing-root warning (AC: 3)
  - [x] `dramatiq_app.py` boot summary (`:103-110`): extend the existing `Boot config:` line (or add one adjacent line — keep it ONE info-level statement per 12-2 convention) with `storage_root=<abs>` and `results_dir=<abs>`. Source them from `tasks_dramatiq.LOCAL_ROOT` / `RESULTS_DIR` (already imported module — reference AFTER the `from . import tasks_dramatiq` import at `:56`; do not re-derive).
  - [x] Missing-root warning: if `not Path(LOCAL_ROOT).is_dir()` → `logger.warning("storage root %s does not exist — uploads will fail file resolution (compose-only STORAGE_LOCAL_ROOT on a native run?)", ...)`. Warning, not crash (first-boot before any upload may legitimately lack `data/` subdirs; the dir itself existing is the signal that matters — repo `data/` is committed).
  - [x] Never log `DATABASE_URL` or S3 secrets (12-2 rule stands).
  - [x] Worker test: extend/adjoin `test_local_root.py` — a small pure helper (e.g. `storage_boot_summary(local_root, results_dir) -> str` or the warning-decision function) so the log content is testable without importing the broker; assert the /data-on-Windows case produces the warning decision. Keep `dramatiq_app.py` import side effects out of tests (existing suite never imports it — follow that).
- [x] Task 5: start-script preflight (AC: 4)
  - [x] New `Test-Preflight` function in `start-spectr.ps1`, called in Main between `Start-Infra`/`Update-Database` and `Start-Apps` (and on the `-SkipInfra` path): checks (a) Docker daemon reachable (`Test-Docker` — skip this check under `-SkipInfra` if Docker isn't required for externally-hosted PG/Redis; report as Info), (b) TCP connect to `localhost:5432`, (c) TCP connect to `localhost:6379`. Use `[System.Net.Sockets.TcpClient]` with a ~2s timeout (`Test-NetConnection` is slow and chatty) — small local helper `Test-TcpPort($port)`.
  - [x] On any preflight failure: `Fail` with which check failed + the likely fix ("Docker Desktop not running", "postgres container not healthy — try -RecreateInfra"), do NOT call `Start-Apps`, let the existing summary + `exit 1` machinery report. BFF/worker/frontend are all DB/Redis-dependent at boot — launching them into dead infra just multiplies red windows.
  - [x] `Update-Database` already fails visibly when PG is down; preflight BEFORE it avoids the confusing EF stack trace as the first symptom. Order: Start-Infra → Test-Preflight → Update-Database → Invoke-Recovery → Start-Apps.
  - [x] Keep `-StopOnly` path untouched (no preflight on teardown).
- [x] Task 6: docs/dev-setup.md (AC: 2)
  - [x] New file `docs/dev-setup.md` (docs/ already holds runbook.md + launch-checklist.md — same home). Sections:
    - Prerequisites: Docker Desktop, .NET 10 SDK, Node 20+, Python 3.11 venv; `pip install -e components/shared components/analysis` then `pip install -r components/worker/requirements.txt`; `npm install` in `components/frontend-spectr-v2`.
    - One-command boot: `./scripts/start-spectr.ps1` (what it does: stop → infra → preflight → migrations → job recovery → 3 windows); flags (`-StopOnly`, `-SkipInfra`, `-RecreateInfra`, `-SkipMigrations`, `-SkipRecovery`).
    - Manual boot order (infra → migrations → BFF → worker → frontend) with the exact commands from CLAUDE.md validation gates.
    - **Env-file reality map** (the audit's core confusion): no `.env` exists after clone, and that is FINE for local dev. BFF reads `appsettings.json` + `appsettings.Development.json` + `launchSettings.json` (Development env is REQUIRED — story 4.1; `start-spectr.ps1` sets it) and does NOT read any `.env`. Worker reads `components/worker/.env` if present (dotenv, `dramatiq_app.py:22-29`) — copy from `components/worker/.env.example` when you need non-default DB/Redis/LLM settings. Root `.env` (from root `.env.example`) feeds docker compose substitutions and is the canonical secret inventory (AR40) — needed for compose-run app services and prod, not for the native dev loop.
    - Verify-gate dev behavior: `Auth:DevAutoVerify` (12-1) — registration auto-verifies in Development; the second-analysis 403 gate never blocks local dev; resend/banner UX exists for staging-like testing.
    - `LLM_FAKE=1` (default): canned verdict/coach replies, zero API spend; `LLM_FAKE=0` requires `ANTHROPIC_API_KEY`.
    - MinIO/S3 (optional): default is local-disk storage; to exercise the presigned path run `docker compose -f docker/docker-compose.yml up -d minio` AND set the `Storage__S3__*` env for the BFF; with S3 configured but MinIO down, uploads fall back to the proxy path (this story).
    - Health checks: `/healthz`, `/api/health/full` (dev), DevHealthDot (12-2); boot config summaries to eyeball.
    - Troubleshooting: worker import fail-loud (12-2), file-lock on `Spectr.Bff.exe`, orphaned `multiprocessing-fork`, dev Redis backlog note (12-2 finding), storage-root mismatch symptom → check the new worker boot line.
  - [x] Keep it factual and terse; link to CLAUDE.md/runbook rather than duplicating; no emojis (workspace style rule).
  - [x] README.md: add a one-line pointer to `docs/dev-setup.md` if the README has a dev-setup section stub (check first; do not restructure the README).
- [x] Task 7: Validation gates (all)
  - [x] BFF: `dotnet build && dotnet test` with dev stack up (Postgres+Redis) — suites false-green without it (12-7).
  - [x] Frontend: `npx vite build` (routeTree first) → `npx tsc -b` → `npm run lint` + `lint:css` → `npx vitest run`.
  - [x] Worker: `uvx ruff@0.15.11 check components/worker/` + `pytest -q components/worker/tests/`.
  - [x] Script: syntax-parse check only (e.g. `[System.Management.Automation.Language.Parser]::ParseFile` or `pwsh -NoProfile -Command "$null = Get-Command -Syntax"` equivalent). Do NOT run the launcher end-to-end — it spawns visible windows; the user verifies the full boot at home (12-2 precedent). List the manual steps for him in the completion notes.

## Dev Notes

### Verified code anchors (2026-07-10 — verified against working tree at story creation)

- **BFF init 500 path**: `Endpoints/UploadEndpoints.cs:127-128` — `store.InitiateMultipartAsync` + `PresignPartUrlsAsync`, no try/catch; `:84-86` is the 501 unconfigured gate (keep). Complete's store calls `:162-168`. AttachmentInit starts `:190+` (its own `IsConfigured` 501 at `:238`; more gates at `:322`).
- **S3 client**: `Services/IMultipartObjectStore.cs` — `S3ObjectStore` (same file, `:52+`), lazy client `:60`, `internal S3ObjectStore(S3StorageOptions, IAmazonS3)` test seam `:64-68`. `ObjectExistsAsync` catches ONLY S3-404 (`:190-208`) — connection errors throw through (12-2's health probe wraps it; upload endpoints must too).
- **Options**: `Services/S3StorageOptions.cs:31` — `IsConfigured => ServiceUrl non-empty`. Bound from `Storage:S3`. Default `appsettings.json` has NO S3 section → local mode out of the box; the trap is env-provided ServiceUrl.
- **Error envelope**: `Endpoints/ErrorEnvelope.cs` — `Build(status, code, message, details?)`. Existing upload-path codes: `presigned_unavailable` (501), `entitlement_exhausted` (409), `entitlements_unavailable` (503), `rate_limited` (429), `upload_not_found` (502). New code: `storage_unreachable` (503).
- **Frontend mix hook**: `src/hooks/useMixUpload.ts` — init call `:89-98` (already OUTSIDE the try/abort block — an init throw propagates with no abort attempt, which is exactly the seam Task 2 needs); fallback branch `:143-155`; session cache `presignedAvailable` `:49`.
- **Frontend attachment sites**: `src/components/UnifiedUploadDialog.tsx:448` (.als), `:489` (reference), `:541` (stems) — identical `status === 501` checks. Helpers: `src/features/upload/attachment-upload-helpers.ts` (throws ApiError through), `multipart-upload-helpers.ts` (pure part logic — untouched).
- **ApiError**: `src/api/fetcher.ts:9-13` — has `status` + `body`; `extractApiError` (`src/api/error-utils.ts`) reads the envelope `code`/`message` (12-1). A fetch-level network failure is a `TypeError`, NOT an ApiError — the predicate must handle both.
- **Worker storage root**: `components/worker/app/tasks_dramatiq.py:48-73` — `_default_local_root()` (nt → `parents[3]/data`, else `/data`), `LOCAL_ROOT` module constant, `RESULTS_DIR` derived. Tests: `components/worker/tests/test_local_root.py`.
- **Worker boot line**: `components/worker/app/dramatiq_app.py:88-110` (12-2). `tasks_dramatiq` imported at `:56`. dotenv load `:22-29` (worker `.env` = `components/worker/.env`).
- **Launcher**: `scripts/start-spectr.ps1` — Main flow `:364-382`; `Test-Docker` `:178-181`; `Start-Infra` healthcheck wait `:210-222` (waits for CONTAINER health — preflight adds the host-side TCP truth on top, which also covers `-SkipInfra` where Start-Infra never runs); `Start-Apps` `:294-341`; `$script:Errors`/`Fail` `:71-76`.
- **Compose**: `docker/docker-compose.yml` — minio service exists (`:36-49`, ports 9000/9001) but start-spectr deliberately starts ONLY postgres+redis (`:207`). Compose worker/bff services set container paths (`Storage__LocalRoot: /data`, volumes `../data:/data`) — those are correct for containers; the hazard is copying them into native env files.

### Design decisions (read before coding)

- **AC1 takes "broadened fallback + honest 503", not a reachability probe in `IsConfigured`.** A probe per request adds latency and a new failure mode; a boot-time probe goes stale the moment MinIO stops. The try/catch at the init endpoints converts the unhandled 500 into a typed 503, and the client treats any init-stage 5xx/network failure as "presigned path unavailable right now" → proxy. Both epic options are thereby covered (501 broadening AND a server-side honest signal).
- **Init-stage vs complete-stage is the safety line.** Falling back after parts uploaded would silently re-upload up to 250 MB through the proxy and can double-create versions. Init failure = zero bytes moved = always safe to fall back. The current `useMixUpload` structure already separates these (init outside the try) — preserve that seam explicitly.
- **4xx never falls back.** 403 `email_verification_required` (12-1), 409 `entitlement_exhausted`, 429 — falling back on these would bypass or blur product gates. The predicate is 501/5xx/network ONLY.
- **Worker root logging is a warning, not a gate.** A wrong `STORAGE_LOCAL_ROOT` must not crash the worker at boot (12-2 rule: never crash for a log line); the missing-dir warning plus the visible resolved path is enough to make the misconfiguration diagnosable in seconds.
- **Preflight lives in the launcher, not the apps.** The BFF/worker already fail loudly on dead infra eventually, but each in its own window with its own stack trace; the launcher is the one place that can refuse to open three doomed windows and print one red line instead.

### Constraints & gotchas

- **DO NOT run `start-spectr.ps1` during dev/verification** — it spawns visible windows; Brian verifies UI/stack boots at home (12-2 did the same: "visual smoke deferred"). Static parse check + code review only; list manual verification steps in completion notes.
- **`presignedAvailable` cache semantics**: 501 today means "S3 unconfigured — permanent for the session". A connection-error 503 is transient, but caching false for the session is still correct UX (one failed probe, then fast proxy uploads); don't build retry/backoff.
- **`UnifiedUploadDialog` catches wrap MORE than the init fetch** (they wrap the whole presigned attempt incl. the PUT). For single-PUT attachments a PUT network failure also means the presigned path is effectively down (MinIO unreachable), and no proxy double-write hazard exists (registration only happens after a successful PUT) — so the broadened predicate at those three sites is safe without restructuring. The mix path is the only one needing the init/complete split.
- **`ObjectExistsAsync` inside `Complete`**: with S3 reachable at complete-time this is fine; if it throws, the new catch returns 503 — but the multipart may have completed. That's acceptable: the client shows an error, the user retries, `/uploads/init` mints a NEW jobId/key (no orphan collision), and the abandoned object is retention-swept (3.4). Do not try to be clever here.
- **Test-suite ripple (12-1/12-2 lesson)**: `WebApplicationFactory` runs env=Development and loads `appsettings.Development.json`. The throwing-store test must OVERRIDE the `IMultipartObjectStore` registration (`Program.cs:221` registers it always with IsConfigured driven by config) — use `WithWebHostBuilder(b => b.ConfigureServices(...))` replacement, NOT config with a real ServiceUrl (which would make OTHER upload tests hit a dead endpoint). Verify no existing test asserts the old 500 behavior.
- **PS1 conventions**: `Fail`/`Warn`/`Good`/`Info` only; PowerShell 7 syntax already assumed elsewhere in the script (`?.` at `:79`). TCP checks must dispose clients; 2s timeout via `ConnectAsync(...).Wait(2000)` pattern.
- **Worker test isolation**: never import `dramatiq_app` in tests (broker side effects, env mutation). Put testable logic in a pure function; the existing suite's only coverage of that module is ruff — keep it that way.
- **Frontend conventions**: TS strict + `verbatimModuleSyntax` (`import type`), no new deps, fetcher-only HTTP, helpers colocated under `src/features/upload/`.
- **Caveman/prose rule**: all committed code, comments, docs, and story outputs written in normal prose — no compressed style in artifacts.
- **docs style**: no emojis in .md (workspace rule); dev-setup.md is human-facing — favor exact commands over narrative.
- **Known BFF parallel-run flakes** (CoachStream etc.) — re-run before diagnosing.

### Testing standards

- BFF: xunit in `components/bff/tests/Spectr.Bff.Tests/`; integration via `WebApplicationFactory` with service-override stubs (see `HealthEndpointsTests.cs` from 12-2 for the current factory pattern). Dev stack (Postgres+Redis) must be UP for real signal.
- Frontend: vitest + jsdom under `src/**/__tests__/`; pure-helper tests preferred over hook rendering (see `multipart-upload-helpers.test.ts` / `attachment-upload-helpers.test.ts` — extend these files' patterns).
- Worker: pytest under `components/worker/tests/`; pure functions + monkeypatched env (see `test_local_root.py`).
- Gate order that works (12-1/12-2): `vite build` BEFORE `tsc -b` (routeTree.gen), then lints, then vitest.

### Previous story intelligence (12-2)

- Verify anchors against the working tree before coding — line numbers above were re-verified at story creation but 12-2's review patches shifted some files.
- `TestEnv.cs` `[ModuleInitializer]` pins `Worker__PendingNoWorkerGraceMinutes=240` process-wide — pattern available if a new Development-json knob would ripple through factory tests (none expected in this story: no new appsettings keys).
- 12-2 boot-summary convention: one Information line, booleans/paths only, wrap anything throwable (`Path.GetFullPath` guard precedent) — the worker storage-root line must follow it.
- The dev Redis carried a ~402-message backlog from the dead-worker era and the system `python` on PATH cannot import `audio_analysis` (worker runs only from the prepared venv) — dev-setup.md troubleshooting section should mention both symptoms.
- Senior-review taste from 12-2: probe/log code must never introduce a new crash path (`healthy:false` over 500; `LLM_FAKE=?` over boot crash) — same bar applies to every addition here.

### Latest tech notes

- No new libraries anywhere in this story. AWSSDK.S3, TanStack, vitest, pytest, PowerShell 7 — all already pinned in-repo. The AWS SDK throws `AmazonServiceException`/`HttpRequestException` (inner) on connection failure — catch broadly (any non-cancellation exception) rather than enumerating SDK exception types, since the endpoint's answer is the same regardless of failure flavor.

### Project Structure Notes

- New files: `docs/dev-setup.md`, `components/frontend-spectr-v2/src/features/upload/presigned-fallback.ts` (+ test), BFF test file for the throwing-store case (or extend an existing UploadEndpoints test class if one exists — check `components/bff/tests/` first).
- Modified: `UploadEndpoints.cs`, `useMixUpload.ts`, `UnifiedUploadDialog.tsx`, `attachment-upload-helpers.test.ts` (extend), `.env.example` (root), `components/worker/.env.example`, `components/worker/app/dramatiq_app.py`, `components/worker/tests/test_local_root.py` (extend or sibling), `scripts/start-spectr.ps1`, possibly `README.md` (pointer only).
- No DB migrations, no new config keys, no new env vars (only commented-out documentation entries in the two `.env.example` files).

### References

- [Source: output/audit/2026-07-10_full-app-audit/findings.md §1 P1-3, P1-5 + "Ruled out" storage-root note]
- [Source: PRPs/epics.md — Epic 12, Story 12.3]
- [Source: PRPs/stories/12-2-failure-visibility-worker-health-and-progress-storyline.md — boot-summary convention, never-crash-for-a-log-line, deferred storage-root line, test-ripple + review patterns]
- [Source: PRPs/stories/12-1-analysis-dispatch-unblocked-in-dev-and-verify-gate-ux.md — AR38 code-mapping error UX, DevAutoVerify]
- [Source: PRPs/stories/3-1-direct-to-r2-presigned-multipart-upload.md — presigned path + 501 fallback contract origin]
- [Source: PRPs/stories/3-2-worker-side-validation-and-attachments-via-r2.md — attachment presigned paths + object_store.resolve_local]
- [Source: CLAUDE.md — validation gates, storage-root off-by-one gotcha, workspace markdown style]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code CLI, dev-story workflow), 2026-07-10.

### Debug Log References

- RED confirmed before implementation for every code task: the three new BFF tests initially failed with `InternalServerError` (proving the audit's unhandled-500 claim); the frontend predicate/hook tests failed on missing module + old 501-only behavior; the worker helper tests failed with `AttributeError`.
- One BFF parallel-run flake on the first full-suite run (`AttachmentInit_Enforces_Ownership_Kinds_And_Limits`) — passed in isolation and on two subsequent full runs (known flake pattern per Dev Notes; not related to this story's change).
- Frontend hook test needed `// @vitest-environment jsdom` (vitest config defaults to node; `environmentMatchGlobs` only covers listen-rack).

### Completion Notes List

- **Task 1 (AC1, BFF)**: `Init` wraps `InitiateMultipartAsync`+`PresignPartUrlsAsync`; `Complete` wraps `CompleteMultipartAsync`+`ObjectExistsAsync` (503 without fallback semantics — error message says "could not be finalized. Please retry", never "falling back"); `AttachmentInit` routes all three presign sites through a shared `PresignPutOr503` helper (gained an `ILoggerFactory` param). All catches exclude `OperationCanceledException`. `IsConfigured` untouched. New `ThrowingMultipartObjectStore` test stub + 3 endpoint tests assert 503 + envelope code `storage_unreachable` (and no dispatch on complete failure).
- **Task 2 (AC1, frontend)**: new `src/features/upload/presigned-fallback.ts` — `shouldFallBackToProxy`: ApiError 501/5xx or TypeError → true; all 4xx and plain Errors → false. `useMixUpload` restructured: `/uploads/init` moved into `upload()` with its own catch (fallback-eligible → cache `presignedAvailable=false` + legacy; other errors now correctly set error state + clear isUploading — fixes a latent stuck-spinner on non-501 init errors); `uploadPresignedParts(file, fields, init)` keeps the abort+surface behavior for part/complete failures. Three `UnifiedUploadDialog` catch sites switched to the predicate. 5 hook tests + 10 predicate tests + attachment-contract extension.
- **Task 3 (AC2/AC3, env)**: root `.env.example` — `Storage__S3__ServiceUrl` commented out with "start MinIO first" note (other S3 keys left, inert without ServiceUrl). Worker `.env.example` — commented `STORAGE_LOCAL_ROOT` entry with compose-only warning.
- **Task 4 (AC3, worker)**: pure `storage_boot_summary(local_root, results_dir) -> (fragment, warning|None)` in `tasks_dramatiq.py` (never raises — guards `is_dir()` against OSError/ValueError); `dramatiq_app.py` appends `storage_root=… results_dir=…` to the single 12-2 `Boot config:` info line and emits one warning when the root dir is missing. 4 new tests (existing root, missing root, /data-on-Windows, invalid-path never-raises); the suite still never imports `dramatiq_app`.
- **Task 5 (AC4, launcher)**: `Test-TcpPort` (TcpClient, 2s timeout, disposed) + `Test-Preflight` (Docker check — Info-only under `-SkipInfra`; TCP 5432 + 6379). Main flow: `Start-Infra → Test-Preflight → (Update-Database → Invoke-Recovery → Start-Apps)` — on preflight failure the apps are NOT launched, `Fail` lines feed the red summary + exit 1. `-StopOnly` path untouched. Verified: parse-check clean; `Test-TcpPort` probed standalone against live 5432/6379 (true) and a dead port (false). The launcher itself was NOT run end-to-end (no-popup-windows rule).
- **Task 6 (AC2, docs)**: `docs/dev-setup.md` — prerequisites, one-command + manual boot, env-file reality map table (BFF=appsettings not .env; worker=components/worker/.env via dotenv; compose=root .env), DevAutoVerify, LLM_FAKE, MinIO strictly optional + 12.3 fallback note, health checks, troubleshooting (import fail-loud, exe file lock, orphaned forks, storage-root symptom, Redis backlog). All claims grep-verified against code. README gained a one-line pointer in "How to run".
- **Gates (Task 7)**: BFF build 0 errors + 358/358 (live PG+Redis); frontend vite build → tsc -b → eslint/css/prices lints clean → vitest 732/732; worker ruff clean + 587 passed/3 xfailed; start-spectr.ps1 parse OK.
- **Manual verification for Brian (at-home session)**: (1) `./scripts/start-spectr.ps1` — expect a new "Preflight: infra reachable from the host" step with green postgres/redis lines, then the usual 3 windows. (2) Worker window boot line now ends with `storage_root=<repo>\data results_dir=…`. (3) Negative preflight: quit Docker Desktop, run the script — expect red preflight lines, NO app windows, red summary, exit 1. (4) Optional AC1 end-to-end: set `Storage__S3__ServiceUrl=http://localhost:9000` for the BFF WITHOUT starting MinIO, upload a mix — expect a seamless proxy-path upload (BFF log shows the 503) instead of a dead upload.

### File List

- `components/bff/src/Spectr.Bff/Endpoints/UploadEndpoints.cs` (modified)
- `components/bff/tests/Spectr.Bff.Tests/UploadEndpointsTests.cs` (modified)
- `components/frontend-spectr-v2/src/features/upload/presigned-fallback.ts` (new)
- `components/frontend-spectr-v2/src/features/upload/__tests__/presigned-fallback.test.ts` (new)
- `components/frontend-spectr-v2/src/features/upload/__tests__/attachment-upload-helpers.test.ts` (modified)
- `components/frontend-spectr-v2/src/hooks/useMixUpload.ts` (modified)
- `components/frontend-spectr-v2/src/hooks/__tests__/useMixUpload.test.tsx` (new)
- `components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx` (modified)
- `.env.example` (modified)
- `components/worker/.env.example` (modified)
- `components/worker/app/tasks_dramatiq.py` (modified)
- `components/worker/app/dramatiq_app.py` (modified)
- `components/worker/tests/test_local_root.py` (modified)
- `scripts/start-spectr.ps1` (modified)
- `docs/dev-setup.md` (new)
- `README.md` (modified)
- `PRPs/sprint-status.yaml` (modified — status tracking)
- `PRPs/stories/12-3-upload-robustness-and-dev-bootstrap.md` (modified — this file)

## Change Log

- 2026-07-10: Story 12.3 implemented (all 7 tasks, all 4 ACs). BFF typed 503 `storage_unreachable` on init/attachments-init/complete; frontend `shouldFallBackToProxy` predicate with init-stage-only mix fallback; env-example truth pass; worker boot storage-root line + missing-root warning; launcher TCP preflight; `docs/dev-setup.md`. Gates: BFF 358/358, vitest 732/732, worker 587 passed + 3 xfailed, ruff clean, ps1 parse OK. Status → review.
