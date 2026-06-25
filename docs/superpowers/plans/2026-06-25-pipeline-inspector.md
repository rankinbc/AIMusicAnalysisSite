# Pipeline Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only Python CLI that, given an analysis id (or `--catalog`), emits a single self-contained HTML page tracing an analysis through every pipeline stage, overlaid on the full catalog of rules and specialists, to surface rule-system gaps.

**Architecture:** A new `app/tools/inspector/` package in the worker. A static stage map (authored) supplies per-stage narration + declared I/O. Rule introspection (AST) extracts each rule's read-paths and re-runs rules deterministically against the stored `final_json`. A loader pulls the `analyses` row + `verdicts` rows. A builder assembles a JSON-able view model (catalog-only or full-trace); a renderer turns it into self-contained HTML. A thin CLI wires the modes.

**Tech Stack:** Python 3.11+, stdlib only (`argparse`, `ast`, `inspect`, `html`, `webbrowser`, `pathlib`, `datetime`), SQLAlchemy 2.0 sync (existing `app.db_sync`), pytest + in-memory sqlite. Reuses `app.verdict_lib` (`rule_engine`, `flatten_analysis`, `validator`, `prompt_loader`) and `aimusic_shared.models`.

## Global Constraints

- Python 3.11+; format with `ruff format`, lint with `ruff check`, type-check with `mypy --ignore-missing-imports`. (One line each, copied from CLAUDE.md.)
- **No new third-party dependencies** — stdlib + already-installed packages only.
- **Read-only:** no DB writes, no new DB columns, no Alembic/EF migrations.
- **`db_sync` is import-time DB-bound** (`app/db_sync.py:27` builds the engine at import and raises if `DATABASE_URL` is unset). The inspector package's top-level imports MUST NOT import `app.db_sync`; the DB session factory is passed in as a parameter. Catalog mode and `--validate-map` (snapshot form) run with no DB.
- **Self-contained output:** inline CSS + minimal vanilla JS, no network calls, no external assets; collapsible regions via native `<details>`. Escape all `final_json`/verdict text with `html.escape`.
- **Output path** (CLAUDE.md output rules): `output/worker/<YYYY-MM-DD>_pipeline_inspector/<short_id>.html` (trace) or `…/_catalog.html` (catalog). Date is `datetime.now().strftime("%Y-%m-%d")`.
- **Tests:** pytest under `components/worker/tests/inspector/`. The root `tests/conftest.py` compiles `JSONB`→`JSON` for sqlite — in-memory ORM seeding works. Minimum bar: one expected-use, one edge, one failure.
- **Disclaimer banner (spec §8) is REQUIRED** in trace-mode HTML, verbatim wording from the spec.
- Spec: `docs/superpowers/specs/2026-06-25-pipeline-inspector-design.md`.

---

### Task 1: Static stage map + map-freshness diff

**Files:**
- Create: `components/worker/app/tools/__init__.py` (empty)
- Create: `components/worker/app/tools/inspector/__init__.py` (empty)
- Create: `components/worker/app/tools/inspector/stage_map.py`
- Create: `components/worker/tests/inspector/__init__.py` (empty)
- Test: `components/worker/tests/inspector/test_stage_map.py`

**Interfaces:**
- Produces:
  - `STAGE_MAP: list[Stage]` where `Stage` is a `dataclass(frozen=True)` with fields `key: str`, `title: str`, `narration: str`, `inputs: tuple[str, ...]`, `outputs: tuple[str, ...]`.
  - `declared_output_paths() -> set[str]` — union of every stage's `outputs`.
  - `stage_for_path(path: str) -> str | None` — the `key` of the stage that declares `path` in its outputs, else `None`.
  - `diff_against_final_json(final_json: dict) -> tuple[list[str], list[str]]` — returns `(stale_missing, phantom)` per spec §6.1. `stale_missing` = paths present in the flattened `final_json` but not declared; `phantom` = declared paths absent from `final_json`, **restricted** to phases that actually appear in the snapshot (so skipped optional phases 8/9 are not false-flagged) plus all top-level rollup keys.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/inspector/test_stage_map.py
from __future__ import annotations

from app.tools.inspector.stage_map import (
    STAGE_MAP,
    declared_output_paths,
    diff_against_final_json,
    stage_for_path,
)


def test_map_covers_all_pipeline_stages():
    keys = {s.key for s in STAGE_MAP}
    for n in range(1, 10):
        assert f"phase{n}" in keys
    assert {"rollups", "rule_engine", "triage", "specialists", "validation", "ranking"} <= keys


def test_declared_outputs_include_known_phase1_metrics():
    paths = declared_output_paths()
    assert "phase1.true_peak_db" in paths
    assert "phase1.lufs" in paths
    assert "phase2.genre" in paths
    assert "overall_score" in paths


def test_stage_for_path_resolves_producer():
    assert stage_for_path("phase1.true_peak_db") == "phase1"
    assert stage_for_path("nonexistent.field") is None


def test_diff_flags_stale_and_phantom():
    final_json = {
        "overall_score": 42.0,
        "grade": "F",
        "danceability_score": 10,
        "top_fixes": [],
        "coach_name": "Coach",
        "coach_intro": "x",
        "coached_fixes": [],
        "phases": [
            {"phase": 1, "name": "Universal", "data": {
                "true_peak_db": -0.2, "lufs": -9.0, "brand_new_metric": 1.0,
            }},
        ],
    }
    stale_missing, phantom = diff_against_final_json(final_json)
    # New, undeclared pipeline output → stale/missing (map needs updating).
    assert "phase1.brand_new_metric" in stale_missing
    # phase1 IS present but the map declares more phase1 keys than the snapshot
    # has → those are phantom; a declared key the snapshot lacks shows here.
    assert "phase1.clipping_detected" in phantom
    # phase2..9 are absent from the snapshot → their declared outputs are NOT
    # phantom (optional/skipped phases must not false-flag).
    assert all(not p.startswith("phase2.") for p in phantom)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/worker && python -m pytest tests/inspector/test_stage_map.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools'`.

- [ ] **Step 3: Write minimal implementation**

