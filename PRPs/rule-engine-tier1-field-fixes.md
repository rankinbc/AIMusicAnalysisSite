# PRP: Rule-engine Tier-1 field-name fixes + honest test fixtures

## Purpose
Revive the rule-engine rules that can never fire because they read pipeline
datapoints under the wrong name/phase, and rewrite the rule tests so they can
never again pass while a rule is dead. Scope is the **cleanly fixable** subset
(a rename revives them fully): the two loudness rules and the stereo-correlation
rule. Surfaced by the pipeline-inspector dev tool (see
`docs/superpowers/specs/2026-06-25-pipeline-inspector-design.md`).

## Core Principles
1. Fix only what a rename makes fully functional; defer rules that also need a
   new/changed metric (those are a separate PRP — see Out of Scope).
2. The rule engine is the LLM-independent guardrail (it runs on free-tier and
   budget-degraded analyses), so dead loudness/stereo rules are a real coverage
   hole, not cosmetic.
3. Tests must validate against the **real `final_json` field shape**, not
   hand-built payloads that mirror the bug.
4. Never mock to pass. Never loosen an assertion to hide a still-broken rule —
   mark it `xfail` with a reason instead.

## Goal
After this PRP: `loudness_too_high_for_streaming`,
`loudness_too_low_for_streaming`, and `stereo_correlation_negative` fire on
real analyses when their thresholds are crossed; their emitted `Evidence`
metric paths resolve through the validator; and the rule-engine test suite uses
real field names so a future field rename breaks a test instead of silently
killing a rule.

## Why
- Verified on real analysis `8aeef3b4`: 8 of 11 rules are diagnosed `bug` by the
  inspector (read a field absent from a phase that ran). Loudness and stereo are
  3 of those 8 and become fully live with a one-field rename.
- The unit tests in `tests/verdict_pipeline/test_rule_engine.py` currently feed
  payloads using the **same wrong names** (`integrated_lufs`,
  `phase2.stereo_correlation`, …), so the suite is green while the rules are
  dead in production. That masking is the root cause and must be removed.

## What
Rename the read paths AND the `Evidence(metric=...)` strings for three rules to
the fields the pipeline actually emits, then rewrite the affected tests to the
real shape and `xfail`-mark the still-deferred dead rules.

### Success Criteria
- [ ] `loudness_too_high_for_streaming` reads `phase1.lufs` (was `integrated_lufs`); its `Evidence.metric` is `phase1.lufs`.
- [ ] `loudness_too_low_for_streaming` reads `phase1.lufs`; `Evidence.metric` is `phase1.lufs`.
- [ ] `stereo_correlation_negative` reads `phase1.stereo_correlation` (was `phase2.…`); `Evidence.metric` is `phase1.stereo_correlation`.
- [ ] These three rules' verdicts pass `validate_verdict` against a real `final_json` (evidence path resolves within ±10%).
- [ ] `tests/verdict_pipeline/test_rule_engine.py` uses real field names for the three fixed rules and asserts both a fires and a does-not-fire case each.
- [ ] Tests for the still-deferred dead rules (`excessive_dynamic_range`, `tiny_dynamic_range`, `low_mid_mud_generic`, `low_mid_mud_trance`, `key_detection_low_confidence`) are `pytest.mark.xfail(reason=..., strict=True)` referencing this PRP, NOT deleted or left green on synthetic payloads.
- [ ] Inspector regression check: on analysis `8aeef3b4`, the inspector's rule-diagnosis `bug` count drops from 8 to 5 (the three fixed rules move to `in_range`); `--validate-map 8aeef3b4` still reports "in sync".
- [ ] All v2 validation gates pass (see Validation Loop).

## All Needed Context

### Documentation & References
```yaml
- file: docs/superpowers/specs/2026-06-25-pipeline-inspector-design.md
  why: the inspector that surfaced these gaps; §1 lists the field mismatches.
- tool: components/worker/app/tools/pipeline_inspector.py
  why: acceptance/regression check — run `--validate-map` + diagnosis on a real analysis.
- file: components/worker/app/verdict_lib/rule_engine.py
  why: the rules to fix (read paths + Evidence metric strings).
- file: components/worker/app/verdict_lib/validator.py
  why: validate_verdict checks each Evidence.metric path resolves ±10% — this is
       why the Evidence metric string MUST be renamed alongside the read path.
- file: components/worker/app/verdict_lib/flatten_analysis.py
  why: confirms the flat key shape (phaseN.<field>) the rules address.
- file: components/worker/tests/verdict_pipeline/test_rule_engine.py
  why: the fixtures to rewrite; currently encode the bug.
```

