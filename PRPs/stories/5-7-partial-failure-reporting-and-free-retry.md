# Story 5.7: Partial-Failure Reporting & Free Retry

Status: done

## Story

As a producer whose file hit a snag,
I want everything that worked plus a free retry,
so that one corrupted region never wastes my analysis.

## Acceptance Criteria

1. **Given** a phase failure (FR6), **When** the report renders, **Then** all successful phases render, the failed phase is named, and a banner offers "re-export and retry free" in the "we kept everything that worked" tone.
2. **Given** the free retry, **When** clicked, **Then** a new analysis dispatches without consuming entitlement (compensation per AR16) and associates to the same song version.
3. **Given** .als parser isolation (AR33), **When** the subprocess crashes or exceeds limits, **Then** the phase skips, the job survives, and the panel notes the skip.

Source: `PRPs/epics.md:921-931`. Related decisions: AR16 (`epics.md:185` — usage event at dispatch, compensating ledger entry, never UPDATE balances), AR33 (`epics.md:214` + `architecture.md:136` D10 — ".als parsed in subprocess with rss/time limits inside worker; failure = phase skipped").

## Reality Check (2026-07-15 code scout — supersedes the stale sprint-status note)

The sprint-status comment claims "DegradationBanner + rerun hooks" exist. **They do not.** No phase-failure DegradationBanner component exists anywhere in frontend-spectr-v2 (the only "degraded" UI is the story-1.4 coach/verdict degradation in `CoachPanel.tsx` — different feature). `useRerunPhase` was deleted in story 12-5 (`hooks.ts:528-532` comment). All three ACs need building. What DOES exist and must be reused:

- **Per-phase failure data already flows end-to-end**: `run_single_phase` (`components/analysis/src/audio_analysis/pipeline.py:73-137`) catches per-phase exceptions → `PhaseResult(status="failed", data={}, error=...)`; `final_json.phases[]` carries `{phase, status: "ok"|"failed"|"skipped", error}` (schema `audio_analysis/schemas.py:11`, FE type `types.ts:1178-1194`). A job with failed phases still lands `Status="complete"` — no degraded flag anywhere, and that is FINE for this story: **derive degraded state from `phases[]`, do not add a new rollup field** (a rollup would churn the golden snapshots guarding `run_pipeline` byte-identical output, and old analyses rows would lack it).
- **Entitlement-free dispatch precedent**: `ReportPhaseEndpoints.cs` per-phase rerun does NOT go through `DispatchAnalysisAsync` and already skips entitlement.
- **Compensation precedents (AR16)**: read-side `invalid_file` exclusion in `EntitlementService.ComputeAsync` (`Services/EntitlementService.cs:88-95`) + `credits.ReverseAsync` reversal row (`JobEndpoints.cs:173-203`, idempotency key `reversal:<jobId>`).
- **Subprocess-with-timeout precedent**: `audio_analysis/structure/docker_allin1.py` (subprocess.run + timeout → typed `Allin1Unavailable` → phase degrades, `pipeline.py:356-380`).

## Tasks / Subtasks