```python
# components/worker/app/tools/inspector/stage_map.py
"""Authored static map of the analysis + verdict pipeline.

One entry per stage: a human narration (what it consumes / produces / how the
data is used) plus the datapoints it reads (`inputs`) and emits (`outputs`).
This is the backbone for catalog mode, per-stage narration, and static gap
detection (spec §6). It is *authored*, not introspected — phase outputs are
dynamic dicts with no typed schema — so `diff_against_final_json` (spec §6.1)
guards it against drift.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.verdict_lib.flatten_analysis import flatten


@dataclass(frozen=True)
class Stage:
    key: str
    title: str
    narration: str
    inputs: tuple[str, ...]
    outputs: tuple[str, ...]


STAGE_MAP: list[Stage] = [
    Stage(
        key="phase1",
        title="Phase 1 — Universal Mix Analysis",
        narration=(
            "Consumes the 44.1 kHz WAV. Produces loudness, true-peak, clipping, "
            "BPM, key, a 7-band spectrum, and stereo health. These are the raw "
            "measurements nearly every downstream rule and specialist reads."
        ),
        inputs=("wav",),
        outputs=(
            "phase1.lufs", "phase1.rms", "phase1.bpm", "phase1.duration_seconds",
            "phase1.bands", "phase1.stereo_correlation", "phase1.stereo_width",
            "phase1.true_peak_db", "phase1.peak_dbfs", "phase1.clipping_detected",
            "phase1.clipped_sample_count", "phase1.detected_key",
            "phase1.mono_compatibility", "phase1.low_energy", "phase1.structure",
        ),
    ),
    Stage(
        key="phase2",
        title="Phase 2 — Genre Detection",
        narration=(
            "Consumes Phase 1 BPM + presence band. Produces a genre label and "
            "confidence used to select genre-specific scoring and rules."
        ),
        inputs=("phase1.bpm", "phase1.bands"),
        outputs=("phase2.genre", "phase2.confidence", "phase2.bpm"),
    ),
    Stage(
        key="phase3",
        title="Phase 3 — Genre-Specific Scoring",
        narration=(
            "Consumes Phase 1 metrics + the Phase 2 genre. Produces a 0–100 "
            "genre score and sub-scores that become the overall grade."
        ),
        inputs=("phase1.bands", "phase1.stereo_width", "phase1.bpm", "phase2.genre"),
        outputs=("phase3.genre", "phase3.total_score", "phase3.sub_scores", "phase3.notes"),
    ),
    Stage(
        key="phase4",
        title="Phase 4 — Stem Separation & Clash",
        narration=(
            "Consumes the WAV (and optional user stems). Produces per-band energy "
            "and frequency-clash findings (low-end buildup, mud, harshness)."
        ),
        inputs=("wav", "stem_paths"),
        outputs=("phase4.stems", "phase4.band_energy", "phase4.clashes"),
    ),
    Stage(
        key="phase5",
        title="Phase 5 — Reference Comparison",
        narration=(
            "Consumes the WAV plus an optional reference track and the genre. "
            "Produces feature deltas vs the reference and vs genre targets. "
            "Skipped (status only) when no reference is supplied."
        ),
        inputs=("wav", "reference_wav", "phase1.lufs", "phase2.genre"),
        outputs=("phase5.status", "phase5.deltas", "phase5.genre_context"),
    ),
    Stage(
        key="phase6",
        title="Phase 6 — Gap Analysis",
        narration=(
            "Consumes Phase 1 metrics + a statistical genre profile. Produces a "
            "percentile ranking and per-feature gaps vs the genre library."
        ),
        inputs=("phase1.bpm", "phase1.stereo_correlation", "phase2.genre"),
        outputs=("phase6.genre", "phase6.percentile", "phase6.gaps"),
    ),
    Stage(
        key="phase7",
        title="Phase 7 — Arrangement Advice",
        narration=(
            "Consumes the Phase 1 song structure + genre/BPM/duration. Produces "
            "an arrangement score, section scores, and suggestions."
        ),
        inputs=("phase1.structure", "phase2.genre", "phase1.bpm", "phase1.duration_seconds"),
        outputs=(
            "phase7.overall_score", "phase7.grade", "phase7.component_scores",
            "phase7.section_scores", "phase7.suggestions", "phase7.fixes",
            "phase7.violations", "phase7.section_count",
        ),
    ),
    Stage(
        key="phase8",
        title="Phase 8 — ALS Analysis (optional)",
        narration=(
            "Consumes an Ableton .als project when uploaded. Produces project "
            "health, device/track summaries, and MIDI findings. Absent otherwise."
        ),
        inputs=("als_file",),
        outputs=("phase8.health_score", "phase8.tracks", "phase8.midi", "phase8.arrangement"),
    ),
    Stage(
        key="phase9",
        title="Phase 9 — Mix Translation",
        narration=(
            "Consumes the WAV. Produces spatial / surround / playback translation "
            "scores (mono collapse, headphone vs speaker) feeding the coach."
        ),
        inputs=("wav",),
        outputs=("phase9.spatial", "phase9.surround", "phase9.playback"),
    ),
    Stage(
        key="rollups",
        title="Rollups — score, grade, coach",
        narration=(
            "Consumes Phase 3 (score/grade), Phase 7/4/9 (fixes), and Phase 1/9 "
            "(coach triggers). Produces the top-level summary fields the report "
            "header and coach panel render."
        ),
        inputs=("phase3.total_score", "phase7.suggestions", "phase4.clashes", "phase9.surround"),
        outputs=(
            "overall_score", "grade", "top_fixes", "danceability_score",
            "coach_name", "coach_intro", "coached_fixes",
        ),
    ),
    Stage(
        key="rule_engine",
        title="Rule engine (deterministic)",
        narration=(
            "Consumes the flattened final_json. Produces baseline verdicts for "
            "hard, objective violations (clipping, true-peak, mono) with no LLM. "
            "Runs before and independently of triage."
        ),
        inputs=("flattened_final_json",),
        outputs=("rule_verdicts",),
    ),
    Stage(
        key="triage",
        title="Triage (LLM routing)",
        narration=(
            "Consumes the flattened final_json + rule verdicts. Produces a routing "
            "plan (which specialists to run, skip list, rationale). This is an LLM "
            "call — shown from persisted routing_plan, never re-run here."
        ),
        inputs=("flattened_final_json", "rule_verdicts"),
        outputs=("routing_plan.specialists_to_run", "routing_plan.skip", "routing_plan.rationale"),
    ),
    Stage(
        key="specialists",
        title="Specialists (LLM)",
        narration=(
            "Each selected specialist consumes the analysis + a focus note and "
            "produces verdicts (headline, evidence, fix). LLM calls — shown from "
            "persisted verdict rows, never re-run here."
        ),
        inputs=("flattened_final_json", "routing_plan.specialists_to_run"),
        outputs=("specialist_verdicts",),
    ),
    Stage(
        key="validation",
        title="Validation + scoring (deterministic)",
        narration=(
            "Consumes each verdict + the analysis. Produces a validated verdict: "
            "metric paths checked, section/ALS sanity, and a moderate-baseline "
            "severity downgrade with priority_score recomputed in Python."
        ),
        inputs=("specialist_verdicts", "flattened_final_json"),
        outputs=("validated_verdicts",),
    ),
    Stage(
        key="ranking",
        title="Dedupe + rank",
        narration=(
            "Consumes all validated verdicts. Produces the deduped, "
            "priority-sorted final list surfaced to the UI."
        ),
        inputs=("validated_verdicts",),
        outputs=("ranked_verdicts",),
    ),
]


def declared_output_paths() -> set[str]:
    return {p for s in STAGE_MAP for p in s.outputs}


def stage_for_path(path: str) -> str | None:
    for s in STAGE_MAP:
        if path in s.outputs:
            return s.key
    return None


def _actual_paths(final_json: dict) -> tuple[set[str], set[str]]:
    """Return (actual_paths, present_phase_keys) from a real final_json."""
    flat = flatten(final_json)
    actual: set[str] = set()
    present_phases: set[str] = set()
    for k, v in flat.items():
        if k.startswith("phase") and isinstance(v, dict):
            present_phases.add(k)
            for fk in v:
                actual.add(f"{k}.{fk}")
        elif not k.startswith("phase"):
            actual.add(k)
    return actual, present_phases


def diff_against_final_json(final_json: dict) -> tuple[list[str], list[str]]:
    declared = declared_output_paths()
    actual, present_phases = _actual_paths(final_json)
    stale_missing = sorted(a for a in actual if a not in declared)
    phantom: list[str] = []
    for d in sorted(declared):
        if d in actual:
            continue
        phase = d.split(".")[0] if "." in d and d.startswith("phase") else None
        # Only flag a declared path as phantom when its phase is present in the
        # snapshot (skipped optional phases must not false-flag), or when it is
        # a top-level rollup key (always expected).
        if phase is None or phase in present_phases:
            phantom.append(d)
    return stale_missing, phantom
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/worker && python -m pytest tests/inspector/test_stage_map.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/tools components/worker/tests/inspector/__init__.py components/worker/tests/inspector/test_stage_map.py
git commit -m "feat(inspector): static stage map + map-freshness diff"
```

