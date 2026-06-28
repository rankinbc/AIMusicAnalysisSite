# Coach Mix — Autonomous Arbitration Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Coach Mix's mechanical dedup with an autonomous arbitration engine that decides which fixes are needed, combines/averages the ones that belong together, consults a holistic mastering-engineer LLM on judgment calls, and emits a release-ready master rack.

**Architecture:** A new `components/worker/app/coach_mix/` package orchestrates the existing IDENTIFY→SOLVE output through a deterministic four-pass Arbiter (NEED→COMBINE→SCAFFOLD→GUARD), escalates unresolved judgment calls to one constrained LLM persona, then translates the reconciled fixes through the existing `solve_lib.preset_compiler`. The on-demand `generate_fix_rack` actor calls it; persistence, the BFF endpoint, and the Listen handoff are reused.

**Tech Stack:** Python 3.11 (dramatiq, Pydantic v2, SQLAlchemy 2.0 sync) for the worker; .NET 10 / EF Core 10 for the BFF; React 19 + TS strict for the frontend.

**Design spec:** `docs/superpowers/specs/2026-06-28-coach-mix-arbiter-design.md`

## Global Constraints

- Python: `ruff format` + `ruff check`; `mypy`; Pydantic v2 only; dramatiq actors are sync `def`. Tests with `pytest` (asyncio_mode=auto). Never loosen `numpy<2.0`.
- Every `DspOp` must pass `aimusic_shared.verdicts.models.DspOp` param-range validation; every chain must pass the rack schema (`solve_lib/rack_schema.py`) — GUARD runs last so the persisted chain always loads.
- LLM calls go through `app.llm.gateway.complete_sync` ONLY (never call anthropic directly); it owns budget + transport retries and raises `LlmBudgetExceeded` / `LlmError`.
- Fail-open everywhere: a deterministic chain always exists before the LLM is consulted; any LLM failure keeps the deterministic chain and sets `degraded=true`.
- Preset persistence: keep `RackPreset.source == "analysis"` (do NOT rename). `chain_json` stays the pure rack chain; coaching meta goes in the new `coach_meta` column.
- C#: snake_case columns; EF migration appended for the new column; DTOs are records.
- TS strict + `verbatimModuleSyntax` (`import type`); CSS Modules, no Tailwind; all four gates (`tsc`, `lint --max-warnings 0`, `build`, `vitest`).
- No tier gate on the LLM for now (both free + pro). The free-tier LLM budget flag `llm_budget_free_usd` must be non-zero (Task 13) or every free Coach Mix degrades.

**Data-model conventions used across tasks (define once, referenced everywhere):**

```python
# components/worker/app/coach_mix/types.py
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict
from aimusic_shared.verdicts.models import Verdict

class JudgmentCall(TypedDict):
    kind: str                 # "eq_conflict" | "glue_offer" | "loudness_conflict" | "heavy_clamp"
    where: str                # human label, e.g. "eq slot @300Hz"
    competing_fix_ids: list[str]   # problem_ids involved
    context: dict[str, Any]   # measured numbers the LLM needs
    question: str             # the specific decision asked of the LLM

@dataclass
class ArbiterResult:
    verdicts: list[Verdict]                  # reconciled fixes, ready for compile_preset
    judgment_calls: list[JudgmentCall] = field(default_factory=list)
    change_log: list[dict[str, Any]] = field(default_factory=list)
```

Each solver emits a `Fix` whose `dsp_chain` is a single `DspOp` (see `solve_lib/solvers.py`), so the Arbiter treats one candidate `Verdict` ≈ one `DspOp`. A "merged" verdict is produced with:
`v.model_copy(update={"fix": v.fix.model_copy(update={"dsp_chain": [merged_op]})})`.

---

## Phase 1 — Worker: deterministic Arbiter core

### Task 1: `coach_mix` package + types + interaction config

**Files:**
- Create: `components/worker/app/coach_mix/__init__.py`
- Create: `components/worker/app/coach_mix/types.py`
- Create: `components/worker/app/coach_mix/interactions.py`
- Test: `components/worker/tests/coach_mix/__init__.py` (empty)
- Test: `components/worker/tests/coach_mix/test_interactions.py`

**Interfaces:**
- Produces: `types.JudgmentCall`, `types.ArbiterResult` (above). `interactions.NEED_FLOOR_SEVERITIES: set[str]`, `interactions.UNIVERSAL_CATEGORIES: set[str]`, `interactions.EQ_MAX_TOTAL_BOOST_DB: float`, `interactions.MAX_CUT_DEPTH_DB: float`, `interactions.MAX_CUMULATIVE_GAIN_DB: float`, `interactions.COMP_RATIO_CAP: float`, `interactions.WIDTH_PCT_BOUNDS: tuple[float,float]`, and pure helpers `blend_eq(a: DspOp, b: DspOp) -> DspOp`, `clamp_gain_total(ops: list[DspOp]) -> tuple[list[DspOp], float]`.

- [ ] **Step 1: Write `types.py`** (verbatim from Global Constraints block above). Create `__init__.py` files (package + test package) empty.

- [ ] **Step 2: Write the failing test for `blend_eq`**

```python
# components/worker/tests/coach_mix/test_interactions.py
from aimusic_shared.verdicts.models import DspOp
from app.coach_mix import interactions as I


def test_blend_eq_same_direction_averages_freq_and_caps_sum_gain():
    a = DspOp(type="peaking_eq", params={"frequency_hz": 280.0, "gain_db": -2.0, "q": 1.0})
    b = DspOp(type="peaking_eq", params={"frequency_hz": 320.0, "gain_db": -3.0, "q": 1.0})
    out = I.blend_eq(a, b)
    assert out.type == "peaking_eq"
    assert out.params["frequency_hz"] == 300.0          # averaged
    assert out.params["gain_db"] == -5.0                # summed (within cut budget)


def test_blend_eq_caps_summed_boost_to_budget():
    a = DspOp(type="peaking_eq", params={"frequency_hz": 1000.0, "gain_db": 4.0, "q": 1.0})
    b = DspOp(type="peaking_eq", params={"frequency_hz": 1000.0, "gain_db": 4.0, "q": 1.0})
    out = I.blend_eq(a, b)
    assert out.params["gain_db"] == I.EQ_MAX_TOTAL_BOOST_DB  # 6.0 cap, not 8.0


def test_clamp_gain_total_caps_cumulative_trim():
    ops = [DspOp(type="gain", params={"gain_db": -20.0}),
           DspOp(type="gain", params={"gain_db": -20.0})]
    clamped, total = I.clamp_gain_total(ops)
    assert total == -I.MAX_CUMULATIVE_GAIN_DB   # e.g. -24.0, not -40.0
    assert len(clamped) == 1
    assert clamped[0].params["gain_db"] == -I.MAX_CUMULATIVE_GAIN_DB
```

- [ ] **Step 3: Run to verify failure**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_interactions.py -v`
Expected: FAIL (`ModuleNotFoundError: app.coach_mix.interactions`)

- [ ] **Step 4: Write `interactions.py`**

```python
# components/worker/app/coach_mix/interactions.py
"""Tuning constants + pure interaction helpers for the Coach Mix arbiter.

Genre-relative targets are resolved by the arbiter via genre_config; these are
the genre-agnostic safety budgets + the deterministic combine math.
"""
from __future__ import annotations

from aimusic_shared.verdicts.models import DspOp

# NEED: fixes below this severity are dropped unless their category is universal.
NEED_FLOOR_SEVERITIES: set[str] = {"win"}            # 'minor'+ always kept for now
UNIVERSAL_CATEGORIES: set[str] = {"clipping", "loudness"}