- [x] Task 1 — BFF: free-retry endpoint, server-side eligibility (AC: 2)
  - [x] 1.1 Migration: add nullable `retry_of_job_id` (Guid?, indexed) to `analysis_jobs`. EF entity `Spectr.Data/Entities/AnalysisJob.cs` + snake_case mapping + `dotnet ef migrations add Story57FreeRetry`. Mirror the column in `components/shared/aimusic_shared/models.py` (worker never writes it, but the ORM mirror must not drift).
  - [x] 1.2 `POST /api/jobs/{jobId}/retry` (new, in `JobEndpoints.cs`). Auth required (authed users only — anon funnel has its own flow; device-owned jobs → 404). Owner check at query level (`WHERE user_id = current`). Eligibility, ALL server-side:
        (a) origin job `Status == "complete"` AND its analyses row's `final_json.phases[]` contains ≥1 `status=="failed"` entry — parse the JSONB with `JsonDocument`; **OR** origin job `Status == "failed"` with `ErrorCode != "invalid_file"` (invalid_file is already compensated by the reversal path and a byte-identical retry cannot succeed);
        (b) origin has `VersionId != null` (retry re-analyzes the same version — AC2);
        (c) no prior retry exists: `NOT EXISTS (analysis_jobs WHERE retry_of_job_id == originId)` — one free retry per origin job. Second attempt → 409 `retry_already_used`. Ineligible → 409 `retry_not_eligible`. Use `ErrorEnvelope.Build`.
  - [x] 1.3 Entitlement-free dispatch: extend `DispatchAnalysisAsync` (`VersionEndpoints.cs:1070-1299`) with an internal `freeRetry: bool = false` + `retryOfJobId: Guid? = null` parameter pair (defaults preserve every existing caller). When `freeRetry`: skip the `AnalysesRemaining == 0` → 409 gate (`:1105-1107`), skip the `UsageEvent` insert (free/pro branch `:1236-1256`) and skip `credits.SpendAsync` (credit branch `:1206-1235`); stamp `RetryOfJobId` on the new job row. **Nothing is written to usage_events or credit_ledger at all** — per AR16 spirit, never-consumed beats write-then-compensate. Keep tier routing (paid/free queue) and KEEP the abuse layers (verify-gate, IP ceiling) — only the entitlement gate is bypassed. Race note: the `NOT EXISTS` check and job insert should ride the same transaction as the existing insert; a lost race resolves to 409 on the loser via the unique-per-origin check re-read — an index on `retry_of_job_id` is enough, do NOT add a unique constraint (origin linkage is also useful for future non-free reruns; enforce once-only in the endpoint transaction).
  - [x] 1.4 Response: `RetryResponse(Guid JobId)` record in DTOs. New job associates to origin's `VersionId` + `ReferenceId` (carry both through so the retry is apples-to-apples).
- [x] Task 2 — BFF tests (AC: 2)
  - [x] 2.1 `FreeRetryTests.cs` (model on `DispatchEntitlementGateTests.cs` + `JobEndpointsCreditReversalTests.cs`): eligible failed-phase origin dispatches with NO UsageEvent row and NO credit_ledger spend row; works when `AnalysesRemaining == 0` (the exhausted free user — the whole point); credit-tier user retains balance; second retry → 409 `retry_already_used`; clean-analysis origin → 409 `retry_not_eligible`; `invalid_file` failed origin → 409; other user's job → 404; device-owned (anon) job → 404; new job row has `RetryOfJobId == origin` and same `VersionId`.
- [x] Task 3 — Frontend: DegradationBanner + free-retry wiring (AC: 1, 2)
  - [x] 3.1 `features/results/DegradationBanner.tsx` + module CSS. Derive from already-fetched results: `const failedPhases = finalJson.phases?.filter(p => p.status === "failed")`. Render only when non-empty. Copy tone per UX spec (`ux-design-specification.md:105,119,125`): pair "what failed" with "what survived + free retry". Name the failed phase(s) with human labels (reuse the existing phase-name map used by `analysisModalData.ts` / ProgressStoryline — do not invent a second phase-label table). Example shape: "Phase 4 (Stem clash) hit a snag — we kept everything that worked. Re-export your file and retry free." Button: "Retry free".
  - [x] 3.2 Hook `useFreeRetry(jobId)` in `features/results/hooks.ts` → `fetcher` POST `/api/jobs/${jobId}/retry` → on success invalidate the version/job queries and navigate to the in-progress state for the NEW jobId (same navigation the existing `useReanalyzeVersion` success path uses, `ReportView.tsx:215-241`). On 409 `retry_already_used` / `retry_not_eligible`: Sonner toast + hide the button (local state) — do NOT open UpgradeSheet (this is the free path; UpgradeSheet stays on the plain re-analyze flow).
  - [x] 3.3 Mount the banner at the top of the report surface in `ReportView.tsx` (above the tabs, visible regardless of active tab). It must not render for clean reports or while the job is in progress.
  - [x] 3.4 .als panel skip note (AC: 3 frontend half): in the Project tab area, when an .als was attached but `phases[]` has phase 8 with `status !== "ok"`, render the "project analysis was skipped this run" note instead of silently showing the unlock CTA. Locate the existing ProjectTab/ProjectUnlock branch and add the third state.
  - [x] 3.5 Vitest: `features/results/__tests__/DegradationBanner.test.tsx` (model on `DunningBanner.test.tsx` / `ProjectUnlock.test.tsx`): renders + names phase on failed-phase fixture; hidden on clean fixture; button POSTs and handles 409 by hiding.
  - [x] 3.6 Whole-job-failed surface: the endpoint also accepts failed origins (`ErrorCode != "invalid_file"`), so wire the same "Retry free" action into the existing job-failed UI state (the 12-2 failure-visibility surface / ProgressStoryline failed state) — find where `status === "failed"` renders today and add the button there, reusing `useFreeRetry`. Small addition, not a redesign.