---

### Task 2: Rule introspection (read-paths, resolution, re-run)

**Files:**
- Create: `components/worker/app/tools/inspector/rule_introspect.py`
- Test: `components/worker/tests/inspector/test_rule_introspect.py`

**Interfaces:**
- Consumes: `app.verdict_lib.rule_engine._RULES` (list of decorated rule functions), `flatten()` output dicts.
- Produces:
  - `read_paths_for_rule(fn) -> set[str]` — dotted datapoint paths a rule reads, via AST: maps `X = _phase(analysis, "phaseN")` locals to `phaseN`, then `X.get("key")` → `"phaseN.key"`; `analysis.get("key")` → `"key"`; plus any `Evidence(metric="...")` literal.
  - `resolve_path(flattened: dict, path: str) -> str` — one of `"present"`, `"null"`, `"missing"`.
  - `run_rule(fn, flattened: dict) -> dict` — `{"fired": bool, "verdict": Verdict | None, "error": str | None}`.
  - `rule_catalog() -> list[dict]` — one entry per registered rule: `{"name": str, "doc": str, "read_paths": list[str]}` (sorted by name).

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/inspector/test_rule_introspect.py
from __future__ import annotations

from app.tools.inspector.rule_introspect import (
    read_paths_for_rule,
    resolve_path,
    rule_catalog,
    run_rule,
)
from app.verdict_lib import rule_engine


def _rule(name: str):
    return next(fn for fn in rule_engine._RULES if fn.__name__ == name)


def test_read_paths_extracts_phase_get_calls():
    paths = read_paths_for_rule(_rule("clipping_detected"))
    assert "phase1.clipping_detected" in paths
    assert "phase1.clipped_sample_count" in paths


def test_read_paths_includes_top_level_analysis_get():
    paths = read_paths_for_rule(_rule("low_mid_mud_trance"))
    assert "phase3.low_mid_energy" in paths
    assert "genre_hint" in paths


def test_resolve_path_states():
    flat = {"phase1": {"true_peak_db": -0.3, "lufs": None}}
    assert resolve_path(flat, "phase1.true_peak_db") == "present"
    assert resolve_path(flat, "phase1.lufs") == "null"
    assert resolve_path(flat, "phase1.missing") == "missing"
    assert resolve_path(flat, "phase2.genre") == "missing"


def test_run_rule_fires_on_clipping():
    flat = {"phase1": {"clipping_detected": True, "clipped_sample_count": 12}}
    out = run_rule(_rule("clipping_detected"), flat)
    assert out["fired"] is True
    assert out["verdict"] is not None
    assert out["error"] is None


def test_run_rule_does_not_fire_when_clean():
    out = run_rule(_rule("clipping_detected"), {"phase1": {"clipping_detected": False}})
    assert out["fired"] is False
    assert out["verdict"] is None


def test_rule_catalog_lists_every_registered_rule():
    cat = rule_catalog()
    names = {e["name"] for e in cat}
    assert "clipping_detected" in names
    assert len(cat) == len(rule_engine._RULES)
    assert all("read_paths" in e for e in cat)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/worker && python -m pytest tests/inspector/test_rule_introspect.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools.inspector.rule_introspect'`.

- [ ] **Step 3: Write minimal implementation**

```python
# components/worker/app/tools/inspector/rule_introspect.py
"""Introspect the rule engine for the inspector.

- `read_paths_for_rule` statically extracts the datapoints a rule reads (so a
  non-firing rule still reveals what it *would* read — the basis for gap
  detection in spec §6.1).
- `run_rule` re-runs a rule deterministically against a flattened final_json.
- `resolve_path` reports whether a datapoint is present / null / missing.
"""
from __future__ import annotations

import ast
import inspect
import textwrap
from typing import Any, Callable

from app.verdict_lib import rule_engine


def _safe_source(fn: Callable) -> str:
    try:
        return textwrap.dedent(inspect.getsource(fn))
    except (OSError, TypeError):
        return ""


class _ReadPathVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.var_to_phase: dict[str, str] = {}
        self.paths: set[str] = set()

    def visit_Assign(self, node: ast.Assign) -> None:
        # X = _phase(analysis, "phaseN")
        v = node.value
        if (
            isinstance(v, ast.Call)
            and isinstance(v.func, ast.Name)
            and v.func.id == "_phase"
            and len(v.args) == 2
            and isinstance(v.args[1], ast.Constant)
            and isinstance(v.args[1].value, str)
        ):
            phase = v.args[1].value
            for tgt in node.targets:
                if isinstance(tgt, ast.Name):
                    self.var_to_phase[tgt.id] = phase
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        # <var>.get("key")  /  analysis.get("key")
        f = node.func
        if (
            isinstance(f, ast.Attribute)
            and f.attr == "get"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            key = node.args[0].value
            if isinstance(f.value, ast.Name):
                base = f.value.id
                if base in self.var_to_phase:
                    self.paths.add(f"{self.var_to_phase[base]}.{key}")
                elif base == "analysis":
                    self.paths.add(key)
        # Evidence(metric="phaseN.key")
        if isinstance(f, ast.Name) and f.id == "Evidence":
            for kw in node.keywords:
                if (
                    kw.arg == "metric"
                    and isinstance(kw.value, ast.Constant)
                    and isinstance(kw.value.value, str)
                ):
                    self.paths.add(kw.value.value)
        self.generic_visit(node)


def read_paths_for_rule(fn: Callable) -> set[str]:
    src = _safe_source(fn)
    if not src:
        return set()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return set()
    visitor = _ReadPathVisitor()
    visitor.visit(tree)
    return visitor.paths


def resolve_path(flattened: dict[str, Any], path: str) -> str:
    cur: Any = flattened
    for seg in path.split("."):
        if not isinstance(cur, dict) or seg not in cur:
            return "missing"
        cur = cur[seg]
    return "null" if cur is None else "present"


def run_rule(fn: Callable, flattened: dict[str, Any]) -> dict[str, Any]:
    try:
        verdict = fn(flattened)
    except Exception as exc:  # a rule that raises on this analysis is itself a finding
        return {"fired": False, "verdict": None, "error": f"{type(exc).__name__}: {exc}"}
    return {"fired": verdict is not None, "verdict": verdict, "error": None}


def rule_catalog() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for fn in rule_engine._RULES:
        out.append({
            "name": fn.__name__,
            "doc": (fn.__doc__ or "").strip(),
            "read_paths": sorted(read_paths_for_rule(fn)),
        })
    return sorted(out, key=lambda e: e["name"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/worker && python -m pytest tests/inspector/test_rule_introspect.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/tools/inspector/rule_introspect.py components/worker/tests/inspector/test_rule_introspect.py
git commit -m "feat(inspector): AST rule read-path extraction + deterministic re-run"
```