# GUARD budgets (do-no-harm ceilings).
EQ_MAX_TOTAL_BOOST_DB: float = 6.0
MAX_CUT_DEPTH_DB: float = 9.0
MAX_CUMULATIVE_GAIN_DB: float = 24.0
COMP_RATIO_CAP: float = 4.0
WIDTH_PCT_BOUNDS: tuple[float, float] = (50.0, 120.0)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def blend_eq(a: DspOp, b: DspOp) -> DspOp:
    """Blend two same-direction EQ ops in one slot: average freq, sum gain (capped)."""
    fa, fb = float(a.params["frequency_hz"]), float(b.params["frequency_hz"])
    ga, gb = float(a.params.get("gain_db", 0.0)), float(b.params.get("gain_db", 0.0))
    summed = ga + gb
    if summed >= 0:
        gain = _clamp(summed, 0.0, EQ_MAX_TOTAL_BOOST_DB)
    else:
        gain = _clamp(summed, -MAX_CUT_DEPTH_DB, 0.0)
    q = (float(a.params.get("q", 1.0)) + float(b.params.get("q", 1.0))) / 2.0
    return DspOp(type="peaking_eq", params={
        "frequency_hz": round((fa + fb) / 2.0, 1), "gain_db": round(gain, 2), "q": round(q, 2),
    })


def clamp_gain_total(ops: list[DspOp]) -> tuple[list[DspOp], float]:
    """Collapse N trim/gain ops into one, clamped to the cumulative-gain budget."""
    total = sum(float(o.params.get("gain_db", 0.0)) for o in ops)
    total = _clamp(total, -MAX_CUMULATIVE_GAIN_DB, MAX_CUMULATIVE_GAIN_DB)
    return [DspOp(type="gain", params={"gain_db": round(total, 2)})], round(total, 2)
```

- [ ] **Step 5: Run to verify pass**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_interactions.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add components/worker/app/coach_mix/ components/worker/tests/coach_mix/
git commit -m "feat(coach-mix): arbiter types + interaction config/helpers"
```

---

### Task 2: Arbiter NEED + COMBINE passes

**Files:**
- Create: `components/worker/app/coach_mix/arbiter.py`
- Test: `components/worker/tests/coach_mix/test_arbiter_combine.py`

**Interfaces:**
- Consumes: `interactions.blend_eq`, `interactions.clamp_gain_total`, `rack_schema.DSPTYPE_TO_MODULE`, `rack_schema.nearest_band_slot`, `aimusic_shared.verdicts.models.{Verdict,DspOp}`.
- Produces: `arbiter._need(verdicts) -> list[Verdict]`; `arbiter._combine(verdicts, change_log) -> tuple[list[Verdict], list[JudgmentCall]]`. Helper `arbiter._single_op(v) -> DspOp` (first dsp op), `arbiter._with_op(v, op) -> Verdict`.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/coach_mix/test_arbiter_combine.py
from aimusic_shared.verdicts.models import DspOp, Evidence, Fix
from app.verdict_lib.rule_engine import _problem
from app.coach_mix import arbiter


def _fix_v(slug, category, op, *, severity="severe", conf=0.9):
    v = _problem(track_id="t", slug=slug, severity=severity, category=category,
                 headline="h", summary="s", why_it_matters="w", data_tier="audio_only",
                 fixable=True, evidence=[Evidence(metric="phase1.x", value=1.0, label="x")])
    fix = Fix(fix_id=f"fix.{slug}", target={"type": "master", "name": "master"},
              dsp_chain=[op], expected_outcome="o")
    return v.model_copy(update={"fix": fix, "confidence": conf})


def test_combine_blends_same_direction_eq_in_one_slot():
    a = _fix_v("mud_a", "frequency_balance",
               DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -2.0, "q": 1.0}))
    b = _fix_v("mud_b", "clarity",
               DspOp(type="peaking_eq", params={"frequency_hz": 320.0, "gain_db": -2.0, "q": 1.0}))
    log: list = []
    out, calls = arbiter._combine([a, b], log)
    eqs = [v for v in out if v.fix.dsp_chain[0].type == "peaking_eq"]
    assert len(eqs) == 1                                   # blended into one
    assert eqs[0].fix.dsp_chain[0].params["gain_db"] == -4.0
    assert not calls                                       # same direction → no judgment call


def test_combine_escalates_opposite_direction_eq_clash():
    boost = _fix_v("air", "frequency_balance",
                   DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": 3.0, "q": 1.0}))
    cut = _fix_v("mud", "frequency_balance",
                 DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -3.0, "q": 1.0}))
    log: list = []
    out, calls = arbiter._combine([boost, cut], log)
    assert any(c["kind"] == "eq_conflict" for c in calls)  # escalated to LLM


def test_combine_keeps_different_slots_additive():
    low = _fix_v("low", "frequency_balance",
                 DspOp(type="peaking_eq", params={"frequency_hz": 120.0, "gain_db": -2.0, "q": 1.0}))
    high = _fix_v("high", "frequency_balance",
                  DspOp(type="peaking_eq", params={"frequency_hz": 8000.0, "gain_db": -2.0, "q": 1.0}))
    out, calls = arbiter._combine([low, high], [])
    assert len([v for v in out if v.fix.dsp_chain[0].type == "peaking_eq"]) == 2


def test_need_drops_win_severity_non_universal():
    keep = _fix_v("real", "frequency_balance",
                  DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -2.0, "q": 1.0}),
                  severity="severe")
    drop = _fix_v("nit", "stereo_field",
                  DspOp(type="stereo_width", params={"width_pct": 95.0}), severity="win")
    kept = arbiter._need([keep, drop])
    slugs = {v.problem_id.split(".")[1] for v in kept}
    assert "real" in slugs and "nit" not in slugs
```

- [ ] **Step 2: Run to verify failure**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_arbiter_combine.py -v`
Expected: FAIL (`app.coach_mix.arbiter` missing)

- [ ] **Step 3: Write `arbiter.py` (NEED + COMBINE; SCAFFOLD/GUARD/run added in Tasks 3-4)**

```python
# components/worker/app/coach_mix/arbiter.py
"""Deterministic Coach Mix arbiter: NEED -> COMBINE -> SCAFFOLD -> GUARD.

Consumes the freshly-merged candidate fixes (Verdicts with a single-op Fix) and
returns reconciled Verdicts ready for solve_lib.preset_compiler, plus the
judgment calls the LLM must rule on and a human-readable change_log.
"""
from __future__ import annotations

from typing import Any

from aimusic_shared.verdicts.models import DspOp, Verdict

from app.coach_mix import interactions as I
from app.coach_mix.types import JudgmentCall
from app.solve_lib.rack_schema import DSPTYPE_TO_MODULE, nearest_band_slot


def _single_op(v: Verdict) -> DspOp:
    return v.fix.dsp_chain[0]


def _with_op(v: Verdict, op: DspOp) -> Verdict:
    return v.model_copy(update={"fix": v.fix.model_copy(update={"dsp_chain": [op]})})


def _need(verdicts: list[Verdict]) -> list[Verdict]:
    kept: list[Verdict] = []
    for v in verdicts:
        if v.severity in I.NEED_FLOOR_SEVERITIES and v.category not in I.UNIVERSAL_CATEGORIES:
            continue
        kept.append(v)
    # Highest priority first — later passes treat the head as the representative.
    return sorted(kept, key=lambda v: v.priority_score, reverse=True)


def _combine(verdicts: list[Verdict], change_log: list[dict[str, Any]]
             ) -> tuple[list[Verdict], list[JudgmentCall]]:
    calls: list[JudgmentCall] = []
    eq_slots: dict[int, Verdict] = {}    # slot -> representative verdict (its op already in slot)
    gain_pairs: list[Verdict] = []
    passthrough: list[Verdict] = []

    for v in verdicts:
        op = _single_op(v)
        module = DSPTYPE_TO_MODULE.get(op.type)
        if module == "eq" and op.type == "peaking_eq":
            slot = nearest_band_slot(float(op.params["frequency_hz"]))
            if slot not in eq_slots:
                eq_slots[slot] = v
                continue
            cur = eq_slots[slot]
            cur_g = float(_single_op(cur).params.get("gain_db", 0.0))
            new_g = float(op.params.get("gain_db", 0.0))
            if (cur_g >= 0) == (new_g >= 0):  # same direction -> blend
                merged = I.blend_eq(_single_op(cur), op)
                eq_slots[slot] = _with_op(cur, merged)
                change_log.append({"module": "eq", "change": f"blended {cur.problem_id}+{v.problem_id} @slot{slot}",
                                   "why": "same-direction EQ in one band"})
            else:                              # opposite -> escalate
                calls.append(JudgmentCall(
                    kind="eq_conflict", where=f"eq slot @{int(op.params['frequency_hz'])}Hz",
                    competing_fix_ids=[cur.problem_id or "", v.problem_id or ""],
                    context={"cur_gain_db": cur_g, "new_gain_db": new_g},
                    question="A boost and a cut target the same band — keep which, or net them?"))
                # default deterministic resolution: keep the stronger move
                if abs(new_g) > abs(cur_g):
                    eq_slots[slot] = v
        elif module == "trim":
            gain_pairs.append(v)
        else:
            passthrough.append(v)

    out: list[Verdict] = list(eq_slots.values()) + passthrough
    if gain_pairs:
        clamped, total = I.clamp_gain_total([_single_op(v) for v in gain_pairs])
        rep = max(gain_pairs, key=lambda v: v.priority_score)
        out.append(_with_op(rep, clamped[0]))
        if len(gain_pairs) > 1:
            change_log.append({"module": "trim", "change": f"summed {len(gain_pairs)} trims -> {total}dB",
                               "why": "cumulative gain staging"})
    return out, calls
```

