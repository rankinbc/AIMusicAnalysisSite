# Story 3.5: Upload & Job Persistence Resilience Verified

Status: done

## Story

As a producer on hotel wifi,
I want interrupted uploads and sessions to survive,
So that flaky connections never cost me an analysis.

## Acceptance Criteria

1. **Given** a user leaves mid-analysis, **When** they return, **Then** job progress restores via the existing SSE/poll path (FR8 regression through the storage change).
2. **Given** a worker restart with pending jobs, **When** the worker returns, **Then** queued jobs remain queued (not failed) and resume (NFR16).
3. **Given** a 190 MB FLAC on a flaky connection (Journey 2), **When** parts stall and retry, **Then** the upload completes and the analysis runs.

## Decisions of record (recon 2026-07-03)

1. **AC2 is currently VIOLATED, not just unverified**: both `StaleJobReaper` and `scripts/recover-jobs.ps1` fail `pending` jobs (keyed off `DispatchedAt` when `StartedAt` is null) after 30 min — a queued job waiting out a worker outage >30 min gets failed instead of resuming. Fix, not just test:
   - Reaper splits the predicate: `processing` jobs stale from `StartedAt` (abandoned mid-run — fail, `worker_unavailable`, unchanged semantics) vs `pending` jobs, which get a much longer `PendingGraceMinutes` (default **240**) from `DispatchedAt` — long enough to survive real restarts/outages/backlogs, short enough that a truly orphaned row (message lost from Redis) still resurfaces as re-runnable instead of spinning forever.
   - `recover-jobs.ps1` (dev launcher, runs BEFORE the new worker starts) fails **processing only** — pending messages are still in the Redis LIST and the about-to-start worker will consume them; failing them at launch was defeating resume by design.
2. **Redelivery guard in `analyze_audio_job`**: Phase A gets an already-`complete` check → clean no-op return. Today a duplicate/redelivered message regresses a completed job to `processing`, re-runs the whole pipeline, then Phase C's INSERT hits the unique `analyses.job_id` index → unhandled IntegrityError → dramatiq retry loop. (Mid-Phase-B crash redelivery still re-runs — correct: no analyses row exists yet.)
3. **AC1 = regression tests on the path the frontend ACTUALLY uses**: the Results page polls `GET /jobs/{id}` every 2 s via `useJob` (the SSE `/jobs/{id}/stream` endpoint exists but has NO frontend consumer — documented, not removed). Test: a `processing` job with phase data returns `status/currentPhase/phasePct` through the presigned-storage-era schema.
4. **AC3 = the 3.1 retry machinery is already unit-proven** (`multipart-upload-helpers.test.ts`: retry-in-place, never-redo-earlier-parts, throw-after-3, monotonic progress). Add the Journey-2 arithmetic case: 190 MB → 12 uniform 16 MiB parts, and record the re-sign verdict 3.1 deferred here: 12 parts × 3 attempts inside the 2 h URL window is ample at any plausible uplink (worst case ~36 part-PUTs; even at 2 Mbps a 16 MiB part ≈ 70 s ⇒ ~42 min total) — **no re-sign endpoint needed at this file cap**.
5. **No new features** — this is a verification story: two targeted hardening fixes (decisions 1-2), tests for the three ACs, and honest documentation of what the gate proved.

## Tasks / Subtasks

- [x] Task 1 — NFR16 fix: reaper + recovery script (AC: 2) — `WorkerOptions.PendingGraceMinutes` (240) + split predicate in `ReapAsync` (processing: `StartedAt ?? DispatchedAt < staleCutoff`; pending: `DispatchedAt < pendingCutoff`); `recover-jobs.ps1` processing-only; `StaleJobReaperTests` 4-scenario matrix in one test (queued-2h survives / queued-5h reaped / abandoned-40min reaped w/ `worker_unavailable` / live-5min untouched)
- [x] Task 2 — redelivery guard (AC: 2) — Phase A `status == complete` → log + no-op return; `test_redelivery_guard.py` proves no pipeline run, no validation, no status regression, no second analyses insert
- [x] Task 3 — AC1 progress-restore regression — `Progress_Restores_Via_The_Poll_Path_For_A_Processing_Job`: seeded processing job (stem_clash, 0.55) → `GET /jobs/{id}` surfaces status/currentPhase/phasePct
- [x] Task 4 — AC3 Journey-2 case — planParts 190 MB → 12 uniform parts test; re-sign verdict recorded (decision 4: not needed at 250 MB cap)
- [x] Task 5 — Gates: BFF 279/279 (2 new), worker 566 + 3 xfail (1 new), vitest 674 (1 new), tsc + lint + ruff clean; no schema change

