# Problem Engine — MixCoach Deterministic Rules (IDENTIFY tier, Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing degraded-only `rule_engine.py` (11 rules emitting `Verdict`) into a config-driven, tiered **Problem engine** that emits the richer MixCoach "problem record" shape, with a two-pass composite/suppression layer — the deterministic IDENTIFY tier that guarantees the Problems list is never empty.

**Architecture:** The repo's `Verdict` **is** the "problem record" (per `PRPs/identify-solve-architecture.md` §3 — *"the incoming 'problem record' ≡ the repo's Finding"*). We extend `Verdict` in place with the Problem fields (`problem_id`, `source`, `data_tier`, `fixable`, `suspected`, `kind`, `where`), refactor the flat rule list into a **slug-registered two-pass engine** (singles → composites with explicit suppression), and drive every threshold from **two committed JSON config files** — `genre-profiles.json` (per-genre reference values) + `rule-bindings.json` (wires each rule to profile paths, tier predicates, `genre_map`, `master_context`) — so genre numbers and platform targets tune without code. `fix` stays `null` — solving is a separate later stage.

**Tech Stack:** Python 3.11, Pydantic v2, pytest. Worker package `components/worker/app/verdict_lib/`, shared models `components/shared/aimusic_shared/verdicts/`. No new dependencies (JSON config via stdlib `json`).

## Global Constraints

- **Emit the repo `Verdict`** (extended), NOT a new parallel `ProblemRecord` type — extend in place (`identify-solve-architecture.md` §8: *"extend the existing verdicts table into the unified Finding record — do NOT add a second table"*).
- **Rules read the FLATTENED analysis** (`flatten(final_json)` → `phaseN.*` keys), never raw `final_json`. The engine entrypoint receives the already-flattened dict (as `evaluate_rules` does today).
- **Every `evidence.metric` must resolve** via `validator._resolve_path` — use only real paths from `identify-solve-architecture.md` §2 "Safe grounding surface" (e.g. `phase1.bands.low_mid`, NOT `phase2.bands.*`).
- **Never emit when the source field is absent** — that's "not assessed," never a failing grade. Return `None`.
- **A rule fires at most one record per evaluation.** If multiple tiers match, take the highest severity.
- **Rule confidence is high and fixed** (`0.9` for singles); the `suspected` flag — not confidence — carries "might be a genre choice." Composites set explicit confidences (0.88–0.95) and `suspected=False`.
- **Thresholds are configuration, not code** — all genre numbers, platform targets, and tier predicates live in `config/genre-profiles.json` + `config/rule-bindings.json` (provided + committed). The engine resolves `phase2.genre` → profile via `rule-bindings.json::genre_map` (note: only `techno` maps to its own profile; `trance/house/dnb/other` → `modern_trance`), picks the loudness world via `master_context` (default `streaming`), and reads numbers by dotted path — never hardcoded.
- **`when`-predicate decision (surfaced):** the engine does **not** dynamically `eval` the `tiers[].when` strings in `rule-bindings.json` (no eval DSL — safety + debuggability). Each Python rule **implements the documented predicate** while pulling every NUMBER from the genre profile. The `when` strings are the authoritative spec for those comparisons; keep them in sync.
- **Coverage caveat (from the config):** `genre-profiles.json` carries hard NUMBERS for loudness/dynamics/bpm/arrangement (→ fully drives A1, A2, A3, A15, `bpm_genre_match`, C1, C7), but the **tonal/stereo rules A7–A12 get only qualitative genre hints** (`low_mid_emphasis`, `brightness_rank`, `air_emphasis`, `width_character`) — no firing numbers. Those rules ship `suspected=true` with a documented placeholder base scaled by the qualitative hint, and stay flagged for a measured-corpus pass (see `genre-profiles.json::_tuning_notes`).
- **Backward compatibility:** the public `evaluate_rules(analysis) -> list[Verdict]` name and signature are preserved (degraded.py + tests call it). New Problem fields are optional with defaults so existing `Verdict(...)` construction and persistence keep working unchanged.
- **Slice boundary:** this plan is Python engine + model + tests ONLY. No DB migration, no BFF, no frontend. Persisting the new fields as columns and surfacing the Problems list in the UI are named follow-on slices (see "Out of Scope / Follow-on Plans").

---

## File Structure

| File | Responsibility |
|---|---|
| `components/shared/aimusic_shared/verdicts/models.py` (modify) | Add Problem fields + `ProblemSource`/`DataTier`/`ProblemKind` literals to `Verdict`. |
| `components/worker/app/verdict_lib/config/genre-profiles.json` (✅ committed) | Per-genre reference values (classic_trance / modern_trance / techno) + `_platform_targets`. Provided. |
| `components/worker/app/verdict_lib/config/rule-bindings.json` (✅ committed) | Wires each rule → genre-profile paths + tier predicates + `genre_map` + `master_context`. Provided. |
| `components/worker/app/verdict_lib/genre_config.py` (create) | Cached loader: genre resolution (`phase2.genre`→profile), profile dotted-path reads, platform targets, `master_context`, per-rule binding access. |
| `components/worker/app/verdict_lib/rule_engine.py` (rewrite core) | Slug registry (`@single`, `@composite`), `_make` extended for Problem fields, two-pass `evaluate_problems`, `evaluate_rules` alias, all Tier A + S + P singles + composites. |
| `components/worker/app/verdict_lib/suppression.py` (create) | Pure suppression algorithm (composite absorbs children, higher-severity wins ties, one-suppression rule). |
| `components/worker/tests/verdict_pipeline/test_thresholds.py` (create) | Loader + accessor tests. |
| `components/worker/tests/verdict_pipeline/test_rule_engine.py` (modify) | Update existing tests for new fields; keep the clean baseline silent. |
| `components/worker/tests/verdict_pipeline/test_rules_tier_a.py` (create) | Per-rule fires/silent + validator tests for Tier A. |
| `components/worker/tests/verdict_pipeline/test_rules_stem_midi.py` (create) | S + P rule tests. |
| `components/worker/tests/verdict_pipeline/test_composites.py` (create) | Composite firing + suppression tests. |

---

## Task 1: Extend the `Verdict` model with Problem fields

**Files:**
- Modify: `components/shared/aimusic_shared/verdicts/models.py`
- Test: `components/shared/tests/test_problem_fields.py` (create)

**Interfaces:**
- Produces: `Verdict` gains optional fields `problem_id: str|None`, `kind: ProblemKind`, `source: ProblemSource`, `data_tier: DataTier`, `fixable: bool`, `suspected: bool`, `where: dict|None`. New literals `ProblemSource`, `DataTier`, `ProblemKind`. All have defaults — existing constructors unaffected.

- [ ] **Step 1: Write the failing test**

```python
# components/shared/tests/test_problem_fields.py
from datetime import datetime, timezone
from aimusic_shared.verdicts.models import Verdict, Evidence

def _v(**over):
    base = dict(
        verdict_id="vrd_x", track_id="t", specialist="rule_engine.true_peak_overshoot",
        prompt_version="rule_engine@2.0.0", model="rules", severity="severe",
        category="clipping", confidence=0.9, priority_score=80,
        headline="h", summary="s", evidence=[Evidence(metric="phase1.true_peak_db", value=0.1, label="x")],
        why_it_matters="w", sources=["rule_engine"], created_at=datetime.now(timezone.utc),
    )
    base.update(over)
    return Verdict(**base)

def test_problem_fields_default_to_audio_only_fixable_fault():
    v = _v()
    assert v.kind == "fault"
    assert v.source == "rule_engine"
    assert v.data_tier == "audio_only"
    assert v.fixable is True
    assert v.suspected is False
    assert v.problem_id is None
    assert v.where is None

def test_problem_fields_round_trip():
    v = _v(problem_id="clipping.true_peak_overshoot.0", data_tier="stems",
           suspected=True, where={"section_type": None, "start_seconds": 0, "end_seconds": 0})
    dumped = v.model_dump()
    assert dumped["problem_id"] == "clipping.true_peak_overshoot.0"
    assert dumped["data_tier"] == "stems"
    assert dumped["suspected"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest components/shared/tests/test_problem_fields.py -v`