- [ ] **Step 4: Run to verify pass**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_arbiter_combine.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/coach_mix/arbiter.py components/worker/tests/coach_mix/test_arbiter_combine.py
git commit -m "feat(coach-mix): arbiter NEED + COMBINE passes"
```

---

### Task 3: Arbiter SCAFFOLD pass (release-ready finishing)

**Files:**
- Modify: `components/worker/app/coach_mix/arbiter.py`
- Test: `components/worker/tests/coach_mix/test_arbiter_scaffold.py`

**Interfaces:**
- Consumes: `app.verdict_lib.genre_config as G` (`G.master_context()`, `G.ppath(genre, path, default)`), `aimusic_shared.verdicts.ulid_helpers.new_verdict_id`, `aimusic_shared.verdicts.scoring.compute_priority_score`.
- Produces: `arbiter._scaffold(verdicts, analysis, genre, change_log) -> tuple[list[Verdict], list[JudgmentCall]]`.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/coach_mix/test_arbiter_scaffold.py
from aimusic_shared.verdicts.models import DspOp, Evidence, Fix
from app.verdict_lib.rule_engine import _problem
from app.coach_mix import arbiter


def _fix_v(slug, category, op):
    v = _problem(track_id="t", slug=slug, severity="severe", category=category,
                 headline="h", summary="s", why_it_matters="w", data_tier="audio_only",
                 fixable=True, evidence=[Evidence(metric="phase1.x", value=1.0, label="x")])
    return v.model_copy(update={"fix": Fix(fix_id=f"fix.{slug}", target={"type": "master", "name": "master"},
                                           dsp_chain=[op], expected_outcome="o")})


def test_scaffold_adds_ceiling_limiter_when_absent():
    a = {"phase1": {"lufs": -8.0}, "phase2": {"genre": "techno"}}
    out, _calls = arbiter._scaffold([], a, "techno", [])
    types = {v.fix.dsp_chain[0].type for v in out}
    assert "limiter" in types          # release-ready always finishes with a ceiling
    assert "gain" in types             # and a loudness trim toward target (-8 is over)


def test_scaffold_does_not_duplicate_existing_limiter():
    existing = _fix_v("clip", "clipping", DspOp(type="limiter", params={"ceiling_db": -1.0}))
    a = {"phase1": {"lufs": -14.0}, "phase2": {"genre": "techno"}}
    out, _calls = arbiter._scaffold([existing], a, "techno", [])
    limiters = [v for v in out if v.fix.dsp_chain[0].type == "limiter"]
    assert len(limiters) == 1          # not duplicated


def test_scaffold_offers_glue_as_judgment_call_only():
    a = {"phase1": {"lufs": -14.0}, "phase2": {"genre": "techno"}}
    out, calls = arbiter._scaffold([], a, "techno", [])
    assert all(v.fix.dsp_chain[0].type != "compressor" for v in out)  # never forced
    assert any(c["kind"] == "glue_offer" for c in calls)             # offered to LLM
```

- [ ] **Step 2: Run to verify failure**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_arbiter_scaffold.py -v`
Expected: FAIL (`arbiter._scaffold` missing)

- [ ] **Step 3: Add `_scaffold` to `arbiter.py`**

```python
# append to components/worker/app/coach_mix/arbiter.py
from aimusic_shared.verdicts.models import Evidence, Fix
from app.verdict_lib import genre_config as G
from app.verdict_lib.rule_engine import _problem


def _scaffold_verdict(slug: str, category: str, op: DspOp, outcome: str) -> Verdict:
    # Build via _problem so every required Verdict field is set correctly. These
    # verdicts are EPHEMERAL — they only flow into compile_preset to build the
    # chain; they are never persisted as Verdict rows, so source/specialist are
    # irrelevant. Attach the fix via model_copy.
    v = _problem(
        track_id="master", slug=slug, severity="minor", category=category,
        headline=outcome[:120], summary=outcome, why_it_matters="release-ready finishing",
        data_tier="audio_only", fixable=True,
        evidence=[Evidence(metric="phase1.lufs", value=0.0, label="scaffold")],
    )
    return v.model_copy(update={"fix": Fix(
        fix_id=f"fix.coach_mix.{slug}", target={"type": "master", "name": "master"},
        dsp_chain=[op], expected_outcome=outcome)})


def _scaffold(verdicts: list[Verdict], analysis: dict[str, Any], genre: str | None,
              change_log: list[dict[str, Any]]) -> tuple[list[Verdict], list[JudgmentCall]]:
    out = list(verdicts)
    calls: list[JudgmentCall] = []
    present = {DSPTYPE_TO_MODULE.get(_single_op(v).type) for v in verdicts}

    # Always finish with a true-peak ceiling limiter.
    if "limiter" not in present:
        ctx = G.master_context()
        ceiling = float(G.ppath(genre, f"loudness.{ctx}.true_peak_dbtp_max", -1.0))
        out.append(_scaffold_verdict("ceiling", "clipping",
                   DspOp(type="limiter", params={"ceiling_db": max(-6.0, min(0.0, ceiling)),
                                                  "release_ms": 100.0, "lookahead_ms": 2.0}),
                   f"Hold true peak at {ceiling:.1f} dBTP."))
        change_log.append({"module": "limiter", "change": "added ceiling (proactive)",
                           "why": "release-ready finishing"})

    # Loudness trim toward target when over and no trim already present.
    lufs = (analysis.get("phase1") or {}).get("lufs")
    if "trim" not in present and lufs is not None:
        ctx = G.master_context()
        target = G.ppath(genre, f"loudness.{ctx}.lufs_target") or G.ppath(genre, "loudness.streaming.lufs_target", -14.0)
        delta = float(target) - float(lufs)
        if delta < 0:
            out.append(_scaffold_verdict("loudness", "loudness",
                       DspOp(type="gain", params={"gain_db": max(-24.0, min(0.0, delta))}),
                       f"Trim {delta:.1f} dB toward {float(target):.0f} LUFS."))
            change_log.append({"module": "trim", "change": "added loudness trim (proactive)",
                               "why": "release-ready finishing"})

    # Offer glue as a judgment call (never forced) when the mix is clean.
    if "comp" not in present:
        calls.append(JudgmentCall(kind="glue_offer", where="bus comp",
                     competing_fix_ids=[], context={"lufs": lufs},
                     question="Would gentle bus-comp glue help, or is this clean mix better left untouched?"))
    return out, calls