## Dev Notes

- Reaper facts: 60 s interval BackgroundService, set-based ExecuteUpdate, `worker_unavailable` (deliberately ≠ `invalid_file` so no refund trigger), `WorkerOptions.StaleJobMinutes=30` default. Tests: none existed.
- `analyze_audio_job` facts: Phase A unconditionally flips to processing (no guard); Phase C fresh-uuid insert; `analyses.job_id` UNIQUE (snapshot L113-114) blocks dup rows but yields the retry-loop failure mode; InvalidFileError arm doesn't re-raise, generic arm does.
- `useJob(jobId, {pollMs:2000})` + `PhaseProgress` inline in `songs.$songId.results.$jobId.tsx` = the real FR8 surface. `StreamStatus` SSE polls the DB at 1500 ms server-side, breaks on terminal — unconsumed by any frontend code.
- dramatiq 2.2.0 pinned; repo policy (reaper + recover-jobs comments): do NOT rely on dramatiq's unacked-redelivery at low traffic — fail-and-resurface for STARTED work, queue-persistence for unstarted work (messages live in the Redis LIST until consumed).
- Worker test conventions: `_FakeSession` registry pattern (`test_analyze_audio_job_images.py`); BFF: `ReapAsync` internal seam (InternalsVisibleTo), Postgres-gated.
- Previous-review patterns to pre-empt: tests that prove the claim (pending-survives is THE assertion), fail-safe direction argued (pending grace >> restart time), no unbounded scans (ExecuteUpdate set-based already).

### References

- [Source: PRPs/epics.md#Story 3.5 (L738-748); NFR16 L131]
- [Source: components/bff/src/Spectr.Bff/Services/StaleJobReaper.cs; Options/WorkerOptions.cs; scripts/recover-jobs.ps1; scripts/start-spectr.ps1 (Invoke-Recovery)]
- [Source: components/worker/app/tasks_dramatiq.py (Phase A/C); AppDbContextModelSnapshot.cs L113-114 (unique job_id)]
- [Source: components/frontend-spectr-v2/src/api/hooks.ts (useJob); src/features/upload/__tests__/multipart-upload-helpers.test.ts]
- [Source: PRPs/stories/3-1-...md decision 5 (re-sign deferred to 3.5)]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- None — clean run; only transient tool-permission hiccup during BFF build (retried).

### Completion Notes List

- AC2 was a real violation, now fixed AND tested: pending jobs survive the 30-min window (the queue IS the persistence — messages sit in the Redis LIST until the worker returns) and only fail after 4 h grace as truly-orphaned resurfacing. recover-jobs.ps1 no longer fails pending jobs at dev launch (it runs before the worker starts — those jobs are about to resume).
- Redelivery guard closes the completed-job retry-loop failure mode (unique `analyses.job_id` + unguarded Phase A).
- AC1 verified on the poll path the frontend actually uses (`useJob` → GET /jobs/{id}); SSE `/stream` remains unconsumed by any frontend code (documented; removal not in scope).
- AC3: retry machinery was already unit-proven in 3.1; added the 190 MB/12-part Journey-2 case and recorded the re-sign sufficiency verdict — no re-sign endpoint needed at the 250 MB cap.

### File List

- `components/bff/src/Spectr.Bff/Options/WorkerOptions.cs` (PendingGraceMinutes)
- `components/bff/src/Spectr.Bff/Services/StaleJobReaper.cs` (split predicate)
- `components/bff/tests/Spectr.Bff.Tests/StaleJobReaperTests.cs` (new)
- `scripts/recover-jobs.ps1` (processing-only predicate)
- `components/worker/app/tasks_dramatiq.py` (Phase A redelivery guard)
- `components/worker/tests/test_redelivery_guard.py` (new)
- `components/frontend-spectr-v2/src/features/upload/__tests__/multipart-upload-helpers.test.ts` (190 MB case)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor; auditor ran the worker/frontend/BFF tests against live Postgres). Outcome: **Approve after patches** — all 3 ACs pass (AC2 "resume" with caveat below). 10 patches applied:

