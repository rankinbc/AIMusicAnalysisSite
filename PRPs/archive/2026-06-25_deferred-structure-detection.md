# Deferred (background) structure detection + Phase 7 fill-in

> Goal: take the ~60-90 s allin1 cost off the analysis critical path. The fast
> phases (grade, spectrum, reference, danceability) return in ~2 s; structure
> detection + the arrangement score **fill in** a few seconds later from a
> background job. Compiled 2026-06-25, after restoring the allin1 Docker
> integration (see "Context" below).

## Context (what already shipped)

The "Fix allin1" work restored structure detection via Docker and made the
unavailable state honest:

- `audio_analysis/structure/docker_allin1.py` — `DockerAllin1.analyze()` shells
  out to the `allin1:latest` container, returns `Allin1Result(bpm, beats,
  downbeats, segments[{label,start,end}])` (seconds). Raises `Allin1Unavailable`
  when Docker/the image isn't set up. Env: `ALLIN1_USE_GPU`, `ALLIN1_IMAGE`.
- `phase1_universal._detect_structure()` calls it, returns
  `{available, detection_method, bpm, beats, downbeats, segments}` or
  `{available: False, reason, segments: [], beats: []}` (logged once).
- `phase1_adapter.adapt()` consumes the seconds-based `segments`; `StructureResult`
  gained `available`; `ArrangementScorer` returns a `"N/A"` "not assessed" score
  (not a CRITICAL "F") when `available is False`.