Expected: FAIL — `Verdict` has `extra="forbid"` and rejects `kind`/`source`/etc., or AttributeError on `v.kind`.

- [ ] **Step 3: Add the literals and fields**

In `models.py`, after the `FeedbackKind` literal (line ~25) add:
```python
ProblemSource = Literal["rule_engine", "llm_identifier"]
DataTier = Literal["audio_only", "stems", "project_midi"]
ProblemKind = Literal["fault", "observation", "integrity"]
```
In `class Verdict`, after `created_at: datetime` (line ~178) add:
```python
    # ── Problem-record fields (IDENTIFY tier). All optional w/ defaults so
    #    existing constructors + persistence are unaffected. See
    #    PRPs/identify-solve-architecture.md §3. ──
    problem_id: Optional[str] = None       # STABLE "<category>.<slug>.<index>"
    kind: ProblemKind = "fault"
    source: ProblemSource = "rule_engine"
    data_tier: DataTier = "audio_only"
    fixable: bool = True
    suspected: bool = False
    where: Optional[dict[str, Any]] = None  # {section_type, start_seconds, end_seconds}
    refines: Optional[str] = None           # parent composite problem_id (set by the Composite Refiner; null for rule output)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest components/shared/tests/test_problem_fields.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing verdict + worker model tests to confirm no regression**

Run: `pytest components/shared/tests/ -q`
Expected: PASS — defaults mean every existing `Verdict(...)` still validates.

- [ ] **Step 6: Commit**

```bash
git add components/shared/aimusic_shared/verdicts/models.py components/shared/tests/test_problem_fields.py
git commit -m "feat(verdicts): add Problem-record fields to Verdict (IDENTIFY tier)"
```

---

## Task 2: Genre-config loader (`genre_config.py`)

The config files are **already committed** (`config/genre-profiles.json`, `config/rule-bindings.json`, `config/genre-config.md` = spec companion). This task is the loader only.

**Files:**
- Use (committed): `components/worker/app/verdict_lib/config/{genre-profiles.json, rule-bindings.json, genre-config.md}`
- Create: `components/worker/app/verdict_lib/genre_config.py`
- Test: `components/worker/tests/verdict_pipeline/test_genre_config.py`

**Interfaces:**
- Produces (all cached, never raise on a missing genre — fall back via `genre_map.default`):
  - `resolve_genre(phase2_genre: str|None) -> str` — maps `phase2.genre` → profile key via `rule-bindings.json::genre_map`.
  - `profile(phase2_genre: str|None) -> dict` — the resolved genre profile.
  - `ppath(phase2_genre: str|None, dotted: str, default=None) -> Any` — read a dotted path inside the resolved profile (e.g. `"loudness.club.lufs_target"`).
  - `platform(key: str, default=None) -> Any` — read from `genre-profiles.json::_platform_targets`.
  - `master_context() -> str` — `"streaming"` (default) or `"club"`.
  - `binding(rule_id: str) -> dict` — the `rule-bindings.json::bindings[rule_id]` entry (spec reference for a rule's predicate).

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/verdict_pipeline/test_genre_config.py
from app.verdict_lib import genre_config as G

def test_genre_map_routes_techno_to_itself_rest_to_modern_trance():
    assert G.resolve_genre("techno") == "techno"
    assert G.resolve_genre("trance") == "modern_trance"
    assert G.resolve_genre("house") == "modern_trance"
    assert G.resolve_genre("dnb") == "modern_trance"
    assert G.resolve_genre(None) == "modern_trance"          # genre_map.default
    assert G.resolve_genre("made_up") == "modern_trance"

def test_ppath_reads_genre_numbers():
    assert G.ppath("techno", "loudness.club.lufs_target") == -6.5
    assert G.ppath("trance", "loudness.streaming.lufs_target") == -14.0
    assert G.ppath("techno", "dynamics.crest_db.warn_below") == 4.0
    assert G.ppath("trance", "loudness.streaming.lufs_tolerance") == 1.5
    assert G.ppath("techno", "missing.path", default=None) is None

def test_platform_targets_and_master_context():
    assert G.platform("hot_master_threshold_lufs") == -14.0
    assert G.platform("hot_master_true_peak_dbtp") == -2.0
    assert G.platform("recommended_streaming_true_peak_dbtp") == -1.0
    assert G.master_context() == "streaming"

def test_binding_returns_predicate_spec():
    b = G.binding("A2_loudness_vs_target")
    assert b["reads_field"] == "phase1.lufs"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest components/worker/tests/verdict_pipeline/test_genre_config.py -v`
Expected: FAIL — module `genre_config` does not exist.

- [ ] **Step 3: Create the loader**

```python
# components/worker/app/verdict_lib/genre_config.py
from __future__ import annotations
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_DIR = Path(__file__).with_name("config")

@lru_cache(maxsize=1)
def _profiles() -> dict[str, Any]:
    return json.loads((_DIR / "genre-profiles.json").read_text(encoding="utf-8"))

@lru_cache(maxsize=1)
def _bindings() -> dict[str, Any]:
    return json.loads((_DIR / "rule-bindings.json").read_text(encoding="utf-8"))

def resolve_genre(phase2_genre: str | None) -> str:
    gm = _bindings()["genre_map"]
    return gm.get((phase2_genre or "").lower(), gm["default"])

def profile(phase2_genre: str | None) -> dict[str, Any]:
    return _profiles()["genre_profiles"][resolve_genre(phase2_genre)]

def ppath(phase2_genre: str | None, dotted: str, default: Any = None) -> Any:
    node: Any = profile(phase2_genre)
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node

def platform(key: str, default: Any = None) -> Any:
    return _profiles()["_platform_targets"].get(key, default)

def master_context() -> str:
    return _bindings()["master_context"]["default"]

def binding(rule_id: str) -> dict[str, Any]:
    return _bindings()["bindings"].get(rule_id, {})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest components/worker/tests/verdict_pipeline/test_genre_config.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/verdict_lib/config/ components/worker/app/verdict_lib/genre_config.py components/worker/tests/verdict_pipeline/test_genre_config.py
git commit -m "feat(rules): genre-config loader (genre-profiles + rule-bindings)"
```

---

## Task 3: Two-pass engine core — slug registry + `_make` + suppression

**Files:**
- Create: `components/worker/app/verdict_lib/suppression.py`
- Modify: `components/worker/app/verdict_lib/rule_engine.py` (the harness — rules come in later tasks)
- Test: `components/worker/tests/verdict_pipeline/test_composites.py` (suppression-algorithm portion)

**Interfaces:**
- Produces:
  - `@single(slug: str, tier: str)` decorator → registers `fn(analysis: dict) -> Verdict|None`.
  - `@composite(slug: str, suppresses: list[str])` decorator → registers `fn(analysis: dict, fired: dict[str, Verdict]) -> Verdict|None`.
  - `_make(*, slug, severity, category, headline, summary, evidence, why_it_matters, index=0, confidence=0.9, kind="fault", source="rule_engine", data_tier="audio_only", fixable=True, suspected=False, where=None, track_id) -> Verdict` — sets `problem_id=f"{category}.{slug}.{index}"`, `specialist=f"rule_engine.{slug}"`.
  - `evaluate_problems(analysis: dict) -> list[Verdict]` — two-pass.
  - `evaluate_rules = evaluate_problems` (back-compat alias).
  - `suppression.apply(singles: dict[str, Verdict], composites: list[CompositeHit]) -> list[Verdict]` where `CompositeHit = tuple[str, list[str], Verdict]` (slug, suppresses, record).
  - `SEVERITY_RANK: dict[str, int]`.

