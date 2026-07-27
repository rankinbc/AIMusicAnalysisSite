# Content-Type Honesty Gate ("Is this even a song?")

> Split out from `PRPs/first-upload-trust-quickwins.md` (item 3 in
> `PRPs/source/INITIAL.md`) — see that PRP's "Scope note" for why. This PRP
> covers **Scope A only** (the minimal degenerate-input honesty gate). Scope B
> (full partial-input scoped analysis) is named explicitly in "Deferred scope"
> below — not dropped, not silently forgotten, just sized honestly as a
> separate, much larger effort.

## Goal

Stop the pipeline from producing a fully-confident, fully-fabricated mix
diagnosis when the uploaded audio isn't a real mix at all (a test tone,
silence, or other non-musical input). Live-tested during the source
brainstorming session: a test-tone beep upload produced a complete,
confident diagnosis (mud buildup, phase-width warnings, EQ
order-of-operations) — every rule threshold, every specialist, and the coach
treated it as a real track.

## Why

- **Calibrated-confidence duty** (`feedback_spectr-coaching-product-philosophy`
  memory): the user trusts SPECTR's advice completely and has no independent
  way to evaluate it — miscalibrated confident advice at scale actively makes
  things worse. A fabricated diagnosis on a non-song input is the sharpest
  possible violation of that duty.
- **First upload is the conversion moment** (same memory): new users
  frequently test with a stray file before their real track — a confidently
  wrong first report is a worse first impression than an honest "this
  doesn't look like a full mix."
- **Additive-only**: this gate suppresses fabrication, it doesn't remove or
  replace any existing measurement or scoring logic for real tracks.
- The codebase already has a working precedent for exactly this posture —
  `components/analysis/src/audio_analysis/stems/role_detector.py:107-113`
  guards near-silent stem windows with "no instrument to fingerprint... return
  OTHER instead of fabricating a confident role." This PRP applies the same
  philosophy at the whole-track level.

## What

A cheap, Phase-1-output-only classifier that flags the worst degenerate input
cases (silence, a sustained test tone, or otherwise clearly non-musical
audio) and, only for those cases, substitutes honest messaging for the
normal fabricated-if-unchecked diagnosis at three gating points: the
deterministic rule engine, the LLM grounding layer (specialists + triage +
coach), and the frontend report banner. **No new expensive computation, no
per-dimension partial-input scoping, no changes to any phase's core
measurement logic for real tracks.**

### Success Criteria
- [ ] A synthetic sine-tone WAV fixture and a synthetic silent WAV fixture both
      classify as degenerate; a real fixture track (already in the test suite)
      does not.
- [ ] For a degenerate-classified analysis: the deterministic rule engine
      (`evaluate_problems`) writes zero Problem rows; on-demand specialists,
      triage, and the coach all receive grounding language telling them the
      input isn't confirmed music and must not fabricate a mix diagnosis.
- [ ] The frontend renders an honest, distinct banner ("this looks like
      `<classification>` — upload a full mix for a real analysis") reusing the
      existing `degradation_notice` pipeline, not a new bespoke surface.
- [ ] A real track's report is byte-for-byte unaffected (this gate only
      activates on the degenerate branch).
- [ ] Scope B (partial-input handling) is explicitly not attempted — no
      per-dimension skip logic, no loop/stem/single-instrument classification.

## Deferred scope (Scope B — do not attempt in this PRP)

Explicit partial-input handling — classifying and separately scoping loops,
isolated stems, single-instrument recordings, and speech, with **per-dimension**
applicable/inapplicable flags threaded through phases 2-9 individually and
through most of the ~30-40 rule-engine predicates — is a separate, much larger
effort (research estimate: 25-35+ files, touches nearly every phase module,
the bulk of the rule corpus, the prompt library, triage routing logic, and
multiple frontend tabs). This is a multi-week epic, not a quick win. Naming
it here so it isn't silently lost: a future PRP should scope it once Scope A
has shipped and the classifier's real-world accuracy is validated.

## All Needed Context