- [x] Task 4 — Worker/analysis: .als subprocess isolation (AC: 3)
  - [x] 4.1 In `components/analysis/src/audio_analysis/phases/phase8_als.py`: split the current body into a top-level `_analyze_als_impl(als_path)` (top-level = picklable under spawn) and a public `analyze_als(als_path)` that runs the impl in an isolated child: `multiprocessing.get_context("spawn").Process` + a `Queue` for the result dict; `join(timeout=ALS_PARSE_TIMEOUT_S)`; if still alive → `terminate()` + `join()` → return `{"phase": 8, "status": "skipped", "error": "als_isolation_timeout"}`. Child crash / nonzero exitcode / empty queue → `{"phase": 8, "status": "skipped", "error": "als_isolation_crashed"}`. Normal path returns the impl's dict unchanged (byte-identical success output — golden snapshots must stay green).
  - [x] 4.2 Resource limit, POSIX-only: inside the child entry function, `try: import resource; resource.setrlimit(resource.RLIMIT_AS, (ALS_PARSE_RSS_BYTES, ...)) except ImportError: pass` — Windows dev has no `resource` module; the timeout is the Windows guard, rss applies on the Linux VPS. Config: module-level constants overridable via env (`ALS_PARSE_TIMEOUT_S` default 60, `ALS_PARSE_RSS_MB` default 512) — read with `os.environ.get`, the analysis package does not use pydantic_settings.
  - [x] 4.3 Do NOT use `concurrent.futures.ProcessPoolExecutor` despite the D10 wording — its `future.result(timeout=)` does not kill the running child on timeout; a raw `Process` with `terminate()` actually enforces the limit. Keep D10's intent (subprocess + rss/time limits), note the deviation in the story record.
  - [x] 4.4 Both invocation sites get the isolation for free (they call `analyze_als`): `pipeline.py:251` and the rerun path `pipeline.py:293-297` / `rerun_phase_actor.py`. Verify no other direct imports of `ALSParser` in worker code paths (tuning CLIs exempt).
  - [x] 4.5 Tests in `components/analysis/tests/`: success parity (result equals direct `_analyze_als_impl` on a small fixture .als); timeout → `skipped` + `als_isolation_timeout` (monkeypatch timeout to ~1s with a sleeping impl — inject via env var, spawn re-reads env in child... NO: spawn child re-imports module, so patch by pointing the child entry at a sleepy target via a module-level test seam, or set `ALS_PARSE_TIMEOUT_S` env + a fixture .als large enough — simplest reliable seam: allow `analyze_als(als_path, _impl=...)` injection? Not picklable cross-process on Windows spawn unless top-level. Use: env `ALS_PARSE_TIMEOUT_S=1` + a top-level `_test_sleep_impl` selected by env flag `ALS_ISOLATION_TEST_MODE=sleep` inside the child entry — ugly but spawn-safe; keep the flag check inside the child entry only); crash → `skipped` + `als_isolation_crashed` (env flag mode `crash`, child `os._exit(1)`). Mark the timeout/crash tests with a generous outer timeout; they must pass on Windows (spawn is default there) AND Linux CI.