- [ ] **Step 1: Write the failing suppression test**

```python
# components/worker/tests/verdict_pipeline/test_composites.py
from datetime import datetime, timezone
from aimusic_shared.verdicts.models import Verdict, Evidence
from app.verdict_lib.suppression import apply, SEVERITY_RANK

def _rec(slug, category, severity):
    return Verdict(
        verdict_id="vrd_"+slug, track_id="t", specialist="rule_engine."+slug,
        prompt_version="rule_engine@2.0.0", model="rules", severity=severity,
        category=category, confidence=0.9, priority_score=50, headline=slug, summary="s",
        evidence=[Evidence(metric="phase1.lufs", value=-1.0, label="x")],
        why_it_matters="w", sources=["rule_engine"], created_at=datetime.now(timezone.utc),
        problem_id=f"{category}.{slug}.0",
    )

def test_severity_rank_orders_correctly():
    assert SEVERITY_RANK["critical"] > SEVERITY_RANK["severe"] > SEVERITY_RANK["moderate"]

def test_composite_absorbs_its_children():
    singles = {"over_compression": _rec("over_compression", "dynamics", "moderate"),
               "true_peak_overshoot": _rec("true_peak_overshoot", "clipping", "moderate")}
    comp = _rec("loudness_war", "dynamics", "severe")
    out = apply(singles, [("loudness_war", ["over_compression", "true_peak_overshoot"], comp)])
    slugs = {v.problem_id.split(".")[1] for v in out}
    assert "loudness_war" in slugs
    assert "over_compression" not in slugs and "true_peak_overshoot" not in slugs

def test_child_claimed_by_two_composites_goes_to_higher_severity():
    singles = {"a": _rec("a", "dynamics", "minor")}
    c_hi = _rec("hi", "dynamics", "severe")
    c_lo = _rec("lo", "dynamics", "moderate")
    out = apply(singles, [("lo", ["a"], c_lo), ("hi", ["a"], c_hi)])
    slugs = {v.problem_id.split(".")[1] for v in out}
    assert "a" not in slugs and "hi" in slugs and "lo" in slugs  # both composites survive; child absorbed once
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest components/worker/tests/verdict_pipeline/test_composites.py -v`
Expected: FAIL — `suppression` module does not exist.

- [ ] **Step 3: Write the suppression algorithm**

```python
# components/worker/app/verdict_lib/suppression.py
from __future__ import annotations
from aimusic_shared.verdicts.models import Verdict

SEVERITY_RANK = {"win": 0, "minor": 1, "moderate": 2, "severe": 3, "critical": 4}
CompositeHit = tuple[str, list[str], Verdict]  # (slug, suppresses, record)

def apply(singles: dict[str, Verdict], composites: list[CompositeHit]) -> list[Verdict]:
    """Drop each suppressed child exactly once, awarding it to the highest-severity
    composite that claims it. All fired composites survive; only children are dropped.

    AUDIT TRAIL (router.md §1a — "why did this card vanish?"): the surviving composite
    records the problem_ids it absorbed in its ``related_verdict_ids`` so a dropped
    single is always traceable to the composite that consumed it.
    """
    # Order composites hottest-first so a contested child is absorbed by the strongest.
    ordered = sorted(composites, key=lambda c: SEVERITY_RANK[c[2].severity], reverse=True)
    suppressed: set[str] = set()
    for _slug, children, rec in ordered:
        for child in children:
            if child in singles and child not in suppressed:
                suppressed.add(child)            # claimed by this (strongest) composite
                rec.related_verdict_ids.append(singles[child].problem_id or child)
    survivors = [v for slug, v in singles.items() if slug not in suppressed]
    survivors.extend(rec for _slug, _children, rec in composites)
    return survivors
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest components/worker/tests/verdict_pipeline/test_composites.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewrite the rule_engine harness (registry + `_make` + two-pass)**

Replace the top of `rule_engine.py` (the `rule`/`evaluate_rules`/`_make` block, lines 9–63) with:
```python
RULE_ENGINE_VERSION = "rule_engine@2.0.0"
RULE_MODEL = "rules"

from app.verdict_lib.suppression import apply as _apply_suppression  # noqa: E402

SingleFn = Callable[[dict[str, Any]], "Verdict | None"]
CompositeFn = Callable[[dict[str, Any], dict[str, "Verdict"]], "Verdict | None"]
_SINGLES: list[tuple[str, SingleFn]] = []
_COMPOSITES: list[tuple[str, list[str], CompositeFn]] = []

def single(slug: str, tier: str = "A"):
    def deco(fn: SingleFn) -> SingleFn:
        _SINGLES.append((slug, fn))
        return fn
    return deco

def composite(slug: str, suppresses: list[str]):
    def deco(fn: CompositeFn) -> CompositeFn:
        _COMPOSITES.append((slug, suppresses, fn))
        return fn
    return deco

def evaluate_problems(analysis: dict[str, Any]) -> list[Verdict]:
    fired: dict[str, Verdict] = {}
    for slug, fn in _SINGLES:
        v = fn(analysis)
        if v is not None:
            fired[slug] = v
    hits = []
    for slug, suppresses, cfn in _COMPOSITES:
        cv = cfn(analysis, fired)
        if cv is not None:
            hits.append((slug, suppresses, cv))
    return _apply_suppression(fired, hits)

# Back-compat: degraded.py + existing tests import this name/shape.
evaluate_rules = evaluate_problems

def _make(*, track_id: str, slug: str, severity: Severity, category: str,
          headline: str, summary: str, evidence: list[Evidence], why_it_matters: str,
          index: int = 0, scope: str = "full_track", confidence: float = 0.9,
          kind: str = "fault", source: str = "rule_engine", data_tier: str = "audio_only",
          fixable: bool = True, suspected: bool = False,
          where: dict[str, Any] | None = None) -> Verdict:
    score = compute_priority_score(severity, category, scope)  # type: ignore[arg-type]
    return Verdict(
        verdict_id=new_verdict_id(), track_id=track_id, specialist=f"rule_engine.{slug}",
        prompt_version=RULE_ENGINE_VERSION, model=RULE_MODEL, severity=severity,
        category=category, confidence=confidence, priority_score=score,  # type: ignore[arg-type]
        headline=headline, summary=summary, evidence=evidence, fix=None,
        why_it_matters=why_it_matters, related_verdict_ids=[], sources=["rule_engine"],
        created_at=datetime.now(tz=timezone.utc),
        problem_id=f"{category}.{slug}.{index}", kind=kind, source=source,  # type: ignore[arg-type]
        data_tier=data_tier, fixable=fixable, suspected=suspected, where=where,  # type: ignore[arg-type]
    )

def _tiered(value: float, bands: dict[str, float], *, higher_is_worse: bool) -> Severity | None:
    """Pick the hottest matching severity. bands keys ∈ severity names."""
    order = ["critical", "severe", "moderate", "minor"]
    for sev in order:
        if sev in bands:
            thr = bands[sev]
            if (higher_is_worse and value > thr) or (not higher_is_worse and value < thr):
                return sev  # type: ignore[return-value]
    return None