### Documentation & References
```yaml
- file: PRPs/first-upload-trust-quickwins.md
  why: Sibling PRP (items 1/2/4/5/6) — same source brainstorm, same standing
       product-philosophy constraints. Land independently; no shared code.

- memory: feedback_spectr-coaching-product-philosophy
  why: Additive-only + calibrated-confidence-duty framing for this entire gate.

- memory: project_final-json-schema-drift
  why: final_json / PipelineResult schema is already flagged fragile across 3
       producer/consumer schemas. Any new field added here must go through
       schemas/final_json.contract.json, not be added ad hoc.

- file: components/analysis/src/audio_analysis/stems/role_detector.py
  why: "Cheap heuristic + honest fallback instead of confident fabrication" is
       already established practice here (lines 15-18 `_SILENCE_RMS` guard,
       107-113 rationale comment, 119-121 onset-rate-not-trustworthy-on-tones
       caveat). Mirror this philosophy, don't reinvent it.

- file: components/worker/app/verdict_lib/input_grounding.py
  why: `grounding_preamble()` (lines 123-155) already solves the adjacent
       problem (LLM narrating stems/reference data that was never provided)
       with an authoritative preamble pattern. Extend it, don't parallel it.
       Consumed by build_specialist_user_message, build_triage_user_message,
       AND coach_lib/context.py:78 — one edit gates all three LLM surfaces.

- file: components/worker/app/verdict_lib/degraded.py
  why: `write_degradation_notice()` (lines 35-70) → analyses.degradation_notice
       JSONB → BFF DegradationNoticeDto → frontend LlmDegradationNotice.tsx is
       an already-shipped, end-to-end "explain why this report looks
       different" pipeline (built for LLM-budget/circuit-breaker reasons).
       Reuse its shape for a new reason value; do not build a parallel path.

- file: components/worker/app/verdict_lib/rule_engine.py
  why: `evaluate_problems()` (lines 142-199) is the single entry point called
       by every consumer (tasks_dramatiq.py, triage_actor.py, verdict_actor.py,
       degraded.py, fix_rack_actor.py, orchestrator.py, trace/run_trace.py) —
       one top-of-function guard here gates the entire deterministic engine
       for all 7+ callers in one edit.
```

### Known Gotchas
```text
# The existing "never grade absent data" guard vocabulary (data_tier +
# per-rule `if x is None: return None` checks) catches a metric's ABSENCE.
# It cannot catch a metric's PRESENCE-BUT-MEANINGLESSNESS — Phase 1's `bands`
# dict is always populated, even from a pure tone's FFT, so existing rule
# guards never fire on a test tone. Content-type gating is a genuinely
# different, new kind of guard — do not try to shoehorn it into data_tier.

# flatten_analysis.py::flatten() is a blind passthrough, not an allowlist —
# any new field added to Phase 1's return dict automatically appears at
# flattened["phase1"]["<field>"] everywhere downstream. No extra plumbing
# code needed for propagation once the field exists.

# Structure detection (allin1, Docker, 60-90s) runs INSIDE Phase 1's analyze()
# and is NOT cheap. This PRP does not attempt to skip it for degenerate
# inputs — restructuring Phase 1 to conditionally short-circuit its own
# sub-steps is a performance optimization, not an honesty fix, and risks
# scope creep toward Scope B. Accept the existing Phase 1 cost as-is.

# Do not assume phases 2-9 should stop RUNNING for a degenerate input. Scope A
# gates the FINDINGS/DIAGNOSIS layer only (rule engine + LLM grounding +
# frontend banner) — it does not skip computation. Skipping computation is a
# separate (and much smaller) optimization that could be a fast-follow, but
# is not required for the honesty fix and is not this PRP's success criterion.

# bpm, key/key_detection_confidence, and transients/onset-rate are NOT
# reliable standalone content-type signals — librosa emits *some* BPM on any
# input, and a pure tone's one-hot chroma can spuriously correlate well with
# a Krumhansl key profile. Do not use these as classifier inputs; use
# crest_factor + spectral_flatness + loudness_range_lu/loudness_timeline
# variance + the existing lufs/rms silence sentinel + bands spread instead —
# all already computed by Phase 1 for other purposes.
```

## Implementation Blueprint

### Task 1 — Cheap classifier (component: `analysis`)

**New file:** `components/analysis/src/audio_analysis/content_type.py`

Pure function, Phase-1-output-only, no new DSP passes:
```python
def classify_content_type(phase1: dict) -> dict:
    """Returns {"content_type": str, "confidence": float, "signals": {...}}.

    content_type in {"silence", "tone_or_nonmusical", "music"} for Scope A.
    "music" is the default — this must NEVER false-positive on real tracks,
    since a false "tone_or_nonmusical" would suppress real findings (the
    opposite failure mode, also unacceptable). Tune thresholds empirically
    against fixture tracks before merging, not from first principles alone.
    """
```
Signal inputs (all already in Phase 1's return dict — confirm exact keys
against current `phase1_universal.py` before wiring, do not assume the
line numbers below are still exact):
- `lufs` (silence sentinel already returns `-70.0` for digital silence) + `rms`
  → `silence` bucket.