---

### Task 3: DB loader (injected session factory)

**Files:**
- Create: `components/worker/app/tools/inspector/loader.py`
- Test: `components/worker/tests/inspector/test_loader.py`

**Interfaces:**
- Consumes: a SQLAlchemy `sessionmaker` (the CLI passes `app.db_sync.SessionFactory`, lazily imported; tests pass a sqlite-bound one), `aimusic_shared.models.Analysis` / `Verdict`.
- Produces:
  - `resolve_analysis_id(session_factory, prefix: str) -> str` — full id string for a unique prefix; raises `LookupError` on 0 or >1 matches.
  - `load_trace(session_factory, analysis_id: str) -> RawTrace` — `RawTrace` is a `dataclass` with `id: str`, `job_id: str`, `song_name: str | None`, `created_at`, `final_json: dict`, `routing_plan: dict | None`, `verdicts: list[dict]` (each verdict row as a plain dict). Raises `LookupError` if the analysis is absent.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/inspector/test_loader.py
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone

import pytest


@pytest.fixture
def sqlite_factory(monkeypatch, tmp_path):
    """sqlite-bound app.db_sync.SessionFactory with the schema created."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'insp.db'}")
    saved = sys.modules.pop("app.db_sync", None)
    import app.db_sync as db_sync  # noqa: PLC0415
    from aimusic_shared.models import Base  # noqa: PLC0415

    Base.metadata.create_all(db_sync.engine)
    yield db_sync.SessionFactory
    if saved is not None:
        sys.modules["app.db_sync"] = saved


def _seed_analysis(factory, **over):
    from aimusic_shared.models import Analysis  # noqa: PLC0415
    aid = over.get("id", uuid.uuid4())
    with factory.begin() as s:
        s.add(Analysis(
            id=aid,
            job_id=over.get("job_id", uuid.uuid4()),
            user_id=uuid.uuid4(),
            song_name=over.get("song_name", "Test Song"),
            final_json=over.get("final_json", {"grade": "F", "phases": []}),
            phase_durations={},
            routing_plan=over.get("routing_plan"),
            created_at=datetime.now(timezone.utc),
        ))
    return str(aid)


def test_load_trace_returns_core_fields(sqlite_factory):
    from app.tools.inspector.loader import load_trace
    aid = _seed_analysis(sqlite_factory, song_name="Track 23-44",
                         final_json={"grade": "F", "phases": [{"phase": 1, "data": {"lufs": -9.0}}]})
    trace = load_trace(sqlite_factory, aid)
    assert trace.song_name == "Track 23-44"
    assert trace.final_json["grade"] == "F"
    assert trace.verdicts == []


def test_resolve_prefix_unique(sqlite_factory):
    from app.tools.inspector.loader import resolve_analysis_id
    aid = _seed_analysis(sqlite_factory)
    assert resolve_analysis_id(sqlite_factory, aid[:8]) == aid


def test_resolve_prefix_no_match_raises(sqlite_factory):
    from app.tools.inspector.loader import resolve_analysis_id
    _seed_analysis(sqlite_factory)
    with pytest.raises(LookupError):
        resolve_analysis_id(sqlite_factory, "ffffffff")


def test_load_trace_missing_raises(sqlite_factory):
    from app.tools.inspector.loader import load_trace
    with pytest.raises(LookupError):
        load_trace(sqlite_factory, str(uuid.uuid4()))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/worker && python -m pytest tests/inspector/test_loader.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools.inspector.loader'`.

- [ ] **Step 3: Write minimal implementation**

```python
# components/worker/app/tools/inspector/loader.py
"""Read-only DB loader for the inspector.

The SQLAlchemy ``sessionmaker`` is injected so this module never imports
``app.db_sync`` (which binds an engine at import and needs DATABASE_URL). The
CLI passes ``app.db_sync.SessionFactory`` lazily; tests pass a sqlite one.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select

from aimusic_shared.models import Analysis, Verdict


@dataclass
class RawTrace:
    id: str
    job_id: str
    song_name: str | None
    created_at: datetime | None
    final_json: dict[str, Any]
    routing_plan: dict[str, Any] | None
    verdicts: list[dict[str, Any]]


_VERDICT_COLS = (
    "id", "specialist", "prompt_version", "model", "severity", "category",
    "confidence", "priority_score", "headline", "summary", "metric_line",
    "why_it_matters", "evidence", "fix", "sources",
)


def resolve_analysis_id(session_factory, prefix: str) -> str:
    # Fetch ids and match the prefix in Python so the logic is identical on
    # sqlite (tests) and Postgres (prod) without dialect-specific text casts.
    # Acceptable for a dev tool; the table is small in dev/debug use.
    prefix = prefix.strip()
    with session_factory() as s:
        rows = s.execute(select(Analysis.id)).scalars().all()
    matches = [str(r) for r in rows if str(r).startswith(prefix)]
    if len(matches) == 1:
        return matches[0]
    raise LookupError(
        f"analysis id prefix {prefix!r} matched {len(matches)} rows (need exactly 1)"
    )


def load_trace(session_factory, analysis_id: str) -> RawTrace:
    aid = uuid.UUID(analysis_id)
    with session_factory() as s:
        a = s.get(Analysis, aid)
        if a is None:
            raise LookupError(f"analysis {analysis_id} not found")
        vrows = s.execute(
            select(Verdict).where(Verdict.analysis_id == aid)
        ).scalars().all()
        verdicts = [{c: getattr(v, c) for c in _VERDICT_COLS} for v in vrows]
        return RawTrace(
            id=str(a.id),
            job_id=str(a.job_id),
            song_name=a.song_name,
            created_at=a.created_at,
            final_json=a.final_json if isinstance(a.final_json, dict) else {},
            routing_plan=a.routing_plan if isinstance(a.routing_plan, dict) else None,
            verdicts=verdicts,
        )