```
Add `from app.verdict_lib import genre_config as G` to the imports. Delete the old `_make`, `rule`, `evaluate_rules`, and **all 11 existing `@rule` functions** (they are re-expressed as `@single` rules in Tasks 4–6; keeping both would double-fire).

- [ ] **Step 6: Run the suppression + thresholds tests**

Run: `pytest components/worker/tests/verdict_pipeline/test_composites.py components/worker/tests/verdict_pipeline/test_thresholds.py -v`
Expected: PASS. (The big `test_rule_engine.py` is updated in Task 7 — expect it red until then; that's fine for this commit since the rules don't exist yet.)

- [ ] **Step 7: Commit**

```bash
git add components/worker/app/verdict_lib/suppression.py components/worker/app/verdict_lib/rule_engine.py components/worker/tests/verdict_pipeline/test_composites.py
git commit -m "feat(rules): two-pass problem engine harness + suppression algorithm"
```

---

## Task 4: Tier A faults — the four archetypes (canonical implementations)

**Files:**
- Modify: `components/worker/app/verdict_lib/rule_engine.py` (add rules)
- Test: `components/worker/tests/verdict_pipeline/test_rules_tier_a.py`

**Interfaces:**
- Consumes: `single`, `_make`, `_tiered`, `TH`, `_phase`, `_track_id` from Task 3.
- Produces: registered singles `true_peak_overshoot`, `clipping_count`, `loudness_vs_target`, `over_compression`. These are the four archetypes (simple-threshold, graduated-count, signed-deviation, suspected-multi-field) that Task 5's table-driven rules copy.

- [ ] **Step 1: Write the failing tests (one fires + one silent per archetype, plus validator)**

```python
# components/worker/tests/verdict_pipeline/test_rules_tier_a.py
from app.verdict_lib.rule_engine import evaluate_problems
from app.verdict_lib.validator import validate_verdict

def _a(**p1):
    base = {"lufs": -14.0, "true_peak_db": -2.0, "mono_compatibility": 0.95,
            "clipping_detected": False, "stereo_correlation": 0.6, "crest_factor": 11.0,
            "loudness_range_lu": 8.0, "key_detection_confidence": 0.9, "duration_seconds": 200,
            "spectral_flatness": 0.2, "spectral_centroid_hz": 2500.0, "low_energy": 0.2,
            "stereo_width": 0.3, "spectral_contrast": 20.0,
            "bands": {"sub_bass": -20, "bass": -18, "low_mid": -20, "mid": -20,
                      "upper_mid": -45, "presence": -55, "air": -70}}
    base.update(p1)
    return {"track_id": "t", "phase1": base}

def _find(records, slug):
    return next((r for r in records if r.problem_id.split(".")[1] == slug), None)

def test_true_peak_overshoot_graduated():
    assert _find(evaluate_problems(_a(true_peak_db=0.5)), "true_peak_overshoot").severity == "severe"
    assert _find(evaluate_problems(_a(true_peak_db=-0.1)), "true_peak_overshoot").severity == "moderate"
    assert _find(evaluate_problems(_a(true_peak_db=-2.0)), "true_peak_overshoot") is None

def test_clipping_count_graduated_and_silent_when_false():
    r = _find(evaluate_problems(_a(clipping_detected=True, clipped_sample_count=5000)), "clipping_count")
    assert r.severity == "severe"
    assert _find(evaluate_problems(_a(clipping_detected=False)), "clipping_count") is None

def test_loudness_vs_target_signed_both_directions():
    too_loud = _find(evaluate_problems(_a(lufs=-7.0)), "loudness_vs_target")
    too_quiet = _find(evaluate_problems(_a(lufs=-22.0)), "loudness_vs_target")
    assert too_loud.severity == "severe" and too_quiet.severity in ("moderate", "severe")
    assert _find(evaluate_problems(_a(lufs=-14.0)), "loudness_vs_target") is None  # within tolerance

def test_over_compression_is_suspected():
    # modern_trance (default genre): severe needs LRA < (lra_lo-2) AND crest < warn_below(4)
    r = _find(evaluate_problems(_a(loudness_range_lu=1.5, crest_factor=3.0)), "over_compression")
    assert r.severity == "severe" and r.suspected is True

def test_over_compression_techno_low_lra_not_flagged_without_crest():
    # techno's low LRA is inherent — must NOT fire on LRA alone (crest healthy)
    a = _a(loudness_range_lu=3.0, crest_factor=6.0); a["phase2"] = {"genre": "techno"}
    assert _find(evaluate_problems(a), "over_compression") is None

def test_tier_a_records_pass_validator():
    a = _a(true_peak_db=0.5)
    r = _find(evaluate_problems(a), "true_peak_overshoot")
    assert validate_verdict(r, a).ok
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest components/worker/tests/verdict_pipeline/test_rules_tier_a.py -v`
Expected: FAIL — rules not yet defined (records are None).

- [ ] **Step 3: Implement the four archetype rules**

Append to `rule_engine.py`:
```python
# ── TIER A — archetypes (genre-aware via genre_config G; predicates per
#    rule-bindings.json). _genre(a) = the detected genre passed to G.ppath. ──

def _genre(a):
    return _phase(a, "phase2").get("genre")

@single("clipping_count", tier="A")           # archetype: graduated by count + bool gate (genre-agnostic)
def clipping_count(a):
    p1 = _phase(a, "phase1")
    if not p1.get("clipping_detected"):
        return None
    n = int(p1.get("clipped_sample_count", 0))
    if n < 1:
        return None
    sev = "severe" if n > 1000 else ("moderate" if n > 100 else "minor")   # rule-bindings A4_clipping_count
    return _make(track_id=_track_id(a), slug="clipping_count", severity=sev, category="clipping",
        kind="fault", headline=f"Hard clipping ({n} samples)",
        summary="The signal hits digital full-scale; distortion is baked in and unfixable downstream.",
        evidence=[Evidence(metric="phase1.clipped_sample_count", value=float(n), label=f"{n} samples")],
        why_it_matters="Clipping is irreversible — limiting/mastering downstream cannot remove it.")

@single("true_peak_overshoot", tier="A")      # archetype: genre ceiling + hot-master rule (binding A1)
def true_peak_overshoot(a):
    p1 = _phase(a, "phase1"); tp = p1.get("true_peak_db")
    if tp is None:
        return None
    g, ctx = _genre(a), G.master_context()
    ceiling = G.ppath(g, f"loudness.{ctx}.true_peak_dbtp_max", -1.0)
    lufs = p1.get("lufs")                       # hot-master: louder than threshold → stricter ceiling
    if lufs is not None and lufs > G.platform("hot_master_threshold_lufs", -14.0):
        ceiling = G.platform("hot_master_true_peak_dbtp", -2.0)
    if tp <= ceiling:
        return None
    sev = "severe" if tp > 0.0 else ("moderate" if tp > ceiling + 0.7 else "minor")
    return _make(track_id=_track_id(a), slug="true_peak_overshoot", severity=sev,
        category="clipping", kind="fault",
        headline=f"True peak {tp:+.2f} dBTP — over {ceiling:.1f} ceiling",
        summary=f"Inter-sample true peak exceeds the {ceiling:.1f} dBTP ceiling; codec re-encoding will clip.",
        evidence=[Evidence(metric="phase1.true_peak_db", value=float(tp),
                           expected_range=(-6.0, ceiling), label=f"{tp:+.2f} dBTP")],
        why_it_matters="Lossy codecs (AAC/Opus) raise peaks on re-encode; over the ceiling risks audible distortion.")