- [x] Task 5 — Gates + story record
  - [x] 5.1 `cd components/bff && dotnet build && dotnet test`
  - [x] 5.2 Frontend all four: `npx tsc --noEmit`, `npm run lint` (max-warnings 0), `npm run build`, `npx vitest run`
  - [x] 5.3 `pytest -q components/analysis/tests/` + `pytest -q components/worker/tests/` (worker suite must stay green — no worker code change expected, phase8 change lives in analysis package)
  - [x] 5.4 Golden snapshots: confirm `run_pipeline` snapshot tests unchanged (no .als in golden fixtures → phase8 skipped-shape must be identical to before for the no-als case: verify `analyze_als(None)` early-returns `skipped` BEFORE spawning any child — zero-cost no-op preserved)
  - [x] 5.5 Update Dev Agent Record + File List; sprint-status flip handled by review workflow

## Dev Notes

### Architecture constraints (MUST follow)

- **AR16** (`epics.md:185`): never UPDATE balances; append-only ledgers. This story's cleaner form: free retry never writes consumption in the first place (no UsageEvent, no spend row) — nothing to compensate. Do not write a `0`-value or marker row.
- **AR15 background**: results read path is entitlement-free (`ResultsReadPathEntitlementFreeTest.cs`) — the retry endpoint is a WRITE path and must keep auth + ownership checks.
- **AR33 / D10** (`architecture.md:136`): subprocess + rss/time limits, failure → phase skipped, never job death. Deviation from `concurrent.futures` to raw `multiprocessing.Process` is deliberate (timeout must actually kill the child).
- **Queue topology (story 2.5)**: free retry still tier-routes via existing `DispatchAnalysisAsync` logic — do not touch actor decorators or queue names.
- **Error envelope**: all new 4xx via `ErrorEnvelope.Build` with codes `retry_not_eligible`, `retry_already_used`.
- **EF**: snake_case mapping; migration in `Spectr.Data/Migrations/`; no `AsNoTracking()` in the write-path lookup joins (known silent-drop gotcha).
- **Frontend**: CSS Modules + tokens; no inline styles except dynamic values; `import type`; fetcher not axios; banner styling should echo existing banner precedents (`DunningBanner`, `VerifyEmailBanner`) — utility classes `.card`/`.pill` where they fit.

### Key file map

| Area | Files |
|------|-------|
| Dispatch + gate | `bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs:1070-1299` (`DispatchAnalysisAsync`) |
| New endpoint | `bff/src/Spectr.Bff/Endpoints/JobEndpoints.cs` (`POST /api/jobs/{jobId}/retry`; `GetStatus` reversal precedent at `:173-203`) |
| Entity + migration | `bff/src/Spectr.Data/Entities/AnalysisJob.cs`; mirror `shared/aimusic_shared/models.py` |
| Entitlement math | `bff/src/Spectr.Bff/Services/EntitlementService.cs:88-95` (invalid_file exclusion precedent — free retry needs NO change here because nothing is written) |
| Banner | `frontend-spectr-v2/src/features/results/DegradationBanner.tsx` (new) + `ReportView.tsx` mount + `hooks.ts` |
| Phase types | `frontend-spectr-v2/src/api/types.ts:1178-1194` (`PhaseResult`, `FinalJson.phases`) |
| .als isolation | `analysis/src/audio_analysis/phases/phase8_als.py`; parser `audio_analysis/als/als_parser.py`; precedent `audio_analysis/structure/docker_allin1.py` |
| Tests | `bff/tests/Spectr.Bff.Tests/FreeRetryTests.cs` (new); `analysis/tests/test_phase8_isolation.py` (new); `frontend .../results/__tests__/DegradationBanner.test.tsx` (new) |