```

> Note: `resolve_analysis_id` deliberately fetches ids and filters the prefix in Python so it behaves identically on sqlite (tests) and Postgres (prod) without dialect-specific text casts.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/worker && python -m pytest tests/inspector/test_loader.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/tools/inspector/loader.py components/worker/tests/inspector/test_loader.py
git commit -m "feat(inspector): read-only DB loader with injected session factory"
```

---

### Task 4: View-model builder (catalog + trace)

**Files:**
- Create: `components/worker/app/tools/inspector/build.py`
- Test: `components/worker/tests/inspector/test_build.py`

**Interfaces:**
- Consumes: `stage_map` (`STAGE_MAP`, `stage_for_path`, `declared_output_paths`), `rule_introspect` (`rule_catalog`, `read_paths_for_rule`, `run_rule`, `resolve_path`), `app.verdict_lib.flatten_analysis.flatten`, `app.verdict_lib.prompt_loader.SPECIALIST_SLUGS`, `loader.RawTrace`.
- Produces (both return JSON-able `dict`s; keys are the rendering contract for Task 5):
  - `build_catalog_model() -> dict` with keys: `mode="catalog"`, `stages` (list of `{key,title,narration,inputs,outputs}`), `rules` (list of `{name,doc,read_paths,producers}` where `producers` maps each read-path → producing stage key or `None`), `specialists` (sorted list of slugs), `datapoint_consumers` (list of `{datapoint, producer, consumers}`), `static_gaps` (`{unmapped_rule_paths: list[{rule,path}]}`).
  - `build_trace_model(raw: RawTrace) -> dict` — superset of the catalog model with `mode="trace"`, `header` (`{id,job_id,song_name,created_at,overall_score,grade}`), per-rule `fired`/`error`/`path_resolution` overlay, `routing_plan`, `specialist_status` (slug → `ran`/`not_selected`), and `verdicts` (the persisted rows).

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/inspector/test_build.py
from __future__ import annotations

from datetime import datetime, timezone

from app.tools.inspector.build import build_catalog_model, build_trace_model
from app.tools.inspector.loader import RawTrace


def test_catalog_model_lists_rules_and_specialists():
    m = build_catalog_model()
    assert m["mode"] == "catalog"
    assert any(r["name"] == "clipping_detected" for r in m["rules"])
    assert "loudness" in m["specialists"]
    assert any(s["key"] == "phase1" for s in m["stages"])


def test_catalog_flags_unmapped_rule_paths_statically():
    # loudness rules read phase1.integrated_lufs, which no stage declares
    # (Phase 1 emits phase1.lufs) — must be flagged with no analysis.
    m = build_catalog_model()
    unmapped = {g["path"] for g in m["static_gaps"]["unmapped_rule_paths"]}
    assert "phase1.integrated_lufs" in unmapped


def test_trace_model_marks_fired_rule_and_header():
    raw = RawTrace(
        id="11111111-1111-1111-1111-111111111111",
        job_id="22222222-2222-2222-2222-222222222222",
        song_name="T",
        created_at=datetime(2026, 6, 17, tzinfo=timezone.utc),
        final_json={"overall_score": 42.0, "grade": "F", "phases": [
            {"phase": 1, "data": {"clipping_detected": True, "clipped_sample_count": 9}},
        ]},
        routing_plan={"specialists_to_run": [{"name": "loudness"}], "skip": [], "rationale": "x"},
        verdicts=[],
    )
    m = build_trace_model(raw)
    assert m["mode"] == "trace"
    assert m["header"]["grade"] == "F"
    fired = {r["name"]: r["fired"] for r in m["rules"]}
    assert fired["clipping_detected"] is True
    assert m["specialist_status"]["loudness"] == "ran"
    assert m["specialist_status"]["dynamics"] == "not_selected"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/worker && python -m pytest tests/inspector/test_build.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools.inspector.build'`.

- [ ] **Step 3: Write minimal implementation**