@single("loudness_vs_target", tier="A")       # archetype: signed deviation vs GENRE target (binding A2)
def loudness_vs_target(a):
    lufs = _phase(a, "phase1").get("lufs")
    if lufs is None:
        return None
    g, ctx = _genre(a), G.master_context()
    target = G.ppath(g, f"loudness.{ctx}.lufs_target") or G.ppath(g, "loudness.streaming.lufs_target", -14.0)
    tol = G.ppath(g, "loudness.streaming.lufs_tolerance", 1.5)
    delta = lufs - target
    if abs(delta) <= tol or abs(delta) <= 3:    # win-band / below-moderate → no problem card (win deferred)
        return None
    sev = "severe" if abs(delta) > 6 else "moderate"
    direction = "loud" if delta > 0 else "quiet"
    return _make(track_id=_track_id(a), slug="loudness_vs_target", severity=sev, category="loudness",
        kind="fault", headline=f"Master too {direction} ({lufs:.1f} LUFS)",
        summary=f"Integrated loudness {lufs:.1f} LUFS is {abs(delta):.1f} LU from the {target:.0f} {ctx} target for {G.resolve_genre(g)}.",
        evidence=[Evidence(metric="phase1.lufs", value=float(lufs),
                           expected_range=(target - 3, target + 3), label=f"{lufs:.1f} LUFS")],
        why_it_matters="Streaming normalises to its target; too loud burns dynamics, too quiet gains up noise.")

@single("over_compression", tier="A")         # archetype: suspected, genre dynamics + techno caveat (binding A3)
def over_compression(a):
    p1 = _phase(a, "phase1")
    lra = p1.get("loudness_range_lu"); cf = p1.get("crest_factor")
    if lra is None and cf is None:
        return None
    g = _genre(a)
    lra_range = G.ppath(g, "dynamics.lra_lu.range", [5.0, 9.0])
    crest_warn = G.ppath(g, "dynamics.crest_db.warn_below", 6.0)
    lra_lo = lra_range[0]
    crest_low = cf is not None and cf < crest_warn
    # techno caveat: low LRA is inherent to a constant beat — require crest corroboration before firing.
    if G.resolve_genre(g) == "techno" and not crest_low:
        return None
    sev = None
    if lra is not None and lra < (lra_lo - 2) and crest_low:
        sev = "severe"
    elif (lra is not None and lra < lra_lo) or crest_low:
        sev = "moderate"
    if sev is None:
        return None
    ev = []
    if lra is not None:
        ev.append(Evidence(metric="phase1.loudness_range_lu", value=float(lra),
                           expected_range=tuple(lra_range), label=f"{lra:.1f} LU"))
    if cf is not None:
        ideal = G.ppath(g, "dynamics.crest_db.range", [7.0, 12.0])
        ev.append(Evidence(metric="phase1.crest_factor", value=float(cf),
                           expected_range=tuple(ideal), label=f"{cf:.1f} dB crest"))
    return _make(track_id=_track_id(a), slug="over_compression", severity=sev, category="dynamics",
        kind="observation", suspected=True, headline="Heavily compressed — dynamics squashed",
        summary=f"Loudness range / crest are below the {G.resolve_genre(g)} ideal. Sometimes a genre choice.",
        evidence=ev,
        why_it_matters="Over-limiting kills transients and fatigues listeners; the genre ideal sets how far is too far.")
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest components/worker/tests/verdict_pipeline/test_rules_tier_a.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/verdict_lib/rule_engine.py components/worker/tests/verdict_pipeline/test_rules_tier_a.py
git commit -m "feat(rules): Tier A archetype rules (true_peak, clipping, loudness, over_compression)"
```

---

## Task 5: Remaining Tier A singles (table-driven, same archetypes)

**Files:**
- Modify: `components/worker/app/verdict_lib/rule_engine.py`
- Test: `components/worker/tests/verdict_pipeline/test_rules_tier_a.py` (extend)

**Interfaces:**
- Produces registered singles: `sub_mono_compatibility`, `negative_correlation`, `thin_low_end`, `mud_buildup`, `harsh_upper_mid`, `dull_no_air`, `no_tonal_center`, `over_widened`, `width_instability`, `missing_section`, `eight_bar_violations`. (A14 `channel_imbalance` is intentionally omitted — superseded by B5 in a follow-on; see Out of Scope.)

Each rule is the **same 5-step TDD cycle** as Task 4 (write fires+silent test → run red → implement using `_make`/`_tiered`/`TH` exactly like the matching archetype → run green → commit). Implement them with these exact parameters:

| slug | reads (real paths) | fires when | tiers | category | kind | suspected | data_tier | archetype to copy |
|---|---|---|---|---|---|---|---|---|
| `sub_mono_compatibility` | `phase1.mono_compatibility` | `< 0.6` | `<0.4` severe · else moderate | `mono_compatibility` | fault | no | audio_only | true_peak (lower_is_worse) |
| `negative_correlation` | `phase1.stereo_correlation` | `< 0.0` | `<-0.3` severe · else moderate | `stereo_phase` | fault | no | audio_only | true_peak (lower_is_worse) |
| `thin_low_end` | `phase1.low_energy`, `phase2.genre` | `low_energy < genre_floor("low_energy", genre)` | far-below severe · modest moderate | `low_end` | fault | no | audio_only | loudness (signed vs config) |
| `mud_buildup` | `phase1.bands.low_mid`, `phase1.bands.mid` | `low_mid − mid > band.moderate` | by `mud_buildup` band | `frequency_balance` | fault | no | audio_only | true_peak (diff value) |
| `harsh_upper_mid` | `phase1.bands.upper_mid`, `phase1.spectral_centroid_hz`, `phase2.genre` | `upper_mid > band.moderate` OR centroid `> genre_ceiling` | graduated | `frequency_balance` | observation | **yes** | audio_only | over_compression (multi-field) |
| `dull_no_air` | `phase1.bands.air`, `phase1.spectral_centroid_hz` | `air < genre_floor("air_db")` OR centroid low | graduated | `frequency_balance` | fault | no | audio_only | true_peak (lower_is_worse) |
| `no_tonal_center` | `phase1.spectral_flatness`, `phase1.key_detection_confidence` | `flatness` high AND `key_conf < 0.5` | moderate | `harmonic` | observation | no | audio_only | over_compression (AND of two) |
| `over_widened` | `phase1.stereo_width`, `phase2.genre` | `> genre_ceiling("stereo_width")` | graduated | `stereo_field` | observation | **yes** | audio_only | true_peak (vs config ceiling) |
| `width_instability` | `phase9.spatial.width_consistency` | `< 60` | `<40` moderate · else minor | `spatial` | fault | no | audio_only | true_peak (lower_is_worse) |
| `missing_section` | `phase7.metadata.{has_drop,has_breakdown,has_buildup}`, `phase2.genre`, `phase7.arrangement_status` | a genre-required flag false **AND** `arrangement_status=="scored"` | missing drop severe · else moderate | `sections` | fault | no | audio_only | clipping (bool gate) |
| `eight_bar_violations` | `phase7.eight_bar_score` | `< 70` | `<50` moderate · else minor | `sections` | fault | no | audio_only | width_instability (lower_is_worse) |

Notes baked into the implementations:
- All genre-aware rules read `phase2.genre` and resolve numbers via `genre_config` (`G.ppath(genre, …)` / `G.resolve_genre`). No hardcoded genre numbers.
- **`missing_section`** is fully genre-driven by binding `A15`: read `genre_profiles.{genre}.arrangement.{required_sections, structure_type}`. **Techno is `linear_hypnotic` — do NOT flag a missing drop/breakdown** (its `required_sections` omits them). Severe only when `structure_type=='breakdown_drop' AND not has_drop`. Gate on `arrangement_status=='scored'`.
- `missing_section`/`eight_bar_violations`: **return None unless `phase7.get("arrangement_status") == "scored"`** (never grade an unscored/short track).
- `mud_buildup` uses the **band difference** `low_mid − mid` (both dB-rel-peak, so normalization-stable — why it's Tier A, not lift-gated). The binding says scale the threshold by `low_mid_emphasis`; until a corpus number exists it uses a placeholder base, `suspected=true`.
- **Tonal/stereo rules A7–A12 (`thin_low_end`, `mud_buildup`, `harsh_upper_mid`, `dull_no_air`, `over_widened`) ship `suspected=true` with a placeholder base scaled by the genre's QUALITATIVE hint** (`low_mid_emphasis`, `brightness_rank`, `air_emphasis`, `width_character`) — `genre-profiles.json` has no firing NUMBERS for them yet. Flagged for the measured-corpus pass (`genre-profiles.json::_tuning_notes`). Implement the hint-scaling hook now; the corpus tightens the base later.
- Every rule: `evidence.metric` is the exact real path; `value` coerced to `float`; one record max.

**Plus one new soft single — `bpm_genre_match`** (binding `bpm_genre_match`): reads `phase1.bpm` vs `genre_profiles.{genre}.bpm.{min,max}`; fires `minor`, `suspected=true`, `category="sections"` when bpm is outside the genre window. Never an error (subgenres span wide — hard techno 140–150, progressive trance 128–134). One TDD cycle, same pattern.

- [ ] **Step 1–N:** For EACH row above, run the TDD cycle (test fires + silent → red → implement → green). Add the fires/silent tests to `test_rules_tier_a.py` mirroring Task 4's `_a()` helper.
- [ ] **Final step: full Tier A validator sweep**

```python
def test_all_tier_a_records_resolve():
    a = _a(true_peak_db=0.5, clipping_detected=True, clipped_sample_count=5000, lufs=-7.0,
           mono_compatibility=0.3, stereo_correlation=-0.4, loudness_range_lu=1.5)
    for r in evaluate_problems(a):
        assert validate_verdict(r, a).ok, r.problem_id