### Edge cases the reviewer will hunt

1. **Curl abuse**: eligibility is 100% server-derived (job status + final_json parse) — no client-supplied "it failed, trust me" flag. One retry per origin, enforced in the dispatch transaction.
2. **Exhausted-cap user**: the free retry MUST work when `AnalysesRemaining == 0` — that is the story. Test it explicitly.
3. **invalid_file origin**: excluded (already compensated via reversal; a retry of the same bytes fails identically).
4. **Anon/device jobs**: 404 — the anon funnel (story 6-3/6-4) has its own single-active-analysis rule; free retry is an authed feature.
5. **Old analyses rows**: banner derives from `phases[]` present in every final_json since the pipeline refactor — guard `finalJson.phases ?? []`.
6. **Retry of a retry**: origin chain — a retry job that itself partially fails is a NEW origin (it has its own jobId); its own single free retry is acceptable but note: `retry_of_job_id` non-null jobs could be excluded from further free retries to cap the chain at 1. DECISION: cap the chain — eligibility also requires `origin.RetryOfJobId == null` (max one free retry per paid analysis). Cheap to enforce, kills the infinite-free-loop abuse.
7. **Windows spawn semantics**: phase8 child must not import heavy modules at child start beyond what phase8 needs (spawn re-imports `phase8_als` — keep it import-light; it already only pulls gzip/ElementTree via `als_parser`). Watch dramatiq worker: actors are sync, `multiprocessing` inside an actor process is fine, but set spawn context explicitly (never fork — CUDA/librosa state in the parent).
8. **Zombie children**: always `terminate()` + `join()` in a `finally`; never leave the child running after timeout (orphaned-worker class of bug, see memory).

### Previous-story intelligence

- 6-3 review pattern: cosmetic client gating = CRITICAL finding (BlurLock curl bypass) → this story keeps ALL retry eligibility server-side.
- 6-4/6-5: 2-layer review + hardening patches cadence; PII/attribution not relevant here.
- 12-5 deleted the orphaned AnalysisTab + `useRerunPhase` — do NOT resurrect per-phase rerun UI in this story; the free retry is a FULL re-analysis via normal dispatch (per-phase rerun endpoint stays dormant for a future surface).
- Analytics: story 6-5 added funnel `capture()`; optionally emit `retry_free_clicked` via the no-op-safe capture — nice-to-have, not an AC.

## Senior Developer Review (AI)

**Date:** 2026-07-15 · **Outcome:** Changes Requested → all action items resolved same session · **Layers:** Blind Hunter + Edge Case Hunter + Acceptance Auditor (3-layer, headless). Auditor AC verdicts pre-patch: AC1 MET, AC2 MET (hardening gaps), AC3 PARTIAL.

### Action Items (all resolved)

