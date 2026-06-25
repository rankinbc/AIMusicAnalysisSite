# Schema-contract drift prevention — design

> Companion to `PRPs/detection-prescription-inventory.md`, which documented **three
> mutually-inconsistent `final_json` schemas** (production `phaseN.lufs`; rule/fixture
> `phaseN.integrated_lufs`+`crest_factor`; prompt `audio_analysis.loudness.integrated_lufs`)
> and the fact that the dead rules pass their tests because the *fixtures* encode the wrong
> schema too. This doc says how we stop it recurring. Compiled 2026-06-25.

## Root cause (one sentence)
There is **no single source of truth for the `final_json` shape**, and every consumer — rules,
LLM prompts, test fixtures, frontend types, the validator — hand-encodes field paths with
**nothing checking those paths against what the producer actually emits**.

## Why the obvious fixes are each half a solution
- **A hand-maintained "master JSON" doc** (the first instinct) becomes a *fourth* schema that
  drifts alongside the other three. Right idea, wrong source: the authoritative artifact must be
  **derived from / asserted against the real producer**, so it cannot lie about what's emitted.
- **A between-phase input/output checker** guards the wrong seam. The drift was never phase→phase
  (phases are independent — they emit, they barely read each other). It bit at the
  **producer→consumer** boundary, where the consumers are the rule engine, the LLM prompts, the
  fixtures, and the frontend types — *none of which is a phase*. A between-phase assert can't see a
  rule or a prompt, and prompts are natural language so **no runtime contract reaches them at all**.

## The principle
**One authoritative schema, derived from the producer, enforced against every consumer in CI —
plus a loud runtime signal for the one consumer (the LLM) that static checks can't fully reach.**

---

## The four layers (ordered by leverage)

### Layer 1 — Authoritative schema artifact (the contract)
- **Artifact:** `schemas/final_json.contract.json` — a manifest of every dotted path the pipeline
  emits (and ideally a type/role per path), living in the already-declared top-level `schemas/`
  folder. Produced **from a real `run_pipeline` output** (run once offline on a fixed reference
  track — the analysis stack has heavy ML deps and isn't CI-gated), then committed and reviewed.
- **Why it can't lie:** a producer-conformance test asserts `run_pipeline` output keys still match
  the manifest. That test lands with the analysis CI gate (Epic 8); **until then**, the inspector's
  existing `stage_map.diff_against_final_json()` + `pipeline_inspector --validate-map <id>` is the
  interim conformance check against a real DB snapshot. The manifest is bootstrapped from one such
  snapshot, so it starts honest.
- Adding/removing a `final_json` field becomes a deliberate manifest edit in the same PR — visible
  in review instead of silent.

### Layer 2 — Consumer path-lint (CI gate) — **the one that would have caught all of this**
A dependency-free test (modeled on `components/worker/tests/test_enforcement_lints.py`) that, for
every place a field path is named, asserts the path resolves in the Layer-1 manifest. Three targets:
- **Rules** — extract `.get()` + `Evidence(metric=…)` paths via the *existing*
  `app.tools.inspector.rule_introspect.read_paths_for_rule(fn)` over `rule_engine._RULES`. Catches
  all the dead rules (`integrated_lufs`, `crest_factor`, `key_detection_confidence`, `genre_hint`,
  `phase3.low_mid_energy`).
- **Prompts** — regex-extract dotted paths from each `prompts/experts/*.md` (+ `Triage.md`) and
  assert resolution. Catches the 165 `audio_analysis.*` citations across 14 files.
- **Fixtures** — load every `tests/verdict_pipeline/fixtures/analyses/*.json` and assert its key
  shape is a subset of the manifest. Catches schema #2 — a fixture could no longer carry
  `integrated_lufs` when the contract says `lufs`.

**Rollout via a ratcheting baseline** (so it ships now despite large existing drift): the lint fails
on any offender *not* in a committed `schemas/_schema_drift_baseline.json`, AND fails if a baseline
entry is *no longer* an offender (forcing it to shrink as fixes land). New drift → red immediately;
existing debt is enumerated, frozen, and can only decrease. Scoped fully in
`PRPs/schema-path-lint-gate.md`.

### Layer 3 — Loud validator telemetry (runtime backstop for the LLM)
`validator.py::_resolve_path` already rejects evidence whose `metric` doesn't resolve — but
**silently** (the verdict is dropped, no signal). Count rejections per specialist + reason and
log/meter them. A prompt steering the model at dead paths then surfaces as a **rejection-rate
spike**, not invisible quality loss. This is the only guard that reaches paths the model invents at
runtime, which static lint cannot.

### Layer 4 (optional) — Frontend type codegen
Generate the TS `Phase1Data`/`Phase4Data`/… interfaces from the Layer-1 manifest (or add a lint
asserting the hand-written types' keys ⊆ manifest), so the UI can't drift either. Lower priority —
a wrong UI field renders `undefined`, which is visible, unlike a silently-dropped verdict.

---

## What each layer would have caught, in this incident

| Drift | Layer that catches it |
|---|---|
| Rules read `phase1.integrated_lufs`, prod emits `lufs` | 2 (rules) |
| Rules read `phase1.crest_factor` / `key_detection_confidence` (never emitted) | 2 (rules) |
| Fixtures encode `integrated_lufs`/`crest_factor` → green tests over a fiction | 2 (fixtures) |
| 14 prompts cite `audio_analysis.*` paths that don't resolve | 2 (prompts) + 3 (runtime) |
| A future new field renamed in the pipeline | 1 (producer-conformance) + 2 |

Layers 1+2 close the door on all three documented schemas. Layer 3 covers what the model can still
introduce live. Layer 4 extends the same guarantee to the UI.

## Sequencing
1. **Layer 2 first** (`PRPs/schema-path-lint-gate.md`) — ✅ **DONE** (branch `schema-path-lint`,
   2026-06-25). Manifest `schemas/final_json.contract.json` (164 leaves, from real samples + the
   stems/reference goldens), resolver + extractors in `app/verdict_lib/schema_contract.py`,
   enforcement lint `tests/test_schema_contract_lints.py`, ratcheting baseline
   `schemas/_schema_drift_baseline.json` (rules:7, prompts:152, fixtures:30). Also delivered
   Layer 1's manifest artifact as a side effect.
2. **Layer 3** — small, independent; do it alongside or right after.
3. **Layer 1 producer-conformance test** — lands with the analysis CI gate (Epic 8); interim
   coverage via the inspector's `--validate-map` is already available.
4. **Burn down the baseline** — the prompt reconciliation is *the same work* as the two-engine
   prescription rewrite (`PRPs/detection-prescription-inventory.md`): rewriting specialists as
   "prescribe a fix for this confirmed problem" deletes most of the dead `audio_analysis.*`
   field-guides outright. Each prompt fixed removes its baseline entries; the ratchet enforces it.
5. **Layer 4** — opportunistic.

## Non-goals / explicitly out of scope
- A between-phase runtime validator (wrong seam — see above).
- Rewriting the prompts in this work (that's the two-engine prescription effort; this just makes
  the drift *visible and non-growing*).
- A formal JSON-Schema/Pydantic model of `final_json` as the source — the phases emit dynamic
  dicts; a path manifest derived from a real run is lighter and matches reality. Can graduate to a
  typed model later without changing the lint's contract.