```python
# components/worker/app/tools/inspector/build.py
"""Assemble JSON-able view models for the inspector (catalog + trace)."""
from __future__ import annotations

from typing import Any

from app.verdict_lib.flatten_analysis import flatten
from app.verdict_lib.prompt_loader import SPECIALIST_SLUGS
from app.verdict_lib import rule_engine

from .loader import RawTrace
from .rule_introspect import read_paths_for_rule, resolve_path, rule_catalog, run_rule
from .stage_map import STAGE_MAP, declared_output_paths, stage_for_path


def _stages_view() -> list[dict[str, Any]]:
    return [
        {"key": s.key, "title": s.title, "narration": s.narration,
         "inputs": list(s.inputs), "outputs": list(s.outputs)}
        for s in STAGE_MAP
    ]


def _rules_with_producers() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for entry in rule_catalog():
        producers = {p: stage_for_path(p) for p in entry["read_paths"]}
        out.append({**entry, "producers": producers})
    return out


def _datapoint_consumers() -> list[dict[str, Any]]:
    # Map every declared output → its producer + the rules that read it.
    rule_reads = {fn.__name__: read_paths_for_rule(fn) for fn in rule_engine._RULES}
    rows: list[dict[str, Any]] = []
    for dp in sorted(declared_output_paths()):
        consumers = sorted(name for name, paths in rule_reads.items() if dp in paths)
        rows.append({"datapoint": dp, "producer": stage_for_path(dp), "consumers": consumers})
    return rows


def _static_gaps(rules: list[dict[str, Any]]) -> dict[str, Any]:
    unmapped = [
        {"rule": r["name"], "path": path}
        for r in rules
        for path, producer in r["producers"].items()
        if producer is None and "." in path  # ignore bare top-level keys (genre_hint, track_id)
    ]
    return {"unmapped_rule_paths": unmapped}


def build_catalog_model() -> dict[str, Any]:
    rules = _rules_with_producers()
    return {
        "mode": "catalog",
        "stages": _stages_view(),
        "rules": rules,
        "specialists": sorted(SPECIALIST_SLUGS),
        "datapoint_consumers": _datapoint_consumers(),
        "static_gaps": _static_gaps(rules),
    }


def build_trace_model(raw: RawTrace) -> dict[str, Any]:
    model = build_catalog_model()
    model["mode"] = "trace"

    flat = flatten(raw.final_json)
    flat.setdefault("track_id", raw.id)

    # Per-rule overlay: fired/not + per-path resolution.
    for r in model["rules"]:
        fn = next(f for f in rule_engine._RULES if f.__name__ == r["name"])
        run = run_rule(fn, flat)
        r["fired"] = run["fired"]
        r["error"] = run["error"]
        r["path_resolution"] = {p: resolve_path(flat, p) for p in r["read_paths"]}

    # Header.
    model["header"] = {
        "id": raw.id,
        "job_id": raw.job_id,
        "song_name": raw.song_name,
        "created_at": raw.created_at.isoformat() if raw.created_at else None,
        "overall_score": raw.final_json.get("overall_score"),
        "grade": raw.final_json.get("grade"),
    }

    # Routing + specialist status.
    model["routing_plan"] = raw.routing_plan
    selected = set()
    if isinstance(raw.routing_plan, dict):
        for item in raw.routing_plan.get("specialists_to_run") or []:
            name = item.get("name") if isinstance(item, dict) else item
            if name:
                selected.add(name)
    model["specialist_status"] = {
        slug: ("ran" if slug in selected else "not_selected")
        for slug in sorted(SPECIALIST_SLUGS)
    }
    model["verdicts"] = raw.verdicts
    return model
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/worker && python -m pytest tests/inspector/test_build.py -v`
Expected: PASS (3 tests). The unmapped-path test confirms the §1 motivating gap (`phase1.integrated_lufs`) is detected statically.

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/tools/inspector/build.py components/worker/tests/inspector/test_build.py
git commit -m "feat(inspector): catalog + trace view-model builder with static gap detection"
```

---

### Task 5: HTML renderer

**Files:**
- Create: `components/worker/app/tools/inspector/render.py`
- Test: `components/worker/tests/inspector/test_render.py`

**Interfaces:**
- Consumes: the model dicts from Task 4.
- Produces: `render_html(model: dict) -> str` — a complete self-contained HTML document. Inline `<style>`, `<details>` for raw JSON, `html.escape` on all dynamic text. Renders the §8 disclaimer banner when `model["mode"] == "trace"`.

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/inspector/test_render.py
from __future__ import annotations

from app.tools.inspector.build import build_catalog_model
from app.tools.inspector.render import render_html


def test_render_catalog_is_self_contained_html():
    html_out = render_html(build_catalog_model())
    assert html_out.lstrip().startswith("<!DOCTYPE html>")
    assert "Pipeline & rule-system catalog" in html_out
    assert "clipping_detected" in html_out
    assert "http://" not in html_out and "https://" not in html_out  # no external assets


def test_trace_render_includes_disclaimer_banner():
    model = build_catalog_model()
    model["mode"] = "trace"
    model["header"] = {"id": "abc", "job_id": "j", "song_name": "S",
                       "created_at": None, "overall_score": 42.0, "grade": "F"}
    model["routing_plan"] = None
    model["specialist_status"] = {}
    model["verdicts"] = []
    for r in model["rules"]:
        r.setdefault("fired", False)
        r.setdefault("error", None)
        r.setdefault("path_resolution", {})
    out = render_html(model)
    assert "Recomputed with current code" in out


def test_render_escapes_dynamic_text():
    model = build_catalog_model()
    model["stages"].append({"key": "x", "title": "<script>alert(1)</script>",
                            "narration": "n", "inputs": [], "outputs": []})
    out = render_html(model)
    assert "<script>alert(1)</script>" not in out
    assert "&lt;script&gt;" in out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/worker && python -m pytest tests/inspector/test_render.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools.inspector.render'`.

- [ ] **Step 3: Write minimal implementation**

```python
# components/worker/app/tools/inspector/render.py
"""Render an inspector view model into a single self-contained HTML page."""
from __future__ import annotations

import html
import json
from typing import Any

_CSS = """
body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#0d1117;color:#e6edf3}
header{padding:16px 24px;background:#161b22;border-bottom:1px solid #30363d}
h1{font-size:18px;margin:0 0 4px}
section{padding:16px 24px;border-bottom:1px solid #21262d}
h2{font-size:15px;color:#7ee787;margin:0 0 8px}
.narration{color:#9da7b3;margin:0 0 10px;max-width:80ch}
.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;margin:6px 0}
.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;margin-left:6px}
.fired{background:#1f6f3f;color:#d6ffe0}.idle{background:#30363d;color:#9da7b3}
.missing{background:#7d1f1f;color:#ffd6d6}.null{background:#7d6a1f;color:#fff4d6}
.present{background:#1f4f7d;color:#d6ecff}
.warn{background:#3d2a00;border:1px solid #9e6a00;color:#ffd98a;padding:10px 12px;border-radius:6px;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border:1px solid #30363d;padding:4px 8px;text-align:left;vertical-align:top}
code,pre{font-family:ui-monospace,monospace}
pre{white-space:pre-wrap;background:#0d1117;padding:8px;border-radius:6px;border:1px solid #30363d}
summary{cursor:pointer;color:#58a6ff}
"""

_DISCLAIMER = (
    "⚠️ Recomputed with current code. Deterministic stages (rule engine, "
    "validation, severity scoring) are re-run against the stored final_json "
    "using the CURRENT module versions, which may differ from the code that "
    "produced this analysis. LLM stages (triage, specialists) are shown from "
    "persisted data, not re-run. Treat stored-vs-recomputed drift as a signal."
)


def _e(x: Any) -> str:
    return html.escape("" if x is None else str(x))


def _details(summary: str, body_html: str) -> str:
    return f"<details><summary>{_e(summary)}</summary>{body_html}</details>"


def _json_block(obj: Any) -> str:
    return f"<pre>{_e(json.dumps(obj, indent=2, default=str))}</pre>"


def _stage_card(s: dict[str, Any]) -> str:
    io = ""
    if s["inputs"] or s["outputs"]:
        io = (f"<div><b>in:</b> <code>{_e(', '.join(s['inputs']))}</code><br>"
              f"<b>out:</b> <code>{_e(', '.join(s['outputs']))}</code></div>")
    return (f"<div class='card'><b>{_e(s['title'])}</b>"
            f"<p class='narration'>{_e(s['narration'])}</p>{io}</div>")


def _rule_card(r: dict[str, Any], trace: bool) -> str:
    head = f"<b>{_e(r['name'])}</b>"
    if trace:
        head += (f"<span class='badge {'fired' if r.get('fired') else 'idle'}'>"
                 f"{'FIRED' if r.get('fired') else 'idle'}</span>")
    rows = ""
    res = r.get("path_resolution", {}) if trace else {}
    for p in r["read_paths"]:
        producer = r["producers"].get(p)
        prod_txt = _e(producer) if producer else "<span class='badge missing'>unmapped</span>"
        state = res.get(p)
        state_txt = f"<span class='badge {state}'>{_e(state)}</span>" if state else ""
        rows += f"<tr><td><code>{_e(p)}</code></td><td>{prod_txt}</td><td>{state_txt}</td></tr>"
    table = (f"<table><tr><th>reads</th><th>produced by</th><th>value</th></tr>{rows}</table>"
             if r["read_paths"] else "<i>no datapoints extracted</i>")
    doc = f"<p class='narration'>{_e(r['doc'])}</p>" if r.get("doc") else ""
    return f"<div class='card'>{head}{doc}{table}</div>"


def _section(title: str, body: str) -> str:
    return f"<section><h2>{_e(title)}</h2>{body}</section>"


def render_html(model: dict[str, Any]) -> str:
    trace = model.get("mode") == "trace"
    parts: list[str] = []

    if trace:
        h = model.get("header", {})
        title = f"Analysis {_e(h.get('id'))} — {_e(h.get('song_name'))}"
        sub = (f"job {_e(h.get('job_id'))} · {_e(h.get('created_at'))} · "
               f"score {_e(h.get('overall_score'))} · grade {_e(h.get('grade'))}")
        banner = f"<div class='warn'>{_e(_DISCLAIMER)}</div>"
    else:
        title = "Pipeline & rule-system catalog — no analysis"
        sub = "static structure of every stage, rule, and specialist"
        banner = ""

    parts.append(f"<header><h1>{title}</h1><div class='narration'>{sub}</div>{banner}</header>")

    parts.append(_section("Pipeline stages", "".join(_stage_card(s) for s in model["stages"])))
    parts.append(_section("Rule engine", "".join(_rule_card(r, trace) for r in model["rules"])))

    spec_body = ", ".join(
        f"{_e(slug)}"
        + (f" <span class='badge {'fired' if model['specialist_status'].get(slug)=='ran' else 'idle'}'>"
           f"{_e(model['specialist_status'].get(slug))}</span>" if trace else "")
        for slug in model["specialists"]
    )
    parts.append(_section("Specialists", f"<div class='card'>{spec_body}</div>"))

    if trace:
        parts.append(_section("Triage routing plan",
                              _json_block(model.get("routing_plan")) if model.get("routing_plan")
                              else "<i>no LLM stage ran (routing_plan is null)</i>"))
        parts.append(_section("Final verdicts", _json_block(model.get("verdicts"))))

    dc_rows = "".join(
        f"<tr><td><code>{_e(d['datapoint'])}</code></td><td>{_e(d['producer'])}</td>"
        f"<td>{_e(', '.join(d['consumers']) or '—')}</td></tr>"
        for d in model["datapoint_consumers"]
    )
    parts.append(_section("Datapoint → consumers",
                          f"<table><tr><th>datapoint</th><th>producer</th><th>consumed by</th></tr>{dc_rows}</table>"))

    gaps = model["static_gaps"]["unmapped_rule_paths"]
    gap_body = ("".join(f"<div class='card'><code>{_e(g['path'])}</code> read by "
                        f"<b>{_e(g['rule'])}</b> — no stage emits this; rule can't fire.</div>"
                        for g in gaps)
                if gaps else "<i>no unmapped rule read-paths 🎉</i>")
    parts.append(_section("System audit — gaps", gap_body))

    return (f"<!DOCTYPE html><html><head><meta charset='utf-8'>"
            f"<title>{title}</title><style>{_CSS}</style></head>"
            f"<body>{''.join(parts)}</body></html>")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/worker && python -m pytest tests/inspector/test_render.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/tools/inspector/render.py components/worker/tests/inspector/test_render.py
git commit -m "feat(inspector): self-contained HTML renderer with required disclaimer"
```