**The cost is in Phase 1** (that's where allin1 runs), so it currently blocks the
whole pipeline early. This PRP moves it to the background.

## Design

Two changes in concert:

1. **Phase 1 defers structure** when asked. The pipeline gains a
   `defer_structure: bool` knob; `analyze_audio_job` always passes it `True`, so
   the main run never blocks on allin1. Deferred Phase 1 emits
   `structure = {"available": False, "deferred": True, "reason": "Structure
   detection running in the background", "segments": [], "beats": []}`.

2. **A background actor runs allin1, patches Phase 1's structure, re-scores
   Phase 7**, and writes the merged `final_json` back to the SAME analysis row —
   reusing the existing `rerun_single_phase(7, ...)` machinery. Progress rides a
   dedicated `AnalysisJob` (same pattern as `rerun_phase`), so the SSE/poll infra
   surfaces it for free.

The `deferred` flag lets the UI distinguish "analyzing arrangement…" (pending)
from "not assessed" (genuinely unavailable — Docker not set up). When the
background job finds allin1 unavailable, it writes the honest non-deferred
`available: False` reason and the Arrangement tab shows "not assessed".

### Why reuse rerun, not a new pipeline

`rerun_single_phase(7, file, prior_result)` already re-runs ONE phase against a
stored result and re-derives rollups. If we first patch
`prior_result.phases[phase==1].data["structure"]` with the freshly detected
structure, then call `rerun_single_phase(7, ...)`, Phase 7 reads the patched
structure and scores it — no new code path, byte-identical handling of all other
phases.

---

## Task 1 — analysis: `defer_structure` knob (analysis package)

**Files:**
- Modify: `components/analysis/src/audio_analysis/phases/phase1_universal.py`
- Modify: `components/analysis/src/audio_analysis/pipeline.py`
  (`run_pipeline`, `run_single_phase` — thread `defer_structure` to phase 1)
- Modify: `components/analysis/src/audio_analysis/__init__.py` if it re-exports
- Test: `components/analysis/tests/test_pipeline.py`

**Behavior:**
- `analyze(wav_path, progress_cb=None, *, defer_structure=False)`: when
  `defer_structure` is True, skip the Docker call and return the deferred
  structure dict above. Default False (direct callers/tests unchanged).
- `run_pipeline(..., defer_structure=False)` and `run_single_phase(...)` pass it
  through to phase 1 only.

**Steps:** write a test asserting `analyze(wav, defer_structure=True)["structure"]`
has `deferred is True` and `available is False` and makes NO Docker call (the
autouse `_no_real_allin1_docker` fixture already blocks real Docker; assert the
wrapper's `analyze` is never invoked by patching it to fail loudly). Then
implement the param. Confirm the existing snapshot/pipeline tests still pass.

## Task 2 — analysis: `detect_structure_and_rescore` helper

**Files:**
- Modify: `components/analysis/src/audio_analysis/pipeline.py`
- Export from `components/analysis/src/audio_analysis/__init__.py`
- Test: `components/analysis/tests/test_pipeline.py`

**Interface:**
```python
def detect_structure_and_rescore(
    file_path: str,
    prior_result: PipelineResult | dict,
    *,
    use_gpu: bool | None = None,
    progress_cb=None,
) -> PipelineResult:
    """Run allin1 on file_path, patch phase-1 structure into prior_result,
    then re-run phase 7 and re-derive rollups. On Allin1Unavailable, patch the
    honest non-deferred unavailable structure and still re-run phase 7 (→ N/A)."""
```
Implementation: build the structure dict exactly as
`phase1_universal._detect_structure` does on success (reuse it / factor a shared
`_structure_from_result(Allin1Result)`), set
`phase_data[1]["structure"]`/the phases list entry, then delegate to
`rerun_single_phase(7, file_path, patched_prior)`.

**Steps:** test with a fake `DockerAllin1.analyze` returning 3 segments → assert
the returned result's phase-7 grade is a real letter (not "N/A") and phase-1
`structure.available is True`. Test the `Allin1Unavailable` branch → phase-7
grade "N/A", structure `available is False`, `deferred` absent/False.

## Task 3 — worker: `detect_structure_job` actor + self-enqueue

**Files:**
- Create: `components/worker/app/structure_actor.py` (mirror `rerun_phase_actor.py`)
- Modify: `components/worker/app/tasks_dramatiq.py` (`analyze_audio_job` Phase C:
  pass `defer_structure=True` to `run_pipeline`; after persisting the Analysis
  row, create a structure `AnalysisJob` row and enqueue `detect_structure_job`)
- Modify: `components/worker/app/dramatiq_app.py` if actors are imported there
- Test: `components/worker/tests/` (mirror existing actor tests; mock
  `detect_structure_and_rescore`)

**Actor:** `detect_structure_job(structure_job_id, analysis_id)` — same 3-phase
tx as `rerun_phase`: mark the structure job PROCESSING + capture paths; run
`detect_structure_and_rescore(file_abs, prior_final, use_gpu=...)` outside any
tx; write merged `final_json` back + flip the structure job COMPLETE. On
`Allin1Unavailable` the helper still returns a valid merged result (N/A), so the
job completes — it does NOT fail the analysis.

**Queue:** declare on `analysis-paid` like `rerun_phase` (latency-sensitive
secondary op; W1). Enqueue is by `actor_name`, tier-routing is the BFF's job for
primary analysis — here the worker self-enqueues, so route paid→`analysis-paid`,
free→`analysis-free` by reading the parent job's tier if convenient, else default
to `analysis-paid`. (Confirm against the AR23 topology note in CLAUDE.md before
finalizing the queue.)

**Self-enqueue:** the worker writes the dramatiq message itself (it already has a
Redis connection for the broker). Create an `AnalysisJob` row of a "structure"
job kind tied to the same version/analysis so the existing job-status/SSE infra
surfaces progress; the frontend polls it.

## Task 4 — frontend: "analyzing arrangement…" pending state

**Files:**
- Modify: `components/frontend-spectr-v2/src/features/results/ArrangementTab.tsx`
- Modify: the results polling/query that owns job → results invalidation
  (find the `['jobs', jobId, 'results']` query; add a poll while a structure job
  is in flight, then invalidate so Phase 7 fills in)
- Test: `components/frontend-spectr-v2/src/features/results/__tests__/` (vitest)

**Behavior:** when `phase7` is absent/`grade === "N/A"` AND `structure.deferred`,
render "Analyzing arrangement…" with a subtle spinner instead of the current
"no structure detected" copy. When the structure job completes and results
refetch, the real timeline + grade replace it. Keep the existing graceful
"not assessed" copy for the genuinely-unavailable (`available: false`,
non-deferred) case.

All four frontend gates must pass: `tsc --noEmit`, `npm run lint
--max-warnings 0`, `npm run build`, `npx vitest run`.

---

## Validation gates

```bash
pytest -q components/analysis/tests/
pytest -q components/worker/tests/
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build && npx vitest run
# Manual e2e: upload a track → fast phases return in ~2 s, Arrangement shows
# "Analyzing arrangement…", then fills in with a real grade ~60-90 s later
# (or ~10-15 s with ALLIN1_USE_GPU=1 in prod).
```

## Non-goals / out of scope

- Tier-gating structure detection (the speed fix here is decoupling, not gating).
- A librosa-only fast fallback detector (kept allin1 as the single source).
- Reframing the arrangement GRADE into the profile-relative "intentional?" Layer-B
  voice — that's the two-engine work (`PRPs/detection-engine-spec.md`); this PRP
  only moves *when* allin1 runs, not what it scores.
- GPU image build/ops wiring (prod just sets `ALLIN1_USE_GPU=1` + builds the CUDA
  variant; the env hook already exists).
```
