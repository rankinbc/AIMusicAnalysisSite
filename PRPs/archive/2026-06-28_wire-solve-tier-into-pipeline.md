# PRP: Wire the deterministic SOLVE tier into every analysis

**Branch:** `ai-analysis-v2`
**Status:** ready to execute
**Related:** [[identify-solve-architecture]], `PRPs/identify-solve-architecture.md`, `PRPs/identifiers/{router,preset-compiler}.md`, `PRPs/problem-engine-mixcoach-rules.md`

---

## Problem

Every verdict on the results page currently has `fix = None`, so the "The Fix"
device-and-parameters block (`features/results/VerdictCard.tsx:101`, renders only
when `verdict.fix?.dsp_chain` is non-empty) never appears. Users see prose
("what to do") but never a device + parameter preset they can audition on Listen.

**Root cause** — the IDENTIFY/SOLVE split landed half-wired:

- `analyze_audio_job` (`components/worker/app/tasks_dramatiq.py`) Phase **C2**
  calls `run_rule_engine_for_analysis` → emits **Problems** with `fix=None`
  hard-coded (`verdict_lib/rule_engine.py:95`). Phase **C3** LLM identifiers also
  force `fix=None, fixable=False`.
- The **SOLVE tier is fully built** — `solve_lib/solvers.py` (8 deterministic
  solvers, real `DspOp` chains), `solve_lib/router.py::merge` (attaches a
  validated `Fix` to each routed/fixable problem), `solve_lib/preset_compiler.py`.
- But `merge`/`solve` is **only** invoked on-demand by `fix_rack_actor.py`
  (the "Generate fix rack" button) — **never by the main pipeline**.

This was an oversight, not a deliberate deferral (confirmed with product owner
2026-06-28).

## Goal

Run the **deterministic** SOLVE-tier solvers on every completed analysis so
fixable Problems carry a `fix.dsp_chain`, restoring the device + parameters block
on the results page and lighting up the existing results→Listen handoff
(`listen-rack/fixToRackPatch.ts` + `useFixOverlay.ts`).

**Non-goal (explicit):** LLM specialists (`run_specialist`) stay **on-demand** —
no LLM spend added to the analysis path. Only the deterministic solvers run
automatically. (Confirmed with product owner 2026-06-28.)

## Approach (smallest correct change)

Attach fixes inside `run_rule_engine_for_analysis`
(`components/worker/app/verdict_lib/degraded.py:73`), between `evaluate_problems`
and the existing validate-and-persist loop. `_to_row` already maps
`fix=(v.fix.model_dump() if v.fix else None)` (`degraded.py:161`), so persistence
needs no change.

```python
# degraded.py, inside run_rule_engine_for_analysis, after line 112:
problems: list[VerdictModel] = rule_engine.evaluate_problems(flattened)

# NEW — attach deterministic Fixes to fixable problems (same genre resolution
# as solve_lib.solve). LLM solvers stay on-demand; this is the cheap path.
# Defensive: a solver bug must degrade to Problems-only, never wipe the
# IDENTIFY output (the whole function body is in one try/except that returns 0
# and persists nothing on a raise — so the SOLVE step gets its own guard).
genre = (flattened.get("phase2") or {}).get("genre")
try:
    problems = solve_merge(problems, flattened, genre)
except Exception:
    logger.warning("SOLVE merge failed for analysis=%s; persisting Problems "
                   "without fixes", analysis_id, exc_info=True)

# existing validate-and-persist loop continues unchanged...
```

(`solve_merge` is `from app.solve_lib.router import merge as solve_merge`, added
to the function's lazy-import block alongside `validate_verdict`.)

### Why this spot, not a new Phase C2.5 in `tasks_dramatiq.py`

- `merge` needs the flattened analysis dict + genre, both already in scope here.
- `merge` internally calls `validate_verdict`; the existing loop re-validates —
  harmless (idempotent) and keeps one persistence path.
- Phase C2's idempotency guard (`source == "rule_engine"`, `degraded.py:96-103`)
  still protects re-runs: the whole function is skip-if-exists, fixes included.
- `route()` only maps `audio_only` `(category, data_tier)` pairs and requires
  `v.fixable` (`router.py:37-41`); non-fixable / unmapped problems pass through
  with `fix=None` unchanged. No behavior change for observations/integrity.

### Edge cases (already handled by `merge`)

- Solver returns `None` (declines) → problem passes through unsolved (`router.py:53`).
- `validate_verdict` rejects the candidate → fix dropped, problem kept (`router.py:60`).
- Malformed `final_json` → `flatten` yields `{}`, no phases, solvers no-op.

## Files to change

| File | Change |
|------|--------|
| `components/worker/app/verdict_lib/degraded.py` | Insert `merge(...)` call after `evaluate_problems` (~3 lines + import). |

That's the whole production change. No schema/migration, no BFF, no frontend —
the `fix` column, `VerdictDto.fix`, TS `VerdictFix`, and the Listen handoff all
already exist.

## Tests (worker, `components/worker/tests/`)

1. **Expected use** — given a `final_json` with a clear fixable problem (e.g.
   clipping or loudness off-target), `run_rule_engine_for_analysis` persists a
   verdict whose `fix` is non-null with a `dsp_chain` of the expected `DspOp`
   type (`limiter` / `gain` respectively). *This is the regression guard.*
2. **Non-fixable pass-through** — an observation / unmapped-category problem
   persists with `fix=None` (no solver wrongly attached).
3. **Idempotency** — second call returns 0 and does not duplicate/alter fixes.
4. **Failure tolerance** — a SOLVE-tier crash degrades to Problems-only and never
   wipes the IDENTIFY output. `test_run_rule_engine_survives_solver_failure_and_keeps_problems`
   monkeypatches `solve_lib.router.merge` to raise and asserts `written >= 1`
   with `all(r.fix is None)`.

Checked: no existing test asserted `fix=None` for *rule-engine rows*. The two
`assert v.fix is None` hits (`test_engine_harness.py`, `test_identifiers.py`) are
on the IDENTIFY-tier producers (`_problem` builder / LLM identifiers), which
correctly stay `fix=None` — SOLVE runs downstream in `degraded.py`. No bug-encoding
test needed updating.

## Outcome (executed 2026-06-28)

- Production: `degraded.py` — lazy import of `merge as solve_merge` + a
  genre-resolved, defensively-guarded `merge` call between `evaluate_problems`
  and the persist loop. `_to_row` already persists `fix`.
- Tests added to `test_degraded_path.py`: regression guard (fixable clipping
  Problem now persists a `limiter` `dsp_chain`) + solver-failure tolerance.
- Gates: targeted `pytest` 47/47 green; ruff + mypy clean. The worker full-suite's
  12 `db_sync`-pollution failures are pre-existing (verified identical on a clean
  tree) and unrelated.

## Validation gates

```bash
pytest -q components/worker/tests/
ruff check components/worker/
mypy components/worker/app/ --ignore-missing-imports
```

Manual: run one analysis end-to-end, open the results page, confirm a fixable
verdict shows "The Fix" with a device + params, click into Listen, confirm the
fix appears in the Plan tab and applies to the rack.

## Rollback

Single-file, additive — revert the `merge(...)` insertion in `degraded.py` to
return to Problems-only behavior.
