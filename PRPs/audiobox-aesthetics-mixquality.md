# Audiobox Aesthetics — reference-free perceptual production-quality score

> Origin: user asked what could be salvaged from the `AgriciDaniel/claude-music`
> repo (an ACE-Step *generation* suite) to improve SPECTR (an *analysis/coaching*
> platform). The two products barely overlap. The one transferable idea was that
> repo's `ranking-method.md`, which composites reference-free audio-quality
> models. Investigation of its two named models rejected both and surfaced a
> better third. **This PRP integrates that third model — Meta Audiobox
> Aesthetics — as a new perceptual signal for the coach.** See "Model selection
> rationale" for why DNSMOS and SongEval were rejected.

## Goal

Add a **reference-free, learned perceptual production-quality score** to every
completed analysis — specifically Meta Audiobox Aesthetics' **PQ (Production
Quality)** axis (0–10), and optionally its **CE (Content Enjoyment)** axis —
persisted into `final_json` so the **coach and specialists** can reference "how
good this actually sounds to a model trained on human musical judgment," as a
signal *complementary to* the deterministic rule-engine thresholds.

This is **not** a new headline grade and **not** a replacement for any existing
measurement. It is one more grounded number the coaching layer can talk about.

## Why

- **Score is NOT the product — coaching is** (`feedback_spectr-coaching-product-philosophy`
  memory). This deliberately does **not** surface as a new A–F grade or compete
  with `overall_score`. It lands as a *coaching input*: a perceptual data point
  the LLM layer can cite ("a model trained on pro-musician ratings scores your
  production quality at 6.1/10, which lines up with the harshness finding
  below"). Framing it as a headline score would violate the standing constraint.
- **Additive-only** (same memory): a new best-effort field in `final_json`.
  Nothing existing is removed, rescored, or gated on it. A model-load or
  inference failure leaves the field `None` and the analysis completes exactly
  as it does today.
- **Complementary signal, not redundant.** The existing rule engine
  (`verdict_lib/rule_engine.py`) is deterministic *measured-threshold* logic
  (crest factor, LUFS, band energy vs genre profiles). Audiobox PQ is a *learned
  perceptual* score from a model trained on music (MUSDB18, MusicCaps) to predict
  human production-quality ratings. It catches "sounds bad in a way no single
  threshold caught" — a different failure class. The two disagreeing is itself
  useful coaching signal.
- **Commercially clean.** SPECTR is a paid product (Stripe/tiers/credits).
  Audiobox Aesthetics is **CC BY 4.0** — commercial use permitted with
  attribution. (This is the entire reason SongEval was rejected — see below.)

## What

A new optional scorer in the `analysis` package that loads the Audiobox
Aesthetics model once per process (singleton, per the existing model-loading
convention), runs it on the already-decoded track during `run_pipeline`, and
writes `perceptual_quality` (+ raw axis scores) into `PipelineResult` /
`final_json`. Downstream, the coach/specialist grounding layer gains a line
exposing the score. **Best-effort throughout** — never blocks or fails an
analysis.

### Success Criteria
- [ ] **Gate 1 (BLOCKING spike) passes** before any integration code lands — see
      the "Gate 1" section. If it fails (torch/numpy conflict unresolvable, or
      CPU inference too slow, or license turns out non-commercial on inspection),
      this PRP stops and the finding is written up. No half-integration.
- [ ] `run_pipeline` output gains a top-level `perceptual_quality` field
      (`{"pq": float|None, "ce": float|None, "model_version": str, "status":
      "ok"|"skipped"|"failed"}`); a model failure yields `status:"failed"`,
      `pq:None`, and a completed analysis (partial-failure tolerant, like every
      phase).
- [ ] The score is loaded **once per worker process** (singleton), not per track
      — mirrors `models.get_model(...)` and the demucs-preload pattern.
- [ ] The coach/specialist grounding preamble exposes the PQ score when present,
      as a *perceptual* signal explicitly distinguished from measured metrics.
- [ ] `schemas/final_json.contract.json` regenerated; schema-contract lint passes.
- [ ] A real-track fixture produces a plausible PQ in [0,10]; the golden-snapshot
      byte-identical guarantee for the rest of `run_pipeline` is preserved (the
      new field is additive and, if the model is unavailable in CI, `status`
      degrades to `skipped` deterministically — see Gotchas).
- [ ] No new headline grade, no change to `overall_score`/`grade`, no new
      frontend hero number. Any frontend surfacing is deferred (see Deferred).

## Model selection rationale (why this model, not the repo's two)

| Model | Music-appropriate? | License | Verdict |
|---|---|---|---|
| **DNSMOS** (Microsoft) | **No** — speech denoiser eval; 16 kHz mono; SIG/BAK/OVRL are denoising metrics meaningless for a mix | MIT / CC BY 4.0 | **Rejected — speech-only** |
| **SongEval** (ASLP-lab) | Yes — MuQ backbone, full-song aesthetics | **CC BY-NC-SA (non-commercial)** | **Rejected — license blocks a paid product**; also `torch==2.7.0` hard pin + `muq` deps vs our `numpy<2.0` |
| **Audiobox Aesthetics** (Meta) | **Yes** — trained on music (MUSDB18, MusicCaps); **PQ axis = production quality** | **CC BY 4.0 (commercial OK)** | **Selected** |

Honest shared caveat: **all three downmix + resample internally** (Audiobox runs
~16 kHz mono). So none of them judges true stereo imaging or 44.1 kHz top-end —
that remains the job of our Phase 1 DSP (`true_peak_db`, LUFS, `mono_compatibility`,
`channel_balance`). Audiobox adds a learned perceptual layer *on top of*, never
instead of, those.

## Gate 1 — BLOCKING compatibility + viability spike (do this FIRST, standalone)

**Do not write any integration code until this passes.** Deliver it as a throwaday
script under the scratchpad or a `spike/` note, not committed to the package.

```yaml
Spike checklist:
  1. LICENSE confirm:
     - Read facebookresearch/audiobox-aesthetics LICENSE file directly.
     - Confirm CC BY 4.0 (or otherwise commercial-permitted). If it is any
       *-NC-* variant → STOP, same failure mode as SongEval.
  2. Dependency resolution against the REAL worker env:
     - audiobox-aesthetics pins: python>=3.9, torch>=2.2.0, torchaudio, numpy
       (UNCONSTRAINED — accepts our <2.0 pin), tqdm, submitit, huggingface_hub,
       rich>=13.9.4, safetensors>=0.5.3. No TensorFlow, no NATTEN, no numpy>=2.
     - Our `analysis` pyproject pins torch>=2.0. Audiobox needs >=2.2.0. Create a
       fresh venv, `pip install -e components/analysis -e components/shared`
       THEN `pip install audiobox-aesthetics`, and confirm pip resolves a single
       torch >=2.2 that ALSO satisfies torchopenl3 + demucs + all-in-one-fix.
       This is THE risk. If torchopenl3/demucs cap torch <2.2 → resolve or STOP.
  3. Smoke-run on CPU:
     - Run the model on one real fixture track (components/analysis/tests
       fixtures) AND on a 5-minute file. Record wall-clock inference time on CPU.
     - Decision threshold: worker is concurrency=1, demucs-heavy. If CPU
       inference is >~30 s for a 5-min track, integration must be gated
       best-effort AND flagged as a latency cost in the PR (still acceptable
       because it's off the user's critical path — Phase C2, post-COMPLETE — but
       must be a conscious call, not a surprise).
  4. Output sanity:
     - Confirm the PQ axis lands in a plausible [0,10] and that a deliberately
       bad input (heavily clipped/distorted fixture) scores lower than a clean
       one. If PQ is flat/uncorrelated across obviously-different inputs, the
       signal is worthless → STOP.
  5. Model weight footprint:
     - Note checkpoint size (huggingface_hub download) and confirm it caches
       under TORCH_HOME=data/models (per the analysis TORCH_HOME convention), not
       ~/.cache.
```

**Gate 1 output:** a short go/no-go note (torch resolution result, CPU timing,
sanity-check numbers, checkpoint size, license confirmation). Only on GO does the
rest of this PRP proceed.

## All Needed Context

### Documentation & References
```yaml
- url: https://github.com/facebookresearch/audiobox-aesthetics
  why: Install, model card, the 4 axes (PQ/PC/CE/CU, 0-10). PQ is the one we use.
  critical: torch>=2.2.0 is the only version bump vs our stack; numpy unconstrained.

- url: https://arxiv.org/abs/2502.05139
  why: What PQ/CE actually measure + that it was trained/validated on music sets.

- url: https://github.com/AgriciDaniel/claude-music/blob/main/skills/claude-music/references/ranking-method.md
  why: The origin idea (composite reference-free scoring). We take the CONCEPT,
       not their model picks (DNSMOS speech-only, SongEval non-commercial).

- memory: feedback_spectr-coaching-product-philosophy
  why: The two constraints that shape this whole PRP — additive-only, and
       "score is NOT the product, coaching is" (so this is a coach INPUT, not a
       new headline grade). Re-read before deciding any UI surfacing.

- memory: project_final-json-schema-drift
  why: final_json has 3 drifting producer/consumer schemas. Any new field goes
       through schemas/final_json.contract.json (regenerate, don't hand-edit).

- memory: project_analysis-recommendations-roadmap-2026-07
  why: Roadmap context — Mix Diagnosis / Cohesive Podium direction. A perceptual
       PQ score is a natural input to that Mix Diagnosis surface later.

- file: components/analysis/src/audio_analysis/scorers/danceability.py
  why: MIRROR THIS. danceability is the existing precedent for a top-level
       derived scorer (pure function, own module under scorers/, surfaced as a
       PipelineResult field). The perceptual scorer follows the same shape,
       except it needs the decoded audio + a model singleton (danceability is
       metric-only), so it lives closer to run_pipeline (see Task 2).

- file: components/analysis/src/audio_analysis/pipeline.py
  why: finalize_result() (lines 140-189) assembles PipelineResult; run_pipeline()
       (line 192+) is where audio is available and phases run. The new scorer is
       invoked in run_pipeline (has file_path + decoded audio), NOT in
       finalize_result (also called by rerun_single_phase — must not re-run the
       model on every per-phase rerun).

- file: components/analysis/src/audio_analysis/schemas.py
  why: PipelineResult TypedDict (lines 16-26) + ANALYSIS_SCHEMA_VERSION (line 5,
       currently "2.1.0"). Add the field to the TypedDict and BUMP the version.

- file: components/worker/app/tasks_dramatiq.py
  why: Phase C2 (lines 428-436) — run_rule_engine_for_analysis is called
       best-effort AFTER the analyses row commits. This is the established
       "extra derived signal, never fails the job" seam. Note: the pipeline
       result is already persisted by then, so if the score is computed INSIDE
       run_pipeline (Task 2) it's already in final_json — no Phase C2 edit needed
       for persistence. (Only touch tasks_dramatiq if the spike shows the model
       must run in the worker rather than the analysis package — see Task 2's
       location decision.)

- file: components/worker/app/verdict_lib/input_grounding.py
  why: grounding_preamble() is the single choke point feeding specialists +
       triage + coach. Add one PQ line here (Task 4), same pattern the
       content-type-honesty-gate PRP uses. One edit, three surfaces.

- file: components/analysis/README.md  (+ CLAUDE.md analysis gotchas)
  why: "Singleton model loading — load weights once per process via
       models.get_model(name), never per-call" and "TORCH_HOME=data/models".
       Both apply directly to the Audiobox model load.
```

### Known Gotchas
```text
# torch>=2.2.0 is the ONE real risk. Our analysis pyproject pins torch>=2.0;
# torchopenl3 + demucs + all-in-one-fix share the env. Gate 1 step 2 proves
# whether a single torch>=2.2 satisfies all of them. Do NOT bump the pin in
# pyproject.toml until Gate 1 confirms resolution — a broken torch resolve takes
# down the whole worker (every phase depends on torch), which is far worse than
# not having a perceptual score.

# Best-effort or nothing. The pipeline is partial-failure tolerant per-phase
# (try/except around each). The perceptual scorer MUST follow suit: any
# exception (model download fail, OOM, torch mismatch at runtime) → status
# "failed", pq None, analysis completes. It must NEVER raise out of run_pipeline.

# Golden-snapshot byte-identity: CLAUDE.md notes run_pipeline output is guarded
# byte-identical by golden snapshots (the run_single_phase/finalize refactor).
# Adding a top-level field changes the snapshot — regenerate goldens
# deliberately AND make the field DETERMINISTIC in CI: when the model/weights
# are absent (CI has no GPU, may not download the checkpoint), the scorer must
# return a fixed status:"skipped", pq:None — never a nondeterministic value or a
# network-dependent one. Guard on an env flag (e.g. PERCEPTUAL_SCORER_ENABLED,
# default off in tests) so CI snapshots stay stable and offline.

# 16 kHz mono internal — do NOT market/surface this as a stereo or mastering
# judgment. It is a perceptual production-quality proxy. The grounding line
# (Task 4) must frame it honestly so the LLM doesn't over-claim ("model thinks
# your stereo image is..." would be wrong).

# Concurrency=1 worker + demucs preloaded. Adding a second resident model raises
# baseline RAM. Gate 1 step 5 records the footprint. If it's large, the model
# load stays lazy-on-first-use (not eager at worker boot) so a worker that never
# analyzes doesn't pay for it.

# flatten_analysis.py is a blind passthrough (per content-type-gate PRP notes) —
# once the field is in run_pipeline's output it appears at flattened root
# automatically. No extra plumbing to reach the grounding layer.
```

## Implementation Blueprint

### Task 1 — New scorer module (component: `analysis`) — GATED on Gate 1 GO
**Create** `components/analysis/src/audio_analysis/scorers/perceptual.py`,
mirroring `scorers/danceability.py`'s shape but model-backed:
```python
# Singleton model handle (per analysis model-loading convention).
def _get_model():  # lazy, cached at module level; loads under TORCH_HOME
    ...

def perceptual_quality(file_path: str) -> dict:
    """Reference-free perceptual production score via Audiobox Aesthetics.

    Returns {"pq": float|None, "ce": float|None,
             "model_version": str, "status": "ok"|"skipped"|"failed"}.
    NEVER raises — any failure returns status "failed"/"skipped" with pq None.
    Disabled (status "skipped") unless PERCEPTUAL_SCORER_ENABLED is set, so CI
    snapshots stay deterministic and offline.
    """
```
Load once, reuse the handle. Honor `TORCH_HOME=data/models`. Wrap the whole body
in try/except → `status:"failed"`.

**Test:** `components/analysis/tests/test_perceptual_scorer.py` — with the scorer
DISABLED (default), assert `status:"skipped"`, `pq:None` deterministically (no
model, no network). A second test, marked to skip unless the model is locally
available (env-gated), asserts a real fixture yields `pq` in [0,10]. Follow the
per-lift test-file convention (`test_phase1_key_estimate.py` etc).

### Task 2 — Wire into pipeline + schema (component: `analysis`)
**Files:** `pipeline.py`, `schemas.py`, `schemas/final_json.contract.json`.

- Add `perceptual_quality: dict` to the `PipelineResult` TypedDict; **bump
  `ANALYSIS_SCHEMA_VERSION`** (e.g. "2.2.0") with a comment noting the new field.
- Invoke `perceptual_quality(file_path)` in **`run_pipeline`** (audio/file
  available there), attach it to the returned `PipelineResult`. Do **not** call
  it in `finalize_result` — that's shared with `rerun_single_phase` and would
  re-run the model on every per-phase rerun for no benefit.
- Regenerate the contract: `python -m app.tools.build_schema_contract` (per
  CLAUDE.md) so `test_schema_contract_lints.py` doesn't flag the new leaf.

**Location decision (resolve during Gate 1):** default is to compute inside the
`analysis` package (Task 2 as written) so it's naturally in `final_json` before
persistence and needs no worker edit. ONLY if Gate 1 shows the model can't live
in the analysis env cleanly (torch resolution forces it into a separate process),
fall back to running it in the worker at Phase C2 (`tasks_dramatiq.py:428-436`,
next to `run_rule_engine_for_analysis`) and patching it into the persisted
`final_json` there. Prefer the analysis-package home.

### Task 3 — Golden snapshots + regression (component: `analysis`)
Regenerate the golden snapshots that guard `run_pipeline` byte-identity, since
the additive field changes them. Confirm the ONLY diff is the new
`perceptual_quality` key and that with the scorer disabled (CI default) the value
is the fixed `skipped`/`None` shape. Run `pytest -q components/analysis/tests/`.

### Task 4 — Expose to the coach/specialist grounding (component: `worker`)
**File:** `components/worker/app/verdict_lib/input_grounding.py`,
`grounding_preamble()`.

Add one block, gated on the flattened `perceptual_quality.status == "ok"`, that
states the PQ (and CE) score AND frames it honestly as a *perceptual model
estimate*, explicitly distinct from measured DSP metrics — e.g. "A model trained
on human production-quality ratings scored this ~<pq>/10 (perceptual estimate,
not a measured value; it does not assess stereo width or true-peak — those are in
the measured metrics above)." Because `grounding_preamble()` feeds
`build_specialist_user_message`, `build_triage_user_message`, and
`coach_lib/context.py`, this single edit reaches all three LLM surfaces.

**Test:** extend `components/worker/tests/verdict_pipeline/test_input_grounding.py`
with an `ok`-status case asserting the PQ line appears, and a `skipped`/absent
case asserting it does NOT (no fabricated score when the model didn't run).

### Task 5 — (Deferred, not this PRP) Frontend surfacing
Explicitly **out of scope.** No new hero number, no new tab. When/if PQ earns a
visible surface, it belongs in the future Mix Diagnosis work
(`project_analysis-recommendations-roadmap-2026-07`), designed as coaching
context, not a competing grade — a separate PRP. Naming it so it isn't silently
forgotten.

## Validation Loop

### Level 1: Syntax & Style
```bash
ruff check components/analysis/ components/worker/
mypy components/analysis/ components/worker/app/ --ignore-missing-imports
```

### Level 2: Unit Tests
```bash
pytest -q components/analysis/tests/test_perceptual_scorer.py
pytest -q components/analysis/tests/            # golden snapshots regenerated + green
pytest -q components/worker/tests/ -k "input_grounding"
python -m app.tools.build_schema_contract && \
  pytest -q components/worker/tests/test_schema_contract_lints.py
```

### Level 3: Integration
```bash
# In a venv with the model enabled (PERCEPTUAL_SCORER_ENABLED=1) + weights cached:
# run run_pipeline on a real fixture; confirm final_json.perceptual_quality.status
# == "ok" and pq in [0,10]. Then start the stack (docs/STARTUP.md), analyze a
# real upload, open the coach — confirm the grounding line surfaces the PQ score
# and reads as a perceptual estimate, not a measured metric. Analyze a second
# track with the scorer DISABLED — confirm no PQ line and a normal report.
```

## Final Validation Checklist
- [ ] Gate 1 GO note exists (license = commercial-OK, torch resolves across
      torchopenl3/demucs/all-in-one-fix, CPU timing recorded, PQ sanity-correlates)
- [ ] `perceptual_quality` in `final_json`; failure path yields
      `status:"failed"`/`pq:None` and a COMPLETED analysis
- [ ] Model loads once per process; honors TORCH_HOME; lazy if footprint is large
- [ ] CI is deterministic + offline (scorer disabled by default → `skipped`)
- [ ] Golden snapshots regenerated; only diff is the additive field
- [ ] Schema contract regenerated; lint passes
- [ ] Grounding line reaches coach + specialists + triage; honestly framed as
      perceptual; absent when the model didn't run
- [ ] No new headline grade; `overall_score`/`grade` unchanged; no frontend surface
- [ ] Attribution for Audiobox Aesthetics (CC BY 4.0) added where third-party
      model credits belong

## Anti-Patterns to Avoid
- Don't skip Gate 1. The torch>=2.2 resolution is a real go/no-go; a broken torch
  resolve breaks every phase. Prove it in a throwaway venv first.
- Don't make it a new headline grade or hero number — it's a coaching input.
  That's the standing product constraint, not a nice-to-have.
- Don't let it raise out of `run_pipeline`. Best-effort or nothing, like every phase.
- Don't compute it in `finalize_result` (re-runs on every per-phase rerun).
- Don't leave CI nondeterministic — env-gate the model so snapshots stay stable
  and offline; never let a test depend on a network checkpoint download.
- Don't over-claim in the grounding text — 16 kHz mono internal; it does not
  judge stereo or true-peak. Frame it as a perceptual estimate.
- Don't hand-edit `schemas/final_json.contract.json` — regenerate it.
- Don't substitute DNSMOS (speech-only) or SongEval (non-commercial) "because
  the repo used them" — both were rejected for concrete reasons above.
