name: "Detection Rule — Tempo Octave Error (phase1 BPM vs structure BPM)"
description: |
  A new deterministic rule-engine rule that fires when the phase-1 beat-tracker BPM is a 2×/½×
  octave of the allin1 structure BPM — i.e. the tempo shown to the user (and fed to genre +
  danceability) is half- or double-time wrong. Drop-in: one function in rule_engine.py + tests.
  Grounded in a real case: analysis 92a87fbe-… showed phase1 71.8 BPM vs structure 143.0 BPM
  (ratio 0.50), so genre detection + danceability were computed on the wrong tempo.

---

## Goal

Add a rule `tempo_octave_error` to the worker rule engine that detects when
`phase1.bpm` and `phase1.structure.bpm` disagree by a factor of ~2 (an octave). It emits a `minor`
advisory verdict that reframes the BPM-derived findings (genre, danceability, phase-7 bars) as
suspect, with the corrected tempo. No audio is at fault — this is a **measurement-integrity caveat**.

## Why

- **It's a real, recurring defect.** librosa's beat tracker (phase 1) frequently locks to half- or
  double-time; allin1 (structure) is usually right. When they disagree by 2×, the *single BPM number
  the user sees is wrong*.
- **It silently corrupts downstream analysis.** Genre detection (`phase2`) and danceability both key
  off `phase1.bpm`. A 71.8-vs-143 split means a 143 BPM track was classified and scored as if it were
  71.8 BPM — wrong genre, wrong danceability, and phase-7 bar math skews on tracks where structure BPM
  isn't independent.
- **It's nearly free to detect.** Both numbers already live in `final_json`. One comparison rule turns
  a latent data bug into a surfaced, explainable finding (and a manual-BPM-fix prompt).

## What

A single `@rule` function. Fires when the ratio `phase1.bpm / structure.bpm` is within tolerance of
0.5 or 2.0. Emits a verdict carrying both measured tempos as Evidence and naming the corrected BPM.

### Success Criteria
- [ ] `tempo_octave_error` registered via the `@rule` decorator in `rule_engine.py`.
- [ ] Fires on half-time (ratio≈0.5) AND double-time (ratio≈2.0); silent when ratios are ~1.0 or the
      structure BPM is absent/zero.
- [ ] Evidence uses exactly `phase1.bpm` and `phase1.structure.bpm` (paths must resolve in the
      validator) and the verdict passes `validate_verdict`.
- [ ] Tolerance is band-limited (±~6%) so genuine tempo *drift* or unrelated BPMs don't false-fire.
- [ ] Unit tests: fires-on-half, fires-on-double, silent-in-range, silent-when-structure-missing,
      passes-validator — mirroring `test_rule_engine.py`.
- [ ] `pytest -q components/worker/tests/verdict_pipeline/test_rule_engine.py` green.

## All Needed Context

### References
```yaml
- file: components/worker/app/verdict_lib/rule_engine.py
  why: Where the rule lives. Mirror the @rule decorator + _make(...) + Evidence(...) + _phase()
       helper pattern. The loudness_too_high_for_streaming rule is the closest template.
  critical: _phase(analysis,"phase1") returns {} if absent; nested reads use (p1.get("structure") or {}).

- file: components/worker/tests/verdict_pipeline/test_rule_engine.py
  why: Test harness. _analysis(**phase1_over) builds a baseline; mirror its fires/silent/validator trio.
  critical: assert validate_verdict(v, a).ok — Evidence.metric paths MUST resolve against the analysis.

- file: components/shared/aimusic_shared/verdicts/models.py
  why: Verdict / Evidence / Severity / Category definitions. Confirm "minor" severity + a valid category.

- file: components/worker/app/verdict_lib/flatten_analysis.py
  why: Confirms the flattened shape — phases become top-level phase1..phase9 keys; structure stays
       nested under phase1.structure. So paths are phase1.bpm and phase1.structure.bpm.

- file: PRPs/detection-engine-spec.md
  why: Severity philosophy (objective-fault guardrail vs profile-relative coaching). This rule is an
       integrity caveat, not a mix fault — hence "minor", and it should reframe (not pile onto) the F.

- file: output/analysis/2026-06-25_latest-final-json/final_json.full.json
  why: Real positive case (phase1 71.78 vs structure 143.0, ratio 0.499). Use its numbers in a test.
```

### Known Gotchas
```python
# CRITICAL: Evidence.metric must be the EXACT dotted path that resolves in the flattened analysis.
#   Use "phase1.bpm" and "phase1.structure.bpm" — NOT "structure.bpm". Validator rejects bad paths.
# CRITICAL: guard structure.bpm == 0 / None before dividing (the deferred-structure placeholder has
#   no bpm). Return None early.
# GOTCHA: don't fire on ~1.0 ratio (agreement) OR on arbitrary unrelated BPMs — band-limit to the
#   octave neighbourhoods [0.47,0.53] and [1.89,2.11] (~±6%). Anything else is not an octave error.
# GOTCHA: severity = "minor". A higher severity would let a measurement caveat outrank real mix faults
#   in priority ordering. It reframes other findings; it isn't itself a defect in the audio.
```

## Implementation Blueprint