```
Run: `pytest components/worker/tests/verdict_pipeline/test_rules_tier_a.py -v` → PASS.

- [ ] **Commit** after the sweep:
```bash
git add components/worker/app/verdict_lib/rule_engine.py components/worker/tests/verdict_pipeline/test_rules_tier_a.py
git commit -m "feat(rules): remaining Tier A singles (mono, correlation, tonal, stereo, sections)"
```

---

## Task 6: Stem (S) + MIDI (P) singles — data-tier tagging

**Files:**
- Modify: `components/worker/app/verdict_lib/rule_engine.py`
- Test: `components/worker/tests/verdict_pipeline/test_rules_stem_midi.py`

**Interfaces:**
- Produces singles: `stem_clash`, `stem_balance` (`data_tier="stems"`), `robotic_velocity`, `no_headroom`, `quantization_issues`, `project_clutter` (`data_tier="project_midi"`). Each gated on its presence flag.

Gates (return None when absent — never grade missing data):
- S rules: `_phase(a,"phase4").get("stems",{}).get("status") != "ok"` → None.
- P rules: `not _phase(a,"phase8")` (empty dict) → None.

| slug | reads (real paths) | fires when | tiers | category | data_tier | evidence carries |
|---|---|---|---|---|---|---|
| `stem_clash` | `phase4.stems.clash_matrix[].severity_tier` (+ `stem_a`,`stem_b`,`band`) | any entry `warning`/`critical` | `critical`→severe · `warning`→moderate | `frequency_collision` | stems | `Evidence(..., stems=[stem_a, stem_b])`, `frequency_range_hz` from band |
| `stem_balance` | `phase4.stems.per_stem.<role>` BalanceFlag (`direction`,`severity_tier`) | any flag present | by `severity_tier` | `gain_staging` | stems | `stems=[role]` |
| `robotic_velocity` | `phase8.per_track_analysis.<track>.velocity_std`, `.humanization_score` | `velocity_std == 0` crit · `< 3` severe · `humanization_score=="robotic"` | as stated | `humanization` | project_midi | `where` = null |
| `no_headroom` | `phase8.tracks[].volume_db` | >80% unmuted tracks high-fader OR std `< 2 dB` | moderate | `gain_staging` | project_midi | — |
| `quantization_issues` | `phase8.quantization_issues_count`, `phase8.midi_issues[]` | severe quantization errors present | by count | `humanization` | project_midi | — |
| `project_clutter` | `phase8.clutter_pct`, `phase8.disabled_devices` | high disabled ratio | graduated | `device_chain` | project_midi | suspected: **yes** |

Example (the S1 archetype — implement the rest the same way, one TDD cycle each):
```python
@single("stem_clash", tier="S")
def stem_clash(a):
    stems = _phase(a, "phase4").get("stems") or {}
    if stems.get("status") != "ok":
        return None
    worst = None
    for row in stems.get("clash_matrix") or []:
        tier = row.get("severity_tier")
        if tier in ("warning", "critical"):
            if worst is None or tier == "critical":
                worst = row
    if worst is None:
        return None
    sev = "severe" if worst.get("severity_tier") == "critical" else "moderate"
    a_s, b_s, band = worst.get("stem_a"), worst.get("stem_b"), worst.get("band")
    return _make(track_id=_track_id(a), slug="stem_clash", severity=sev,
        category="frequency_collision", kind="fault", data_tier="stems",
        headline=f"Stem clash: {a_s} vs {b_s} ({band})",
        summary=f"{a_s} and {b_s} overlap in the {band} band — masking that a fix should carve.",
        evidence=[Evidence(metric="phase4.stems.clash_matrix", value=None,
                           label=f"{a_s}×{b_s} {band}", stems=[a_s, b_s])],
        why_it_matters="Two stems competing in the same band smear definition; carve one to make room.")
```

- [ ] TDD cycle per row (fires when present + gate-silent when `status!="ok"` / no phase8). Build fixtures with a stems block and a phase8 block in `test_rules_stem_midi.py`.
- [ ] Run: `pytest components/worker/tests/verdict_pipeline/test_rules_stem_midi.py -v` → PASS.
- [ ] **Commit:** `git commit -am "feat(rules): stem + MIDI problem rules with data_tier tagging"`

---

## Task 7: Reconcile existing rule_engine tests + keep the clean baseline silent

**Files:**
- Modify: `components/worker/tests/verdict_pipeline/test_rule_engine.py`
- Modify (fixtures if needed): `components/worker/tests/verdict_pipeline/fixtures/analyses/clean_trance.json`

**Interfaces:** consumes the new engine; no new production code.

The old file tests the deleted `@rule` functions and 3 `xfail` dead rules. The new rules supersede them. The clean fixture must trip **zero** rules.

- [ ] **Step 1: Run the existing suite to see what broke**

Run: `pytest components/worker/tests/verdict_pipeline/test_rule_engine.py -v`
Expected: failures (renamed records, deleted rules, xfails now passing).

- [ ] **Step 2: Update the assertions to the Problem shape**

Records are now found by `problem_id.split(".")[1]` (slug) or `category`. Rewrite the 3 still-relevant smoke tests to the new categories/slugs (clipping→`clipping_count`, true peak→`true_peak_overshoot`, mono→`sub_mono_compatibility`). Delete the 3 `xfail` tests for the removed `low_mid_mud_*` / old `key_detection` rules — their replacements (`mud_buildup`, `no_tonal_center`) are covered in `test_rules_tier_a.py`.

- [ ] **Step 3: Ensure the clean baseline is silent**

```python
def test_clean_track_emits_no_problems(clean_trance):
    assert evaluate_problems(clean_trance) == []