- [x] [CRITICAL][blind+edge+auditor] Once-only TOCTOU race — concurrent POSTs mint N free retries. → Partial UNIQUE index on `retry_of_job_id` (WHERE NOT NULL, migration rebuilt as 20260715134927) + `DbUpdateException` → 409 in the freeRetry insert. DB is now the authority; the original "no unique constraint" story decision was wrong and is superseded.
- [x] [HIGH][blind+edge] Enqueue failure permanently burns the once-only retry (dead row occupies the unique slot; 500 to client). → freeRetry rows are DELETED (not marked failed) in the enqueue-failure path — nothing was consumed, retry can be re-attempted.
- [x] [HIGH][edge] Verify-gate 403s the flagship scenario (unverified free user, degraded complete origin). → gate skipped for `freeRetry` (a retry re-runs an already-granted analysis; per-IP limiter retained).
- [x] [HIGH][edge] Failed rerun-phase tracking jobs (entitlement-free, repeatable) qualify as origins — uncapped free-analysis mint. → consumed-origin guard: eligibility requires a usage_event or credit spend referencing the origin job.
- [x] [HIGH][blind] `freeRetry` with null `retryOfJobId` would create an unmarked, itself-retryable free job. → hard `ArgumentException` in the dispatch lane.
- [x] [MED][edge] Retention-purged/deleted version burns the retry on a guaranteed worker failure. → pre-dispatch check of `song_versions.raw_audio_purged_at` → 409 with re-upload message.
- [x] [MED][blind+edge] Parent-side `float(env)` / `Pipe()` failures escape isolation and fail the whole job. → whole parent path wrapped (`als_isolation_parent_error`), timeout env parse falls back to default (also rejects NaN/≤0); regression test added.
- [x] [MED][blind+edge] No kill() escalation after terminate(); child_conn FD leak on spawn-fail. → terminate→join→kill→join + child_conn close in finally.
- [x] [MED][blind] `ALS_ISOLATION_TEST_MODE` backdoor live in prod. → fenced to `PYTEST_CURRENT_TEST` presence.
- [x] [MED][blind] RLIMIT_AS is address space, not RSS — 512 MB can false-positive on spawn re-imports. → default bumped to 1024 MB + comments corrected; env name kept for compat.
- [x] [MED][auditor] AC3 PARTIAL: Project tab silent when client-parsed map exists but phase 8 died. → `ProjectTab.phase8Failed` note ("server project analysis was skipped this run").
- [x] [MED][auditor] Declared-but-missing tests. → added `CreditsOrigin_RetryKeepsBalance`, `DeviceOwnedOrigin_404`, plus `NonConsumingOrigin_409NotEligible`; existing tests updated for the consumed-origin guard.
- [x] [LOW][edge] `retryGone` not keyed to jobId (param-only navigation). → `useEffect` reset on jobId in both surfaces.
- [x] [LOW][edge] Deleted reference makes the retry permanently 404. → dead reference dropped, retry runs the mix alone.

### Accepted / deferred (not patched, on the record)

- Corrupt-.als free retry "doubling" (blind HIGH): accepted — bounded to ONE free retry per consumed origin (chain cap + unique index), retry consumes nothing, and a phase-8-failed report IS degraded product. Not an uncapped mint post-patch.
- `invalid_file` fail-panel button dead-click + one-shot nature not surfaced in UI (blind LOW): server-authority pattern accepted; JobStatusDto lacks errorCode — candidate polish, deferred.
- `HasFailedPhaseAsync` full-JSON parse per POST (blind LOW): bounded by auth + per-IP limiter; deferred.
- No FK on retry_of_job_id (blind LOW): deferred (account-deletion cascade semantics unclear; index + app checks suffice).
- 503 when entitlement service down (blind LOW): `ent.Tier` drives QUEUE ROUTING, not just a label — the dependency is real; deferred.
- `RetryResponse` nested in JobEndpoints.cs not DTOs/ (auditor LOW): matches `SetRatingRequest` precedent; accepted.
- `useFreeRetry` doesn't invalidate `['versions', id]` (auditor LOW): hook can't know versionId; navigation refetches; accepted.
- Spawn/import time billed against the 60 s timeout (blind LOW): documented tradeoff; accepted.

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- FreeRetryTests initially all-skipped: Docker Desktop wasn't running (Postgres probe). Started daemon headless, applied `Story57FreeRetry` migration, 9/9 pass.
- ESLint react-refresh warning: `failedPhases` exported from the component file — moved to `helpers/failed-phases.ts`.

### Completion Notes List