### The rule (drop into rule_engine.py near the other phase1 rules)
```python
@rule
def tempo_octave_error(analysis: dict[str, Any]) -> Verdict | None:
    """phase1 beat-tracker BPM is a 2×/½× octave of the structure (allin1) BPM →
    the displayed tempo (and the genre/danceability derived from it) is wrong."""
    p1 = _phase(analysis, "phase1")
    bpm = p1.get("bpm")
    structure = p1.get("structure") or {}
    struct_bpm = structure.get("bpm")

    if bpm is None or not struct_bpm:        # absent or 0 → can't compare
        return None

    ratio = bpm / struct_bpm
    half = 0.47 <= ratio <= 0.53             # phase1 detected HALF-time (most common)
    double = 1.89 <= ratio <= 2.11           # phase1 detected DOUBLE-time
    if not (half or double):
        return None

    corrected = struct_bpm                   # allin1 is the trusted reference
    direction = "half-time" if half else "double-time"
    return _make(
        track_id=_track_id(analysis),
        severity="minor",
        category="tempo",                    # use existing tempo/structure category; see models.py
        headline=f"Tempo likely {direction}: shown {bpm:.0f} BPM, structure reads {corrected:.0f} BPM",
        summary=(
            f"The beat tracker reported {bpm:.1f} BPM but structural analysis found "
            f"{corrected:.1f} BPM — an exact 2× octave. The displayed tempo is probably "
            f"{direction}; the true tempo is ~{corrected:.0f} BPM."
        ),
        evidence=[
            Evidence(metric="phase1.bpm", value=float(bpm),
                     label=f"{bpm:.1f} BPM (beat tracker)"),
            Evidence(metric="phase1.structure.bpm", value=float(struct_bpm),
                     label=f"{struct_bpm:.1f} BPM (structure)"),
        ],
        why_it_matters=(
            "Genre detection and the danceability score are computed from the displayed BPM, so a "
            "half/double-time error mis-routes both. Correct the BPM (or trust the structure tempo) "
            "to re-ground those findings."
        ),
    )
```

### Tests (append to test_rule_engine.py)
```python
def _with_structure(bpm, struct_bpm):
    a = _analysis(bpm=bpm)
    a["phase1"]["structure"] = {"bpm": struct_bpm, "beats": [], "segments": []}
    return a

def test_tempo_octave_error_fires_on_half_time():           # the real 92a87fbe case
    a = _with_structure(71.78, 143.0)
    v = next(x for x in evaluate_rules(a) if "octave" in x.category or "tempo" in x.headline.lower())
    assert v.severity == "minor"
    assert {e.metric for e in v.evidence} == {"phase1.bpm", "phase1.structure.bpm"}
    assert validate_verdict(v, a).ok

def test_tempo_octave_error_fires_on_double_time():
    a = _with_structure(280.0, 140.0)
    assert any("tempo" in x.headline.lower() for x in evaluate_rules(a))

def test_tempo_octave_error_silent_when_in_agreement():
    a = _with_structure(140.0, 140.0)
    assert not any("tempo" in x.headline.lower() for x in evaluate_rules(a))

def test_tempo_octave_error_silent_without_structure():
    a = _analysis(bpm=140.0)                                 # no structure key
    assert not any("tempo" in x.headline.lower() for x in evaluate_rules(a))
```

### Integration Points
```yaml
RULE ENGINE:   register via @rule (auto-collected). No wiring beyond the decorator.
CATEGORY:      reuse an existing Category (tempo/structure) from aimusic_shared.verdicts.models;
               only add a new enum member if none fits (keep it minimal, additive).
SURFACING:     flows through orchestrator.evaluate_rules → validate_verdict → verdicts_payload →
               frontend findings, AND through degraded.py (rule-only mode) when LLM budget is spent.
FRONTEND:      no change required — it renders as a standard verdict. (The Song Map component from the
               companion task can additionally render this inline; cross-ref.)
```

## Validation Loop
```bash
ruff check components/worker/app/verdict_lib/rule_engine.py
mypy components/worker/app/verdict_lib/ --ignore-missing-imports
pytest -q components/worker/tests/verdict_pipeline/test_rule_engine.py
```
Assert: fires on 0.5 and 2.0 ratios; silent on ~1.0 and missing structure; `validate_verdict(...).ok`.

## Out of Scope / Follow-ups
- **Auto-correcting** the BPM (and re-running genre/danceability) — this rule only *flags*. A real fix
  is to make phase 1 prefer/cross-check the structure BPM, or expose a manual BPM override that
  re-routes phase 2/danceability. Track separately (ties into `[[final-json-schema-drift]]`).
- A symmetric check for **triple/dotted** tempo confusions (ratio ≈ 1.5 / 3.0) if they show up in data.

## Anti-Patterns to Avoid
- ❌ Firing on any BPM disagreement — band-limit to the octave neighbourhoods only.
- ❌ severity above "minor" — it's an integrity caveat, not an audio defect; don't let it outrank faults.
- ❌ Evidence path "structure.bpm" — must be "phase1.structure.bpm" or the validator drops the verdict.
- ❌ Dividing without guarding `struct_bpm` falsy (deferred-structure placeholder has no bpm).
```