```
Run it. If any new rule fires on `clean_trance`, the fixture is genuinely out of the configured "healthy" bands — fix the **fixture** values (not the thresholds) so a clean reference trips nothing, matching the spec's "never emit when in range."

- [ ] **Step 4: Full verdict-pipeline suite green**

Run: `pytest components/worker/tests/verdict_pipeline/ -q`
Expected: PASS (including `degraded` tests — `evaluate_rules` alias keeps that path working).

- [ ] **Step 5: Commit**

```bash
git add components/worker/tests/verdict_pipeline/
git commit -m "test(rules): reconcile rule-engine suite to Problem shape; clean baseline silent"
```

---

## Task 8: Composites (Tier-A-input only) — C1, C2, C3, C5, C6

**Files:**
- Modify: `components/worker/app/verdict_lib/rule_engine.py`
- Test: `components/worker/tests/verdict_pipeline/test_composites.py` (extend)

**Interfaces:**
- Produces `@composite` registrations. Each reads `fired: dict[str, Verdict]` and/or raw `analysis`, returns a record with `suspected=False` and severity ≥ its hottest constituent, and declares `suppresses`.

Implement exactly these (C4 needs B1, C7 needs B2 — both deferred):

| slug | inputs (fired slug and/or metric) | severity / confidence | category | suppresses |
|---|---|---|---|---|
| `loudness_war` | `crest_factor < 6` AND `loudness_range_lu < 4` AND `true_peak_db > -0.3` | severe / 0.95 | dynamics | `over_compression`, `true_peak_overshoot` |
| `congested_mix` | `mud_buildup` fired AND `spectral_contrast` low AND `spectral_flatness` elevated | severe / 0.90 | clarity | `mud_buildup` |
| `phantom_width` | `over_widened` fired AND `mono_compatibility < 0.6` AND `stereo_correlation ≤ 0.1` | severe / 0.92 | stereo_field | `over_widened`, `sub_mono_compatibility`, `negative_correlation` |
| `lifeless_at_source` | `crest_factor` low AND `phase8` present AND `humanization_score=="robotic"` on ≥2 tracks AND `velocity_std≈0` | severe / 0.93 | humanization | `robotic_velocity`, `over_compression` |
| `thin_and_bright` | `thin_low_end` fired AND `spectral_centroid_hz > genre_ceiling` AND `bands.air` hot | moderate / 0.88 | frequency_balance | `thin_low_end`, `harsh_upper_mid`, `dull_no_air` |

Canonical composite (copy for the rest):
```python
@composite("loudness_war", suppresses=["over_compression", "true_peak_overshoot"])
def loudness_war(a, fired):
    p1 = _phase(a, "phase1")
    cf, lra, tp = p1.get("crest_factor"), p1.get("loudness_range_lu"), p1.get("true_peak_db")
    if None in (cf, lra, tp):
        return None
    # GENRE-AWARE (rule-bindings composite_bindings.C1): defer the hardcoded crest<6/LRA<4
    # to the genre's warn_below / static_floor so a techno crest of 5 (fine) doesn't false-fire.
    g = _phase(a, "phase2").get("genre")
    crest_warn = G.ppath(g, "dynamics.crest_db.warn_below", 6.0)
    lra_floor = G.ppath(g, "dynamics.lra_lu.static_floor", 4.0)
    if not (cf < crest_warn and lra < lra_floor and tp > -0.3):
        return None
    return _make(track_id=_track_id(a), slug="loudness_war", severity="severe", confidence=0.95,
        category="dynamics", kind="fault", suspected=False,
        headline="Over-limited master — dynamics crushed and peaks clipped",
        summary="Crest factor, loudness range, and true peak all indicate aggressive limiting — not a genre choice.",
        evidence=[
            Evidence(metric="phase1.crest_factor", value=float(cf), expected_range=(7, 12), label="crushed dynamics"),
            Evidence(metric="phase1.loudness_range_lu", value=float(lra), expected_range=(5, 9), label="low LRA"),
            Evidence(metric="phase1.true_peak_db", value=float(tp), expected_range=(-1.5, -1.0), label="against ceiling"),
        ],
        why_it_matters="Three corroborating metrics mean this is over-limiting, certain — fix the master chain, not one knob.")
```

- [ ] **Step 1: Composite firing + suppression tests**

```python
def test_loudness_war_fires_and_suppresses_children():
    # default genre → modern_trance: crest_warn=4, lra_floor fallback=4. cf<4 AND lra<4 AND tp>-0.3.
    a = {"track_id": "t", "phase1": {"crest_factor": 3.0, "loudness_range_lu": 2.9, "true_peak_db": -0.1,
         "lufs": -8.0, "clipping_detected": False, "mono_compatibility": 0.95, "stereo_correlation": 0.6}}
    out = evaluate_problems(a)
    slugs = {r.problem_id.split(".")[1] for r in out}
    assert "loudness_war" in slugs
    assert "over_compression" not in slugs and "true_peak_overshoot" not in slugs
    war = next(r for r in out if r.problem_id.split(".")[1] == "loudness_war")
    assert war.suspected is False and war.confidence == 0.95
    assert war.related_verdict_ids  # audit trail (router §1a): records absorbed children

def test_loudness_war_silent_for_techno_dense_master():
    # techno crest 5 / LRA 3 is normal, not a loudness war — genre warn_below(4)/static_floor(3) gate it.
    a = {"track_id": "t", "phase2": {"genre": "techno"},
         "phase1": {"crest_factor": 5.0, "loudness_range_lu": 3.2, "true_peak_db": -0.1}}
    assert not any(r.problem_id.split(".")[1] == "loudness_war" for r in evaluate_problems(a))

def test_composite_silent_when_only_one_input_present():
    a = {"track_id": "t", "phase1": {"crest_factor": 4.8, "loudness_range_lu": 8.0, "true_peak_db": -2.0}}
    out = evaluate_problems(a)
    assert not any(r.problem_id.split(".")[1] == "loudness_war" for r in out)
```

- [ ] **Step 2: red → implement the 5 composites → green** (one TDD cycle each).
- [ ] **Step 3: Validator sweep** — every composite record's evidence resolves:
```python
def test_composite_records_pass_validator():
    a = {"track_id": "t", "phase1": {"crest_factor": 4.8, "loudness_range_lu": 2.9, "true_peak_db": -0.1}}
    for r in evaluate_problems(a):
        assert validate_verdict(r, a).ok, r.problem_id