### Real field shape (confirmed against analysis 8aeef3b4 `final_json`)
```
phase1 keys: bands, bpm, clipped_sample_count, clipping_detected, detected_key,
  duration_seconds, low_energy, lufs, mono_compatibility, peak_dbfs, rms,
  stereo_correlation, stereo_width, structure, true_peak_db
  -> phase1.lufs is the integrated LUFS; phase1.stereo_correlation lives HERE (not phase2).
phase2 keys: bpm, confidence, genre        (NO stereo_correlation)
phase3 keys: genre, notes, sub_scores, total_score   (NO low_mid_energy)
```

### Known Gotchas
```
# CRITICAL: validator.validate_verdict rejects a verdict whose Evidence.metric
#   does not resolve in the analysis. So renaming ONLY the rule's read .get()
#   is not enough — the Evidence(metric="phase1.integrated_lufs", ...) literal
#   in the SAME rule must also become "phase1.lufs", or every newly-firing
#   verdict gets rejected and the rule still produces nothing.
# CRITICAL: making these rules live means real analyses will emit NEW verdicts.
#   Check tests/verdict_pipeline/test_orchestrator.py and any golden/snapshot
#   tests for verdict output; update expectations deliberately (this is intended).
# CHECK: components/api/app/verdict_pipeline/ — the legacy FastAPI api hosts a
#   parallel verdict pipeline. If it has its own rule_engine with the same
#   field bugs, either apply the same rename or confirm the v2 worker engine is
#   the only one in use. Do not let the two drift silently.
# The rule thresholds and severities are CORRECT and unchanged — only the
#   datapoint addresses are wrong. Do not touch threshold logic.
```

## Implementation Blueprint

### list of tasks (in order)
```
Task 1: Rewrite test fixtures to real field names (RED).
Task 2: Fix loudness_too_high / loudness_too_low read path + Evidence metric.
Task 3: Fix stereo_correlation_negative phase + Evidence metric.
Task 4: xfail-mark the still-deferred dead-rule tests with PRP reference.
Task 5: Reconcile orchestrator/golden tests + check the legacy api rule engine.
Task 6: Inspector regression check on real data.
```

### Per task pseudocode
```
# Task 1 (RED first — TDD)
# In tests/verdict_pipeline/test_rule_engine.py, change the three rules' fixtures:
#   "phase1": {"integrated_lufs": -7.0, ...}   ->  "phase1": {"lufs": -7.0, ...}
#   "phase2": {"stereo_correlation": -0.3}     ->  move to "phase1": {"stereo_correlation": -0.3}
# Add fires + does-not-fire cases per rule using the REAL shape. Run -> these
# FAIL against current rule_engine.py (rules still read old names). Expected RED.

# Task 2 — rule_engine.py loudness_too_high_for_streaming / _too_low_for_streaming
#   lufs = p1.get("integrated_lufs")        ->  lufs = p1.get("lufs")
#   Evidence(metric="phase1.integrated_lufs", ...) -> metric="phase1.lufs"
#   (thresholds -8.0 / -20.0 unchanged)

# Task 3 — rule_engine.py stereo_correlation_negative
#   p2 = _phase(analysis, "phase2")  ->  p1 = _phase(analysis, "phase1")
#   corr = p2.get("stereo_correlation") -> corr = p1.get("stereo_correlation")
#   Evidence(metric="phase2.stereo_correlation", ...) -> "phase1.stereo_correlation"

# Task 4 — xfail the deferred dead rules (still reading nonexistent fields)
#   @pytest.mark.xfail(reason="reads phase1.crest_factor — not emitted; PRP "
#     "rule-engine-tier2 (crest_factor emission)", strict=True)
#   ...same for low_mid_mud_* (phase3.low_mid_energy + genre_hint) and
#      key_detection_low_confidence (phase1.key_detection_confidence).

# Task 5 — run full verdict_pipeline suite; update orchestrator/golden expectations
#   for the now-firing loudness/stereo verdicts (intended new output). Grep the
#   legacy api for a parallel rule engine; sync or confirm unused.

# Task 6 — regression via the inspector (no new test infra needed)
#   DATABASE_URL=... python -m app.tools.pipeline_inspector --validate-map 8aeef3b4   # expect "in sync"
#   build_trace_model(8aeef3b4): rule_diagnosis_summary["bug"] == 5 (was 8)
```