- `crest_factor` (pure tone ≈ 3 dB; real mixes run 6-20 dB) — low value is a
  signal component, not sole determinant.
- `spectral_flatness` (near 0 = tonal/peaky; a pure tone sits near-zero; real
  mixes sit in a broad mid-range).
- `loudness_range_lu` and/or variance across `loudness_timeline`'s
  `momentary`/`short_term` arrays (a constant tone or silence has near-zero
  variation over time; real music varies).
- `bands` spread (a pure tone concentrates energy in 1-2 of the 7 mel bands
  with near-floor energy elsewhere; a real mix has a flatter distribution).

Combine as: `silence` if the lufs sentinel/near-zero rms fires; else
`tone_or_nonmusical` if crest_factor AND spectral_flatness AND loudness
variance ALL independently point low (require agreement across signals, not
any single one, to avoid false-positiving on legitimately sparse/minimal
real music); else `music` (default, no gate fires).

**Test:** new `components/analysis/tests/test_content_type_classifier.py`,
following this repo's existing convention of a dedicated test file per
Phase-1 "lift" (precedent: `test_phase1_channel_balance.py`,
`test_phase1_key_estimate.py`). Generate a synthetic sine-tone WAV and a
synthetic silent WAV as fixtures (a few seconds each, generated in the test
itself via `numpy`/`soundfile` — do not commit binary fixture files if
avoidable); run Phase 1 on each and assert the classifier's output. Also run
against at least one existing real-track fixture and assert `"music"`.

### Task 2 — Wire into the pipeline + schema (component: `analysis`)

**Files:** `components/analysis/src/audio_analysis/pipeline.py`,
`components/analysis/src/audio_analysis/schemas.py`,
`schemas/final_json.contract.json` (regenerate, don't hand-edit — see
CLAUDE.md/`project_final-json-schema-drift` memory).

Call `classify_content_type` in `run_pipeline` right after Phase 1 completes
(before Phase 2 dispatches), store the result under a new top-level
`PipelineResult` key (e.g. `content_type_check`), version-stamp per the
existing `ANALYSIS_SCHEMA_VERSION` convention. Regenerate the contract via
`python -m app.tools.build_schema_contract` (per CLAUDE.md) so
`test_schema_contract_lints.py` doesn't flag the new field as an unlisted leaf.

Do **not** branch pipeline control flow here (phases 2-9 still run
unconditionally per the gotcha above) — this task only makes the
classification result available in `final_json` for the downstream gates in
Tasks 3-5 to consult.

### Task 3 — Gate the rule engine (component: `worker`)

**File:** `components/worker/app/verdict_lib/rule_engine.py`,
`evaluate_problems()` (lines 142-199).

Add a top-of-function guard reading `flattened.get("phase1", {}).get(
"content_type_check", {}).get("content_type")`; if it's `"silence"` or
`"tone_or_nonmusical"`, return an empty list immediately, before any
`@single`/`@composite` rule runs. This one edit covers all 7+ callers
(`tasks_dramatiq.py`, `triage_actor.py`, `verdict_actor.py`, `degraded.py`,
`fix_rack_actor.py`, `orchestrator.py`, `trace/run_trace.py`) — confirmed the
single choke point during research, no per-caller changes needed.

**Test:** extend `components/worker/tests/` wherever `evaluate_problems` is
unit-tested with a case asserting zero Problems for a degenerate
`content_type`.

### Task 4 — Gate LLM grounding (component: `worker`)

**File:** `components/worker/app/verdict_lib/input_grounding.py`,
`grounding_preamble()` (lines 123-155).

Following the exact existing pattern (e.g. the stems-absent
`"NO — no separated stems were provided. Do NOT discuss..."` block), add an
equivalent block gated on the same `content_type_check` field: when
degenerate, instruct the model NOT to produce a mix diagnosis, and instead to
state plainly that the input doesn't appear to be a full music mix. Because
`grounding_preamble()` is consumed by `build_specialist_user_message`,
`build_triage_user_message`, **and** `coach_lib/context.py:78`, this single
edit gates on-demand specialists, triage, and the interactive coach chat
simultaneously — no prompt-library edits needed for Scope A (confirmed no
existing specialist prompt has degenerate-content handling, and none is
required since the preamble is prepended externally, ahead of the prompt
body).

**Test:** extend `components/worker/tests/verdict_pipeline/test_input_grounding.py`
(currently covers only `grounding_preamble`/`input_provenance` in general) with
a degenerate-`content_type` case asserting the new block's presence.