---

### Task 6: CLI entry point (trace / catalog / validate-map)

**Files:**
- Create: `components/worker/app/tools/pipeline_inspector.py`
- Test: `components/worker/tests/inspector/test_cli.py`

**Interfaces:**
- Consumes: all prior modules. Lazily imports `app.db_sync` ONLY inside the trace branch.
- Produces:
  - `main(argv: list[str] | None = None) -> int` — process exit code.
  - Modes: `<analysis_id>` (trace) → writes `<short_id>.html`; `--catalog` → writes `_catalog.html`; `--validate-map [<analysis_id>]` → prints drift, returns non-zero if any. `--open` opens the file via `webbrowser`. `--out-dir` overrides the output directory (default per Global Constraints).

- [ ] **Step 1: Write the failing test**

```python
# components/worker/tests/inspector/test_cli.py
from __future__ import annotations

from pathlib import Path

from app.tools.pipeline_inspector import main


def test_catalog_mode_writes_html_without_db(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)  # prove no DB needed
    rc = main(["--catalog", "--out-dir", str(tmp_path)])
    assert rc == 0
    out = Path(tmp_path) / "_catalog.html"
    assert out.exists()
    assert "Pipeline & rule-system catalog" in out.read_text(encoding="utf-8")


def test_validate_map_with_clean_snapshot_returns_zero(tmp_path, monkeypatch):
    # A snapshot whose only phase1 keys are all declared → no stale/missing.
    import json
    snap = Path(tmp_path) / "snap.json"
    snap.write_text(json.dumps({
        "overall_score": 1, "grade": "F", "danceability_score": 0,
        "top_fixes": [], "coach_name": "c", "coach_intro": "i", "coached_fixes": [],
        "phases": [{"phase": 1, "data": {"lufs": -9.0, "true_peak_db": -1.0}}],
    }), encoding="utf-8")
    rc = main(["--validate-map", "--snapshot", str(snap)])
    # phase1 present but map declares more keys than snapshot has → phantom →
    # non-zero. This asserts the gate trips on drift.
    assert rc != 0


def test_unknown_arg_combo_errors(tmp_path):
    rc = main(["--validate-map", "--snapshot", str(tmp_path / "nope.json")])
    assert rc != 0
```

> Note: the validate test uses `--snapshot <file>` (a committed/temp `final_json`) as the DB-free source of truth. The CLI also accepts `--validate-map <analysis_id>` to pull from the DB; that DB path is covered by manual smoke (Step 6), not unit tests, since it needs Postgres.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/worker && python -m pytest tests/inspector/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools.pipeline_inspector'`.

- [ ] **Step 3: Write minimal implementation**