### Integration Points
```
- No DB schema change, no migration, no new dependency.
- No frontend change.
- analysis package (components/analysis) is NOT touched — these fields already
  exist; only the rule engine addresses them wrongly.
```

## Validation Loop

### Level 1: Syntax & Style
```bash
cd components/worker && python -m ruff check app/ tests/
cd components/worker && python -m mypy app/verdict_lib/rule_engine.py --ignore-missing-imports
```

### Level 2: Unit Tests
```bash
# RED first (Task 1), then GREEN after Tasks 2-3:
cd components/worker && python -m pytest tests/verdict_pipeline/test_rule_engine.py -v
# The three fixed rules: fires + does-not-fire pass. Deferred rules: xfail (not pass, not error).
cd components/worker && python -m pytest tests/verdict_pipeline/ -q   # orchestrator/validator stay green
```

### Level 3: Integration (real analysis via the inspector)
```bash
cd components/worker
export DATABASE_URL="postgresql+psycopg2://spectr:spectr@localhost:5432/spectr"
python -m app.tools.pipeline_inspector --validate-map 8aeef3b4     # expect: "stage map is in sync ... rc=0"
python - <<'PY'
from app.tools.inspector.loader import load_trace, resolve_analysis_id
from app.tools.inspector.build import build_trace_model
from app.db_sync import SessionFactory
m = build_trace_model(load_trace(SessionFactory, resolve_analysis_id(SessionFactory,"8aeef3b4")))
print(m["rule_diagnosis_summary"])   # expect bug == 5 (was 8); loudness/stereo now in_range
PY
```

## Final validation Checklist
- [ ] `ruff` + `mypy` clean.
- [ ] `test_rule_engine.py` green for fixed rules (fires + no-fire), `xfail` for deferred rules.
- [ ] Full `tests/verdict_pipeline/` green (orchestrator expectations updated for new verdicts).
- [ ] Inspector: `--validate-map 8aeef3b4` "in sync"; `bug` count 8 → 5.
- [ ] Legacy api rule engine synced or confirmed unused.

## Anti-Patterns to Avoid
- ❌ Renaming the `.get()` read but NOT the `Evidence(metric=...)` string (verdict gets validator-rejected; rule still emits nothing).
- ❌ Touching thresholds/severities — they are correct.
- ❌ Rewriting the deferred dead rules here (they need a new metric, not a rename — separate PRP).
- ❌ Deleting or green-faking the deferred-rule tests instead of `xfail`-marking them.
- ❌ Building new test infra — the pipeline-inspector already provides the real-data regression check.

## Out of Scope (deferred — track as follow-up PRPs)
- **Tier 2 — `crest_factor`:** `excessive_dynamic_range` / `tiny_dynamic_range` read `phase1.crest_factor`, which the pipeline never emits. Fix = emit it in phase1 (`peak_dbfs − 20·log10(rms)`); both fields already exist. Touches `components/analysis`.
- **Tier 3 — low-mid mud:** `low_mid_mud_*` read `phase3.low_mid_energy` (absent) and `genre_hint` (an input param, not an output). Real low-mid lives at `phase1.bands.low_mid` / `phase4.band_energy.low_mid` as **dB**, but the rule's thresholds assume a 0–1 ratio — needs metric + threshold redesign and a genre source switch to `phase2.genre`. Not a rename.
- **Tier 3 — key confidence:** `key_detection_low_confidence` reads `phase1.key_detection_confidence`, never emitted (only `detected_key`). Emit the chroma confidence in phase1, or retire the rule.
- **Versioning analyses** (`memory: version-analyses-followup`) — orthogonal but related: would let the inspector recompute against the historical rule code instead of disclaiming.
```