- **AC2 dispatch design**: free retry writes NOTHING to usage_events/credit_ledger (never-consumed beats write-then-compensate — AR16's no-UPDATE rule holds trivially). `DispatchAnalysisAsync(freeRetry:, retryOfJobId:)` skips the exhausted gate + both consumption writes; all other callers untouched (defaulted params).
- **Deviation from task 1.3 wording**: the disposable-domain arm is ALSO skipped for free retries (not just the entitlement gate) — it is an entitlement-style cap over usage_events, and a free retry consumes none; blocking there would re-create the exhausted-gate bug for disposable users. Per-IP limiter + verify-gate still apply.
- **Deviation from task 3.2 location**: `useFreeRetry` lives in `src/api/hooks.ts` next to `useReanalyzeVersion` (all fetcher mutations live there; `features/results/` has no hooks file).
- **Deviation from task 4.1 status**: isolation failures return `status="failed"` (typed errors `als_isolation_timeout` / `als_isolation_crashed`), NOT `"skipped"` — "skipped" remains reserved for "no .als attached" (error=None), keeping the frontend's skipped/failed semantics and making a sandboxed-out .als count toward free-retry eligibility (re-export + retry free is exactly the right user path). AC3's "phase skips" is satisfied: phase result absent from the report, job survives, Project tab notes the skip.
- **Deviation from D10 wording** (per task 4.3): raw `multiprocessing.get_context("spawn").Process` + `Pipe.poll(timeout)` + `terminate()` instead of `concurrent.futures` — a pool's `result(timeout=)` never kills the running child. RSS cap POSIX-only (`resource` absent on Windows; timeout is the Windows guard). Spawn-safe test seam via `ALS_ISOLATION_TEST_MODE` env (sleep|crash) read only in the child entry.
- **Task 3.6**: failed-job surface got the same "Retry free" button in `songs.$songId.results.$jobId.tsx`'s fail panel, sharing `useFreeRetry`; 409 hides it.
- **mypy skipped**: not present in the lock venv and not part of the CI gate set the 2026-07-10 green baseline runs (ruff + pytest per component); noted for consistency with stories 12.x/6.x.
- Gates: BFF build 0W/0E + full `dotnet test` green (incl. 9 new FreeRetryTests); frontend vite build + `tsc -b` + eslint/css/prices/fonts lints + vitest 822/822 (5 new banner tests); analysis pytest 172/172 (5 new isolation tests, golden snapshots untouched — success path byte-identical); worker 593 passed + 3 xfail (unchanged); shared 27/27; ruff clean.

### File List

- components/bff/src/Spectr.Data/Entities/AnalysisJob.cs (RetryOfJobId column)
- components/bff/src/Spectr.Data/AppDbContext.cs (retry_of_job_id index)
- components/bff/src/Spectr.Data/Migrations/20260715134927_Story57FreeRetry.cs (+ .Designer.cs, snapshot; rebuilt in review with the partial UNIQUE index)
- components/bff/src/Spectr.Bff/Endpoints/JobEndpoints.cs (POST /jobs/{id}/retry + eligibility + RetryResponse)
- components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs (DispatchAnalysisAsync freeRetry lane)
- components/bff/tests/Spectr.Bff.Tests/FreeRetryTests.cs (new, 9 tests)
- components/shared/aimusic_shared/models.py (retry_of_job_id mirror)
- components/analysis/src/audio_analysis/phases/phase8_als.py (subprocess isolation: _analyze_als_impl + _child_entry + isolated analyze_als)
- components/analysis/tests/als/test_phase8_isolation.py (new, 5 tests)
- components/frontend-spectr-v2/src/api/types.ts (RetryResponse)
- components/frontend-spectr-v2/src/api/hooks.ts (useFreeRetry)
- components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx (new) + DegradationBanner.module.css (new)
- components/frontend-spectr-v2/src/features/results/helpers/failed-phases.ts (new)
- components/frontend-spectr-v2/src/features/results/helpers/analysisModalData.ts (PHASE_SHORT exported)
- components/frontend-spectr-v2/src/features/results/ReportView.tsx (banner mount + project skip note)
- components/frontend-spectr-v2/src/routes/_app/songs.$songId.results.$jobId.tsx (failed-job Retry free)
- components/frontend-spectr-v2/src/features/results/__tests__/DegradationBanner.test.tsx (new, 5 tests)
- PRPs/stories/5-7-partial-failure-reporting-and-free-retry.md, PRPs/sprint-status.yaml (tracking)