```python
# components/worker/app/tools/pipeline_inspector.py
"""Pipeline Inspector CLI.

Trace mode:    python -m app.tools.pipeline_inspector <analysis_id> [--open]
Catalog mode:  python -m app.tools.pipeline_inspector --catalog [--open]
Validate map:  python -m app.tools.pipeline_inspector --validate-map [<analysis_id>|--snapshot FILE]

Catalog + snapshot-validate run with NO database. db_sync is imported lazily,
only when a DB read is actually required.
"""
from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from datetime import datetime
from pathlib import Path

from app.tools.inspector.build import build_catalog_model, build_trace_model
from app.tools.inspector.render import render_html
from app.tools.inspector.stage_map import diff_against_final_json


def _default_out_dir() -> Path:
    date = datetime.now().strftime("%Y-%m-%d")
    # components/worker/app/tools/pipeline_inspector.py → repo output/worker/...
    repo = Path(__file__).resolve().parents[4]
    return repo / "output" / "worker" / f"{date}_pipeline_inspector"


def _write(out_dir: Path, name: str, html_text: str, do_open: bool) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(html_text, encoding="utf-8")
    if do_open:
        webbrowser.open(path.as_uri())
    return path


def _session_factory():
    """Lazy import — only call inside DB-backed branches."""
    from app.db_sync import SessionFactory  # noqa: PLC0415
    return SessionFactory


def _run_validate(args) -> int:
    if args.snapshot:
        final_json = json.loads(Path(args.snapshot).read_text(encoding="utf-8"))
    else:
        from app.tools.inspector.loader import load_trace, resolve_analysis_id  # noqa: PLC0415
        factory = _session_factory()
        aid = resolve_analysis_id(factory, args.target) if args.target else None
        if aid is None:
            print("--validate-map needs an <analysis_id> or --snapshot FILE", file=sys.stderr)
            return 2
        final_json = load_trace(factory, aid).final_json
    stale_missing, phantom = diff_against_final_json(final_json)
    if not stale_missing and not phantom:
        print("stage map is in sync with the snapshot ✓")
        return 0
    if stale_missing:
        print("STALE/MISSING (pipeline emits, map omits):")
        for p in stale_missing:
            print(f"  + {p}")
    if phantom:
        print("PHANTOM (map declares, snapshot lacks):")
        for p in phantom:
            print(f"  - {p}")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline_inspector")
    parser.add_argument("target", nargs="?", help="analysis id (or unique prefix)")
    parser.add_argument("--catalog", action="store_true", help="render catalog only (no DB)")
    parser.add_argument("--validate-map", action="store_true", help="check stage map vs a real final_json")
    parser.add_argument("--snapshot", help="path to a final_json for --validate-map")
    parser.add_argument("--out-dir", help="override output directory")
    parser.add_argument("--open", action="store_true", help="open the result in a browser")
    args = parser.parse_args(argv)

    try:
        if args.validate_map:
            return _run_validate(args)

        out_dir = Path(args.out_dir) if args.out_dir else _default_out_dir()

        if args.catalog:
            html_text = render_html(build_catalog_model())
            path = _write(out_dir, "_catalog.html", html_text, args.open)
            print(f"wrote {path}")
            return 0

        if not args.target:
            parser.error("provide <analysis_id>, --catalog, or --validate-map")

        from app.tools.inspector.loader import load_trace, resolve_analysis_id  # noqa: PLC0415
        factory = _session_factory()
        aid = resolve_analysis_id(factory, args.target)
        raw = load_trace(factory, aid)
        html_text = render_html(build_trace_model(raw))
        path = _write(out_dir, f"{aid[:8]}.html", html_text, args.open)
        print(f"wrote {path}")
        return 0
    except LookupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/worker && python -m pytest tests/inspector/test_cli.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full inspector suite + lint/type gates**

Run:
```bash
cd components/worker && python -m pytest tests/inspector/ -v
ruff check app/tools/
mypy app/tools/ --ignore-missing-imports
```
Expected: all inspector tests PASS; ruff clean; mypy clean.

- [ ] **Step 6: Manual smoke against the real DB (the analysis from this session)**

Run (worker env, Postgres up):
```bash
cd components/worker
DATABASE_URL="postgresql+psycopg2://spectr:spectr@localhost:5432/spectr" \
  python -m app.tools.pipeline_inspector 8aeef3b4 --open
DATABASE_URL="postgresql+psycopg2://spectr:spectr@localhost:5432/spectr" \
  python -m app.tools.pipeline_inspector --validate-map 8aeef3b4
python -m app.tools.pipeline_inspector --catalog --open
```
Expected: a trace HTML for analysis `8aeef3b4…` opens; catalog HTML opens; `--validate-map` prints any real drift (this is the live confirmation of the §1 rule mismatches).

- [ ] **Step 7: Commit**

```bash
git add components/worker/app/tools/pipeline_inspector.py components/worker/tests/inspector/test_cli.py
git commit -m "feat(inspector): CLI for trace/catalog/validate-map modes"
```

---

### Task 7: Docs + spec close-out

**Files:**
- Modify: `components/worker/README.md` (add a "Pipeline Inspector (dev tool)" section)
- Modify: `docs/superpowers/specs/2026-06-25-pipeline-inspector-design.md` (flip Status to "Implemented")

**Interfaces:** none.

- [ ] **Step 1: Add a README section**

Document the three invocations, the output location, and the "recomputed with current code" caveat. Example block to insert under a new `## Pipeline Inspector (dev tool)` heading:

```markdown
## Pipeline Inspector (dev tool)

Render the full input→output trace of one analysis, overlaid on the catalog of
all rules + specialists, to find rule-system gaps. Read-only.

    # one analysis (needs DATABASE_URL → Postgres)
    python -m app.tools.pipeline_inspector <analysis_id|prefix> --open
    # static catalog, no DB
    python -m app.tools.pipeline_inspector --catalog --open
    # check the §6 stage map hasn't drifted from real output
    python -m app.tools.pipeline_inspector --validate-map <analysis_id|--snapshot FILE>

Output: `output/worker/<date>_pipeline_inspector/`. Deterministic stages (rules,
validation, scoring) are recomputed with CURRENT code; LLM stages (triage,
specialists) are shown from persisted data. See
`docs/superpowers/specs/2026-06-25-pipeline-inspector-design.md`.
```

- [ ] **Step 2: Flip the spec status**

Change the spec header line `**Status:** Approved (pre-implementation)` → `**Status:** Implemented (2026-06-25)`.

- [ ] **Step 3: Commit**

```bash
git add components/worker/README.md docs/superpowers/specs/2026-06-25-pipeline-inspector-design.md
git commit -m "docs(inspector): document the dev tool + mark spec implemented"
```

---

## Notes for the implementer

- **Run rules against the FLATTENED analysis**, never the raw `final_json` (rules address `phaseN.*` keys produced by `flatten()`). Task 4 does this; don't bypass it.
- **Never import `app.db_sync` at module top** anywhere in `app/tools/inspector/`. Only `pipeline_inspector._session_factory()` and the loader (via injected factory) touch the DB. This is what keeps catalog mode + snapshot-validate DB-free; the `test_catalog_mode_writes_html_without_db` test enforces it.
- The §1 rule mismatches (`phase1.integrated_lufs`, `phase2.stereo_correlation`, `phase1.crest_factor`, …) are **expected findings**, not bugs to fix here. Task 4's static-gap test asserts at least one of them is detected. Fixing the rules is explicitly out of scope (spec §2).
- If a future pipeline change adds a phase output, `--validate-map` (and the optional CI test from spec §9) will flag the §6 `STAGE_MAP` as stale — update `stage_map.py` in the same change.
- **Scoped down from spec §6b/§7-3d (validator-recompute drift):** the `verdicts` table stores only the *post-validation* verdict (already downgraded/scored); the *pre-validation* LLM output is not persisted. So re-running the validator over persisted rows is a near-no-op and yields no meaningful "stored vs recomputed" drift. This plan therefore delivers the fully-deterministic, high-value recompute — the **rule engine** (Task 4 overlay) — and renders the validation stage as documented narration + the final persisted verdicts (Task 5). True validator-drift detection depends on persisting pre-validation output, which is part of the **versioning-analyses follow-up** (spec §10). The spec has been narrowed to match.
```
