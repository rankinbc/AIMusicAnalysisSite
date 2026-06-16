# Design: Per-phase re-run (re-run a single analysis phase in place)

**Date:** 2026-06-16
**Status:** Draft — awaiting review
**Component scope:** `analysis` (refactor), `worker` (new actor), `bff` (new endpoint), `frontend-spectr-v2` (UI + hook). No DB migration.

---

## Problem

Today the only DSP dispatch is `analyze_audio_job` → `run_pipeline`, which runs **all** 7–8 phases.
"Re-analyze" re-runs everything. There's no way to re-run a single phase — e.g. after attaching
stems you want only **Stem clash (4)** redone, or a phase **failed** and you want to **retry** just
it, without recomputing the whole pipeline. The phases are modular functions but the orchestration
is all-or-nothing.

## Goal

Let the user re-run an individual phase from the Analysis tab. The re-run merges the new phase
result into the **existing** report (in place) and re-derives the top-level rollups (overall score,
grade, top fixes). Fast — a single phase is ~1–2s.

## Decisions (from brainstorming)

- **Scope = asset-driven + retry-failed.** Re-runnable on demand: **Stem clash (4)**, **Reference
  comparison (5)**, **Ableton project (8)**. Plus a **Retry** on any phase whose stored status is
  `failed`. **Phase 1 is full-run only** (every other phase depends on its output).
- **Trigger = per-row button** on the Analysis tab (explicit; no auto-on-asset-add this pass).
- **Result model = update the report in place.** Re-run rewrites that phase's entry in the existing
  `analyses.final_json` and re-derives rollups; the same report refreshes. No new analysis row.

## Non-goals