```

- [ ] **Step 4: Run to verify pass**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_arbiter_scaffold.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/coach_mix/arbiter.py components/worker/tests/coach_mix/test_arbiter_scaffold.py
git commit -m "feat(coach-mix): arbiter SCAFFOLD (release-ready finishing + glue offer)"
```

---

### Task 4: Arbiter GUARD pass + `run()` orchestration

**Files:**
- Modify: `components/worker/app/coach_mix/arbiter.py`
- Test: `components/worker/tests/coach_mix/test_arbiter_run.py`

**Interfaces:**
- Produces: `arbiter._guard(verdicts, change_log) -> tuple[list[Verdict], list[JudgmentCall]]`; `arbiter.run(verdicts, analysis, genre) -> ArbiterResult`.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/coach_mix/test_arbiter_run.py
from aimusic_shared.verdicts.models import DspOp, Evidence, Fix
from app.verdict_lib.rule_engine import _problem
from app.coach_mix import arbiter, interactions as I
from app.coach_mix.types import ArbiterResult


def _fix_v(slug, category, op):
    v = _problem(track_id="t", slug=slug, severity="severe", category=category,
                 headline="h", summary="s", why_it_matters="w", data_tier="audio_only",
                 fixable=True, evidence=[Evidence(metric="phase1.x", value=1.0, label="x")])
    return v.model_copy(update={"fix": Fix(fix_id=f"fix.{slug}", target={"type": "master", "name": "master"},
                                           dsp_chain=[op], expected_outcome="o")})


def test_guard_clamps_over_budget_cut():
    deep = _fix_v("mud", "frequency_balance",
                  DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -20.0, "q": 1.0}))
    out, _ = arbiter._guard([deep], [])
    assert out[0].fix.dsp_chain[0].params["gain_db"] == -I.MAX_CUT_DEPTH_DB


def test_run_returns_arbiterresult_and_always_finishes_a_master():
    v = _fix_v("mud", "frequency_balance",
               DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -2.0, "q": 1.0}))
    res = arbiter.run([v], {"phase1": {"lufs": -8.0}, "phase2": {"genre": "techno"}}, "techno")
    assert isinstance(res, ArbiterResult)
    types = {x.fix.dsp_chain[0].type for x in res.verdicts}
    assert "limiter" in types                # scaffold finished the master
    assert res.change_log                     # decisions recorded
```

- [ ] **Step 2: Run to verify failure**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_arbiter_run.py -v`
Expected: FAIL (`arbiter._guard` / `arbiter.run` missing)

- [ ] **Step 3: Add `_guard` + `run` to `arbiter.py`**

```python
# append to components/worker/app/coach_mix/arbiter.py
from app.coach_mix.types import ArbiterResult


def _guard(verdicts: list[Verdict], change_log: list[dict[str, Any]]
           ) -> tuple[list[Verdict], list[JudgmentCall]]:
    out: list[Verdict] = []
    calls: list[JudgmentCall] = []
    for v in verdicts:
        op = _single_op(v)
        if op.type in ("peaking_eq", "low_shelf", "high_shelf"):
            g = float(op.params.get("gain_db", 0.0))
            clamped = max(-I.MAX_CUT_DEPTH_DB, min(I.EQ_MAX_TOTAL_BOOST_DB, g))
            if clamped != g:
                op = DspOp(type=op.type, params={**op.params, "gain_db": round(clamped, 2)})
                v = _with_op(v, op)
                change_log.append({"module": "eq", "change": f"clamped gain {g}->{clamped}",
                                   "why": "do-no-harm budget"})
        elif op.type == "compressor":
            r = float(op.params.get("ratio", 2.0))
            if r > I.COMP_RATIO_CAP:
                op = DspOp(type="compressor", params={**op.params, "ratio": I.COMP_RATIO_CAP})
                v = _with_op(v, op)
                change_log.append({"module": "comp", "change": f"capped ratio -> {I.COMP_RATIO_CAP}",
                                   "why": "do-no-harm budget"})
        elif op.type == "stereo_width":
            w = float(op.params.get("width_pct", 100.0))
            lo, hi = I.WIDTH_PCT_BOUNDS
            clamped = max(lo, min(hi, w))
            if clamped != w:
                op = DspOp(type="stereo_width", params={**op.params, "width_pct": clamped})
                v = _with_op(v, op)
        out.append(v)
    return out, calls


def run(verdicts: list[Verdict], analysis: dict[str, Any], genre: str | None) -> ArbiterResult:
    change_log: list[dict[str, Any]] = []
    needed = _need(verdicts)
    combined, calls_c = _combine(needed, change_log)
    scaffolded, calls_s = _scaffold(combined, analysis, genre, change_log)
    guarded, calls_g = _guard(scaffolded, change_log)
    return ArbiterResult(verdicts=guarded, judgment_calls=[*calls_c, *calls_s, *calls_g],
                         change_log=change_log)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_arbiter_run.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the whole arbiter test set + ruff + mypy**

Run: `cd components/worker && python -m pytest tests/coach_mix/ -q && cd /c/Users/badmin/projects/AIMusicAnalysisSite && python -m ruff check components/worker/app/coach_mix/ && cd components/worker && python -m mypy app/coach_mix/ --ignore-missing-imports`
Expected: all PASS / clean

- [ ] **Step 6: Commit**

```bash
git add components/worker/app/coach_mix/arbiter.py components/worker/tests/coach_mix/test_arbiter_run.py
git commit -m "feat(coach-mix): arbiter GUARD + run() orchestration"
```

---

## Phase 2 — Worker: holistic LLM arbiter

### Task 5: MasteringEngineer prompt + decision schema

**Files:**
- Create: `components/worker/prompts/experts/MasteringEngineer.md`
- Create: `components/worker/app/coach_mix/decision_schema.py`
- Modify: `components/worker/app/verdict_lib/prompt_loader.py` (register the slug→filename mapping)
- Test: `components/worker/tests/coach_mix/test_decision_schema.py`

**Interfaces:**
- Produces: `decision_schema.ArbiterDecision` (Pydantic): `{call_index: int, action: Literal["keep","blend","drop","add_glue","adjust"], params: dict[str,Any] | None, rationale: str}`; `decision_schema.ArbiterResponse` = `{decisions: list[ArbiterDecision]}`.
- The prompt loader maps slug `"mastering_engineer"` → `"MasteringEngineer.md"`.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/coach_mix/test_decision_schema.py
import pytest
from pydantic import ValidationError
from app.coach_mix.decision_schema import ArbiterResponse


def test_parses_valid_decisions():
    r = ArbiterResponse.model_validate({"decisions": [
        {"call_index": 0, "action": "drop", "params": None, "rationale": "clean mix"},
        {"call_index": 1, "action": "add_glue", "params": {"ratio": 1.5, "threshold_db": -18.0,
                                                            "attack_ms": 30.0, "release_ms": 120.0},
         "rationale": "gentle glue"},
    ]})
    assert len(r.decisions) == 2
    assert r.decisions[1].action == "add_glue"


def test_rejects_unknown_action():
    with pytest.raises(ValidationError):
        ArbiterResponse.model_validate({"decisions": [
            {"call_index": 0, "action": "nuke", "rationale": "x"}]})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_decision_schema.py -v`
Expected: FAIL (module missing)

- [ ] **Step 3: Write `decision_schema.py`**

```python
# components/worker/app/coach_mix/decision_schema.py
"""Constrained output contract for the holistic mastering-engineer LLM.

The LLM does NOT author a rack — it rules on the arbiter's judgment calls.
Every param it returns is re-validated by GUARD + DspOp before it touches the
chain (see llm_arbiter.apply_decisions)."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel

Action = Literal["keep", "blend", "drop", "add_glue", "adjust"]


class ArbiterDecision(BaseModel):
    call_index: int
    action: Action
    params: dict[str, Any] | None = None
    rationale: str = ""


class ArbiterResponse(BaseModel):
    decisions: list[ArbiterDecision]
```