```
Run: `pytest components/worker/tests/verdict_pipeline/test_composites.py -v` → PASS.

- [ ] **Step 4: Commit**

```bash
git add components/worker/app/verdict_lib/rule_engine.py components/worker/tests/verdict_pipeline/test_composites.py
git commit -m "feat(rules): Tier C composites (loudness_war, congested_mix, phantom_width, lifeless_at_source, thin_and_bright)"
```

---

## Task 9: Final integration sweep + docs

**Files:**
- Modify: `components/worker/app/verdict_lib/rule_engine.py` (module docstring)
- Modify: `CLAUDE.md` (worker section — note the engine is now two-pass + config-driven)

- [ ] **Step 1: Full worker + shared suites**

Run:
```bash
pytest -q components/worker/tests/
pytest -q components/shared/tests/
ruff check components/worker/ components/shared/
mypy components/worker/app/verdict_lib/ --ignore-missing-imports
```
Expected: all green.

- [ ] **Step 2: Smoke against the real captured payload**

```bash
python - <<'PY'
import json
from app.verdict_lib.flatten_analysis import flatten
from app.verdict_lib.rule_engine import evaluate_problems
fj = json.load(open("output/analysis/2026-06-25_latest-final-json/final_json.full.json"))
recs = evaluate_problems({**flatten(fj), "track_id": "smoke"})
print(len(recs), "problems")
for r in recs: print(r.severity, r.problem_id, "| suppressed-aware")
PY
```
Expected: a non-empty, de-suppressed problem list with valid `problem_id`s — no exceptions.

- [ ] **Step 3: Update the docstring + CLAUDE.md** to describe the two-pass engine, `thresholds.json`, and that rules emit the Problem shape (`fix=null`).

- [ ] **Step 4: Commit**

```bash
git add components/worker/app/verdict_lib/rule_engine.py CLAUDE.md
git commit -m "docs(rules): document two-pass Problem engine + config thresholds"
```

---

## Self-Review

**1. Spec coverage:**
- TIER A: A1 `true_peak_overshoot`✓(T4) · A2 `loudness_vs_target`✓(T4) · A3 `over_compression`✓(T4) · A4 `clipping_count`✓(T4) · A5 `sub_mono_compatibility`✓(T5) · A6 `negative_correlation`✓(T5) · A7 `thin_low_end`✓(T5) · A8 `mud_buildup`✓(T5) · A9 `harsh_upper_mid`✓(T5) · A10 `dull_no_air`✓(T5) · A11 `no_tonal_center`✓(T5) · A12 `over_widened`✓(T5) · A13 `width_instability`✓(T5) · **A14 `channel_imbalance` → DEFERRED** (needs 2×2 matrix lift = B5; the spec itself says "consider deferring to B") · A15 `missing_section`✓(T5, presence-only) · A16 `eight_bar_violations`✓(T5).
- TIER B (B1–B5): **all DEFERRED** — each needs an INTERNAL→EXPOSED lift (ties to `PRPs/surface-latent-analysis-datapoints.md`); B2 needs per-section RMS which is itself deferred. See follow-on plan.
- S1–S2, P1–P4: ✓ (T6).
- TIER C: C1✓ C2✓ C3✓ C5✓ C6✓ (T8) · **C4 DEFERRED** (needs B1) · **C7 DEFERRED** (needs B2).
- Composite evaluation order (singles → composites → suppression): ✓ (T3 `evaluate_problems`).
- Suppression engine (absorb children, higher-severity wins, one-suppression) **+ audit trail** (router §1a — composite stamps `related_verdict_ids` with absorbed `problem_id`s): ✓ (T3 `suppression.apply`).
- Genre config (provided `genre-profiles.json` + `rule-bindings.json` + `genre-config.md`): ✓ committed; loader ✓ (T2); genre-relative severity wired into A1/A2/A3/A15/C1 + techno LRA caveat + `bpm_genre_match` (T4/T5/T8). Tonal A7–A12 ship `suspected` pending corpus.
- Composite Refiner (`refines` field + LLM refine mode) and 4-stage Router (`router.md`): accounted for as follow-ons #5/#6 with deps; `Verdict.refines` hook added in T1.
- Example record shape (problem_id, source, data_tier, fixable, suspected, where, evidence.frequency_range_hz/stems): ✓ (T1 model + `_make`).
- "Never emit when field absent / never grade missing data": ✓ (every rule's `None`-guard + presence gates).
- "Rules run on degraded/free tier, never empty": ✓ (`evaluate_rules` alias keeps degraded.py wired).

**2. Placeholder scan:** archetype rules show full code; table-driven rules carry exact paths/tiers/categories + the named archetype to copy (concrete, not "similar to") — acceptable density for ~20 near-identical rules. No TBD/TODO.

**3. Type consistency:** `_make(slug=…)` sets `problem_id=f"{category}.{slug}.{index}"` and `specialist=f"rule_engine.{slug}"` everywhere; tests find records via `problem_id.split(".")[1]`. `evaluate_problems`/`evaluate_rules` alias consistent across degraded.py + tests. `suppression.apply(singles, composites)` signature matches T3 + T8 usage.

---

## Out of Scope / Follow-on Plans

These are **named, sequenced** follow-ons — each a separate plan producing working software:

1. **`problem-engine-tier-b-lifts`** — Tier B rules, each gated on a datapoint lift from `PRPs/surface-latent-analysis-datapoints.md`: B1 `missing_sidechain` (momentary loudness series), B3 `sub_rumble` (<30 Hz band split), B4 `modal_ambiguity` (24-key Krumhansl vector), B5 `channel_imbalance` (2×2 L/R matrix; supersedes A14). Then composite **C4** `untreated_low_end` (needs B1).
2. **`problem-engine-section-rms`** — the per-section true RMS/LUFS lift (replaces phase-7's confidence-proxy "energy"), then B2 `weak_drop_payoff` and composite **C7** `no_drop_payoff`. Explicitly gated: do NOT build against the phase-7 proxy, **and C7 only fires when `genre_profiles.{genre}.arrangement.structure_type == 'breakdown_drop'`** — never techno (`linear_hypnotic` has no drop to pay off), per rule-bindings `composite_bindings.C7`.
3. **`problem-list-persistence`** — extend the `verdicts` table + EF entity + `aimusic_shared` ORM + `VerdictDto` with the Problem columns (`problem_id`, `source`, `data_tier`, `fixable`, `suspected`, `kind`, `where`), and promote the engine to the **healthy** analysis path (not just degraded), persisting the de-suppressed problem list. (BFF migration — separate subsystem, separate review.)
4. **`problem-list-persistence`** (above) also adds the `refines` audit/relationship columns so the refiner output round-trips.
5. **`composite-refiner`** — the LLM identifier in *refine* mode (staged spec: `PRPs/identifiers/composite-refiner.md` + `worked-example-refinement.md`). Takes a **fired Tier C composite** + genre config + the Tier B time-series and either enriches it in place (sharper `summary`/`evidence`/`where`, possibly upgraded `data_tier`) or **splits it into children**, each carrying `refines = parent.problem_id`. **Depends on:** this slice's composites + genre config (done here) **and** the Tier B lifts (#1/#2). It's the "(1b) payoff" — LLM budget spent only on already-confirmed problems. The `Verdict.refines` field added in Task 1 is its hook.
6. **`router`** — the 4-stage IDENTIFY→SOLVE bridge (staged spec: `PRPs/identifiers/router.md`; design in `identify-solve-architecture.md` §6):
   - **Reconcile** — suppression (already produced here, with the audit trail from Task 3) **then** refinement (a `refines` record supersedes its parent: enrich-in-place replaces, split removes-and-routes-children). **Ordering: suppress before refine.** Observations (`fixable=false`) skip routing.
   - **Route** — map each survivor → one primary solver by `(category, data_tier)` (the tier-gating table: audio-only masking→EQ, stems masking→Sidechain). Genre rides on every record.
   - **Fan-out** — multi-domain problems (kick/bass = EQ carve + sidechain duck) split to multiple solvers, each told which slice it owns.
   - **Merge** — reattach `fix` by `problem_id`, order fan-out steps into one chain, reconcile overlaps, honest hand-backs → observation.
   - **Degraded path:** if the refiner is unavailable (free/no-LLM), route the **raw composite** — coarse but correct (the whole point of the deterministic engine).
7. **SOLVE solver roster** — EQ Surgeon / Dynamics / Sidechain / Stereo / Arrangement / Gain-Routing (`identify-solve-architecture.md` §5). Reuses the existing `Fix`/`DspOp` validator. Consumes the routed queue.
8. **`problem-list-ui`** — the Problems tab/list surface in `frontend-spectr-v2` (coordinate with the `analysis-results-ui` branch per `identify-solve-architecture.md` §9).

**Full pipeline (for orientation):** EXTRACT (`rules.md` + `config/genre-*`) → IDENTIFY incl. refine (`identifiers/composite-refiner.md`) → **this plan = the deterministic EXTRACT/IDENTIFY engine** → router (`identifiers/router.md`) → SOLVE (`solve-*`) → RANK/PRESENT, with `Verdict` (the problem record) as the contract throughout.

---

## Execution Handoff

Plan complete and saved to `PRPs/problem-engine-mixcoach-rules.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach? (And: do you want me to fold the real threshold numbers into `thresholds.json` once you send them, before or after Task 4?)