- Auto-running phases when an asset is added (manual button only).
- Per-phase re-run of phase 1 (that's a full re-analyze).
- DB schema changes; reference_path wiring for the unified flow (separate follow-up).
- Cascading re-runs (re-running phase 2 does NOT auto-re-run 3/6/7).

---

## Dependency facts (why this works)

`run_pipeline` feeds later phases from earlier outputs:
- phase 1 → consumed by 2, 3, 5, 6, 7 (and `structure` → 7)
- phase 2 → `genre` → consumed by 3, 6, 7
- phase 4 (stems) and phase 8 (als) are **independent** of phase 1.

So any single phase 2–8 can be re-run from the **stored** phase-1 output + genre (both live in the
existing `final_json`). Phase 1 is the only one that can't run standalone. The endpoint enforces
that the required upstream data exists; if phase 1 itself failed, the re-run is rejected with
"re-run the full analysis."

---

## Architecture / flow

1. User clicks **Re-run** (phase 4/5/8) or **Retry** (a failed phase) on the Analysis tab row.
2. Frontend → `POST /api/reports/{jobId}/phases/{phase}/rerun` → `{ rerunJobId }`.
3. Frontend marks that row "re-running…", polls `useJob(rerunJobId)` (existing hook).
4. BFF creates a lightweight **re-run AnalysisJob** (progress vehicle; reuses the job status/SSE
   infra), enqueues `rerun_phase(rerunJobId, analysisId, phase)`. Returns the rerun job id.
5. Worker `rerun_phase` actor:
   - loads the **existing Analysis** (`final_json`) + its `SongVersion` (audio/stem/ref/als paths),
   - extracts stored `phase1` data + `genre` from `final_json`,
   - runs **only** the requested phase via a shared single-phase runner,
   - merges the new `PhaseResult` into `final_json.phases[]` (replace that phase's entry),
   - re-derives rollups (`overall_score`, `grade`, `top_fixes`, `danceability_score`,
     `coach_*`) via a shared finalize helper,
   - writes `final_json` back to the **same** Analysis row; flips the rerun job `complete`
     (progress_cb → current_phase/phase_pct, same as the main actor).
6. On rerun-job `complete`, frontend invalidates the results query for the original `jobId` →
   report refetches → the row + rollups update in place. On `failed`, the row shows the error and a
   Retry.

Net: **no new Analysis row, no duplicate report.** The rerun job is ephemeral progress only.

---

## Component changes

### analysis (refactor — behavior-preserving)
- Extract the per-phase dispatch from the `run_pipeline` loop into a reusable
  `run_single_phase(phase_num, *, wav_path, phase1, genre, reference_path, als_file_path,
  stem_paths, stem_mode, progress_cb)` returning a `PhaseResult`.
- Extract the post-loop aggregation into `finalize_result(phase_data, genre, ...)` returning the
  rollup dict (`overall_score`, `grade`, `top_fixes`, `danceability_score`, `coach_*`).
- `run_pipeline` is rewritten to call both — **output must be byte-for-byte identical** (guarded by
  existing golden snapshots, e.g. `phase4_with_stems.json`).
- Add a small `rerun_single_phase(phase_num, file_path, prior_final_json, version_paths) -> dict`
  convenience that converts audio→wav, pulls phase1/genre from `prior_final_json`, calls
  `run_single_phase`, and returns `{ phase_result, rollups }` for the worker to merge. (Keeps the
  worker thin; keeps phase wiring in the analysis package.)

### worker
- New actor `rerun_phase(rerun_job_id, analysis_id, phase)` (sync, `db_sync`), 3-phase tx pattern
  like `analyze_audio_job`: (A) mark processing, (B) run single phase outside a tx, (C) merge into
  the analysis row + flip job complete. Writes a fail-marker on the rerun job on error (doesn't
  corrupt the existing report).
- Register `DramatiqTasks.RerunPhase = "rerun_phase"` on the BFF side; worker actor name matches.

### bff
- `POST /api/reports/{jobId}/phases/{phase:int}/rerun` (mirrors the verdict
  `/reports/{jobId}/verdicts/run/{slug}` shape). Validates ownership (jobId→analysis→user),
  enforces the **scope guard** (phase ∈ {4,5,8} OR stored status of that phase == `failed`; reject
  phase 1 and absent-upstream with 409), creates the re-run job, enqueues `rerun_phase`, returns
  `RerunPhaseResponse(rerunJobId)`.
- `DramatiqTasks.RerunPhase` constant.

### frontend-spectr-v2
- `useRerunPhase(jobId)` mutation → POST above → `{ rerunJobId }`.
- Analysis tab: per-row **Re-run** (phase 4/5/8 rows) / **Retry** (failed rows) button. While the
  rerun job is in flight, the row shows a spinner; on completion invalidate
  `['jobs', jobId, 'results']` (and `['songs']`) so the report refreshes in place. Reuse `useJob`
  for polling the rerun job.
- Gate buttons: only show Re-run on 4/5/8 and Retry on `failed` rows (match server scope).

---

## Merge semantics
- Replace exactly one entry in `final_json.phases[]` (matched by `phase` number) with the new
  `PhaseResult`; leave all other phases untouched.
- Recompute rollups from the full (post-merge) `phase_data` map so overall score/grade/top-fixes
  stay consistent (e.g. re-running phase 3 changes the score).
- `final_json` is rewritten atomically in one transaction.

## Testing
- **analysis:** golden snapshot proves `run_pipeline` output unchanged after the refactor; unit
  tests for `run_single_phase` (4/5/8 in isolation, using a stored phase1 fixture) and
  `finalize_result`.
- **worker:** `rerun_phase` merges only the target phase + re-derives rollups; writes fail-marker
  on a bad phase; leaves other phases intact. (`pytest components/worker/tests/`).
- **bff:** scope guard — allow 4/5/8 + failed; reject phase 1 / non-failed others / absent
  upstream (409); ownership 404. Creates a job + enqueues `rerun_phase`. (`dotnet test`).
- **frontend:** hook + button-gating unit tests (Re-run only on 4/5/8, Retry only on failed);
  all four gates green.
- **e2e:** full analysis → mutate nothing → `POST .../phases/4/rerun` → exactly one rerun job →
  `final_json.phases[4]` refreshed, other phases byte-identical, rollups re-derived.

## Risks / edge cases
- **Refactor regressions** — mitigated by the golden snapshot (output must not change).
- **Missing upstream** (phase 1 failed / absent) → 409 "re-run the full analysis"; button hidden.
- **Re-run job proliferation** — re-run creates an `analysis_jobs` row per click; acceptable
  (explicit user action, gives history). It updates the existing analysis, never creates a 2nd one.
- **Reference re-run with no attached reference** — phase 5 falls back to genre-preset only (same
  as a full run today); the report reflects that. (User-reference wiring is a separate follow-up.)
- **Concurrent re-runs of different phases** — each merges its own phase; last finalize wins on the
  rollups. Acceptable; phases are fast and serialized by the single-concurrency worker.

## Reuse vs new
| Reuse | Build new |
|---|---|
| `useJob` polling, job status/SSE infra, 3-phase tx pattern, progress_cb | `run_single_phase` + `finalize_result` refactor; `rerun_single_phase` |
| `analyses.final_json` storage, results endpoint, report refetch | `rerun_phase` actor; `POST /reports/{jobId}/phases/{phase}/rerun`; `useRerunPhase`; per-row buttons |