- [ ] **Step 4: Write the prompt** `components/worker/prompts/experts/MasteringEngineer.md` with YAML frontmatter (mirror an existing prompt's frontmatter keys — open `components/worker/prompts/experts/Loudness.md` and copy the `version:`/`model:` frontmatter shape). Body instructs: "You are a mastering engineer. You are given the measured metrics, the detected problems, the candidate rack, and a numbered list of JUDGMENT CALLS. For each call return a decision. Respond with ONLY JSON matching: `{\"decisions\":[{\"call_index\":int,\"action\":\"keep|blend|drop|add_glue|adjust\",\"params\":{...}|null,\"rationale\":str}]}`. Guard against over-processing a clean mix."

- [ ] **Step 5: Register the slug** in `prompt_loader.py` — open the file, find `SLUG_TO_FILENAME`, add `"mastering_engineer": "MasteringEngineer.md",`.

- [ ] **Step 6: Run to verify pass**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_decision_schema.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add components/worker/app/coach_mix/decision_schema.py components/worker/prompts/experts/MasteringEngineer.md components/worker/app/verdict_lib/prompt_loader.py components/worker/tests/coach_mix/test_decision_schema.py
git commit -m "feat(coach-mix): mastering-engineer prompt + constrained decision schema"
```

---

### Task 6: LLM arbiter — consult + apply + re-guard + degrade

**Files:**
- Create: `components/worker/app/coach_mix/llm_arbiter.py`
- Test: `components/worker/tests/coach_mix/test_llm_arbiter.py`

**Interfaces:**
- Consumes: `app.llm.gateway.complete_sync` (signature per `verdict_actor.py:220`), `app.llm.gateway.{LlmBudgetExceeded,LlmError}`, `app.verdict_lib.json_extraction.extract_json_object`, `app.verdict_lib.prompt_loader.{load_prompt,load_prompt_model}`, `arbiter._guard`, `decision_schema.ArbiterResponse`.
- Produces: `llm_arbiter.consult(result: ArbiterResult, analysis: dict, genre: str|None, *, user_id: str, correlation_id: str) -> tuple[ArbiterResult, str|None, bool]` returning `(updated_result, arbiter_notes_json_or_None, degraded)`.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/coach_mix/test_llm_arbiter.py
import json
import pytest
from app.coach_mix import llm_arbiter
from app.coach_mix.types import ArbiterResult, JudgmentCall
from app.llm.gateway import LlmBudgetExceeded


class _Result:
    def __init__(self, text): self.text, self.model = text, "claude-test"


def _res_with_glue_call():
    return ArbiterResult(verdicts=[], judgment_calls=[JudgmentCall(
        kind="glue_offer", where="bus comp", competing_fix_ids=[], context={"lufs": -14.0},
        question="glue?")], change_log=[])


def test_consult_skips_llm_when_no_judgment_calls(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", lambda **k: called.__setitem__("n", 1))
    out, notes, degraded = llm_arbiter.consult(
        ArbiterResult(verdicts=[], judgment_calls=[], change_log=[]), {}, "techno",
        user_id="u", correlation_id="c")
    assert called["n"] == 0 and notes is None and degraded is False


def test_consult_applies_decision_and_returns_notes(monkeypatch):
    monkeypatch.setattr(llm_arbiter, "load_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_prompt_model", lambda slug: None)
    payload = {"decisions": [{"call_index": 0, "action": "drop", "params": None, "rationale": "clean"}]}
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", lambda **k: _Result(json.dumps(payload)))
    out, notes, degraded = llm_arbiter.consult(_res_with_glue_call(), {}, "techno",
                                               user_id="u", correlation_id="c")
    assert degraded is False
    assert notes is not None and "clean" in notes


def test_consult_degrades_on_budget_exceeded(monkeypatch):
    monkeypatch.setattr(llm_arbiter, "load_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_prompt_model", lambda slug: None)
    def _boom(**k): raise LlmBudgetExceeded("tier_budget", "over")
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", _boom)
    res = _res_with_glue_call()
    out, notes, degraded = llm_arbiter.consult(res, {}, "techno", user_id="u", correlation_id="c")
    assert degraded is True
    assert out.verdicts == res.verdicts        # deterministic chain preserved


def test_consult_degrades_on_malformed_json(monkeypatch):
    monkeypatch.setattr(llm_arbiter, "load_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_prompt_model", lambda slug: None)
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", lambda **k: _Result("not json"))
    out, notes, degraded = llm_arbiter.consult(_res_with_glue_call(), {}, "techno",
                                               user_id="u", correlation_id="c")
    assert degraded is True
```

- [ ] **Step 2: Run to verify failure**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_llm_arbiter.py -v`
Expected: FAIL (module missing)

- [ ] **Step 3: Write `llm_arbiter.py`**

```python
# components/worker/app/coach_mix/llm_arbiter.py
"""Holistic mastering-engineer escalation: rule on the arbiter's judgment calls.

Consulted only when judgment_calls is non-empty. Fail-open: any LLM problem
keeps the deterministic chain and returns degraded=True. Every param the LLM
returns is re-run through arbiter._guard before it can affect the chain."""
from __future__ import annotations

import json
import logging
from typing import Any

from aimusic_shared.verdicts.models import DspOp, Evidence, Fix, Verdict

from app.coach_mix import arbiter
from app.coach_mix.decision_schema import ArbiterResponse
from app.coach_mix.types import ArbiterResult
from app.llm import gateway
from app.llm.gateway import LlmBudgetExceeded, LlmError
from app.verdict_lib.json_extraction import extract_json_object
from app.verdict_lib.prompt_loader import load_prompt, load_prompt_model
from app.verdict_lib.rule_engine import _problem

logger = logging.getLogger(__name__)
SLUG = "mastering_engineer"


def _build_user_message(result: ArbiterResult, analysis: dict[str, Any], genre: str | None) -> str:
    calls = [{"index": i, **c} for i, c in enumerate(result.judgment_calls)]
    payload = {
        "genre": genre,
        "metrics": analysis.get("phase1") or {},
        "candidate_chain": [v.fix.dsp_chain[0].model_dump() for v in result.verdicts if v.fix],
        "judgment_calls": calls,
    }
    return json.dumps(payload)


def _glue_verdict(params: dict[str, Any]) -> Verdict:
    op = DspOp(type="compressor", params=params)  # DspOp validates ranges
    # Ephemeral verdict (never persisted as a row) built via _problem so all
    # required fields are set; only the fix's dsp_chain reaches compile_preset.
    v = _problem(
        track_id="master", slug="glue", severity="minor", category="dynamics",
        headline="Bus glue", summary="gentle bus compression", why_it_matters="cohesion",
        data_tier="audio_only", fixable=True,
        evidence=[Evidence(metric="phase1.lufs", value=0.0, label="glue")])
    return v.model_copy(update={"fix": Fix(
        fix_id="fix.coach_mix.glue", target={"type": "master", "name": "master"},
        dsp_chain=[op], expected_outcome="gentle bus glue")})


def apply_decisions(result: ArbiterResult, resp: ArbiterResponse) -> ArbiterResult:
    verdicts = list(result.verdicts)
    for d in resp.decisions:
        if d.call_index < 0 or d.call_index >= len(result.judgment_calls):
            continue
        call = result.judgment_calls[d.call_index]
        if call["kind"] == "glue_offer" and d.action == "add_glue" and d.params:
            try:
                verdicts.append(_glue_verdict(d.params))
            except Exception:               # invalid params -> skip the glue
                logger.info("glue params rejected by DspOp validator: %s", d.params)
        # eq_conflict 'drop'/'keep' is already deterministically resolved; the
        # LLM's rationale is recorded in notes but the chain stands unless adjust.
    guarded, _ = arbiter._guard(verdicts, result.change_log)
    return ArbiterResult(verdicts=guarded, judgment_calls=result.judgment_calls,
                         change_log=result.change_log)


def consult(result: ArbiterResult, analysis: dict[str, Any], genre: str | None, *,
            user_id: str, correlation_id: str) -> tuple[ArbiterResult, str | None, bool]:
    if not result.judgment_calls:
        return result, None, False
    try:
        prompt_version, prompt_body = load_prompt(SLUG)
        out = gateway.complete_sync(
            system=prompt_body, user=_build_user_message(result, analysis, genre),
            purpose="coach_mix", prompt_slug=SLUG, prompt_version=prompt_version,
            model=load_prompt_model(SLUG), user_id=_as_uuid(user_id),
            correlation_id=correlation_id, timeout_s=120)
        parsed = extract_json_object(out.text)
        resp = ArbiterResponse.model_validate(parsed)
    except (LlmBudgetExceeded, LlmError, ValueError, Exception) as exc:  # fail-open
        logger.info("coach_mix LLM degraded: %s", exc)
        return result, None, True
    updated = apply_decisions(result, resp)
    notes = json.dumps([d.model_dump() for d in resp.decisions])
    return updated, notes, False


def _as_uuid(user_id: str):
    import uuid
    try:
        return uuid.UUID(user_id)
    except (ValueError, TypeError, AttributeError):
        return None
```

- [ ] **Step 4: Run to verify pass**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_llm_arbiter.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Tighten the except clause** — `ruff` will flag `except (… , Exception)` as redundant. Replace with `except Exception as exc:` (the broad catch is intentional fail-open; add `# noqa: BLE001`). Re-run the test (still PASS).

- [ ] **Step 6: Commit**

```bash
git add components/worker/app/coach_mix/llm_arbiter.py components/worker/tests/coach_mix/test_llm_arbiter.py
git commit -m "feat(coach-mix): holistic LLM arbiter — consult, apply, re-guard, degrade"
```

---

## Phase 3 — Worker: orchestrator + actor wiring

### Task 7: `synthesize()` orchestrator

**Files:**
- Create: `components/worker/app/coach_mix/synthesize.py`
- Test: `components/worker/tests/coach_mix/test_synthesize.py`

**Interfaces:**
- Consumes: `app.solve_lib.router.merge`, `app.solve_lib.preset_compiler.compile_preset`, `arbiter.run`, `llm_arbiter.consult`.
- Produces: `synthesize(problems: list[Verdict], analysis: dict, *, genre: str|None, user_id: str, correlation_id: str) -> dict` returning `{"chain", "leftover_advice", "change_log", "arbiter_notes", "degraded"}`.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/coach_mix/test_synthesize.py
from app.coach_mix import synthesize as S
from app.verdict_lib.rule_engine import evaluate_problems
from app.verdict_lib.flatten_analysis import flatten


def _clipping_final():
    return {"phase1": {"clipping_detected": True, "clipped_sample_count": 1234,
                       "true_peak_db": -0.2, "lufs": -7.0}, "phase2": {"genre": "techno"}}


def test_synthesize_problem_mix_emits_chain_with_limiter(monkeypatch):
    # No LLM in this path (judgment calls may exist -> stub consult to passthrough).
    monkeypatch.setattr(S.llm_arbiter, "consult",
                        lambda res, a, g, **k: (res, None, False))
    flat = flatten(_clipping_final()); flat["track_id"] = "t"
    out = S.synthesize(evaluate_problems(flat), flat, genre="techno",
                       user_id="u", correlation_id="c")
    assert "limiter" in out["chain"]["modules"]
    assert isinstance(out["change_log"], list)
    assert out["degraded"] is False


def test_synthesize_clean_mix_minimal_chain(monkeypatch):
    monkeypatch.setattr(S.llm_arbiter, "consult", lambda res, a, g, **k: (res, None, False))
    flat = {"phase1": {"lufs": -14.0}, "phase2": {"genre": "techno"}, "track_id": "t"}
    out = S.synthesize([], flat, genre="techno", user_id="u", correlation_id="c")
    # release-ready always finishes a ceiling; nothing else on a clean, on-target mix
    assert set(out["chain"]["modules"]).issubset({"limiter"})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_synthesize.py -v`
Expected: FAIL (module missing)

- [ ] **Step 3: Write `synthesize.py`**

```python
# components/worker/app/coach_mix/synthesize.py
"""Coach Mix orchestrator: problems -> solvers -> arbiter -> (LLM) -> compile."""
from __future__ import annotations

from typing import Any

from aimusic_shared.verdicts.models import Verdict

from app.coach_mix import arbiter, llm_arbiter
from app.solve_lib.preset_compiler import compile_preset
from app.solve_lib.router import merge


def synthesize(problems: list[Verdict], analysis: dict[str, Any], *, genre: str | None,
               user_id: str, correlation_id: str) -> dict[str, Any]:
    candidates = [v for v in merge(problems, analysis, genre) if v.fix]
    result = arbiter.run(candidates, analysis, genre)
    result, notes, degraded = llm_arbiter.consult(
        result, analysis, genre, user_id=user_id, correlation_id=correlation_id)
    compiled = compile_preset(result.verdicts)
    return {
        "chain": compiled["chain"],
        "leftover_advice": compiled["leftover_advice"],
        "change_log": [*result.change_log, *compiled["change_log"]],
        "arbiter_notes": notes,
        "degraded": degraded,
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd components/worker && python -m pytest tests/coach_mix/test_synthesize.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/coach_mix/synthesize.py components/worker/tests/coach_mix/test_synthesize.py
git commit -m "feat(coach-mix): synthesize orchestrator"
```

---

### Task 8: Wire `generate_fix_rack` actor to synthesize + persist coach_meta

**Files:**
- Modify: `components/worker/app/fix_rack_actor.py`
- Modify: `components/shared/aimusic_shared/models.py` (add `coach_meta` to `RackPreset`)
- Test: `components/worker/tests/test_fix_rack_actor.py` (extend)

**Interfaces:**
- Consumes: `coach_mix.synthesize`.
- Produces: `generate_fix_rack(analysis_id: str, user_id: str, tier: str)` — now 3 string args. Persists `RackPreset(source='analysis', chain_json=chain, coach_meta={change_log, arbiter_notes, degraded, leftover_advice})`.

- [ ] **Step 1: Add `coach_meta` to the shared model.** Open `components/shared/aimusic_shared/models.py`, find the `RackPreset` class, add after `chain_json`:

```python
    coach_meta: Mapped[dict | None] = mapped_column("coach_meta", JSONB, nullable=True)
```

(Match the existing import style — `JSONB` is already imported for `chain_json`; `dict | None` mirrors other nullable JSONB columns in the file.)

- [ ] **Step 2: Update the existing tests for the new 3-arg signature + stub `synthesize`.** The new signature breaks all 4 existing calls and the new `synthesize` would reach a real LLM, so the actor tests must stub it (they test persistence wiring, not synthesis). In `tests/test_fix_rack_actor.py`:

  - Add a stub fixture near `harness`:

```python
@pytest.fixture
def stub_synth(monkeypatch):
    """Actor tests cover persistence wiring, not synthesis — stub it so no LLM
    is reached and the chain is deterministic."""
    out = {
        "chain": {"order": ["limiter"], "modules": {"limiter": {"enabled": True}},
                  "masterBypass": False},
        "leftover_advice": [], "change_log": [{"module": "limiter", "change": "added ceiling"}],
        "arbiter_notes": None, "degraded": False,
    }
    monkeypatch.setattr(fra, "synthesize", lambda problems, analysis, **k: out)
    return out
```

  - `test_generate_fix_rack_writes_analysis_preset(harness, stub_synth)`: call `fra.generate_fix_rack(str(aid), str(uuid.uuid4()), "free")`; change the name assertion to `assert p.name.startswith("Coach Mix")`; keep `p.chain_json["modules"]["limiter"]["enabled"] is True`.
  - `test_generate_fix_rack_replaces_prior_analysis_preset(harness, stub_synth)`: add the two extra args to the call.
  - `test_generate_fix_rack_skips_when_no_version(harness)`: add the two extra args (no stub needed — it returns before compute).
  - `test_generate_fix_rack_survives_compute_error(harness, monkeypatch)`: add the two extra args. It monkeypatches `fra.evaluate_problems` to raise — still valid, since the actor evaluates `evaluate_problems(flattened)` before calling `synthesize`, so the boom is caught and no preset is written (no LLM reached).

- [ ] **Step 3: Write the new coach_meta persistence test** (append to the same file):

```python
def test_generate_fix_rack_persists_coach_meta(harness, stub_synth):
    aid, vid = uuid.uuid4(), uuid.uuid4()
    harness["registry"][Analysis] = _analysis(
        aid, vid, {"phase1": {"true_peak_db": 0.5}, "phase2": {"genre": "techno"}})

    fra.generate_fix_rack(str(aid), str(uuid.uuid4()), "free")

    p = next(o for o in harness["added"] if isinstance(o, RackPreset))
    assert p.coach_meta["change_log"][0]["change"] == "added ceiling"
    assert p.coach_meta["degraded"] is False
    assert p.coach_meta["arbiter_notes"] is None
```

- [ ] **Step 4: Run to verify failure**

Run: `cd components/worker && python -m pytest tests/test_fix_rack_actor.py -v`
Expected: FAIL (1-arg calls / `synthesize` attr missing / `coach_meta` attr missing)

- [ ] **Step 5: Modify `fix_rack_actor.py`** — change the import, signature, compute, and persist:

```python
# replace `from .solve_lib import solve` with:
from .coach_mix.synthesize import synthesize
# ... in the decorator keep queue/max_retries; change the signature:
def generate_fix_rack(analysis_id: str, user_id: str, tier: str) -> None:
    aid = uuid.UUID(analysis_id)
    # Phase 1 — load (unchanged: final_json, version_id, song_name) ...
    # Phase 2 — compute:
    try:
        flattened = flatten(final_json if isinstance(final_json, dict) else {})
        flattened.setdefault("track_id", str(aid))
        genre = (flattened.get("phase2") or {}).get("genre")
        result = synthesize(evaluate_problems(flattened), flattened,
                            genre=genre, user_id=user_id, correlation_id=str(aid))
        chain = result["chain"]
    except Exception:
        logger.exception("fix rack: compute failed for analysis %s; skipping", aid)
        return
    # Phase 3 — persist (add coach_meta alongside chain_json):
    with SessionFactory.begin() as s:
        prior = s.execute(select(RackPreset).where(
            RackPreset.song_version_id == version_id, RackPreset.source == "analysis"
        )).scalars().all()
        for row in prior:
            s.delete(row)
        s.add(RackPreset(
            song_version_id=version_id, name=f"Coach Mix — {song_name}"[:120],
            source="analysis", chain_json=chain,
            coach_meta={"change_log": result["change_log"], "arbiter_notes": result["arbiter_notes"],
                        "degraded": result["degraded"], "leftover_advice": result["leftover_advice"]}))
```

Keep the existing `flatten` / `evaluate_problems` imports (already present). Remove the now-unused `from .solve_lib import solve` import.

- [ ] **Step 6: Run to verify pass + full worker coach_mix + actor tests**

Run: `cd components/worker && python -m pytest tests/coach_mix/ tests/test_fix_rack_actor.py -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add components/worker/app/fix_rack_actor.py components/shared/aimusic_shared/models.py components/worker/tests/test_fix_rack_actor.py
git commit -m "feat(coach-mix): wire generate_fix_rack to synthesize + persist coach_meta"
```

---

## Phase 4 — BFF: pass identity + surface coach_meta

### Task 9: EF column + DTO + endpoint changes

**Files:**
- Modify: `components/bff/src/Spectr.Data/Entities/RackPreset.cs` (add `CoachMeta`)
- Create: EF migration via `dotnet ef migrations add AddRackPresetCoachMeta`
- Modify: `components/bff/src/Spectr.Bff/DTOs/RackPresetDtos.cs` (`FixRackDto`)
- Modify: `components/bff/src/Spectr.Bff/Endpoints/FixRackEndpoints.cs` (POST args + GET projection)
- Test: `components/bff/tests/Spectr.Bff.Tests/` (add a fix-rack endpoint test if a harness exists; otherwise rely on `dotnet build` + the worker contract test)

**Interfaces:**
- Produces: `FixRackDto(string Name, JsonElement Chain, JsonElement? CoachMeta, DateTimeOffset CreatedAt)`. POST enqueues `GenerateFixRack` with `[analysis.Id, userId, tier]`.

- [ ] **Step 1: Add the entity column.** In `RackPreset.cs`, mirror the `ChainJson` mapping:

```csharp
    [Column("coach_meta", TypeName = "jsonb")]
    public string? CoachMeta { get; set; }
```

- [ ] **Step 2: Add the migration**

Run: `cd components/bff && dotnet ef migrations add AddRackPresetCoachMeta --project src/Spectr.Data --startup-project src/Spectr.Bff`
Expected: a new migration adding the nullable `coach_meta jsonb` column. Inspect it to confirm it only adds that column.

- [ ] **Step 3: Extend `FixRackDto`**

```csharp
public sealed record FixRackDto(string Name, JsonElement Chain, JsonElement? CoachMeta, DateTimeOffset CreatedAt);
```

- [ ] **Step 4: Update the endpoint.** In `FixRackEndpoints.cs`:
- POST `Generate`: resolve tier and pass three args. Add a tier lookup (use the existing entitlement/user service pattern — open `EntitlementService` for the call; if a tier string is readily available on the user or via a service, use it, else default `"free"`). Change the enqueue to:

```csharp
        var tier = await entitlements.GetTierAsync(userId, ct); // or the project's existing accessor
        await queue.EnqueueAsync(
            DramatiqTasks.GenerateFixRack,
            new object[] { analysis.Id.ToString(), userId.ToString(), tier },
            DramatiqQueues.AnalysisPaid, ct);
```

- GET `GetFixRack`: add `p.CoachMeta` to the projection and parse it like `ChainJson` (nullable):

```csharp
            .Select(p => new { p.Name, p.ChainJson, p.CoachMeta, p.CreatedAt })
            ...
        JsonElement? coachMeta = null;
        if (!string.IsNullOrEmpty(preset.CoachMeta))
        {
            try { using var cm = JsonDocument.Parse(preset.CoachMeta); coachMeta = cm.RootElement.Clone(); }
            catch (JsonException) { coachMeta = null; }
        }
        return Results.Ok(new FixRackDto(preset.Name, chain, coachMeta, preset.CreatedAt));
```

- [ ] **Step 5: Build + test**

Run: `cd components/bff && dotnet build && dotnet test`
Expected: build succeeds; tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/bff/
git commit -m "feat(coach-mix): persist+expose coach_meta; pass user_id+tier to actor"
```

---

## Phase 5 — Frontend: surface the rationale + degraded badge

### Task 10: FixRackPanel rationale + degraded badge + types

**Files:**
- Modify: `components/frontend-spectr-v2/src/api/types.ts` (FixRack type gains `coachMeta`)
- Modify: `components/frontend-spectr-v2/src/features/results/FixRackPanel.tsx`
- Test: `components/frontend-spectr-v2/src/features/results/FixRackPanel.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `FixRackDto` now includes `coachMeta?: { change_log?: {module:string;change:string;why?:string}[]; arbiter_notes?: string|null; degraded?: boolean; leftover_advice?: unknown[] } | null`.

- [ ] **Step 1: Extend the type.** In `types.ts`, find the fix-rack response type (the one `useFixRack` returns) and add:

```typescript
export interface FixRackCoachMeta {
  change_log?: { module: string; change: string; why?: string }[];
  arbiter_notes?: string | null;
  degraded?: boolean;
  leftover_advice?: unknown[];
}
// add `coachMeta?: FixRackCoachMeta | null;` to the FixRack response interface
```

- [ ] **Step 2: Write the failing test**

```tsx
// components/frontend-spectr-v2/src/features/results/FixRackPanel.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock the data hooks so the panel renders the "ready" branch with coachMeta.
vi.mock('../../api/hooks', () => ({
  useGenerateFixRack: () => ({ mutate: vi.fn(), isPending: false }),
  useFixRack: () => ({ data: {
    name: 'Coach Mix — Track',
    chain: { order: ['limiter'], modules: { limiter: { enabled: true, ceilingDb: -1 } }, masterBypass: false },
    coachMeta: { change_log: [{ module: 'limiter', change: 'added ceiling', why: 'release-ready' }],
                 degraded: true, arbiter_notes: null },
  } }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

import { FixRackPanel } from './FixRackPanel';

describe('FixRackPanel coach meta', () => {
  it('renders the change-log rationale and a degraded badge', () => {
    render(<FixRackPanel jobId="j" versionId="v" committedCount={1} requested />);
    expect(screen.getByText(/added ceiling/i)).toBeInTheDocument();
    expect(screen.getByText(/rule-based master/i)).toBeInTheDocument();  // degraded copy
  });
});
```

- [ ] **Step 2b: Run to verify failure**

Run: `cd components/frontend-spectr-v2 && npx vitest run src/features/results/FixRackPanel.test.tsx`
Expected: FAIL (panel still renders the "soon" placeholder, no change-log text)

- [ ] **Step 3: Replace the placeholder coach block** in `FixRackPanel.tsx` (lines 125-134) with real rationale rendering driven by `rack.coachMeta`:

```tsx
        {(() => {
          const meta = (rack as { coachMeta?: import('../../api/types').FixRackCoachMeta | null }).coachMeta;
          return (
            <div className={s.coach}>
              <span className={s.coachIc}>✦</span>
              <div>
                <div className={s.coachTitle}>
                  What Coach did
                  {meta?.degraded && <span className={s.soon}>used the rule-based master</span>}
                </div>
                {meta?.change_log?.length ? (
                  <ul className={s.sub}>
                    {meta.change_log.map((c, i) => (
                      <li key={i}><b>{c.module}</b>: {c.change}{c.why ? ` — ${c.why}` : ''}</li>
                    ))}
                  </ul>
                ) : (
                  <div className={s.sub}>No master-rack changes were needed.</div>
                )}
              </div>
            </div>
          );
        })()}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd components/frontend-spectr-v2 && npx vitest run src/features/results/FixRackPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Run all four frontend gates**

Run: `cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build && npx vitest run`
Expected: all PASS / clean

- [ ] **Step 6: Commit**

```bash
git add components/frontend-spectr-v2/src/api/types.ts components/frontend-spectr-v2/src/features/results/FixRackPanel.tsx components/frontend-spectr-v2/src/features/results/FixRackPanel.test.tsx
git commit -m "feat(coach-mix): surface change-log rationale + degraded badge in FixRackPanel"
```

---

## Phase 6 — Config + end-to-end guard

### Task 11: Free-tier LLM budget flag + golden snapshot

**Files:**
- Create: an idempotent seed migration for `llm_budget_free_usd` (EF data migration OR a `feature_flags` upsert — follow the project's flag-seeding pattern in existing migrations)
- Test: `components/worker/tests/coach_mix/test_synthesize_golden.py`

**Interfaces:** none new.

- [ ] **Step 1: Seed/raise the free-tier budget flag.** Find how flags are seeded (search migrations for `feature_flags` `INSERT … ON CONFLICT DO NOTHING`). Add/raise `llm_budget_free_usd` to a non-zero value (e.g. `0.50`) so free-tier Coach Mix actually calls the LLM rather than degrading. If a flag row already exists at 0, the migration must UPDATE it (document the chosen value in the migration comment).

- [ ] **Step 2: Write the golden snapshot test** (deterministic path — stub the LLM to passthrough so output is byte-stable):

```python
# components/worker/tests/coach_mix/test_synthesize_golden.py
from app.coach_mix import synthesize as S
from app.verdict_lib.rule_engine import evaluate_problems
from app.verdict_lib.flatten_analysis import flatten


def test_golden_deterministic_chain_is_stable(monkeypatch):
    monkeypatch.setattr(S.llm_arbiter, "consult", lambda res, a, g, **k: (res, None, False))
    final = {"phase1": {"clipping_detected": True, "clipped_sample_count": 999,
                        "true_peak_db": -0.1, "lufs": -6.0, "bands": {"low_mid": -4.0, "mid": -10.0}},
             "phase2": {"genre": "techno"}}
    flat = flatten(final); flat["track_id"] = "t"
    out = S.synthesize(evaluate_problems(flat), flat, genre="techno", user_id="u", correlation_id="c")
    enabled = sorted(m for m, st in out["chain"]["modules"].items() if st.get("enabled"))
    assert enabled == ["eq", "limiter", "trim"]   # update to the actual stable set on first green run
```

- [ ] **Step 3: Run, then pin the golden.** Run the test; on first run, replace the expected `enabled` list with the actual sorted module set the engine produces (this is the snapshot baseline). Re-run → PASS. Document that changing this set requires a deliberate golden update.

Run: `cd components/worker && python -m pytest tests/coach_mix/test_synthesize_golden.py -v`

- [ ] **Step 4: Commit**

```bash
git add components/worker/tests/coach_mix/test_synthesize_golden.py <migration files>
git commit -m "feat(coach-mix): free-tier LLM budget seed + golden chain snapshot"
```

---

## Phase 7 — Full validation

### Task 12: Run every gate end-to-end

- [ ] **Step 1: Worker**

Run: `cd components/worker && python -m pytest tests/coach_mix/ tests/test_fix_rack_actor.py -q && cd /c/Users/badmin/projects/AIMusicAnalysisSite && python -m ruff check components/worker/app/coach_mix/ components/worker/app/fix_rack_actor.py && cd components/worker && python -m mypy app/coach_mix/ --ignore-missing-imports`
Expected: PASS / clean. (Note: the full `pytest tests/` has pre-existing `db_sync` ordering-pollution failures unrelated to this work — scope to the coach_mix + fix_rack tests.)

- [ ] **Step 2: Shared model**

Run: `cd /c/Users/badmin/projects/AIMusicAnalysisSite && pip install -e components/shared && python -m pytest components/shared/tests/ -q`
Expected: PASS.

- [ ] **Step 3: BFF**

Run: `cd components/bff && dotnet build && dotnet test`
Expected: build + tests PASS.

- [ ] **Step 4: Frontend**

Run: `cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build && npx vitest run`
Expected: all four gates PASS.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore(coach-mix): final validation pass"
```

---

## Self-review notes (gaps to watch during execution)

- **`gateway.complete_sync` exact kwargs:** mirror `verdict_actor.py:220-230` verbatim (`system`, `user`, `purpose`, `prompt_slug`, `prompt_version`, `model`, `user_id`, `correlation_id`, `timeout_s`). If a kwarg name differs in the installed gateway, fix at Task 6.
- **`compile_preset` reuse:** the Arbiter pre-merges, so `compile_preset`'s own dedup is inert (one op per module). No change to `preset_compiler.py` is required — confirm by reading it before Task 7 if behavior looks off.
- **Tier accessor in the BFF (Task 9 Step 4):** the exact entitlement/tier call may differ — open `EntitlementService` and use its real method; default to `"free"` if unavailable. The worker accepts any tier string.
- **`RackPreset` source stays `"analysis"`** — the BFF GET filter is unchanged; only the projection grows. Do not rename to `coach_mix`.
- **Flag seeding pattern (Task 11):** match the existing `feature_flags` upsert migration style; do not hardcode the value in code.
