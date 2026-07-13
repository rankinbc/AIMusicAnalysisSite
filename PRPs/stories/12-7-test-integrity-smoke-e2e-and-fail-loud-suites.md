# Story 12.7: Test Integrity — Smoke E2E & Fail-Loud Suites

Status: review

## Story

As the operator,
I want green CI to mean something,
so that suites can never silently no-op.

## Background (audit evidence)

- The BFF suite's "skip without Postgres" is a hand-rolled **early-return-green**: `TestSupport.cs:22-35` `TestDb.Reachable(...)` returns false on any connect failure, and ~**335 call sites across 52 of 60 test files** do `if (!await TestDb.Reachable(_factory)) { return; }` — xUnit records a PASS with zero assertions. No `SkippableFact`/skip attribute exists anywhere in the suite.
- CI (`.github/workflows/ci.yml`, `bff` job, ~L61-75) provisions **no Postgres and no Redis** (`services:` block absent) and runs bare `dotnet test --no-build` with no count assertion. Net effect: in CI the entire DB-touching suite silently no-ops; the only real HTTP test executing is `SmokeTest.Root_Returns_Ok`. "BFF 355/355 green" in CI is a compile check.
- Two files duplicate the gate privately instead of using the shared helper: `BillingCreditsEndpointsTests.cs:84-93`, `CreditLedgerServiceTests.cs:26-35` (the latter's "Testcontainers Postgres" comment is aspirational — no Testcontainers package exists).
- Playwright is **already scaffolded** in frontend-spectr-v2 (`@playwright/test ^1.49.1`, `playwright.config.ts` with `testDir: './playwright'`, `npm run test:e2e`), including `slice-1-happy-path.spec.ts` — the exact register→upload→report flow — but its selectors are stale against the current UI (see Dev Notes) and it stops before Listen.
- 12-1's error-code contract covers 5 dispatch codes across two files; `rate_limited` (429) and the per-IP `entitlement_exhausted` branch lack envelope-contract tests.

**Deferred here from story 12-2's Senior Review Record:** (a) silent-skip integration-test pattern + storage-probe test weakness; (b) launcher check-vs-window python-profile divergence; (c) `TestEnv` pin excluding dev fast-tier config from factory hosts (document/cover, not remove).

## Acceptance Criteria

1. **Given** BFF integration tests without Postgres, **Then** they report as SKIPPED (visible count in test output) instead of silently returning green — and in CI, where the DB is expected, an unreachable DB is a **failure**, not a skip.
2. **Given** the local dev stack, **Then** one headless Playwright smoke test runs: register → upload fixture WAV → wait for report → open Listen — catching verify-gate, dead-handoff, and dead-UI regressions in one pass.
3. **Given** dispatch endpoints, **Then** a contract test asserts every dispatch-path 4xx carries a machine-readable `code` (pairs with 12.1 AC5) — closing the `rate_limited` and per-IP `entitlement_exhausted` gaps.
4. **Given** CI, **Then** the `bff` job provisions Postgres + Redis services so the suite actually executes, and a canary asserts the DB was reachable (fail-loud when infra wiring breaks).
5. **Given** the launcher (`start-spectr.ps1`), **Then** the python used for the worker import-check is the SAME interpreter (absolute path) launched in the worker window — no check-vs-window profile divergence.

## Tasks / Subtasks

- [x] Task 1: Fail-loud skip machinery (AC: 1, 4)
  - [x] Add `Xunit.SkippableFact` (v1.5.x, xunit 2.9-compatible) to `Spectr.Bff.Tests.csproj`.
  - [x] New helper in `TestSupport.cs`: `TestDb.RequireAsync(factory)` — probes like `Reachable`, then: if unreachable AND env `SPECTR_REQUIRE_DB=1` → `Assert.Fail("Postgres required but unreachable")`; if unreachable otherwise → `Skip.If(true, "Postgres unreachable — integration test skipped")`. Keep `Reachable` (marked obsolete) until the sweep completes, then delete.
  - [x] Mechanical sweep: all ~335 `if (!await TestDb.Reachable(...)) { return; }` sites → `await TestDb.RequireAsync(_factory);` and `[Fact]` → `[SkippableFact]` (`[Theory]` → `[SkippableTheory]`) on the gated tests only. Fold the two private `PostgresReachable()` copies (`BillingCreditsEndpointsTests`, `CreditLedgerServiceTests`) into the shared helper.
  - [x] Verify: `dotnet test` with docker stopped → skipped count ≈ gated test count, 0 failures; with stack up → same pass count as before (355+).
- [x] Task 2: CI provisions the DB and fails loud (AC: 1, 4)
  - [x] `.github/workflows/ci.yml` `bff` job: add `services:` postgres:16 (user/pass/db `spectr`, health-check) + redis:7, map 5432/6379. Set `SPECTR_REQUIRE_DB=1` and `ConnectionStrings__Postgres` env on the Test step (host `localhost`).
  - [x] EF schema: apply migrations before tests (`dotnet ef database update` step, or reuse BootMigrator path if simpler — pick ONE, note in completion).
  - [x] Canary test `CiDbCanaryTests`: plain `[Fact]` (not skippable) asserting `CanConnectAsync()` **only when** `SPECTR_REQUIRE_DB=1`, else no-op-pass with a log line. This is the fail-loud tripwire if services wiring regresses.
- [x] Task 3: Rewrite the Playwright smoke (AC: 2)
  - [x] Replace `playwright/slice-1-happy-path.spec.ts` with `playwright/smoke-first-run.spec.ts` (serial, `test.setTimeout(360_000)`): register (`getByLabel('Email'/'Password')`, button `Create account`) → library empty state (`Your library starts here`) → `+ New song` → NewSongDialog (name input, button `Create song`) → UnifiedUploadDialog (`New version` title, mix `input[type="file"]` scoped to the mix zone, button `Upload & analyze`) → results URL `/songs/$songId/results/$jobId` → wait for `Analysis in progress` hidden + ReportView ready signal; assert `Analysis failed.` NEVER appears → click RackSidebar `Open in Listen` → assert URL `/listen-rack/{versionId}` and page mounts.
  - [x] Add `data-testid="report-view"` to `ReportView` root (`features/results/ReportView.tsx` ~L242) as the hard ready signal.
  - [x] Fixture: keep `playwright/fixtures/` convention. Write `fixtures/gen-wav.mjs` — dependency-free PCM WAV writer (5 s stereo 440 Hz sine, 44.1 kHz s16le, ~0.9 MB) — invoked from a Playwright `globalSetup` when `test-tone.wav` is absent. No ffmpeg/sox requirement, nothing binary committed. Update `fixtures/README.md`.
  - [x] Config: keep `webServer` (Vite only) as-is; document in the spec header the required stack (BFF Development + `Auth:DevAutoVerify`, worker with `LLM_FAKE=1` from the prepared venv, postgres+redis; MinIO NOT required — proxy-upload fallback path is the one exercised). Headless is Playwright's default — do not set `headless: false` anywhere.
  - [x] Set `VITE_ROOM_LIVE_SSE=0` for the e2e run if the Listen SSE connection flakes; otherwise leave default.
- [x] Task 4: Dispatch 4xx contract completion (AC: 3)
  - [x] `DispatchErrorContractTests`: add `rate_limited` 429 envelope test (enable `RateLimits:Enabled` via `UseSetting` for that factory, drive past the per-IP dispatch ceiling) and the per-IP `entitlement_exhausted` branch (`VersionEndpoints.cs:~1146`).
  - [x] Assert-shape helper reuse (`AssertEnvelopeAsync`) — no new assertion style.
  - [x] Note in Dev Notes (NOT in-scope): non-dispatch endpoints still emit legacy `{ error: "string" }`/ProblemDetails shapes (~28 files); envelope migration is a separate follow-on story candidate.
- [x] Task 5: Launcher python-profile pin (AC: 5)
  - [x] `start-spectr.ps1`: resolve `$python = (Get-Command python).Source` once (honor `$env:SPECTR_PYTHON` override first); use that absolute path in BOTH the 12-2 import-check and the worker window command line. Print the resolved path in the boot summary.
  - [x] Static parse check only (`[System.Management.Automation.Language.Parser]::ParseFile`) — DO NOT execute the launcher (spawns windows).
- [x] Task 6: TestEnv pin documentation + coverage (deferral (c))
  - [x] Comment on `TestEnv.cs` explaining the pin excludes dev fast-tier reaper config from ALL factory hosts; add one explicit-options test (or point to the existing `StaleJobReaperTests` fast-tier unit coverage) so the dev 5-min tier is verifiably tested somewhere.
- [x] Task 7: Validation gates (all)
  - [x] BFF: `dotnet build && dotnet test` — with dev stack UP (real signal) AND once with docker stopped (assert skip count visible, zero failures).
  - [x] Frontend: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run` (vitest excludes `playwright/**` — confirm still true).
  - [x] Smoke: boot postgres+redis (compose), BFF (`dotnet run`, Development) + worker (venv python, `LLM_FAKE=1`) as background processes — NO windows — then `npm run test:e2e` headless.
  - [x] Worker untouched except none expected; if touched: ruff + pytest.

## Dev Notes

### Verified code anchors

- Silent gate: `components/bff/tests/Spectr.Bff.Tests/TestSupport.cs:22-35` (`TestDb.Reachable`); call-site pattern e.g. `DispatchErrorContractTests.cs:63`. Private copies: `BillingCreditsEndpointsTests.cs:84-93`, `CreditLedgerServiceTests.cs:26-35`.
- CI: `.github/workflows/ci.yml` bff job ~L61-75 — no `services:`, bare `dotnet test --no-build`.
- Test csproj: xunit **2.9.2**, `Microsoft.AspNetCore.Mvc.Testing` 10.0.0; NO Testcontainers/Respawn. Cleanup is per-test `ExecuteDeleteAsync` + `TestAuth.AllowPurgeAsync` (`SET spectr.allow_purge='1'`, `TestSupport.cs:54-58`).
- Conn string: `Program.cs:36-37` `ConnectionStrings:Postgres`; default `appsettings.json:10` = localhost:5432 spectr/spectr. Env override: `ConnectionStrings__Postgres`.
- Contract tests: `DispatchErrorContractTests.cs` (4 codes on `POST /api/versions/{id}/analyze`: `email_verification_required` 403, `entitlement_exhausted` 409 @L1106 branch, `insufficient_credits` 409, `entitlements_unavailable` 503) + `DispatchReferenceTests.cs:129` (`reference_not_found` 404). Gaps: `rate_limited` 429 (`VersionEndpoints.cs:~1174`; only behavior-tested in `AbuseContainmentTests.cs:315`), per-IP `entitlement_exhausted` (`VersionEndpoints.cs:~1146`). `dispatch_failed` (`:~1290`) is a DB-row error code post-enqueue-throw, NOT an HTTP contract — out of scope.
- Playwright: `components/frontend-spectr-v2/playwright.config.ts` (`testDir: './playwright'`, chromium only, `baseURL http://localhost:5174`, `webServer` = Vite dev only). Existing `playwright/smoke.spec.ts` (trivial /login check — keep), `slice-1-happy-path.spec.ts` (STALE — replace).
- Smoke flow selectors (verified current): register `_public/register.tsx` (labels wrap inputs → `getByLabel` works; submit `Create account`; success = `window.location.assign('/library')`). Library: `SongsLibrarySection.tsx` header `+ New song` (~L748) + empty-state title `Your library starts here` (~L904). `NewSongDialog.tsx` → name via `SongFields.tsx:39-47` (placeholder `Untitled song`), submit `Create song`. `UnifiedUploadDialog.tsx`: with `songId` the title is `New version` (~L672); mix file input ~L757-762 (SEVERAL hidden file inputs exist — scope to the mix zone or `input[type="file"][accept*=".mp3"]` first); submit `Upload & analyze` (~L1121); mix-only path dispatches `POST /versions/{id}/analyze` then navigates to `/songs/$songId/results/$jobId`. Results route `songs.$songId.results.$jobId.tsx`: `useJob(jobId, {pollMs: 2000})`; in-progress h1 `Analysis in progress`; complete renders `ReportView` (no testid today — Task 3 adds one); failed panel text `Analysis failed.`. Listen: RackSidebar button `Open in Listen` (`RackSidebar.tsx:115-119`) → `/listen-rack/$versionId`.
- DevAutoVerify: `AuthEndpoints.cs:183-190` — Development AND `Auth:DevAutoVerify=true` (set in `appsettings.Development.json`) stamps `EmailVerifiedAt` at register. `RateLimits:Enabled=false` in Development.
- Worker determinism for smoke: `LLM_FAKE=1` read via `dramatiq_app.py` load_dotenv of `components/worker/.env` (`.env.example:36-37`); fake gateway = `app/llm/fake.py` (canned triage/coach/verdicts, zero network). `USE_DEMUCS=False` (`phase4_stems.py:27`). allin1 unavailable → `Allin1Unavailable` caught in `phase1_universal.py:248-257`, job COMPLETES degraded (`available:false`) — do NOT install the allin1 image for smoke runs; the degrade path is the fast path. 5 s WAV ⇒ analysis completes in seconds on a warm worker.
- Fixture reality: `playwright/fixtures/README.md` documents an uncommitted `test-tone.wav` (ffmpeg/sox recipes). BFF `tests/data/audio/**/source.wav` are 1024-byte placeholder blobs — NOT analyzable, never point the smoke at them.
- Launcher: `scripts/start-spectr.ps1` — infra = postgres+redis ONLY (no MinIO); worker window runs bare PATH `python` (~L72, ~L378); 12-2 import-check ~L363-379 pre-flights the same-named-but-possibly-different `python`. `Test-Preflight` L250-277.
- TestEnv pin: `TestEnv.cs:15-20` `[ModuleInitializer]` sets `Worker__PendingNoWorkerGraceMinutes=240` (factory hosts boot as Development; env var outranks appsettings).

### Design decisions

- **Skip mechanism = Xunit.SkippableFact package**, not xunit v3 `Assert.Skip` (suite is xunit 2.9.2; v3 migration is NOT this story). `RequireAsync` centralizes the probe so the CI-hard-fail arm (`SPECTR_REQUIRE_DB=1`) lives in ONE place.
- **CI gets real services** — skipping visibly is the guard rail, but the point of AC1 is that CI actually executes the suite. Postgres 16 + Redis 7 service containers match compose versions.
- **Smoke = local-stack test, not a CI job (yet).** Worker deps (librosa/torch) make a full-stack CI job a separate infra effort; wire the smoke into CI as a follow-on once a slim worker image exists. The story's deliverable is the reliable local headless run + the rewritten spec.
- **Fixture generated, not committed**: dependency-free WAV writer in `globalSetup` keeps binaries out of git and works on Windows without ffmpeg/sox.
- **Contract scope = dispatch paths only.** The 28-file legacy `{error:"string"}` sweep is a distinct story candidate (log in deferred-work ledger via 12-8).

### Constraints & gotchas

- **NO VISIBLE WINDOWS** (standing rule, Brian at work): never run `start-spectr.ps1`; boot BFF/worker as background processes; Playwright stays headless (default — just don't set `headless:false` or use `--headed`/`--ui`).
- Worker python = prepared venv `%TEMP%\spectr-lock-venv` (system python imports dramatiq but NOT audio_analysis — the exact divergence AC5 fixes).
- BFF exe file-lock: stop any running BFF before `dotnet build`.
- Known BFF parallel flakes (rerun before diagnosing): CoachStream, DispatchReference/CoachProMonthlyCap pairs, `Concurrent_Posts_Converge` (12-6 fixes the test double — do NOT fix it here, just rerun).
- The SkippableFact sweep is large but mechanical — do it with careful search/replace, verify counts, and DON'T reformat unrelated code (review diff noise).
- `slice-1-happy-path.spec.ts` selector deltas (all verified): no "Library" heading / "No songs yet" / "Upload your first track" / `[data-testid="final-json"]` / plain `Upload` button. Two-dialog flow (NewSongDialog THEN UnifiedUploadDialog).
- Vitest must keep excluding `playwright/**` (`vitest.config.ts` include/exclude — don't break it).
- Dispatch 429 test: enable `RateLimits:Enabled=true` + limiter windows persist 1 hour across runs — clear limiter keys up front (see `AbuseContainmentTests` J6 pattern, incl. `FakeIpStartupFilter` since TestServer IP is null).
- EF migrations in CI: BootMigrator is gated `Migrations__ApplyAtBoot` — if using it for CI schema, set the env only on the test step; don't change its default.

### Testing standards

- xUnit + WebApplicationFactory integration style (no separate unit project). New tests follow `AssertEnvelopeAsync` helper reuse. Playwright: `@playwright/test` runner, chromium, serial for the smoke, generous timeouts (existing 360 s pattern).

### Previous story intelligence

- 12-2: TestEnv pin exists BECAUSE factory hosts load appsettings.Development.json; env vars are the only later-loading override. Never crash for a log line. Launcher `Fail`/`Warn`/`Good`/`Info` helpers; PS7 syntax OK.
- 12-3: static-parse-check the launcher, never execute it; worker test isolation — never import `dramatiq_app` in tests.
- 12-1: AR38 envelope `{error:{code,message}}`, frontend keys off `code` never message text; DevAutoVerify double-guard pattern.

### Project Structure Notes

- Smoke spec + fixtures live in `components/frontend-spectr-v2/playwright/` (configured `testDir`) — NO new top-level e2e folder.
- CI edits confined to `.github/workflows/ci.yml` bff job.
- No new components, no schema changes, no worker changes.

### References

- [Source: PRPs/epics.md — Epic 12, Story 12.7]
- [Source: PRPs/sprint-status.yaml — 12-2 note: deferred silent-skip pattern + launcher python-profile + TestEnv pin]
- [Source: PRPs/stories/12-2-failure-visibility-worker-health-and-progress-storyline.md — Senior Review Record deferrals]
- [Source: output/audit/2026-07-10_full-app-audit/findings.md — team improvement round]
- [Source: components/bff/tests/Spectr.Bff.Tests/TestSupport.cs, DispatchErrorContractTests.cs — current gate + contract state]
- [Source: components/frontend-spectr-v2/playwright.config.ts + playwright/ — existing E2E scaffold]

## Dev Agent Record

### Agent Model Used

### Debug Log References

- No-Postgres run (docker stopped): `Failed: 5, Passed: 76, Skipped: 278, Total: 359` — skips now VISIBLE; the 5 failures are pre-existing Redis-at-boot failures (same 5 red in CI since the 12-2 merge; fixed by CI Redis service + they pass with local stack up).
- CI archaeology: master CI red for ≥8 runs — `bff` job red since 12-2 merge (5 Redis-boot test failures; DB suite silently no-oped), `python` job red since ≥10-6 (6 tests monkeypatching `LOCAL_ROOT="/root"` — PermissionError as non-root Linux runner; fine on Windows where `C:\root` simply doesn't exist).
- Worker fix verified: 6/6 pass (venv run, 3m18s).

### Completion Notes List

- Discovered scope delta: 27 private `PostgresReachable()` copies (not 2) + 5 silent Redis gates. Swept ALL: 276 Postgres gate sites → `TestDb.RequireAsync(_factory)` (24 uniform private copies regex-removed, 3 multiline-catch variants removed by hand), 5 Redis gates → `TestDb.Require(bool, "Redis")`. 52 files swapped to `[SkippableFact]`/`[SkippableTheory]` (Xunit.SkippableFact 1.5.61).
- `SPECTR_REQUIRE_DB=1` (CI test step) turns unreachable deps into hard failures; `CiDbCanaryTests` is the tripwire if the services block breaks.
- CI `bff` job: postgres:16 + redis:7 services, EF migrate step (`ASPNETCORE_ENVIRONMENT=Development` — non-Dev boot refuses without real signing keys), `SPECTR_REQUIRE_DB=1` on the test step.
- Fixed the long-red CI `python` job: the two harness fixtures now use `tmp_path` instead of `"/root"`.
- AC3 implemented as CONTRACT REUSE, not new burn-machinery: envelope assertion promoted to shared `TestContract.AssertEnvelopeAsync`; the existing `rate_limited` (CrossAccount per-IP) and disposable-cap `entitlement_exhausted` behavior tests upgraded from code-substring asserts to full envelope contract. `dispatch_failed` is a DB-row code, not HTTP — out of scope as designed.
- Smoke: `smoke-first-run.spec.ts` replaces stale `slice-1-happy-path.spec.ts` (two-dialog flow, `Upload & analyze`, report-ready via new `data-testid="report-view"`, fail-fast on `Analysis failed.`, final `Open in Listen` → `/listen-rack/*` assert). Fixture WAV generated by dependency-free `gen-wav.mjs` via `globalSetup` — nothing binary committed, no ffmpeg. Headless only.
- Launcher AC5: `$PythonExe` resolved once (`$env:SPECTR_PYTHON` override → `(Get-Command python).Source`), used by BOTH the import check and the worker window; resolved path printed. Static parse OK (never executed — no-window rule).
- eslint: `playwright/**/*.mjs` added to the Node-globals override (generator lints as Node, not browser).
- **Smoke found a REAL auth bug (fixed)**: the boot silent-refresh in `AuthContext` was not single-flight — React StrictMode dev double-invokes the mount effect, two concurrent `POST /api/auth/refresh` race, rotation 401s the loser, and `applyAuth(null)` logs the fresh session straight back out (BFF log: 200 + 401 + 401 in one second). Fixed with a module-level in-flight promise sharing the parsed result.
- Smoke robustness: cold Vite dev streams route modules after first paint; a late module swap remounts the register form and wipes fills → submit blocked by HTML5 `required` with no POST fired. The spec settles on `networkidle` then retries fill→verify→submit→navigated as one `toPass` unit (retry-safe: the only observed failure mode fires no POST).
- Smoke final leg DEVIATION (documented): the report's RackSidebar "Open in Listen" is `disabled` until a fix is committed to the rack (`committed.length === 0`) — on a fresh LLM_FAKE report nothing is committed. The smoke asserts Listen reachability via the library card's Play button (`title="Play latest version"` → `/listen-rack/$versionId`); the fix-carry-over handoff is exactly story 12-4's integration test, not this smoke's job.
- Smoke run: **PASSED headless in 16.8 s** against the local stack (register → upload via proxy fallback → analysis complete → report → Listen page mounts with audio/presets/sessions all 200). Diagnostics (API request/response + pageerror logging) left in the spec so failures self-explain.
- MEASURED smoke wall-clock: warm worker analyzes the 5 s fixture in seconds; the 360 s budget is cold-start headroom only.

### File List

- components/bff/tests/Spectr.Bff.Tests/Spectr.Bff.Tests.csproj (modified — Xunit.SkippableFact 1.5.61)
- components/bff/tests/Spectr.Bff.Tests/TestSupport.cs (modified — TestDb.RequireAsync + TestDb.Require + TestContract.AssertEnvelopeAsync)
- components/bff/tests/Spectr.Bff.Tests/TestEnv.cs (modified — pin-exclusion documentation)
- components/bff/tests/Spectr.Bff.Tests/CiDbCanaryTests.cs (new)
- components/bff/tests/Spectr.Bff.Tests/*.cs (52 files — mechanical sweep: gates → RequireAsync, [Fact]→[SkippableFact], private PostgresReachable copies removed; AbuseContainmentTests + DispatchErrorContractTests also carry the AC3 contract upgrades)
- components/worker/tests/test_analyze_audio_job_problems.py (modified — tmp_path LOCAL_ROOT)
- components/worker/tests/test_analyze_audio_job_reference.py (modified — tmp_path LOCAL_ROOT)
- .github/workflows/ci.yml (modified — bff services + migrate + SPECTR_REQUIRE_DB)
- components/frontend-spectr-v2/playwright/smoke-first-run.spec.ts (new)
- components/frontend-spectr-v2/playwright/slice-1-happy-path.spec.ts (deleted)
- components/frontend-spectr-v2/playwright/global-setup.ts (new)
- components/frontend-spectr-v2/playwright/fixtures/gen-wav.mjs (new)
- components/frontend-spectr-v2/playwright/fixtures/README.md (modified)
- components/frontend-spectr-v2/playwright.config.ts (modified — globalSetup)
- components/frontend-spectr-v2/eslint.config.js (modified — playwright mjs node globals)
- components/frontend-spectr-v2/src/features/results/ReportView.tsx (modified — data-testid)
- components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx (modified — data-testid)
- components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx (modified — data-testid on mix input)
- components/frontend-spectr-v2/src/auth/AuthContext.tsx (modified — single-flight boot refresh, bug found by the smoke)
- scripts/start-spectr.ps1 (modified — $PythonExe pin, AC5)
- PRPs/sprint-status.yaml (status flips)
- PRPs/stories/12-7-test-integrity-smoke-e2e-and-fail-loud-suites.md (this file)

## Senior Review Record (bmad-code-review, 2026-07-13)

Three-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor) of `master..story/12-7-test-integrity` (PR #41). Auditor verdict: **all 5 ACs Met**. Findings triaged; patches applied on the story branch:

- **P1 (all 3 layers, High)**: 4 silent `RedisUp` early-return gates survived the sweep in `AbuseContainmentTests` (the sweep grep only matched `RedisReachable`) — including the test carrying the AC3 `rate_limited` contract. All 4 → `TestDb.Require(TestDb.RedisUp(_factory), "Redis")`; the private `RedisUp` folded into a shared `TestDb.RedisUp` helper.
- **P2**: the 5 pre-existing Redis-at-boot failures (SmokeTest, ErrorEnvelopeLeakTests, Get_Plans, Webhook_Missing_Signature, SpinePrimitives opaque-token) are now Redis-gated skip-visible — the no-docker run is 0-failure for real (Task 1's original verify criterion now true). ErrorEnvelopeLeakTests' review-M3 "no gate" note updated: CI provisions Redis + REQUIRE_DB hard-fails, so the proof cannot go vacuous.
- **P3 (Edge Case Hunter, Med — real bug)**: AuthContext and fetcher.ts each had their OWN single-flight refresh; a concurrent boot-refresh + 401-refresh still raced rotation. Unified: `fetcher.refreshSession()` is THE single-flight for the tab; fetcher's `refreshToken` and AuthContext's `refresh` both consume it.
- **P4 (Med)**: logout/refresh interleave — logout bumps a session epoch; a refresh resolving after logout can no longer re-apply a stale session.
- **P5**: smoke retry idempotency — fresh email per attempt + short-circuit when already on /library; toPass budget 90 s. Query strings redacted from smoke diagnostics (audio `?t=` JWTs must not land in CI artifacts).
- **P6**: CI — `ConnectionStrings__Postgres` set explicitly on migrate + test steps (no silent coupling to the appsettings default); `dotnet-ef` pinned `--version "10.*"`.
- **P7**: canary — logged no-op when disarmed, plus a Redis canary arm; skip/fail reasons now carry the last probe exception (`LastProbeError`).
- **P8**: launcher — `Test-Path -PathType Leaf` + distinct message for a set-but-invalid `SPECTR_PYTHON`. Stray double blank lines from the method removals collapsed (18 files).
- **Record corrections**: the spec's "per-IP `entitlement_exhausted` @~1146" was a mislabel — `:1146` is the DISPOSABLE-cap branch (covered); the per-IP arm emits only `rate_limited` `:1174` (covered). Counts reconciled: 276 Postgres gate call-sites rewritten + 9 Redis gates (5 in dev + 4 in review) across 53 files; 278 = gated tests skipped in the no-DB run (a test can hold >1 gate call, and some gated tests were failing pre-gate).
- **Accepted without change (documented)**: file-scoped `[SkippableFact]` swap also covers never-gating tests in gated files (SkippableFact behaves identically to Fact absent a SkipException); `SPECTR_REQUIRE_DB` arms only on exact `"1"` (documented at both read sites); `Reachable` kept un-`[Obsolete]` (it is the probe consumed by RequireAsync + the canary); playwright/ stays outside the tsc gate (Playwright transpiles its own runner files).

## Change Log

- 2026-07-13: Story created (create-story workflow) — folds in 12-2 review deferrals; scouted anchors verified against current code.
- 2026-07-13: Implemented (dev-story). Skip sweep 276 gates + 5 Redis gates across 52 files; CI bff services + SPECTR_REQUIRE_DB + canary; fixed the long-red CI python job ("/root" fixture root); headless smoke rewritten and PASSING (16.8 s); AuthContext boot-refresh single-flight bug found by the smoke and fixed; launcher python pin; TestEnv pin documented. Status → review.