### Task 5 — Honest frontend messaging (component: `worker` + `bff` + `frontend`)

**Files:** `components/worker/app/verdict_lib/degraded.py` (reuse
`write_degradation_notice`), `components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs`
(`DegradationNoticeDto`, `Reason` already a bare `string` — minimal touch),
`components/frontend-spectr-v2/src/features/results/LlmDegradationNotice.tsx`
(or sibling — confirm current name/path before editing).

Wire Phase C2 (`tasks_dramatiq.py`, where `run_rule_engine_for_analysis` is
already called post-analysis per CLAUDE.md) to call
`write_degradation_notice(analysis_id, reason="not_music", detail=<the
classified content_type + confidence>)` when the classifier fires — reusing
the exact existing notice pipeline built for LLM-budget/circuit-breaker
scenarios, not a new bespoke path. On the frontend, add a new `reason` case
to `LlmDegradationNotice.tsx`'s existing `copyFor()`-style switch with honest
copy (e.g. "This looks like `<content_type>`, not a full mix — upload a
complete track for a real analysis."). The rest of the report still renders
underneath (Findings will simply be empty per Task 3, not fabricated) —
this task does not hide or replace other tabs, consistent with not
attempting Scope B's per-dimension scoping.

**Test:** BFF — confirm `DegradationNoticeDto` round-trips the new reason
value (likely no code change needed, just a test case, since `Reason` is
already untyped). Frontend — new `vitest` case for the new `copyFor()`
branch.

## Validation Loop

### Level 1: Syntax & Style
```bash
ruff check components/analysis/ components/worker/
mypy components/analysis/ components/worker/app/ --ignore-missing-imports
cd components/bff && dotnet build
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
```

### Level 2: Unit Tests
```bash
pytest -q components/analysis/tests/test_content_type_classifier.py components/analysis/tests/test_pipeline.py
pytest -q components/worker/tests/ -k "rule_engine or input_grounding or degraded"
cd components/bff && dotnet test
cd components/frontend-spectr-v2 && npx vitest run
```

### Level 3: Integration
```bash
# Start the stack per docs/STARTUP.md — ./scripts/start-spectr.ps1
# Manual check: upload a generated test-tone WAV and a silent WAV through the
# real upload flow; confirm the report shows the honest banner and an empty
# Findings tab, NOT a fabricated diagnosis. Upload one real track and confirm
# its report is unaffected (regression check for the "music" default branch).
python -m app.tools.build_schema_contract   # regenerate schemas/final_json.contract.json
pytest -q components/worker/tests/test_schema_contract_lints.py
```

## Final Validation Checklist
- [ ] Classifier correctly flags synthetic silence + synthetic tone fixtures;
      does not false-positive on any existing real-track fixture
- [ ] `evaluate_problems()` returns `[]` for degenerate `content_type`, unchanged
      otherwise
- [ ] `grounding_preamble()` gates specialists + triage + coach simultaneously
      for degenerate inputs
- [ ] Frontend renders the new honest banner via the existing
      `degradation_notice` pipeline, no new bespoke surface built
- [ ] `schemas/final_json.contract.json` regenerated; schema-contract lint test
      passes
- [ ] Real-track reports are byte-for-byte unaffected (regression-checked, not
      assumed)
- [ ] Scope B is not attempted; this PRP's diff does not touch phase
      2-9 per-dimension logic, the rule corpus beyond the one guard in Task 3,
      or the specialist prompt library

## Anti-Patterns to Avoid
- Don't attempt Scope B (per-dimension partial-input scoping) under cover of
  "while I'm in here" — it's a separate, multi-week effort, explicitly deferred.
- Don't add a new model-inference classification pass — the whole point of
  Scope A is that Phase 1's already-computed fields are sufficient.
- Don't use bpm, key confidence, or onset/transient rate as classifier
  inputs — all three are documented as unreliable on non-musical or sustained-
  tone input elsewhere in this same codebase.
- Don't skip phase 2-9 computation for degenerate inputs — that's a
  performance optimization outside this PRP's honesty-focused scope.
- Don't hand-edit `schemas/final_json.contract.json` — regenerate it via the
  existing tool.
- Don't build a new notice/banner pipeline — reuse `degradation_notice` end to
  end; it already exists for exactly this "explain why this report looks
  different" purpose.
- Don't let the classifier's false-positive risk go untested — a
  real-but-minimal/sparse track misclassified as non-musical is the opposite,
  equally unacceptable failure mode. Test both directions.