- [x] [High] Reaper-failed job resurrection: a job the reaper failed (`worker_unavailable`) whose message later arrived would silently flip failed → processing → complete, potentially double-running against the user's manual retry → guard extended to no-op on `failed + worker_unavailable` (other failure codes stay retryable — dramatiq max_retries is their legitimate re-entry); test added
- [x] [High] Messageless pending row: enqueue failure (Redis down) after the job row committed would now wait the FULL 4 h grace with credits never reversed → `DispatchAnalysisAsync` catches enqueue failure, fails the row `dispatch_failed`, rethrows
- [x] [Med] Same redelivery gap in `rerun_phase` + `detect_structure_job` → same complete-guard added to both
- [x] [Med] recover-jobs regression for genuine Redis queue loss (volume wipe/FLUSHALL — the old behavior's one legitimate case) → `-IncludePending` switch restores it explicitly; default stays processing-only
- [x] [Med] `PendingGraceMinutes < StaleJobMinutes` misconfig would fail QUEUED jobs faster than started ones → clamped via `Math.Max` in ReapAsync
- [x] [Low] Doc drift: recover-jobs `.DESCRIPTION`/`.EXAMPLE`s, start-spectr `Invoke-Recovery` comment, `WorkerOptions.StaleJobMinutes` comment (fallback now documented) — all updated
- [x] [Low] `appsettings.json` gets `PendingGraceMinutes: 240` (script treats appsettings as the knob source of truth)
- [x] [Low] 190 MB test comment rewritten honestly: it pins the part plan; the re-sign verdict is timing analysis in decision 4, not something the test proves
- [x] [Low] `[ValidateRange(1,10080)]` on recover-jobs `$StaleMinutes`
- [x] [Honesty] AC2 caveat recorded below.
- Deferred: TOCTOU row-lock on the Phase A guard (concurrent duplicate delivery while original consumer still runs) — each analysis lane has exactly ONE consumer process (`--processes 1`, W1/W2 split), so concurrent same-job delivery cannot occur in the current topology; revisit if consumers scale. Heartbeat-aware processing reap (time_limit 60 min > StaleJobMinutes 30 tension) — pre-existing, documented in WorkerOptions; ops knob. Boundary-adjacent (±10 min) reaper tests. StaleJobReaperTests hosted-reaper coexistence (deterministic today — same outcomes).
- Rejected: NULL dispatched_at immortal-row claim (column is non-nullable with DB default — verified); `TestDb.Reachable` silent-green pattern (project-wide convention, not this story's to change).

**AC2 honesty note**: "queued jobs remain queued (not failed)" is fixed and directly tested. "and resume" rests on dramatiq's Redis LIST persistence (messages survive worker death until consumed) — asserted by mechanism, not demonstrated end-to-end in an automated test. Manual verification path: stop worker, dispatch, restart worker, job completes (dev-verified behavior of the queue topology since 2.5).

### Change Log

- 2026-07-03: implemented on `storage/3-5-resilience`. Gates: BFF 279/279; worker 566 + 3 xfail; vitest 674; tsc/lint/ruff clean. Status → review.
- 2026-07-03 (review): 10 patches applied (see Senior Developer Review). Gates after patches: BFF 279/279 (one parallel-run flake pair re-ran green), worker 567 + 3 xfail, vitest upload suite 49/49, ruff clean.
