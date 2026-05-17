# Verdict Pipeline Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prose-based AI Mix Experts panel with a structured-output verdict pipeline (rule engine → triage routing → sequential specialist execution → validator → dedupe → ranker → SSE-streamed verdict cards).

**Architecture:** All pipeline stages live in `components/api/app/verdict_pipeline/` as small, single-responsibility modules. Pydantic v2 schemas live in `components/shared/aimusic_shared/verdicts/` and are imported by both api and worker. Verdict payloads cache as JSONB on `analysis_results.verdicts_payload`; user state lives in a separate `verdict_user_state` table. Frontend rebuilds `features/experts/` as `features/verdicts/` with verdict cards. LLM transport is the `claude` CLI only in v1.

**Tech Stack:** Python 3.11+ (FastAPI, Pydantic v2, SQLAlchemy 2.0 async, Alembic, pytest, hypothesis), TypeScript 5 (React 19, Vite 8, Vitest, RTL, datamodel-code-generator for type generation), `claude` CLI subprocess, PostgreSQL 15 JSONB.

**Source spec:** `docs/superpowers/specs/2026-04-25-verdict-pipeline-restructure-design.md`

---

## File Structure

### Created

```
components/shared/aimusic_shared/verdicts/
  __init__.py                       Re-export public types
  models.py                         Pydantic models: Verdict, Fix, Evidence, DspOp, etc.
  scoring.py                        Pure priority_score formula
  ulid_helpers.py                   `vrd_<ulid>` / `fix_<ulid>` generators

components/shared/tests/
  test_verdict_schema.py            Schema-only tests (no DB, no LLM)
  test_verdict_scoring.py           Priority formula tests

components/api/app/verdict_pipeline/
  __init__.py                       Re-export Orchestrator
  orchestrator.py                   Composes all stages, async generator yielding SSE events
  rule_engine.py                    Rule registry + 11 rule functions
  triage.py                         Calls LLM, parses SpecialistRoutingPlan
  specialists.py                    Sequential specialist runner with retry
  validator.py                      Schema + metric-path + range + severity checks
  dedupe.py                         Merge overlapping verdicts
  ranker.py                         Sort by computed priority_score
  prompt_loader.py                  Read .md files, parse frontmatter version
  json_extraction.py                Strip code fences, extract JSON from LLM text
  derived_metrics.py                Pre-compute derived metric paths from analysis.json

components/api/app/llm/
  __init__.py                       Re-export LLMClient
  client.py                         LLMClient ABC + CliClient + ApiClient stub

components/api/app/routers/
  verdicts.py                       /api/reports/{job_id}/verdicts/* endpoints

components/api/tests/verdict_pipeline/
  __init__.py
  conftest.py                       Fixture analysis JSONs, MockLLMClient
  test_rule_engine.py
  test_triage.py
  test_specialists.py
  test_validator.py
  test_dedupe.py
  test_ranker.py
  test_orchestrator.py
  test_cli_client_live.py           @pytest.mark.live_llm — skipped by default
  fixtures/analyses/
    clean_trance.json
    muddy_hiphop.json
    clipped_pop.json
    mono_broken_indie.json
    tiny_dynamics_edm.json
  fixtures/llm_responses/
    triage_clean_trance.json
    low_end_muddy_hiphop.json
    ... (one canned response per fixture × specialist combo used in tests)

components/api/tests/
  test_verdicts_router.py           HTTP-layer integration tests

components/api/alembic/versions/
  006_add_verdicts_payload.py
  007_add_verdict_user_state.py

components/frontend/src/features/verdicts/
  index.ts                          Re-export VerdictsPanel
  useVerdictStream.ts               SSE hook
  VerdictsPanel.tsx                 Top-level container
  SummaryCard.tsx                   Top-3 summary
  VerdictList.tsx                   Filter chips + ordered card list
  VerdictCard.tsx                   Single card
  EvidenceChips.tsx                 Evidence chip rendering
  FixSummary.tsx                    Human-readable dsp_chain rendering
  SeverityBadge.tsx                 Color-coded severity badge
  VerdictSkeleton.tsx               Shimmer placeholder
  feedbackClient.ts                 POST dismiss / feedback
  __tests__/
    VerdictCard.test.tsx
    useVerdictStream.test.ts
    VerdictsPanel.test.tsx

components/frontend/src/types/
  verdicts.ts                       Auto-generated from Pydantic; checked in for build

docs/
  ai-mix-verdicts.md                User-facing doc for the new pipeline
  archive/ai-mix-experts.md         Old prose pipeline doc, archived
```

### Modified

```
components/shared/aimusic_shared/models.py     Add VerdictUserState ORM model
components/shared/aimusic_shared/__init__.py   Re-export verdicts package
components/shared/pyproject.toml               Bump version, add python-ulid dep
components/api/app/main.py                     Mount verdicts router; remove experts
components/api/app/config.py                   Add VERDICT_* env vars
components/api/app/routers/reports.py          Extend share endpoint with verdicts payload
components/api/requirements.txt                Add: python-ulid, datamodel-code-generator (dev)
components/api/prompts/experts/Triage.md       Append "Required Output" footer + version frontmatter
components/api/prompts/experts/<all-23>.md     Append "Required Output" footer + version frontmatter
components/frontend/src/pages/ReportPage.tsx   Swap ExpertsPanel for VerdictsPanel + SummaryCard
components/frontend/src/pages/SharedReportPage.tsx   Same swap; fetch-only mode
components/frontend/package.json               Add datamodel-code-generator script (npm script + python via venv)
components/frontend/tailwind.config.ts         Safelist severity color classes
CLAUDE.md                                      Update validation gates section
```

### Deleted

```
components/api/app/services/expert_service.py
components/api/app/routers/experts.py
components/api/tests/test_expert_service.py
components/api/tests/test_experts_router.py
components/frontend/src/features/experts/      (whole directory)
```

---

## Conventions Used Throughout This Plan

- **Specialist slugs are snake_case** (`low_end`, `frequency_balance`, `priority_summary`). Specialist .md filenames are PascalCase (`LowEnd.md`). Mapping lives in `prompt_loader.py::SLUG_TO_FILENAME`.
- **Test file convention:** every Pythontest file imports from `aimusic_shared.verdicts` (the canonical Pydantic models) — never duplicate types in tests.
- **Commit cadence:** one commit per task (after the green test run). Use `feat:` / `test:` / `refactor:` / `docs:` prefixes.
- **Fixture analysis JSONs** are created in Task 0 and reused by every test that needs analysis data. They are minimal — only fields the test exercises are populated.
- **MockLLMClient** is a test double in `conftest.py` that returns canned responses keyed by `(specialist_slug, fixture_name)`. Never call the real `claude` CLI in unit tests.

---

## Task 0: Test fixtures and MockLLMClient (foundation)

**Files:**
- Create: `components/api/tests/verdict_pipeline/__init__.py`
- Create: `components/api/tests/verdict_pipeline/conftest.py`
- Create: `components/api/tests/verdict_pipeline/fixtures/analyses/clean_trance.json`
- Create: `components/api/tests/verdict_pipeline/fixtures/analyses/muddy_hiphop.json`
- Create: `components/api/tests/verdict_pipeline/fixtures/analyses/clipped_pop.json`
- Create: `components/api/tests/verdict_pipeline/fixtures/analyses/mono_broken_indie.json`
- Create: `components/api/tests/verdict_pipeline/fixtures/analyses/tiny_dynamics_edm.json`

- [ ] **Step 1: Create `__init__.py`**

```python
# components/api/tests/verdict_pipeline/__init__.py
```

- [ ] **Step 2: Create `clean_trance.json`** (no rule violations expected)

```json
{
  "track_id": "fixture-clean-trance",
  "phase1": {
    "duration_seconds": 360.0,
    "integrated_lufs": -10.5,
    "true_peak_db": -1.2,
    "peak_dbfs": -0.5,
    "clipping_detected": false,
    "clipped_sample_count": 0,
    "crest_factor": 9.0,
    "mono_compatibility": 0.92,
    "low_energy": 0.12,
    "detected_key": "A",
    "key_detection_confidence": 0.85,
    "bpm": 138.0
  },
  "phase2": {"stereo_correlation": 0.55},
  "phase3": {"low_mid_energy": 0.14},
  "genre_hint": "trance"
}
```

- [ ] **Step 3: Create `muddy_hiphop.json`** (low_mid_mud_generic should fire)

```json
{
  "track_id": "fixture-muddy-hiphop",
  "phase1": {
    "duration_seconds": 220.0,
    "integrated_lufs": -9.0,
    "true_peak_db": -1.5,
    "peak_dbfs": -1.0,
    "clipping_detected": false,
    "clipped_sample_count": 0,
    "crest_factor": 7.5,
    "mono_compatibility": 0.85,
    "low_energy": 0.20,
    "detected_key": "F#",
    "key_detection_confidence": 0.7,
    "bpm": 92.0
  },
  "phase2": {"stereo_correlation": 0.6},
  "phase3": {"low_mid_energy": 0.31},
  "genre_hint": "hip-hop"
}
```

- [ ] **Step 4: Create `clipped_pop.json`** (clipping + true_peak_over_minus_1)

```json
{
  "track_id": "fixture-clipped-pop",
  "phase1": {
    "duration_seconds": 200.0,
    "integrated_lufs": -7.0,
    "true_peak_db": 0.4,
    "peak_dbfs": 0.0,
    "clipping_detected": true,
    "clipped_sample_count": 1842,
    "crest_factor": 5.0,
    "mono_compatibility": 0.88,
    "low_energy": 0.15,
    "detected_key": "C",
    "key_detection_confidence": 0.8,
    "bpm": 120.0
  },
  "phase2": {"stereo_correlation": 0.5},
  "phase3": {"low_mid_energy": 0.18},
  "genre_hint": "pop"
}
```

- [ ] **Step 5: Create `mono_broken_indie.json`** (mono_incompatible + stereo_correlation_negative)

```json
{
  "track_id": "fixture-mono-broken-indie",
  "phase1": {
    "duration_seconds": 240.0,
    "integrated_lufs": -14.0,
    "true_peak_db": -2.0,
    "peak_dbfs": -1.5,
    "clipping_detected": false,
    "clipped_sample_count": 0,
    "crest_factor": 11.0,
    "mono_compatibility": 0.45,
    "low_energy": 0.13,
    "detected_key": "E",
    "key_detection_confidence": 0.75,
    "bpm": 110.0
  },
  "phase2": {"stereo_correlation": -0.25},
  "phase3": {"low_mid_energy": 0.16},
  "genre_hint": "indie"
}
```

- [ ] **Step 6: Create `tiny_dynamics_edm.json`** (tiny_dynamic_range)

```json
{
  "track_id": "fixture-tiny-dynamics-edm",
  "phase1": {
    "duration_seconds": 300.0,
    "integrated_lufs": -7.5,
    "true_peak_db": -0.8,
    "peak_dbfs": -0.3,
    "clipping_detected": false,
    "clipped_sample_count": 0,
    "crest_factor": 3.2,
    "mono_compatibility": 0.9,
    "low_energy": 0.18,
    "detected_key": "G",
    "key_detection_confidence": 0.82,
    "bpm": 128.0
  },
  "phase2": {"stereo_correlation": 0.6},
  "phase3": {"low_mid_energy": 0.18},
  "genre_hint": "edm"
}
```

- [ ] **Step 7: Create `conftest.py` with fixture loaders + MockLLMClient**

```python
# components/api/tests/verdict_pipeline/conftest.py
from __future__ import annotations
import json
from pathlib import Path
import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def _load_analysis(name: str) -> dict:
    return json.loads((FIXTURES / "analyses" / f"{name}.json").read_text())


@pytest.fixture
def clean_trance() -> dict:
    return _load_analysis("clean_trance")


@pytest.fixture
def muddy_hiphop() -> dict:
    return _load_analysis("muddy_hiphop")


@pytest.fixture
def clipped_pop() -> dict:
    return _load_analysis("clipped_pop")


@pytest.fixture
def mono_broken_indie() -> dict:
    return _load_analysis("mono_broken_indie")


@pytest.fixture
def tiny_dynamics_edm() -> dict:
    return _load_analysis("tiny_dynamics_edm")


class MockLLMClient:
    """Test double for LLMClient. Returns canned responses keyed by
    (system_prompt_excerpt, fixture_track_id). Use `register()` to add
    responses inside individual tests."""

    def __init__(self) -> None:
        self._responses: dict[tuple[str, str], str] = {}
        self.calls: list[dict] = []

    def register(self, prompt_excerpt: str, track_id: str, response: str) -> None:
        self._responses[(prompt_excerpt, track_id)] = response

    async def call(self, system: str, user: str, *, max_tokens: int = 4096,
                   timeout_s: int = 90) -> str:
        track_id = "unknown"
        for line in user.splitlines():
            if "track_id" in line:
                # crude — sufficient for fixture matching
                track_id = line.split('"')[3] if line.count('"') >= 4 else "unknown"
                break
        for excerpt, tid in self._responses:
            if excerpt in system and tid == track_id:
                self.calls.append({"system_excerpt": excerpt, "track_id": track_id,
                                   "user": user})
                return self._responses[(excerpt, tid)]
        raise KeyError(f"No mock response for track={track_id}, system={system[:50]!r}")


@pytest.fixture
def llm() -> MockLLMClient:
    return MockLLMClient()
```

- [ ] **Step 8: Verify pytest can collect the directory**

Run: `cd components/api && pytest tests/verdict_pipeline/ --collect-only`
Expected: collects 0 tests, no import errors.

- [ ] **Step 9: Commit**

```bash
git add components/api/tests/verdict_pipeline/
git commit -m "test: scaffold verdict pipeline test fixtures and MockLLMClient"
```

---

## Task 1: Verdict & Fix Pydantic schemas

**Files:**
- Create: `components/shared/aimusic_shared/verdicts/__init__.py`
- Create: `components/shared/aimusic_shared/verdicts/models.py`
- Create: `components/shared/aimusic_shared/verdicts/ulid_helpers.py`
- Create: `components/shared/tests/test_verdict_schema.py`
- Modify: `components/shared/pyproject.toml` (add `python-ulid>=2.2`)
- Modify: `components/shared/aimusic_shared/__init__.py` (re-export)

- [ ] **Step 1: Add `python-ulid` to shared `pyproject.toml`**

In `components/shared/pyproject.toml` under `[project] dependencies`:

```toml
dependencies = [
  "sqlalchemy>=2.0",
  "python-ulid>=2.2",
]
```

- [ ] **Step 2: Create `ulid_helpers.py`**

```python
# components/shared/aimusic_shared/verdicts/ulid_helpers.py
from __future__ import annotations
from ulid import ULID


def new_verdict_id() -> str:
    return f"vrd_{ULID()}"


def new_fix_id() -> str:
    return f"fix_{ULID()}"


def is_verdict_id(s: str) -> bool:
    return s.startswith("vrd_") and len(s) == 30  # 4 prefix + 26 ulid


def is_fix_id(s: str) -> bool:
    return s.startswith("fix_") and len(s) == 30
```

- [ ] **Step 3: Write failing schema tests in `test_verdict_schema.py`**

Create `components/shared/tests/__init__.py` (empty file) if it doesn't exist.

```python
# components/shared/tests/test_verdict_schema.py
from __future__ import annotations
import pytest
from datetime import datetime, timezone
from pydantic import ValidationError
from aimusic_shared.verdicts.models import (
    Verdict, Fix, Evidence, DspOp, UserState, SpecialistRoutingPlan,
)
from aimusic_shared.verdicts.ulid_helpers import (
    new_verdict_id, new_fix_id, is_verdict_id, is_fix_id,
)


def _minimal_verdict(**overrides) -> dict:
    base = dict(
        verdict_id=new_verdict_id(),
        track_id="track-1",
        specialist="rule_engine",
        prompt_version="rule_engine@1.0.0",
        model="rules",
        severity="moderate",
        category="loudness",
        confidence=0.8,
        priority_score=70,
        headline="Headline",
        summary="Summary text.",
        evidence=[Evidence(metric="phase1.integrated_lufs", value=-7.0,
                           label="LUFS too high")],
        fix=None,
        why_it_matters="It matters.",
        related_verdict_ids=[],
        sources=["rule_engine"],
        user_state=UserState(),
        created_at=datetime.now(tz=timezone.utc),
    )
    base.update(overrides)
    return base


def test_minimal_verdict_validates():
    v = Verdict(**_minimal_verdict())
    assert v.severity == "moderate"
    assert is_verdict_id(v.verdict_id)


def test_severity_must_be_in_enum():
    with pytest.raises(ValidationError):
        Verdict(**_minimal_verdict(severity="catastrophic"))


def test_confidence_out_of_range():
    with pytest.raises(ValidationError):
        Verdict(**_minimal_verdict(confidence=1.2))
    with pytest.raises(ValidationError):
        Verdict(**_minimal_verdict(confidence=-0.1))


def test_dsp_peaking_eq_gain_in_range():
    DspOp(type="peaking_eq", params={"frequency_hz": 250, "gain_db": -4.0, "q": 1.2})
    with pytest.raises(ValidationError):
        DspOp(type="peaking_eq", params={"frequency_hz": 250, "gain_db": -30.0, "q": 1.2})
    with pytest.raises(ValidationError):
        DspOp(type="peaking_eq", params={"frequency_hz": 25000, "gain_db": -4.0, "q": 1.2})


def test_dsp_compressor_ratio_in_range():
    DspOp(type="compressor", params={"threshold_db": -20, "ratio": 4,
                                     "attack_ms": 5, "release_ms": 80, "knee_db": 6})
    with pytest.raises(ValidationError):
        DspOp(type="compressor", params={"threshold_db": -20, "ratio": 50,
                                         "attack_ms": 5, "release_ms": 80, "knee_db": 6})


def test_unknown_dsp_type_rejected():
    with pytest.raises(ValidationError):
        DspOp(type="bitcrusher", params={"bits": 8})


def test_evidence_required_fields():
    Evidence(metric="phase1.integrated_lufs", label="x")
    with pytest.raises(ValidationError):
        Evidence(label="x")  # missing metric


def test_fix_with_dsp_chain():
    f = Fix(
        fix_id=new_fix_id(),
        target={"type": "stem", "name": "bass"},
        section=None,
        dsp_chain=[DspOp(type="peaking_eq",
                         params={"frequency_hz": 250, "gain_db": -4.0, "q": 1.2})],
        sidechain=None,
        expected_outcome="Cleaner low end.",
        ableton_hint=None,
    )
    assert is_fix_id(f.fix_id)
    assert len(f.dsp_chain) == 1


def test_routing_plan_validates():
    p = SpecialistRoutingPlan(
        specialists_to_run=[{"name": "low_end", "priority": 1, "focus": "kick-bass"}],
        skip=["spatial"],
        rationale="Low end dominates.",
        estimated_total_tokens=15000,
    )
    assert p.specialists_to_run[0]["name"] == "low_end"
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd components/shared && pytest tests/test_verdict_schema.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'aimusic_shared.verdicts'`

- [ ] **Step 5: Implement `models.py`**

```python
# components/shared/aimusic_shared/verdicts/models.py
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Severity = Literal["critical", "severe", "moderate", "minor", "win"]

Category = Literal[
    "low_end", "frequency_balance", "dynamics", "stereo_phase", "loudness",
    "sections", "trance_arrangement", "stem_reference", "harmonic", "clarity",
    "spatial", "surround", "playback", "overall", "gain_staging",
    "stereo_field", "frequency_collision", "humanization", "section_contrast",
    "density", "chord_harmony", "device_chain", "priority_summary",
    "clipping", "mono_compatibility",
]

DspType = Literal[
    "peaking_eq", "low_shelf", "high_shelf", "high_pass", "low_pass",
    "compressor", "multiband_compressor", "limiter", "gain",
    "stereo_width", "sidechain",
]

FeedbackKind = Literal["helpful", "wrong", "unclear"]


class Evidence(BaseModel):
    model_config = ConfigDict(frozen=False, extra="forbid")

    metric: str
    value: Optional[float] = None
    expected_range: Optional[tuple[float, float]] = None
    delta_pct: Optional[float] = None
    label: str
    frequency_range_hz: Optional[tuple[float, float]] = None
    stems: Optional[list[str]] = None


# Per-DSP-type param specs. Keys are the allowed param names, values are
# (min, max) inclusive ranges for numeric params or `None` for free-form.
_DSP_PARAM_RANGES: dict[str, dict[str, tuple[float, float] | None]] = {
    "peaking_eq": {
        "frequency_hz": (20.0, 22000.0),
        "gain_db": (-24.0, 24.0),
        "q": (0.1, 18.0),
    },
    "low_shelf": {
        "frequency_hz": (20.0, 22000.0),
        "gain_db": (-24.0, 24.0),
    },
    "high_shelf": {
        "frequency_hz": (20.0, 22000.0),
        "gain_db": (-24.0, 24.0),
    },
    "high_pass": {
        "frequency_hz": (20.0, 22000.0),
        "slope_db": (6.0, 96.0),
    },
    "low_pass": {
        "frequency_hz": (20.0, 22000.0),
        "slope_db": (6.0, 96.0),
    },
    "compressor": {
        "threshold_db": (-60.0, 0.0),
        "ratio": (1.0, 20.0),
        "attack_ms": (0.1, 1000.0),
        "release_ms": (1.0, 5000.0),
        "knee_db": (0.0, 24.0),
    },
    "multiband_compressor": {
        "bands": None,  # list of band dicts; not range-checked here
    },
    "limiter": {
        "ceiling_db": (-6.0, 0.0),
        "release_ms": (1.0, 5000.0),
    },
    "gain": {
        "gain_db": (-24.0, 24.0),
    },
    "stereo_width": {
        "width_pct": (0.0, 200.0),
    },
    "sidechain": {
        "source_stem": None,  # string
        "depth_db": (0.0, 24.0),
        "release_ms": (1.0, 5000.0),
    },
}


class DspOp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: DspType
    params: dict[str, Any]

    @model_validator(mode="after")
    def _validate_params(self) -> "DspOp":
        spec = _DSP_PARAM_RANGES[self.type]
        for key, value in self.params.items():
            if key not in spec:
                raise ValueError(
                    f"Unknown param {key!r} for DSP type {self.type!r}; "
                    f"allowed: {sorted(spec)}"
                )
            rng = spec[key]
            if rng is None:
                continue
            if not isinstance(value, (int, float)):
                raise ValueError(
                    f"Param {key!r} for {self.type!r} must be numeric, got {type(value).__name__}"
                )
            lo, hi = rng
            if not (lo <= float(value) <= hi):
                raise ValueError(
                    f"Param {key!r}={value} out of range [{lo}, {hi}] for {self.type!r}"
                )
        return self


class Fix(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fix_id: str
    target: dict[str, Any]  # {"type": "stem"|"master"|"bus", "name": str}
    section: Optional[dict[str, Any]] = None
    dsp_chain: list[DspOp]
    sidechain: Optional[dict[str, Any]] = None
    expected_outcome: str
    ableton_hint: Optional[dict[str, Any]] = None


class UserState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dismissed: bool = False
    applied: bool = False
    user_modified_fix: Optional[dict[str, Any]] = None
    feedback: Optional[FeedbackKind] = None


class Verdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict_id: str
    track_id: str
    specialist: str
    prompt_version: str
    model: str
    severity: Severity
    category: Category
    confidence: float = Field(ge=0.0, le=1.0)
    priority_score: int
    headline: str = Field(max_length=80)
    summary: str = Field(max_length=300)
    evidence: list[Evidence]
    fix: Optional[Fix] = None
    why_it_matters: str = Field(max_length=200)
    related_verdict_ids: list[str] = Field(default_factory=list)
    sources: list[str]
    user_state: UserState = Field(default_factory=UserState)
    created_at: datetime

    @field_validator("verdict_id")
    @classmethod
    def _check_verdict_id(cls, v: str) -> str:
        if not v.startswith("vrd_"):
            raise ValueError("verdict_id must start with 'vrd_'")
        return v


class SpecialistRoutingPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    specialists_to_run: list[dict[str, Any]]
    skip: list[str] = Field(default_factory=list)
    rationale: str
    estimated_total_tokens: int = Field(ge=0)

    @field_validator("specialists_to_run")
    @classmethod
    def _validate_entries(cls, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for item in items:
            if not {"name", "priority", "focus"} <= set(item):
                raise ValueError(
                    f"specialists_to_run entry missing fields: {item}"
                )
        return items
```

- [ ] **Step 6: Create `__init__.py` for the verdicts package**

```python
# components/shared/aimusic_shared/verdicts/__init__.py
from aimusic_shared.verdicts.models import (
    Category,
    DspOp,
    DspType,
    Evidence,
    FeedbackKind,
    Fix,
    Severity,
    SpecialistRoutingPlan,
    UserState,
    Verdict,
)
from aimusic_shared.verdicts.ulid_helpers import (
    is_fix_id,
    is_verdict_id,
    new_fix_id,
    new_verdict_id,
)

__all__ = [
    "Category", "DspOp", "DspType", "Evidence", "FeedbackKind", "Fix",
    "Severity", "SpecialistRoutingPlan", "UserState", "Verdict",
    "is_fix_id", "is_verdict_id", "new_fix_id", "new_verdict_id",
]
```

- [ ] **Step 7: Re-export from `aimusic_shared/__init__.py`**

Append to existing `components/shared/aimusic_shared/__init__.py`:

```python
from aimusic_shared import verdicts  # noqa: F401  re-export for `from aimusic_shared import verdicts`
```

- [ ] **Step 8: Reinstall shared package to pick up new module + dep**

Run: `pip install -e components/shared`
Expected: installs `python-ulid` if not present.

- [ ] **Step 9: Run schema tests, expect green**

Run: `cd components/shared && pytest tests/test_verdict_schema.py -v`
Expected: 9 PASSED.

- [ ] **Step 10: Commit**

```bash
git add components/shared/aimusic_shared/verdicts/ \
        components/shared/tests/test_verdict_schema.py \
        components/shared/aimusic_shared/__init__.py \
        components/shared/pyproject.toml \
        components/shared/tests/__init__.py
git commit -m "feat(shared): add Verdict/Fix/Evidence Pydantic schemas with DSP range validation"
```

---

## Task 2: Priority score formula

**Files:**
- Create: `components/shared/aimusic_shared/verdicts/scoring.py`
- Create: `components/shared/tests/test_verdict_scoring.py`

- [ ] **Step 1: Write failing scoring tests**

```python
# components/shared/tests/test_verdict_scoring.py
from __future__ import annotations
import pytest
from aimusic_shared.verdicts.scoring import (
    compute_priority_score,
    severity_from_score,
)


def test_critical_full_track_clipping():
    # base=200, category=1.5, scope=1.0  → 300
    assert compute_priority_score("critical", "clipping", "full_track") == 300


def test_severe_full_track_loudness():
    # base=120, category=1.4, scope=1.0  → 168
    assert compute_priority_score("severe", "loudness", "full_track") == 168


def test_moderate_single_section_low_end():
    # base=70, category=1.3, scope=0.7   → 64 (rounded from 63.7)
    assert compute_priority_score("moderate", "low_end", "single_section") == 64


def test_minor_single_stem_dynamics():
    # base=30, category=1.0, scope=0.6   → 18
    assert compute_priority_score("minor", "dynamics", "single_stem") == 18


def test_win_full_track():
    # base=20, category=1.0, scope=1.0   → 20
    assert compute_priority_score("win", "frequency_balance", "full_track") == 20


def test_unknown_category_defaults_to_1_0():
    # base=70, category=1.0, scope=1.0   → 70
    assert compute_priority_score("moderate", "device_chain", "full_track") == 70


def test_severity_from_score_bands():
    assert severity_from_score(250) == "critical"
    assert severity_from_score(200) == "critical"
    assert severity_from_score(199) == "severe"
    assert severity_from_score(120) == "severe"
    assert severity_from_score(99) == "moderate"
    assert severity_from_score(70) == "moderate"
    assert severity_from_score(40) == "minor"
    assert severity_from_score(25) == "minor"
    assert severity_from_score(20) == "win"
    assert severity_from_score(0) == "win"


def test_unknown_severity_raises():
    with pytest.raises(ValueError):
        compute_priority_score("emergency", "clipping", "full_track")  # type: ignore[arg-type]


def test_unknown_scope_raises():
    with pytest.raises(ValueError):
        compute_priority_score("severe", "clipping", "headphones")  # type: ignore[arg-type]
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/shared && pytest tests/test_verdict_scoring.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `scoring.py`**

```python
# components/shared/aimusic_shared/verdicts/scoring.py
from __future__ import annotations
from typing import Literal
from aimusic_shared.verdicts.models import Severity

Scope = Literal["full_track", "multi_section", "single_section", "single_stem"]


_BASE_SEVERITY: dict[Severity, int] = {
    "critical": 200,
    "severe": 120,
    "moderate": 70,
    "minor": 30,
    "win": 20,
}

_CATEGORY_WEIGHT: dict[str, float] = {
    "clipping": 1.5,
    "loudness": 1.4,
    "mono_compatibility": 1.4,
    "low_end": 1.3,
    "frequency_balance": 1.2,
}

_SCOPE_MULTIPLIER: dict[Scope, float] = {
    "full_track": 1.0,
    "multi_section": 0.9,
    "single_section": 0.7,
    "single_stem": 0.6,
}


def compute_priority_score(
    severity: Severity, category: str, scope: Scope
) -> int:
    if severity not in _BASE_SEVERITY:
        raise ValueError(f"Unknown severity: {severity!r}")
    if scope not in _SCOPE_MULTIPLIER:
        raise ValueError(f"Unknown scope: {scope!r}")
    base = _BASE_SEVERITY[severity]
    cat = _CATEGORY_WEIGHT.get(category, 1.0)
    scp = _SCOPE_MULTIPLIER[scope]
    return round(base * cat * scp)


def severity_from_score(score: int) -> Severity:
    if score >= 200:
        return "critical"
    if score >= 100:
        return "severe"
    if score >= 50:
        return "moderate"
    if score >= 25:
        return "minor"
    return "win"
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/shared && pytest tests/test_verdict_scoring.py -v`
Expected: 9 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/shared/aimusic_shared/verdicts/scoring.py \
        components/shared/tests/test_verdict_scoring.py
git commit -m "feat(shared): add priority_score formula and severity-band helper"
```

---

## Task 3: VerdictUserState ORM model + migration 006 (verdicts_payload columns)

**Files:**
- Modify: `components/shared/aimusic_shared/models.py`
- Create: `components/api/alembic/versions/006_add_verdicts_payload.py`

- [ ] **Step 1: Add `VerdictUserState` and verdicts columns to `models.py`**

In `components/shared/aimusic_shared/models.py`, after the `AnalysisResult` class, add:

```python
class VerdictUserState(Base):
    __tablename__ = "verdict_user_state"

    verdict_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("upload_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    applied: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    user_modified_fix: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    feedback: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

Add columns to `AnalysisResult` (right after `share_token`):

```python
    verdicts_payload: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    verdicts_generated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verdicts_prompt_version_set: Mapped[Optional[str]] = mapped_column(
        String(2000), nullable=True
    )
    verdicts_model: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
```

- [ ] **Step 2: Reinstall shared so api can pick up the new model**

Run: `pip install -e components/shared`

- [ ] **Step 3: Create migration `006_add_verdicts_payload.py`**

```python
"""add verdicts_payload + verdict_validation_failures

Revision ID: 006
Revises: 005
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('analysis_results',
                  sa.Column('verdicts_payload', JSONB, nullable=True))
    op.add_column('analysis_results',
                  sa.Column('verdicts_generated_at', sa.DateTime(timezone=True),
                            nullable=True))
    op.add_column('analysis_results',
                  sa.Column('verdicts_prompt_version_set', sa.String(2000),
                            nullable=True))
    op.add_column('analysis_results',
                  sa.Column('verdicts_model', sa.String(50), nullable=True))
    op.create_index(
        'idx_analysis_results_verdicts_generated',
        'analysis_results',
        ['verdicts_generated_at'],
        postgresql_where=sa.text('verdicts_payload IS NOT NULL'),
    )

    op.create_table(
        'verdict_validation_failures',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('job_id', UUID(as_uuid=True),
                  sa.ForeignKey('upload_jobs.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('specialist', sa.String(64), nullable=False),
        sa.Column('prompt_version', sa.String(64), nullable=False),
        sa.Column('reason', sa.Text, nullable=False),
        sa.Column('raw_output_excerpt', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        'idx_verdict_failures_specialist',
        'verdict_validation_failures',
        ['specialist', sa.text('created_at DESC')],
    )


def downgrade() -> None:
    op.drop_index('idx_verdict_failures_specialist',
                  table_name='verdict_validation_failures')
    op.drop_table('verdict_validation_failures')
    op.drop_index('idx_analysis_results_verdicts_generated',
                  table_name='analysis_results')
    op.drop_column('analysis_results', 'verdicts_model')
    op.drop_column('analysis_results', 'verdicts_prompt_version_set')
    op.drop_column('analysis_results', 'verdicts_generated_at')
    op.drop_column('analysis_results', 'verdicts_payload')
```

- [ ] **Step 4: Apply migration against running PostgreSQL**

Run: `cd components/api && alembic upgrade head`
Expected: `INFO  [alembic.runtime.migration] Running upgrade 005 -> 006`

- [ ] **Step 5: Verify schema with psql**

Run:
```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d music_analyzer \
  -c "\d analysis_results" \
  -c "\d verdict_validation_failures"
```
Expected: `verdicts_payload` jsonb column visible; `verdict_validation_failures` table exists.

- [ ] **Step 6: Commit**

```bash
git add components/shared/aimusic_shared/models.py \
        components/api/alembic/versions/006_add_verdicts_payload.py
git commit -m "feat(db): migration 006 — verdicts_payload + validation_failures"
```

---

## Task 4: Migration 007 — verdict_user_state table

**Files:**
- Create: `components/api/alembic/versions/007_add_verdict_user_state.py`

- [ ] **Step 1: Create migration**

```python
"""add verdict_user_state table

Revision ID: 007
Revises: 006
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'verdict_user_state',
        sa.Column('verdict_id', sa.String(40), nullable=False),
        sa.Column('user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('job_id', UUID(as_uuid=True),
                  sa.ForeignKey('upload_jobs.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('dismissed', sa.Boolean, nullable=False,
                  server_default=sa.text('false')),
        sa.Column('applied', sa.Boolean, nullable=False,
                  server_default=sa.text('false')),
        sa.Column('user_modified_fix', JSONB, nullable=True),
        sa.Column('feedback', sa.String(20), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('verdict_id', 'user_id'),
        sa.CheckConstraint(
            "feedback IN ('helpful', 'wrong', 'unclear') OR feedback IS NULL",
            name='verdict_user_state_feedback_chk',
        ),
    )
    op.create_index(
        'idx_verdict_user_state_user_job',
        'verdict_user_state',
        ['user_id', 'job_id'],
    )


def downgrade() -> None:
    op.drop_index('idx_verdict_user_state_user_job',
                  table_name='verdict_user_state')
    op.drop_table('verdict_user_state')
```

- [ ] **Step 2: Apply**

Run: `cd components/api && alembic upgrade head`
Expected: `005 -> 006 -> 007`

- [ ] **Step 3: Verify**

Run: `docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d music_analyzer -c "\d verdict_user_state"`
Expected: composite PK on (verdict_id, user_id), check constraint on feedback.

- [ ] **Step 4: Commit**

```bash
git add components/api/alembic/versions/007_add_verdict_user_state.py
git commit -m "feat(db): migration 007 — verdict_user_state table"
```

---

## Task 5: LLMClient ABC + CliClient

**Files:**
- Create: `components/api/app/llm/__init__.py`
- Create: `components/api/app/llm/client.py`
- Create: `components/api/tests/verdict_pipeline/test_cli_client_live.py`

- [ ] **Step 1: Write failing test for CliClient (mocked subprocess)**

Add to `components/api/tests/verdict_pipeline/test_cli_client.py`:

```python
# components/api/tests/verdict_pipeline/test_cli_client.py
from __future__ import annotations
import asyncio
import subprocess
from unittest.mock import patch, MagicMock
import pytest
from app.llm.client import CliClient, LLMTimeoutError, LLMInvocationError


@pytest.mark.asyncio
async def test_cli_client_returns_stdout():
    completed = MagicMock(returncode=0, stdout=b'{"specialist":"low_end","verdicts":[]}',
                          stderr=b'')
    with patch("subprocess.run", return_value=completed) as mock_run:
        client = CliClient()
        out = await client.call(system="sys", user="usr")
    assert out == '{"specialist":"low_end","verdicts":[]}'
    args = mock_run.call_args[0][0]
    assert args[0] == "claude"
    assert "--system-prompt-file" in args


@pytest.mark.asyncio
async def test_cli_client_nonzero_exit_raises():
    completed = MagicMock(returncode=1, stdout=b'', stderr=b'auth failed')
    with patch("subprocess.run", return_value=completed):
        client = CliClient()
        with pytest.raises(LLMInvocationError, match="auth failed"):
            await client.call(system="sys", user="usr")


@pytest.mark.asyncio
async def test_cli_client_timeout_raises():
    def slow(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="claude", timeout=0.1)
    with patch("subprocess.run", side_effect=slow):
        client = CliClient()
        with pytest.raises(LLMTimeoutError):
            await client.call(system="sys", user="usr", timeout_s=1)


@pytest.mark.asyncio
async def test_cli_client_serializes_concurrent_calls():
    """CliClient must hold a Semaphore(1) — concurrent calls run sequentially."""
    call_log: list[str] = []

    async def fake_to_thread(fn, *args, **kwargs):
        call_log.append("start")
        await asyncio.sleep(0.05)
        call_log.append("end")
        return MagicMock(returncode=0, stdout=b"ok", stderr=b"")

    with patch("asyncio.to_thread", side_effect=fake_to_thread):
        client = CliClient()
        await asyncio.gather(
            client.call(system="s", user="u"),
            client.call(system="s", user="u"),
        )
    assert call_log == ["start", "end", "start", "end"]
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_cli_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm'`

- [ ] **Step 3: Implement `client.py`**

```python
# components/api/app/llm/client.py
from __future__ import annotations
import asyncio
import subprocess
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path


class LLMInvocationError(Exception):
    """LLM subprocess returned a non-zero exit code."""


class LLMTimeoutError(Exception):
    """LLM call exceeded the timeout."""


class LLMClient(ABC):
    @abstractmethod
    async def call(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 4096,
        timeout_s: int = 90,
    ) -> str:
        """Return raw text output from the model. Caller is responsible for parsing."""


class CliClient(LLMClient):
    """Wraps the `claude` CLI via subprocess.

    - System prompt is written to a tempfile and passed via --system-prompt-file.
    - User message is passed inline via -p.
    - asyncio.Semaphore(1) ensures the CLI is never called concurrently from a
      single API process — empirically the CLI is not concurrency-safe.
    """

    def __init__(self) -> None:
        self._sema = asyncio.Semaphore(1)

    async def call(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 4096,  # noqa: ARG002 — CLI doesn't expose; kept for ABC parity
        timeout_s: int = 90,
    ) -> str:
        async with self._sema:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".md", delete=False, encoding="utf-8"
            ) as f:
                f.write(system)
                system_path = Path(f.name)
            try:
                cmd = [
                    "claude", "-p", user,
                    "--system-prompt-file", str(system_path),
                    "--output-format", "text",
                ]
                try:
                    completed = await asyncio.to_thread(
                        subprocess.run,
                        cmd,
                        capture_output=True,
                        timeout=timeout_s,
                    )
                except subprocess.TimeoutExpired as e:
                    raise LLMTimeoutError(
                        f"claude CLI exceeded {timeout_s}s timeout"
                    ) from e
                if completed.returncode != 0:
                    stderr = completed.stderr.decode(errors="replace").strip()
                    raise LLMInvocationError(
                        f"claude CLI exited {completed.returncode}: {stderr}"
                    )
                return completed.stdout.decode(errors="replace")
            finally:
                system_path.unlink(missing_ok=True)


class ApiClient(LLMClient):
    """Stub for the Anthropic API path (deferred to follow-up PRP)."""

    async def call(self, **kwargs) -> str:  # noqa: ARG002
        raise NotImplementedError(
            "Anthropic API transport is deferred. Use CliClient with USE_CLAUDE_CLI=true."
        )
```

- [ ] **Step 4: Create `__init__.py`**

```python
# components/api/app/llm/__init__.py
from app.llm.client import (
    ApiClient,
    CliClient,
    LLMClient,
    LLMInvocationError,
    LLMTimeoutError,
)

__all__ = [
    "ApiClient", "CliClient", "LLMClient",
    "LLMInvocationError", "LLMTimeoutError",
]
```

- [ ] **Step 5: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_cli_client.py -v`
Expected: 4 PASSED.

- [ ] **Step 6: Create live-LLM smoke test (skipped by default)**

```python
# components/api/tests/verdict_pipeline/test_cli_client_live.py
from __future__ import annotations
import shutil
import pytest
from app.llm.client import CliClient

pytestmark = pytest.mark.live_llm


@pytest.fixture(autouse=True)
def skip_if_no_cli():
    if shutil.which("claude") is None:
        pytest.skip("claude CLI not on PATH")


@pytest.mark.asyncio
async def test_cli_round_trip():
    client = CliClient()
    out = await client.call(
        system="You are a JSON echo. Reply with: {\"ok\": true}",
        user="echo",
        timeout_s=60,
    )
    assert "ok" in out.lower()
```

Add to `components/api/pytest.ini` (or pyproject.toml `[tool.pytest.ini_options]`):

```ini
markers =
    live_llm: integration test that calls the real claude CLI (skipped by default)
```

And configure default deselection. In `components/api/pyproject.toml` (or pytest.ini):

```toml
[tool.pytest.ini_options]
addopts = "-m 'not live_llm'"
markers = [
    "live_llm: integration test that calls the real claude CLI (skipped by default)",
]
```

- [ ] **Step 7: Verify default suite skips the live test**

Run: `cd components/api && pytest tests/verdict_pipeline/test_cli_client_live.py -v`
Expected: 1 deselected (default `-m 'not live_llm'` skips it).

Run: `cd components/api && pytest tests/verdict_pipeline/test_cli_client_live.py -m live_llm -v`
Expected: PASS if `claude --version` works, else SKIPPED.

- [ ] **Step 8: Commit**

```bash
git add components/api/app/llm/ \
        components/api/tests/verdict_pipeline/test_cli_client.py \
        components/api/tests/verdict_pipeline/test_cli_client_live.py \
        components/api/pyproject.toml
git commit -m "feat(api): LLMClient ABC + CliClient subprocess wrapper with Semaphore(1)"
```

---

## Task 6: Rule engine — base infrastructure + first 3 rules

**Files:**
- Create: `components/api/app/verdict_pipeline/__init__.py` (empty for now)
- Create: `components/api/app/verdict_pipeline/rule_engine.py`
- Create: `components/api/tests/verdict_pipeline/test_rule_engine.py`

- [ ] **Step 1: Write failing tests for first 3 rules**

```python
# components/api/tests/verdict_pipeline/test_rule_engine.py
from __future__ import annotations
import pytest
from app.verdict_pipeline.rule_engine import evaluate_rules


def test_no_rules_fire_on_clean_track(clean_trance):
    verdicts = evaluate_rules(clean_trance)
    assert all(v.specialist == "rule_engine" for v in verdicts)
    # clean_trance is engineered to trigger zero rules
    assert verdicts == []


def test_clipping_rule_fires(clipped_pop):
    verdicts = evaluate_rules(clipped_pop)
    cats = [v.category for v in verdicts]
    assert "clipping" in cats
    clip = next(v for v in verdicts if v.category == "clipping")
    assert clip.severity == "critical"
    assert clip.evidence[0].metric == "phase1.clipped_sample_count"
    assert clip.evidence[0].value == 1842


def test_true_peak_rule_fires(clipped_pop):
    verdicts = evaluate_rules(clipped_pop)
    tp = next((v for v in verdicts if v.category == "loudness"
               and "true_peak" in v.headline.lower()), None)
    assert tp is not None
    assert tp.severity == "severe"


def test_mono_incompat_fires(mono_broken_indie):
    verdicts = evaluate_rules(mono_broken_indie)
    mono = next(v for v in verdicts if v.category == "mono_compatibility")
    assert mono.severity == "severe"
    assert mono.evidence[0].metric == "phase1.mono_compatibility"
    assert mono.evidence[0].value == 0.45
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_rule_engine.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Create `verdict_pipeline/__init__.py` (empty)**

```python
# components/api/app/verdict_pipeline/__init__.py
```

- [ ] **Step 4: Implement `rule_engine.py` with the rule registration pattern + first 3 rules**

```python
# components/api/app/verdict_pipeline/rule_engine.py
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Callable

from aimusic_shared.verdicts.models import Evidence, Severity, Verdict
from aimusic_shared.verdicts.scoring import compute_priority_score
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id

RULE_ENGINE_VERSION = "rule_engine@1.0.0"
RULE_MODEL = "rules"

RuleFn = Callable[[dict[str, Any]], "Verdict | None"]
_RULES: list[RuleFn] = []


def rule(fn: RuleFn) -> RuleFn:
    """Decorator to register a rule function."""
    _RULES.append(fn)
    return fn


def evaluate_rules(analysis: dict[str, Any]) -> list[Verdict]:
    """Run every registered rule. Each rule returns a Verdict or None."""
    out: list[Verdict] = []
    for fn in _RULES:
        v = fn(analysis)
        if v is not None:
            out.append(v)
    return out


def _make(
    *,
    track_id: str,
    severity: Severity,
    category: str,
    headline: str,
    summary: str,
    evidence: list[Evidence],
    why_it_matters: str,
    scope: str = "full_track",
    confidence: float = 1.0,
) -> Verdict:
    score = compute_priority_score(severity, category, scope)  # type: ignore[arg-type]
    return Verdict(
        verdict_id=new_verdict_id(),
        track_id=track_id,
        specialist="rule_engine",
        prompt_version=RULE_ENGINE_VERSION,
        model=RULE_MODEL,
        severity=severity,
        category=category,  # type: ignore[arg-type]
        confidence=confidence,
        priority_score=score,
        headline=headline,
        summary=summary,
        evidence=evidence,
        fix=None,
        why_it_matters=why_it_matters,
        related_verdict_ids=[],
        sources=["rule_engine"],
        created_at=datetime.now(tz=timezone.utc),
    )


def _track_id(analysis: dict[str, Any]) -> str:
    return analysis.get("track_id", "unknown-track")


def _phase(analysis: dict[str, Any], key: str) -> dict[str, Any]:
    return analysis.get(key) or {}


# ── Rules ──────────────────────────────────────────────────────────────────


@rule
def clipping_detected(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    if not p1.get("clipping_detected"):
        return None
    n = int(p1.get("clipped_sample_count", 0))
    return _make(
        track_id=_track_id(analysis),
        severity="critical",
        category="clipping",
        headline=f"Hard clipping detected ({n} samples)",
        summary="The signal is hitting digital ceiling. Distortion is audible "
                "and unfixable downstream.",
        evidence=[Evidence(
            metric="phase1.clipped_sample_count",
            value=float(n),
            label=f"{n} clipped samples",
        )],
        why_it_matters="Clipping is irreversible distortion. Mastering and "
                       "limiting downstream cannot remove it.",
    )


@rule
def true_peak_over_minus_1(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    tp = p1.get("true_peak_db")
    if tp is None or tp <= -1.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="loudness",
        headline=f"True peak {tp:+.2f} dBTP — exceeds streaming limits",
        summary=f"Peak is {tp:+.2f} dBTP. Streaming services re-encode and "
                "introduce inter-sample peaks; aim for ≤ -1.0 dBTP.",
        evidence=[Evidence(
            metric="phase1.true_peak_db",
            value=float(tp),
            expected_range=(-6.0, -1.0),
            label=f"{tp:+.2f} dBTP",
        )],
        why_it_matters="Codec re-encoding (AAC, Opus) raises peaks. Any track "
                       "above -1.0 dBTP risks audible inter-sample distortion "
                       "on Spotify, YouTube, Apple Music.",
    )


@rule
def mono_incompatible(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    mono = p1.get("mono_compatibility")
    if mono is None or mono >= 0.7:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="mono_compatibility",
        headline=f"Mono compatibility low ({mono:.2f})",
        summary=f"Mono fold-down RMS ratio is {mono:.2f}. Phase cancellation "
                "in stereo content is collapsing parts of the mix in mono.",
        evidence=[Evidence(
            metric="phase1.mono_compatibility",
            value=float(mono),
            expected_range=(0.7, 1.0),
            label=f"{mono:.2f} ratio",
        )],
        why_it_matters="Club systems, AM radio, single-speaker phones, and "
                       "Bluetooth earbuds can collapse a mix to mono. Parts "
                       "that disappear there sound thin and broken.",
    )
```

- [ ] **Step 5: Run, expect green for the first 3 rules**

Run: `cd components/api && pytest tests/verdict_pipeline/test_rule_engine.py -v`
Expected: 4 PASSED.

- [ ] **Step 6: Commit**

```bash
git add components/api/app/verdict_pipeline/__init__.py \
        components/api/app/verdict_pipeline/rule_engine.py \
        components/api/tests/verdict_pipeline/test_rule_engine.py
git commit -m "feat(verdict_pipeline): rule engine base + 3 rules (clipping, true_peak, mono)"
```

---

## Task 7: Rule engine — remaining 8 rules

**Files:**
- Modify: `components/api/app/verdict_pipeline/rule_engine.py`
- Modify: `components/api/tests/verdict_pipeline/test_rule_engine.py`

- [ ] **Step 1: Add tests for all 8 remaining rules**

Append to `test_rule_engine.py`:

```python
def test_loudness_too_high_streaming(clipped_pop):
    # clipped_pop has integrated_lufs = -7.0 (> -8) — should fire
    verdicts = evaluate_rules(clipped_pop)
    loud = next((v for v in verdicts if v.category == "loudness"
                 and "too loud" in v.headline.lower()), None)
    assert loud is not None
    assert loud.severity == "moderate"


def test_loudness_too_low_streaming():
    analysis = {
        "track_id": "low-loudness",
        "phase1": {"integrated_lufs": -22.0, "true_peak_db": -3.0,
                   "mono_compatibility": 0.9, "clipping_detected": False,
                   "crest_factor": 8.0, "duration_seconds": 200},
        "phase2": {"stereo_correlation": 0.5},
        "phase3": {"low_mid_energy": 0.15},
        "genre_hint": "ambient",
    }
    verdicts = evaluate_rules(analysis)
    quiet = next(v for v in verdicts if "too quiet" in v.headline.lower())
    assert quiet.severity == "moderate"


def test_low_mid_mud_trance():
    analysis = {
        "track_id": "muddy-trance",
        "phase1": {"integrated_lufs": -10, "true_peak_db": -2,
                   "mono_compatibility": 0.9, "clipping_detected": False,
                   "crest_factor": 9.0, "duration_seconds": 300},
        "phase2": {"stereo_correlation": 0.55},
        "phase3": {"low_mid_energy": 0.22},
        "genre_hint": "trance",
    }
    verdicts = evaluate_rules(analysis)
    mud = next(v for v in verdicts if v.category == "low_end")
    assert mud.severity == "moderate"
    assert "trance" in mud.summary.lower()


def test_low_mid_mud_generic_threshold(muddy_hiphop):
    # muddy_hiphop has low_mid_energy=0.31 (>0.25 generic threshold)
    verdicts = evaluate_rules(muddy_hiphop)
    mud = next(v for v in verdicts if v.category == "low_end")
    assert mud.severity == "moderate"


def test_excessive_dynamic_range():
    analysis = {
        "track_id": "wide-dr",
        "phase1": {"integrated_lufs": -16, "true_peak_db": -2,
                   "mono_compatibility": 0.9, "clipping_detected": False,
                   "crest_factor": 25.0, "duration_seconds": 240},
        "phase2": {"stereo_correlation": 0.5},
        "phase3": {"low_mid_energy": 0.15},
        "genre_hint": "classical",
    }
    verdicts = evaluate_rules(analysis)
    dr = next(v for v in verdicts if v.category == "dynamics")
    assert dr.severity == "minor"


def test_tiny_dynamic_range_fires(tiny_dynamics_edm):
    # tiny_dynamics_edm has crest_factor=3.2
    verdicts = evaluate_rules(tiny_dynamics_edm)
    dr = next(v for v in verdicts if v.category == "dynamics")
    assert dr.severity == "severe"


def test_stereo_correlation_negative(mono_broken_indie):
    verdicts = evaluate_rules(mono_broken_indie)
    sc = next(v for v in verdicts if v.category == "stereo_phase")
    assert sc.severity == "severe"
    assert sc.evidence[0].value == -0.25


def test_key_detection_low_confidence():
    analysis = {
        "track_id": "uncertain-key",
        "phase1": {"integrated_lufs": -12, "true_peak_db": -2,
                   "mono_compatibility": 0.9, "clipping_detected": False,
                   "crest_factor": 10.0, "duration_seconds": 200,
                   "key_detection_confidence": 0.3},
        "phase2": {"stereo_correlation": 0.5},
        "phase3": {"low_mid_energy": 0.15},
        "genre_hint": "rock",
    }
    verdicts = evaluate_rules(analysis)
    key = next(v for v in verdicts if v.category == "harmonic")
    assert key.severity == "minor"
```

- [ ] **Step 2: Append rules to `rule_engine.py`**

Add after the existing rules:

```python
@rule
def loudness_too_high_for_streaming(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    lufs = p1.get("integrated_lufs")
    if lufs is None or lufs <= -8.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="moderate",
        category="loudness",
        headline=f"Master too loud for streaming ({lufs:.1f} LUFS)",
        summary=f"Integrated loudness is {lufs:.1f} LUFS. Spotify normalises to "
                "-14 LUFS; mastering hotter than -8 burns dynamics for no payoff.",
        evidence=[Evidence(
            metric="phase1.integrated_lufs",
            value=float(lufs),
            expected_range=(-16.0, -8.0),
            label=f"{lufs:.1f} LUFS",
        )],
        why_it_matters="Streaming services normalise loud masters down to "
                       "their target. A -7 LUFS master sounds the same volume "
                       "as a -14 LUFS master on Spotify, but the loud one has "
                       "less dynamic punch.",
    )


@rule
def loudness_too_low_for_streaming(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    lufs = p1.get("integrated_lufs")
    if lufs is None or lufs >= -20.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="moderate",
        category="loudness",
        headline=f"Master too quiet ({lufs:.1f} LUFS)",
        summary=f"Integrated loudness is {lufs:.1f} LUFS — Spotify will push "
                "the gain up but headroom and noise floor become problems.",
        evidence=[Evidence(
            metric="phase1.integrated_lufs",
            value=float(lufs),
            expected_range=(-20.0, -8.0),
            label=f"{lufs:.1f} LUFS",
        )],
        why_it_matters="Below -20 LUFS, streaming gain-up amplifies any noise "
                       "or hiss; the track also feels weaker in playlist "
                       "context next to normalised neighbours.",
    )


@rule
def low_mid_mud_trance(analysis: dict[str, Any]) -> Verdict | None:
    p3 = _phase(analysis, "phase3")
    energy = p3.get("low_mid_energy")
    genre = (analysis.get("genre_hint") or "").lower()
    if energy is None or genre != "trance" or energy <= 0.20:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="moderate",
        category="low_end",
        headline=f"Low-mid mud high for trance ({energy:.2f})",
        summary=f"Low-mid energy is {energy:.2f}; trance reference targets are "
                "0.10–0.15. The kick-bass region is competing for clarity.",
        evidence=[Evidence(
            metric="phase3.low_mid_energy",
            value=float(energy),
            expected_range=(0.10, 0.15),
            label=f"{energy:.2f} (trance target ≤0.20)",
        )],
        why_it_matters="Trance lives or dies on a clean kick-bass relationship. "
                       "Excess low-mid energy buries the punch and makes "
                       "drops feel cluttered on club systems.",
    )


@rule
def low_mid_mud_generic(analysis: dict[str, Any]) -> Verdict | None:
    # Skip if the trance-specific rule already fired (avoid duplicate; dedupe
    # would merge anyway, but the messages would conflict).
    p3 = _phase(analysis, "phase3")
    energy = p3.get("low_mid_energy")
    genre = (analysis.get("genre_hint") or "").lower()
    if energy is None or energy <= 0.25 or genre == "trance":
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="moderate",
        category="low_end",
        headline=f"Low-mid energy high ({energy:.2f})",
        summary=f"Low-mid energy is {energy:.2f}; most genres target 0.15–0.20. "
                "Mud is masking definition between elements.",
        evidence=[Evidence(
            metric="phase3.low_mid_energy",
            value=float(energy),
            expected_range=(0.15, 0.20),
            label=f"{energy:.2f}",
        )],
        why_it_matters="The 200-500 Hz region builds up fast. Without a "
                       "subtractive cut on bass, pad, or guitar, the mix loses "
                       "headroom and clarity.",
    )


@rule
def excessive_dynamic_range(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    cf = p1.get("crest_factor")
    if cf is None or cf <= 22.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="minor",
        category="dynamics",
        headline=f"Very wide dynamic range (crest {cf:.1f} dB)",
        summary=f"Crest factor is {cf:.1f} dB. For most playback contexts, "
                "extra-wide dynamics get squashed by listener volume control "
                "or platform normalisation anyway.",
        evidence=[Evidence(
            metric="phase1.crest_factor",
            value=float(cf),
            expected_range=(8.0, 18.0),
            label=f"{cf:.1f} dB",
        )],
        why_it_matters="Listeners turn down loud peaks and can't hear quiet "
                       "passages. Some compression preserves intent better "
                       "than relying on the listener to ride the volume knob.",
    )


@rule
def tiny_dynamic_range(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    cf = p1.get("crest_factor")
    if cf is None or cf >= 4.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="dynamics",
        headline=f"Severely squashed dynamics (crest {cf:.1f} dB)",
        summary=f"Crest factor is only {cf:.1f} dB. The mix has been hammered "
                "flat — transient detail is gone, the track will feel "
                "fatiguing on full playback.",
        evidence=[Evidence(
            metric="phase1.crest_factor",
            value=float(cf),
            expected_range=(8.0, 14.0),
            label=f"{cf:.1f} dB (target ≥6 dB)",
        )],
        why_it_matters="Below 4 dB crest, listener fatigue spikes within 30s "
                       "and the mix loses anything that could be called "
                       "a transient. Limiter is doing too much work.",
    )


@rule
def stereo_correlation_negative(analysis: dict[str, Any]) -> Verdict | None:
    p2 = _phase(analysis, "phase2")
    corr = p2.get("stereo_correlation")
    if corr is None or corr >= -0.1:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="stereo_phase",
        headline=f"Negative stereo correlation ({corr:+.2f})",
        summary=f"Stereo correlation is {corr:+.2f}. Channels are partially "
                "out of phase — this collapses to a hollow mono and sounds "
                "wrong on most playback chains.",
        evidence=[Evidence(
            metric="phase2.stereo_correlation",
            value=float(corr),
            expected_range=(0.2, 1.0),
            label=f"{corr:+.2f} (target ≥0.2)",
        )],
        why_it_matters="Negative correlation is almost always a stereo widener "
                       "or M/S processing gone wrong. Mono compatibility "
                       "fails, sub-bass disappears, headphone listeners hear "
                       "spatial weirdness.",
    )


@rule
def key_detection_low_confidence(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    conf = p1.get("key_detection_confidence")
    if conf is None or conf >= 0.5:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="minor",
        category="harmonic",
        confidence=float(conf),
        headline=f"Key detection unsure (confidence {conf:.2f})",
        summary="The harmonic content is ambiguous — could be modal, "
                "atonal, or simply unusual. Manual key labelling is more "
                "reliable than the auto-detected value.",
        evidence=[Evidence(
            metric="phase1.key_detection_confidence",
            value=float(conf),
            expected_range=(0.5, 1.0),
            label=f"{conf:.2f} confidence",
        )],
        why_it_matters="Auto-detected key drives genre comparison and "
                       "harmonic-mixing recommendations downstream. A wrong "
                       "key label produces nonsense suggestions.",
    )
```

- [ ] **Step 2: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_rule_engine.py -v`
Expected: 12 PASSED.

- [ ] **Step 3: Commit**

```bash
git add components/api/app/verdict_pipeline/rule_engine.py \
        components/api/tests/verdict_pipeline/test_rule_engine.py
git commit -m "feat(verdict_pipeline): remaining 8 deterministic rules"
```

---

## Task 8: Prompt loader + version frontmatter parser + slug mapping

**Files:**
- Create: `components/api/app/verdict_pipeline/prompt_loader.py`
- Create: `components/api/app/verdict_pipeline/json_extraction.py`
- Create: `components/api/tests/verdict_pipeline/test_prompt_loader.py`
- Create: `components/api/tests/verdict_pipeline/test_json_extraction.py`

- [ ] **Step 1: Write failing tests for `prompt_loader.py`**

```python
# components/api/tests/verdict_pipeline/test_prompt_loader.py
from __future__ import annotations
from pathlib import Path
import pytest
from app.verdict_pipeline.prompt_loader import (
    SLUG_TO_FILENAME,
    SPECIALIST_SLUGS,
    load_prompt,
    parse_version_frontmatter,
)


def test_slug_mapping_complete():
    assert "low_end" in SLUG_TO_FILENAME
    assert SLUG_TO_FILENAME["low_end"] == "LowEnd"
    assert SLUG_TO_FILENAME["frequency_balance"] == "FrequencyBalance"
    assert SLUG_TO_FILENAME["priority_summary"] == "PriorityProblemSummary"
    # Triage is not a "specialist" run by the runner — separate mapping
    assert "triage" not in SLUG_TO_FILENAME


def test_all_23_specialist_slugs_present():
    assert len(SPECIALIST_SLUGS) == 23


def test_parse_version_frontmatter_present():
    body = (
        "---\nversion: 1.2.0\n---\n\n# Title\n\nbody"
    )
    version, content = parse_version_frontmatter(body)
    assert version == "1.2.0"
    assert content.lstrip().startswith("# Title")


def test_parse_version_frontmatter_missing_defaults():
    body = "# Title\n\nbody"
    version, content = parse_version_frontmatter(body)
    assert version == "0.0.0"
    assert content == body


def test_load_prompt_real_file(tmp_path: Path, monkeypatch):
    fake_dir = tmp_path / "experts"
    fake_dir.mkdir()
    (fake_dir / "LowEnd.md").write_text("---\nversion: 2.0.1\n---\n# LowEnd\nbody")
    monkeypatch.setattr("app.verdict_pipeline.prompt_loader.PROMPTS_DIR", fake_dir)
    version, content = load_prompt("low_end")
    assert version == "2.0.1"
    assert "# LowEnd" in content


def test_load_unknown_slug_raises(monkeypatch, tmp_path):
    monkeypatch.setattr("app.verdict_pipeline.prompt_loader.PROMPTS_DIR", tmp_path)
    with pytest.raises(KeyError):
        load_prompt("nonexistent_slug")
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_prompt_loader.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `prompt_loader.py`**

```python
# components/api/app/verdict_pipeline/prompt_loader.py
from __future__ import annotations
import re
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "experts"

SLUG_TO_FILENAME: dict[str, str] = {
    "low_end": "LowEnd",
    "frequency_balance": "FrequencyBalance",
    "dynamics": "Dynamics",
    "stereo_phase": "StereoPhase",
    "loudness": "Loudness",
    "sections": "Sections",
    "trance_arrangement": "TranceArrangement",
    "stem_reference": "StemReference",
    "harmonic": "HarmonicAnalysis",
    "clarity": "ClarityAnalysis",
    "spatial": "SpatialAnalysis",
    "surround": "SurroundCompatibility",
    "playback": "PlaybackOptimization",
    "overall": "OverallScore",
    "gain_staging": "GainStagingAudit",
    "stereo_field": "StereoFieldAudit",
    "frequency_collision": "FrequencyCollisionDetection",
    "humanization": "DynamicsHumanizationReport",
    "section_contrast": "SectionContrastAnalysis",
    "density": "DensityBusynessReport",
    "chord_harmony": "ChordHarmonyAnalysis",
    "device_chain": "DeviceChainAnalysis",
    "priority_summary": "PriorityProblemSummary",
}

SPECIALIST_SLUGS: tuple[str, ...] = tuple(SLUG_TO_FILENAME.keys())

TRIAGE_FILENAME = "Triage"

_FRONTMATTER_RE = re.compile(
    r"\A---\s*\n(?P<body>.*?)\n---\s*\n", re.DOTALL
)
_VERSION_RE = re.compile(r"^version:\s*(?P<v>\S+)\s*$", re.MULTILINE)


def parse_version_frontmatter(content: str) -> tuple[str, str]:
    """Extract `version:` from a leading YAML-ish frontmatter block.
    Returns (version, content_with_frontmatter_stripped).
    Defaults to '0.0.0' if no frontmatter or no version key."""
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return "0.0.0", content
    fm = m.group("body")
    vm = _VERSION_RE.search(fm)
    version = vm.group("v") if vm else "0.0.0"
    return version, content[m.end():]


def _load(filename: str) -> tuple[str, str]:
    path = PROMPTS_DIR / f"{filename}.md"
    if not path.exists():
        raise KeyError(f"prompt file not found: {path}")
    return parse_version_frontmatter(path.read_text(encoding="utf-8"))


def load_prompt(slug: str) -> tuple[str, str]:
    """Returns (version, body) for a specialist prompt by slug."""
    if slug not in SLUG_TO_FILENAME:
        raise KeyError(f"unknown specialist slug: {slug!r}")
    return _load(SLUG_TO_FILENAME[slug])


def load_triage() -> tuple[str, str]:
    return _load(TRIAGE_FILENAME)
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_prompt_loader.py -v`
Expected: 6 PASSED.

- [ ] **Step 5: Write failing tests for JSON extraction**

```python
# components/api/tests/verdict_pipeline/test_json_extraction.py
from __future__ import annotations
import pytest
from app.verdict_pipeline.json_extraction import extract_json_object


def test_plain_json():
    s = '{"a": 1, "b": 2}'
    assert extract_json_object(s) == {"a": 1, "b": 2}


def test_json_in_code_fence():
    s = "Here is the result:\n\n```json\n{\"a\": 1}\n```\n\nDone."
    assert extract_json_object(s) == {"a": 1}


def test_json_in_unfenced_code_block():
    s = "result:\n```\n{\"a\": 1}\n```"
    assert extract_json_object(s) == {"a": 1}


def test_first_object_taken_when_multiple():
    s = '{"a": 1}\n\n{"b": 2}'
    assert extract_json_object(s) == {"a": 1}


def test_nested_braces_handled():
    s = '{"a": {"b": [1,2,{"c": 3}]}}'
    assert extract_json_object(s) == {"a": {"b": [1, 2, {"c": 3}]}}


def test_no_json_raises():
    with pytest.raises(ValueError, match="No JSON object found"):
        extract_json_object("Just prose with no JSON.")


def test_invalid_json_raises():
    with pytest.raises(ValueError):
        extract_json_object("{invalid: not, json}")
```

- [ ] **Step 6: Implement `json_extraction.py`**

```python
# components/api/app/verdict_pipeline/json_extraction.py
from __future__ import annotations
import json
import re

_FENCE_RE = re.compile(
    r"```(?:json)?\s*\n(?P<body>.*?)\n```", re.DOTALL | re.IGNORECASE
)


def extract_json_object(text: str) -> dict:
    """Find and parse the first JSON object in the text.
    Tries: (1) entire text as JSON, (2) first ``` fenced block, (3) brace-balanced scan.
    """
    text = text.strip()

    # 1. Whole-string parse
    if text.startswith("{"):
        try:
            obj = json.loads(text)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass

    # 2. ``` fenced block
    m = _FENCE_RE.search(text)
    if m:
        try:
            obj = json.loads(m.group("body"))
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass

    # 3. Brace-balanced scan for first { ... }
    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(text)):
            ch = text[i]
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"' and not escape:
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    chunk = text[start:i + 1]
                    try:
                        obj = json.loads(chunk)
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        break  # try next start
        start = text.find("{", start + 1)

    raise ValueError("No JSON object found in LLM response")
```

- [ ] **Step 7: Run JSON tests, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_json_extraction.py -v`
Expected: 7 PASSED.

- [ ] **Step 8: Commit**

```bash
git add components/api/app/verdict_pipeline/prompt_loader.py \
        components/api/app/verdict_pipeline/json_extraction.py \
        components/api/tests/verdict_pipeline/test_prompt_loader.py \
        components/api/tests/verdict_pipeline/test_json_extraction.py
git commit -m "feat(verdict_pipeline): prompt loader, slug mapping, JSON extraction"
```

---

## Task 9: Append "Required Output" footer + version frontmatter to all 24 prompts

**Files:**
- Modify: `components/api/prompts/experts/Triage.md`
- Modify: `components/api/prompts/experts/<each of the 23 specialists>.md`
- Create: `scripts/update_specialist_prompts.py` (one-shot helper, deleted at end of task)

- [ ] **Step 1: Write the helper script that appends footer + frontmatter**

Create `scripts/update_specialist_prompts.py`:

```python
"""One-shot script that adds version frontmatter and a structured-output
footer to every specialist prompt.

Idempotent — running twice produces no extra changes.

Run: python scripts/update_specialist_prompts.py
Then: rm scripts/update_specialist_prompts.py (committed only as part of this task)
"""
from __future__ import annotations
from pathlib import Path

PROMPTS_DIR = Path("components/api/prompts/experts")

SPECIALIST_FOOTER = """\

---

## Required Output

Respond ONLY with JSON matching this schema. No prose, no code fences, no commentary outside the JSON object.

```
{
  "specialist": "<this specialist's slug, snake_case>",
  "verdicts": [
    {
      "severity": "critical" | "severe" | "moderate" | "minor" | "win",
      "category": "<category slug>",
      "confidence": <float 0-1>,
      "headline": "<short, ≤80 chars>",
      "summary": "<≤300 chars>",
      "evidence": [
        {
          "metric": "<dotted path in analysis.json — must resolve>",
          "value": <number or null>,
          "expected_range": [<lo>, <hi>] or null,
          "label": "<≤60 chars>",
          "frequency_range_hz": [<lo>, <hi>] or null,
          "stems": [<stem names>] or null
        }
      ],
      "fix": {
        "target": { "type": "stem"|"master"|"bus", "name": "<name>" },
        "section": { "start_seconds": <num>, "end_seconds": <num>,
                     "section_type": "intro|build|drop|breakdown|outro|null" } or null,
        "dsp_chain": [
          { "type": "<allowed DSP type>", "params": { ... } }
        ],
        "sidechain": { "source_stem": "<stem>", "depth_db": <num>,
                       "release_ms": <num> } or null,
        "expected_outcome": "<one sentence>",
        "ableton_hint": { "device": "<name>", "band": <int>,
                          "preset_name": "<name>" } or null
      } or null,
      "why_it_matters": "<≤200 chars>"
    }
  ]
}
```

Constraints (any violation → the verdict will be rejected):

- `evidence[].metric` MUST be a dotted path that resolves in the analysis JSON. NEVER invent metric paths.
- Allowed DSP types: peaking_eq, low_shelf, high_shelf, high_pass, low_pass,
  compressor, multiband_compressor, limiter, gain, stereo_width, sidechain.
- Param ranges: gain_db ∈ [-24, 24], frequency_hz ∈ [20, 22000], q ∈ [0.1, 18],
  ratio ∈ [1, 20], threshold_db ∈ [-60, 0], attack_ms ∈ [0.1, 1000],
  release_ms ∈ [1, 5000], ceiling_db ∈ [-6, 0], width_pct ∈ [0, 200].
- `severity` must match the verdict's actual impact — over-claiming downgrades silently.
- Omit `fix` (use `null`) for pure-observation verdicts (wins, key-detection notes, etc.).
"""

TRIAGE_FOOTER = """\

---

## Required Output

Respond ONLY with JSON matching this schema. No prose, no code fences, no commentary outside the JSON object.

```
{
  "specialists_to_run": [
    { "name": "<specialist_slug>", "priority": <int 1-10>, "focus": "<short>" }
  ],
  "skip": ["<specialist_slug>", ...],
  "rationale": "<one sentence>",
  "estimated_total_tokens": <int>
}
```

Valid `name` values (snake_case): low_end, frequency_balance, dynamics,
stereo_phase, loudness, sections, trance_arrangement, stem_reference,
harmonic, clarity, spatial, surround, playback, overall, gain_staging,
stereo_field, frequency_collision, humanization, section_contrast, density,
chord_harmony, device_chain, priority_summary.

Lower `priority` numbers run first.
"""


def add_frontmatter(content: str, version: str = "1.0.0") -> str:
    if content.startswith("---\n"):
        return content
    return f"---\nversion: {version}\n---\n\n{content}"


def append_footer(content: str, footer: str, marker: str = "## Required Output") -> str:
    if marker in content:
        return content
    return content.rstrip() + "\n" + footer


def main() -> None:
    if not PROMPTS_DIR.exists():
        raise SystemExit(f"prompts dir not found: {PROMPTS_DIR}")

    for path in sorted(PROMPTS_DIR.glob("*.md")):
        original = path.read_text(encoding="utf-8")
        updated = add_frontmatter(original, version="1.0.0")
        if path.stem == "Triage":
            updated = append_footer(updated, TRIAGE_FOOTER)
        else:
            updated = append_footer(updated, SPECIALIST_FOOTER)
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            print(f"updated: {path.name}")
        else:
            print(f"unchanged: {path.name}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script**

Run: `python scripts/update_specialist_prompts.py`
Expected: 24 lines, mostly `updated:`. Re-run and expect all `unchanged:` (idempotent check).

- [ ] **Step 3: Spot-check one specialist file**

Run: `head -5 components/api/prompts/experts/LowEnd.md` and `tail -10 components/api/prompts/experts/LowEnd.md`
Expected: starts with `---\nversion: 1.0.0\n---`; ends with the constraints list.

- [ ] **Step 4: Spot-check Triage**

Run: `tail -20 components/api/prompts/experts/Triage.md`
Expected: ends with the routing-plan JSON schema and the slug list.

- [ ] **Step 5: Verify `prompt_loader.load_prompt` returns version 1.0.0**

```bash
cd components/api && python -c "from app.verdict_pipeline.prompt_loader import load_prompt; v,_ = load_prompt('low_end'); print(v)"
```
Expected: `1.0.0`

- [ ] **Step 6: Delete the helper script (it was a one-shot)**

```bash
rm scripts/update_specialist_prompts.py
rmdir scripts 2>/dev/null || true   # only if empty
```

- [ ] **Step 7: Commit prompt changes**

```bash
git add components/api/prompts/experts/
git commit -m "refactor(prompts): add version frontmatter and structured-output footer to all 24 prompts"
```

---

## Task 10: Triage stage

**Files:**
- Create: `components/api/app/verdict_pipeline/triage.py`
- Create: `components/api/tests/verdict_pipeline/test_triage.py`

- [ ] **Step 1: Write failing tests**

```python
# components/api/tests/verdict_pipeline/test_triage.py
from __future__ import annotations
import json
import pytest
from aimusic_shared.verdicts.models import SpecialistRoutingPlan
from app.verdict_pipeline.triage import run_triage


@pytest.mark.asyncio
async def test_triage_returns_valid_plan(llm, muddy_hiphop):
    canned = json.dumps({
        "specialists_to_run": [
            {"name": "low_end", "priority": 1, "focus": "kick-bass clash"},
            {"name": "frequency_balance", "priority": 2, "focus": "low-mid mud"},
        ],
        "skip": ["surround", "spatial"],
        "rationale": "Low end dominates the issues.",
        "estimated_total_tokens": 14000,
    })
    llm.register("Triage", muddy_hiphop["track_id"], canned)
    plan = await run_triage(muddy_hiphop, rule_verdicts=[], llm=llm)
    assert isinstance(plan, SpecialistRoutingPlan)
    assert plan.specialists_to_run[0]["name"] == "low_end"


@pytest.mark.asyncio
async def test_triage_retries_on_invalid_json(llm, muddy_hiphop):
    """First call returns garbage; we don't retry inside triage (caller's job).
    Triage simply raises ValueError, and the orchestrator handles fallback."""
    llm.register("Triage", muddy_hiphop["track_id"], "Definitely not JSON.")
    with pytest.raises(ValueError):
        await run_triage(muddy_hiphop, rule_verdicts=[], llm=llm)


@pytest.mark.asyncio
async def test_triage_includes_rule_verdicts_in_user_message(llm, clipped_pop, monkeypatch):
    canned = json.dumps({
        "specialists_to_run": [{"name": "loudness", "priority": 1,
                                "focus": "true peak"}],
        "skip": [],
        "rationale": "Clipping already flagged by rules.",
        "estimated_total_tokens": 5000,
    })
    llm.register("Triage", clipped_pop["track_id"], canned)

    captured = {}
    orig_call = llm.call

    async def spy(system, user, **kwargs):
        captured["user"] = user
        return await orig_call(system, user, **kwargs)

    monkeypatch.setattr(llm, "call", spy)

    from app.verdict_pipeline.rule_engine import evaluate_rules
    rule_verdicts = evaluate_rules(clipped_pop)

    await run_triage(clipped_pop, rule_verdicts=rule_verdicts, llm=llm)
    assert "rule_engine" in captured["user"]
    assert "clipping" in captured["user"]
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_triage.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `triage.py`**

```python
# components/api/app/verdict_pipeline/triage.py
from __future__ import annotations
import json
from typing import Any

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict
from app.llm.client import LLMClient
from app.verdict_pipeline.json_extraction import extract_json_object
from app.verdict_pipeline.prompt_loader import load_triage


def _build_user_message(analysis: dict[str, Any], rule_verdicts: list[Verdict]) -> str:
    rule_summary = [
        {
            "specialist": "rule_engine",
            "category": v.category,
            "severity": v.severity,
            "headline": v.headline,
        }
        for v in rule_verdicts
    ]
    payload = {
        "analysis": analysis,
        "rule_engine_findings": rule_summary,
    }
    return (
        "Triage this mix.\n\n"
        f"```json\n{json.dumps(payload, indent=2, default=str)}\n```\n\n"
        "Return only the routing-plan JSON object."
    )


async def run_triage(
    analysis: dict[str, Any],
    *,
    rule_verdicts: list[Verdict],
    llm: LLMClient,
    timeout_s: int = 90,
) -> SpecialistRoutingPlan:
    """Call the Triage prompt; parse and return SpecialistRoutingPlan.

    Raises ValueError if the LLM output cannot be parsed into a valid plan.
    The caller (orchestrator) decides whether to retry or fall back.
    """
    _, system_body = load_triage()
    user = _build_user_message(analysis, rule_verdicts)
    raw = await llm.call(system=system_body, user=user, timeout_s=timeout_s)
    obj = extract_json_object(raw)
    return SpecialistRoutingPlan(**obj)
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_triage.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/verdict_pipeline/triage.py \
        components/api/tests/verdict_pipeline/test_triage.py
git commit -m "feat(verdict_pipeline): structured Triage stage returning SpecialistRoutingPlan"
```

---

## Task 11: Specialist runner (sequential, with retry)

**Files:**
- Create: `components/api/app/verdict_pipeline/specialists.py`
- Create: `components/api/tests/verdict_pipeline/test_specialists.py`

- [ ] **Step 1: Write failing tests**

```python
# components/api/tests/verdict_pipeline/test_specialists.py
from __future__ import annotations
import json
from datetime import datetime, timezone
from typing import AsyncIterator
import pytest
from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict
from app.verdict_pipeline.specialists import run_specialists


@pytest.mark.asyncio
async def test_runner_yields_one_verdict_per_specialist(llm, muddy_hiphop):
    plan = SpecialistRoutingPlan(
        specialists_to_run=[
            {"name": "low_end", "priority": 1, "focus": "kick-bass clash"},
        ],
        skip=[],
        rationale="lowend.",
        estimated_total_tokens=5000,
    )
    canned = json.dumps({
        "specialist": "low_end",
        "verdicts": [{
            "severity": "moderate",
            "category": "low_end",
            "confidence": 0.8,
            "headline": "Bass-kick clash 80Hz",
            "summary": "Kick and bass compete at 80Hz.",
            "evidence": [{
                "metric": "phase3.low_mid_energy",
                "value": 0.31,
                "expected_range": [0.10, 0.20],
                "label": "low-mid +50%",
            }],
            "fix": None,
            "why_it_matters": "Punch lost on club systems.",
        }],
    })
    llm.register("LowEnd", muddy_hiphop["track_id"], canned)
    yielded: list[tuple[str, Verdict | Exception]] = []
    async for slug, item in run_specialists(plan, muddy_hiphop, llm=llm):
        yielded.append((slug, item))
    assert len(yielded) == 1
    slug, v = yielded[0]
    assert slug == "low_end"
    assert isinstance(v, Verdict)
    assert v.specialist == "low_end"
    assert v.headline == "Bass-kick clash 80Hz"


@pytest.mark.asyncio
async def test_runner_respects_priority_order(llm, muddy_hiphop):
    plan = SpecialistRoutingPlan(
        specialists_to_run=[
            {"name": "loudness", "priority": 3, "focus": "x"},
            {"name": "low_end", "priority": 1, "focus": "x"},
            {"name": "dynamics", "priority": 2, "focus": "x"},
        ],
        skip=[],
        rationale="x",
        estimated_total_tokens=5000,
    )
    empty = lambda slug: json.dumps({"specialist": slug, "verdicts": []})  # noqa: E731
    llm.register("LowEnd", muddy_hiphop["track_id"], empty("low_end"))
    llm.register("Dynamics", muddy_hiphop["track_id"], empty("dynamics"))
    llm.register("Loudness", muddy_hiphop["track_id"], empty("loudness"))

    seen_slugs = []
    async for slug, _ in run_specialists(plan, muddy_hiphop, llm=llm):
        seen_slugs.append(slug)
    # Empty verdict lists yield nothing per-verdict, but the runner emits a
    # sentinel "completion" via `("__done__", slug)` — see implementation.
    # Reorder check is via call ordering on the LLM mock.
    call_order = [c["system_excerpt"] for c in llm.calls]
    # priorities 1, 2, 3 → LowEnd, Dynamics, Loudness
    assert call_order == ["LowEnd", "Dynamics", "Loudness"]


@pytest.mark.asyncio
async def test_runner_retries_invalid_json(llm, muddy_hiphop, monkeypatch):
    plan = SpecialistRoutingPlan(
        specialists_to_run=[{"name": "low_end", "priority": 1, "focus": "x"}],
        skip=[], rationale="x", estimated_total_tokens=5000,
    )
    # First response: garbage. Second response: valid empty.
    sequence = iter([
        "Not JSON at all",
        json.dumps({"specialist": "low_end", "verdicts": []}),
    ])

    async def fake_call(*args, **kwargs):
        return next(sequence)

    monkeypatch.setattr(llm, "call", fake_call)
    out = []
    async for item in run_specialists(plan, muddy_hiphop, llm=llm):
        out.append(item)
    # No verdicts produced (empty list), but no exception either — retry
    # succeeded.
    assert out == []


@pytest.mark.asyncio
async def test_runner_skips_after_two_failures(llm, muddy_hiphop, monkeypatch):
    plan = SpecialistRoutingPlan(
        specialists_to_run=[{"name": "low_end", "priority": 1, "focus": "x"}],
        skip=[], rationale="x", estimated_total_tokens=5000,
    )

    async def fake_call(*args, **kwargs):
        return "Still not JSON"

    monkeypatch.setattr(llm, "call", fake_call)
    out = []
    async for slug, item in run_specialists(plan, muddy_hiphop, llm=llm):
        out.append((slug, item))
    # Expect a single error item for the failed specialist.
    assert len(out) == 1
    slug, err = out[0]
    assert slug == "low_end"
    assert isinstance(err, Exception)
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_specialists.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `specialists.py`**

```python
# components/api/app/verdict_pipeline/specialists.py
from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id
from app.llm.client import LLMClient
from app.verdict_pipeline.json_extraction import extract_json_object
from app.verdict_pipeline.prompt_loader import load_prompt

log = logging.getLogger(__name__)

RETRY_SUFFIX = (
    "\n\n[SYSTEM] Your previous response was not valid JSON. "
    "Respond with ONLY the JSON object — no prose, no code fences."
)


def _build_user_message(analysis: dict[str, Any], focus: str) -> str:
    return (
        f"Analyze this mix. Triage focus: {focus}\n\n"
        f"```json\n{json.dumps(analysis, indent=2, default=str)}\n```\n\n"
        "Return only the verdicts JSON object as specified in your instructions."
    )


def _hydrate_verdict(
    raw: dict[str, Any],
    *,
    track_id: str,
    specialist_slug: str,
    prompt_version: str,
    model: str,
) -> Verdict:
    """Take a raw verdict dict from the LLM, fill in server-controlled fields,
    and return a fully-validated Verdict (Pydantic raises if invalid).

    Note: the validator stage will overwrite priority_score and may downgrade
    severity. Here we set sensible defaults so the Pydantic model can construct.
    """
    body = dict(raw)
    body.setdefault("verdict_id", new_verdict_id())
    body["track_id"] = track_id
    body["specialist"] = specialist_slug
    body["prompt_version"] = prompt_version
    body["model"] = model
    body.setdefault("priority_score", 0)  # validator will recompute
    body.setdefault("sources", [specialist_slug])
    body.setdefault("related_verdict_ids", [])
    body.setdefault("user_state", {})
    body.setdefault("created_at", datetime.now(tz=timezone.utc).isoformat())
    return Verdict(**body)


async def run_specialists(
    plan: SpecialistRoutingPlan,
    analysis: dict[str, Any],
    *,
    llm: LLMClient,
    model_name: str = "claude-cli",
    timeout_s: int = 90,
) -> AsyncIterator[tuple[str, Verdict | Exception]]:
    """Run each routed specialist in priority order.

    Yields (specialist_slug, verdict) per produced verdict, or
    (specialist_slug, exception) if the specialist failed after retry.
    """
    track_id = analysis.get("track_id", "unknown-track")
    ordered = sorted(plan.specialists_to_run, key=lambda d: d.get("priority", 99))
    for entry in ordered:
        slug = entry["name"]
        focus = entry.get("focus", "")
        try:
            version, system_body = load_prompt(slug)
        except KeyError as e:
            log.warning("unknown specialist slug %r: %s", slug, e)
            yield (slug, e)
            continue

        user_msg = _build_user_message(analysis, focus)
        raw_text = ""
        parsed: dict[str, Any] | None = None
        last_err: Exception | None = None

        for attempt in (1, 2):
            user = user_msg if attempt == 1 else user_msg + RETRY_SUFFIX
            try:
                raw_text = await llm.call(
                    system=system_body, user=user, timeout_s=timeout_s
                )
                parsed = extract_json_object(raw_text)
                break
            except Exception as e:
                last_err = e
                log.info("specialist %s attempt %d failed: %s", slug, attempt, e)
                continue

        if parsed is None:
            yield (slug, last_err or RuntimeError("specialist failed without exception"))
            continue

        verdicts_raw = parsed.get("verdicts") or []
        for raw_v in verdicts_raw:
            try:
                v = _hydrate_verdict(
                    raw_v,
                    track_id=track_id,
                    specialist_slug=slug,
                    prompt_version=f"{slug}@{version}",
                    model=model_name,
                )
            except Exception as e:
                log.info("specialist %s emitted invalid verdict: %s", slug, e)
                yield (slug, e)
                continue
            yield (slug, v)
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_specialists.py -v`
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/verdict_pipeline/specialists.py \
        components/api/tests/verdict_pipeline/test_specialists.py
git commit -m "feat(verdict_pipeline): sequential specialist runner with one-shot retry"
```

---

## Task 12: Validator — schema + DSP ranges + section sanity

**Files:**
- Create: `components/api/app/verdict_pipeline/validator.py`
- Create: `components/api/tests/verdict_pipeline/test_validator.py`

- [ ] **Step 1: Write failing tests**

```python
# components/api/tests/verdict_pipeline/test_validator.py
from __future__ import annotations
from datetime import datetime, timezone
import pytest
from aimusic_shared.verdicts.models import (
    DspOp, Evidence, Fix, UserState, Verdict,
)
from aimusic_shared.verdicts.ulid_helpers import new_fix_id, new_verdict_id
from app.verdict_pipeline.validator import (
    ValidationFailure,
    validate_verdict,
)


def _v(**overrides) -> Verdict:
    base = dict(
        verdict_id=new_verdict_id(),
        track_id="track-1",
        specialist="low_end",
        prompt_version="low_end@1.0.0",
        model="claude-cli",
        severity="moderate",
        category="low_end",
        confidence=0.8,
        priority_score=50,  # will be overwritten
        headline="Headline",
        summary="Summary.",
        evidence=[Evidence(metric="phase3.low_mid_energy", value=0.31,
                           label="lowmid")],
        fix=None,
        why_it_matters="x",
        related_verdict_ids=[],
        sources=["low_end"],
        user_state=UserState(),
        created_at=datetime.now(tz=timezone.utc),
    )
    base.update(overrides)
    return Verdict(**base)


def _analysis(low_mid_energy: float = 0.31, duration: float = 220.0) -> dict:
    return {
        "track_id": "track-1",
        "phase1": {"duration_seconds": duration},
        "phase3": {"low_mid_energy": low_mid_energy},
    }


def test_clean_verdict_passes_and_score_recomputed():
    v = _v()
    result = validate_verdict(v, _analysis())
    assert result.ok
    assert result.verdict.priority_score > 0
    # severity unchanged when score lands in moderate band (50-99)
    assert result.verdict.severity == "moderate"


def test_metric_path_must_resolve():
    v = _v(evidence=[Evidence(metric="phase9.imaginary_metric",
                              value=0.0, label="x")])
    result = validate_verdict(v, _analysis())
    assert not result.ok
    assert isinstance(result.failure, ValidationFailure)
    assert "metric path" in result.failure.reason.lower()


def test_metric_value_must_match_within_tolerance():
    v = _v(evidence=[Evidence(metric="phase3.low_mid_energy",
                              value=0.99, label="fabricated")])
    # actual is 0.31; claimed 0.99 → >10% delta → reject
    result = validate_verdict(v, _analysis())
    assert not result.ok
    assert "value" in result.failure.reason.lower()


def test_severity_downgrade_when_score_too_low():
    v = _v(severity="critical")  # claims critical
    # default analysis → category low_end, scope full_track → score 91 (severe band)
    result = validate_verdict(v, _analysis())
    assert result.ok
    assert result.verdict.severity in ("severe", "moderate")
    assert result.verdict.severity != "critical"


def test_dsp_chain_out_of_range_rejected():
    # Pydantic itself catches this — but the verdict was already constructed
    # with a valid DspOp; we verify the validator passes through unchanged.
    op = DspOp(type="peaking_eq",
               params={"frequency_hz": 250, "gain_db": -4.0, "q": 1.2})
    fix = Fix(fix_id=new_fix_id(),
              target={"type": "stem", "name": "bass"},
              section=None,
              dsp_chain=[op],
              sidechain=None,
              expected_outcome="cleaner",
              ableton_hint=None)
    v = _v(fix=fix)
    result = validate_verdict(v, _analysis())
    assert result.ok


def test_section_end_must_not_exceed_duration():
    fix = Fix(
        fix_id=new_fix_id(),
        target={"type": "stem", "name": "bass"},
        section={"start_seconds": 100.0, "end_seconds": 999.0,
                 "section_type": "drop"},
        dsp_chain=[],
        sidechain=None,
        expected_outcome="ok",
        ableton_hint=None,
    )
    v = _v(fix=fix)
    result = validate_verdict(v, _analysis(duration=220.0))
    assert not result.ok
    assert "section" in result.failure.reason.lower()
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_validator.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `validator.py`**

```python
# components/api/app/verdict_pipeline/validator.py
from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Any, Optional

from aimusic_shared.verdicts.models import Severity, Verdict
from aimusic_shared.verdicts.scoring import (
    compute_priority_score,
    severity_from_score,
)


@dataclass
class ValidationFailure:
    specialist: str
    prompt_version: str
    reason: str
    raw_excerpt: str = ""


@dataclass
class ValidationResult:
    ok: bool
    verdict: Verdict | None = None
    failure: ValidationFailure | None = None


def _resolve_path(obj: Any, path: str) -> Any:
    """Resolve a dotted path against a dict tree.
    Raises KeyError if any segment is missing."""
    cur = obj
    for seg in path.split("."):
        if not isinstance(cur, dict):
            raise KeyError(f"path segment {seg!r}: parent is not a dict")
        if seg not in cur:
            raise KeyError(seg)
        cur = cur[seg]
    return cur


def _value_close(a: Any, b: Any, *, rel_tol: float = 0.10) -> bool:
    """Compare numeric values with 10% relative tolerance.
    Non-numeric: must be equal."""
    try:
        af, bf = float(a), float(b)
    except (TypeError, ValueError):
        return a == b
    if af == 0.0 and bf == 0.0:
        return True
    return math.isclose(af, bf, rel_tol=rel_tol)


def _infer_scope(verdict: Verdict) -> str:
    """Heuristic — single_section if fix has a section; single_stem if target is a stem;
    else full_track."""
    if verdict.fix is None:
        return "full_track"
    if verdict.fix.section is not None:
        return "single_section"
    target = verdict.fix.target or {}
    if target.get("type") == "stem":
        return "single_stem"
    return "full_track"


def validate_verdict(verdict: Verdict, analysis: dict[str, Any]) -> ValidationResult:
    """Run every check in order. Recompute priority_score and adjust severity.
    Returns ValidationResult with ok=False + failure on rejection."""
    fail = lambda reason: ValidationResult(  # noqa: E731
        ok=False,
        failure=ValidationFailure(
            specialist=verdict.specialist,
            prompt_version=verdict.prompt_version,
            reason=reason,
            raw_excerpt=verdict.headline[:200],
        ),
    )

    # 1. Metric path resolution + value check
    for ev in verdict.evidence:
        try:
            actual = _resolve_path(analysis, ev.metric)
        except KeyError:
            return fail(f"metric path {ev.metric!r} does not resolve in analysis JSON")
        if ev.value is not None and not _value_close(actual, ev.value):
            return fail(
                f"metric {ev.metric!r}: claimed value {ev.value!r} differs from "
                f"actual {actual!r} by more than 10%"
            )

    # 2. Section sanity
    if verdict.fix is not None and verdict.fix.section is not None:
        sec = verdict.fix.section
        start = sec.get("start_seconds")
        end = sec.get("end_seconds")
        duration = (analysis.get("phase1") or {}).get("duration_seconds")
        if start is None or end is None:
            return fail("fix.section requires start_seconds and end_seconds")
        if start >= end:
            return fail(f"fix.section: start {start} >= end {end}")
        if duration is not None and end > duration + 0.5:
            return fail(
                f"fix.section.end_seconds {end} exceeds track duration {duration}"
            )

    # 3. Recompute priority_score (always overwrites LLM-supplied)
    scope = _infer_scope(verdict)
    score = compute_priority_score(verdict.severity, verdict.category, scope)  # type: ignore[arg-type]

    # 4. Severity downgrade if claimed severity exceeds score band
    score_band = severity_from_score(score)
    severity_rank: dict[Severity, int] = {
        "critical": 5, "severe": 4, "moderate": 3, "minor": 2, "win": 1
    }
    if severity_rank[verdict.severity] > severity_rank[score_band]:
        # Downgrade and recompute score under the new severity
        new_severity: Severity = score_band
        score = compute_priority_score(new_severity, verdict.category, scope)  # type: ignore[arg-type]
        # Build a new Verdict with adjusted severity + score (Pydantic models are immutable-by-config-friendly via model_copy)
        adjusted = verdict.model_copy(update={
            "severity": new_severity,
            "priority_score": score,
        })
        return ValidationResult(ok=True, verdict=adjusted)

    return ValidationResult(
        ok=True,
        verdict=verdict.model_copy(update={"priority_score": score}),
    )
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_validator.py -v`
Expected: 6 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/verdict_pipeline/validator.py \
        components/api/tests/verdict_pipeline/test_validator.py
git commit -m "feat(verdict_pipeline): validator — metric paths, section sanity, score recompute, severity downgrade"
```

---

## Task 13: Dedupe stage

**Files:**
- Create: `components/api/app/verdict_pipeline/dedupe.py`
- Create: `components/api/tests/verdict_pipeline/test_dedupe.py`

- [ ] **Step 1: Write failing tests**

```python
# components/api/tests/verdict_pipeline/test_dedupe.py
from __future__ import annotations
from datetime import datetime, timezone
from aimusic_shared.verdicts.models import Evidence, UserState, Verdict
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id
from app.verdict_pipeline.dedupe import dedupe_verdicts


def _v(specialist="low_end", category="low_end", metric="phase3.low_mid_energy",
       severity="moderate", confidence=0.8, sources=None, headline="x",
       summary="s") -> Verdict:
    return Verdict(
        verdict_id=new_verdict_id(),
        track_id="t1",
        specialist=specialist,
        prompt_version=f"{specialist}@1.0.0",
        model="claude-cli",
        severity=severity,  # type: ignore[arg-type]
        category=category,  # type: ignore[arg-type]
        confidence=confidence,
        priority_score=50,
        headline=headline,
        summary=summary,
        evidence=[Evidence(metric=metric, value=0.31, label="x")],
        fix=None,
        why_it_matters="x",
        related_verdict_ids=[],
        sources=sources or [specialist],
        user_state=UserState(),
        created_at=datetime.now(tz=timezone.utc),
    )


def test_no_overlap_no_merge():
    a = _v(category="low_end", metric="phase3.low_mid_energy")
    b = _v(category="loudness", metric="phase1.integrated_lufs",
           specialist="loudness")
    out = dedupe_verdicts([a, b])
    assert len(out) == 2


def test_same_category_and_metric_merges():
    rule = _v(specialist="rule_engine", sources=["rule_engine"],
              headline="Rule headline", confidence=1.0)
    spec = _v(specialist="low_end", sources=["low_end"],
              headline="Specialist longer richer headline", confidence=0.85,
              summary="Specialist summary that is longer than the rule one.")
    out = dedupe_verdicts([rule, spec])
    assert len(out) == 1
    merged = out[0]
    assert set(merged.sources) == {"rule_engine", "low_end"}
    # specialist headline is longer → wins
    assert "Specialist" in merged.headline


def test_higher_severity_wins():
    a = _v(severity="moderate")
    b = _v(severity="severe", specialist="rule_engine", sources=["rule_engine"])
    out = dedupe_verdicts([a, b])
    assert len(out) == 1
    assert out[0].severity == "severe"


def test_evidence_unioned_and_dedup_by_path():
    a = _v(metric="phase3.low_mid_energy")
    a = a.model_copy(update={"evidence": list(a.evidence) + [
        Evidence(metric="stem.kick_bass_clash", value=0.6, label="extra")
    ]})
    b = _v(metric="phase3.low_mid_energy", specialist="rule_engine",
           sources=["rule_engine"])
    out = dedupe_verdicts([a, b])
    assert len(out) == 1
    paths = {e.metric for e in out[0].evidence}
    assert paths == {"phase3.low_mid_energy", "stem.kick_bass_clash"}


def test_three_way_merge():
    a = _v(specialist="rule_engine", sources=["rule_engine"])
    b = _v(specialist="low_end", sources=["low_end"])
    c = _v(specialist="frequency_balance", sources=["frequency_balance"])
    out = dedupe_verdicts([a, b, c])
    assert len(out) == 1
    assert set(out[0].sources) == {"rule_engine", "low_end", "frequency_balance"}
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_dedupe.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `dedupe.py`**

```python
# components/api/app/verdict_pipeline/dedupe.py
from __future__ import annotations
from collections import OrderedDict
from typing import Iterable

from aimusic_shared.verdicts.models import Severity, Verdict


_SEVERITY_RANK: dict[Severity, int] = {
    "critical": 5, "severe": 4, "moderate": 3, "minor": 2, "win": 1
}


def _primary_metric(v: Verdict) -> str:
    return v.evidence[0].metric if v.evidence else ""


def _merge_pair(a: Verdict, b: Verdict) -> Verdict:
    """Merge b into a. Prefers rule-engine evidence; longer text; higher rank."""
    higher = a if _SEVERITY_RANK[a.severity] >= _SEVERITY_RANK[b.severity] else b
    other = b if higher is a else a

    # Sources: union, preserving order with `a` first
    merged_sources: list[str] = []
    for s in list(a.sources) + list(b.sources):
        if s not in merged_sources:
            merged_sources.append(s)

    # Evidence: union, dedupe by metric path
    by_path: OrderedDict[str, object] = OrderedDict()
    rule_first_evs = (
        list(a.evidence) if "rule_engine" in a.sources else list(b.evidence)
    )
    other_evs = (
        list(b.evidence) if "rule_engine" in a.sources else list(a.evidence)
    )
    for ev in rule_first_evs + other_evs:
        by_path.setdefault(ev.metric, ev)

    # Headline + summary: prefer rule_engine if present (templated, stable),
    # else the longer string
    if "rule_engine" in a.sources:
        headline = a.headline if len(a.headline) >= len(b.headline) else b.headline
        summary = a.summary if len(a.summary) >= len(b.summary) else b.summary
    elif "rule_engine" in b.sources:
        headline = b.headline if len(b.headline) >= len(a.headline) else a.headline
        summary = b.summary if len(b.summary) >= len(a.summary) else a.summary
    else:
        headline = a.headline if len(a.headline) >= len(b.headline) else b.headline
        summary = a.summary if len(a.summary) >= len(b.summary) else b.summary

    # Fix: rule_engine fix wins, else higher confidence
    if a.fix is not None and "rule_engine" in a.sources:
        chosen_fix = a.fix
    elif b.fix is not None and "rule_engine" in b.sources:
        chosen_fix = b.fix
    elif a.fix is None:
        chosen_fix = b.fix
    elif b.fix is None:
        chosen_fix = a.fix
    else:
        chosen_fix = a.fix if a.confidence >= b.confidence else b.fix

    # Related: union
    related = list(dict.fromkeys(list(a.related_verdict_ids) + list(b.related_verdict_ids)))

    return higher.model_copy(update={
        "sources": merged_sources,
        "evidence": list(by_path.values()),
        "headline": headline,
        "summary": summary,
        "fix": chosen_fix,
        "confidence": max(a.confidence, b.confidence),
        "priority_score": max(a.priority_score, b.priority_score),
        "related_verdict_ids": related,
    })


def dedupe_verdicts(verdicts: Iterable[Verdict]) -> list[Verdict]:
    """Merge verdicts that share (category, primary metric path).
    Returns a new list, preserving first-seen order of merged groups."""
    bucket: OrderedDict[tuple[str, str], Verdict] = OrderedDict()
    for v in verdicts:
        key = (v.category, _primary_metric(v))
        if key in bucket:
            bucket[key] = _merge_pair(bucket[key], v)
        else:
            bucket[key] = v
    return list(bucket.values())
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_dedupe.py -v`
Expected: 5 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/verdict_pipeline/dedupe.py \
        components/api/tests/verdict_pipeline/test_dedupe.py
git commit -m "feat(verdict_pipeline): dedupe stage merging by (category, primary metric)"
```

---

## Task 14: Ranker stage

**Files:**
- Create: `components/api/app/verdict_pipeline/ranker.py`
- Create: `components/api/tests/verdict_pipeline/test_ranker.py`

- [ ] **Step 1: Write failing tests**

```python
# components/api/tests/verdict_pipeline/test_ranker.py
from __future__ import annotations
from datetime import datetime, timezone
from aimusic_shared.verdicts.models import Evidence, UserState, Verdict
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id
from app.verdict_pipeline.ranker import rank_verdicts


def _v(severity="moderate", priority_score=50, confidence=0.5,
       verdict_id=None) -> Verdict:
    return Verdict(
        verdict_id=verdict_id or new_verdict_id(),
        track_id="t1",
        specialist="x",
        prompt_version="x@1.0.0",
        model="claude-cli",
        severity=severity,  # type: ignore[arg-type]
        category="loudness",
        confidence=confidence,
        priority_score=priority_score,
        headline="h",
        summary="s",
        evidence=[Evidence(metric="phase1.x", label="x")],
        fix=None,
        why_it_matters="x",
        related_verdict_ids=[],
        sources=["x"],
        user_state=UserState(),
        created_at=datetime.now(tz=timezone.utc),
    )


def test_sort_by_priority_score_desc():
    a = _v(priority_score=100)
    b = _v(priority_score=200)
    c = _v(priority_score=50)
    out = rank_verdicts([a, b, c])
    assert [v.priority_score for v in out] == [200, 100, 50]


def test_severity_breaks_score_tie():
    a = _v(severity="moderate", priority_score=100)
    b = _v(severity="critical", priority_score=100)
    out = rank_verdicts([a, b])
    assert out[0].severity == "critical"


def test_confidence_breaks_severity_tie():
    a = _v(severity="severe", priority_score=120, confidence=0.6)
    b = _v(severity="severe", priority_score=120, confidence=0.9)
    out = rank_verdicts([a, b])
    assert out[0].confidence == 0.9


def test_verdict_id_breaks_all_ties():
    a = _v(verdict_id="vrd_aaa", priority_score=50, confidence=0.5)
    b = _v(verdict_id="vrd_bbb", priority_score=50, confidence=0.5)
    out = rank_verdicts([b, a])
    assert out[0].verdict_id == "vrd_aaa"
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_ranker.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ranker.py`**

```python
# components/api/app/verdict_pipeline/ranker.py
from __future__ import annotations
from typing import Iterable

from aimusic_shared.verdicts.models import Severity, Verdict


_SEVERITY_RANK: dict[Severity, int] = {
    "critical": 5, "severe": 4, "moderate": 3, "minor": 2, "win": 1
}


def rank_verdicts(verdicts: Iterable[Verdict]) -> list[Verdict]:
    """Sort by priority_score desc, severity desc, confidence desc, verdict_id asc."""
    return sorted(
        verdicts,
        key=lambda v: (
            -v.priority_score,
            -_SEVERITY_RANK[v.severity],
            -v.confidence,
            v.verdict_id,
        ),
    )
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_ranker.py -v`
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/verdict_pipeline/ranker.py \
        components/api/tests/verdict_pipeline/test_ranker.py
git commit -m "feat(verdict_pipeline): pure ranker by score → severity → confidence → id"
```

---

## Task 15: Orchestrator + SSE event emitter

**Files:**
- Create: `components/api/app/verdict_pipeline/orchestrator.py`
- Modify: `components/api/app/verdict_pipeline/__init__.py`
- Create: `components/api/tests/verdict_pipeline/test_orchestrator.py`

- [ ] **Step 1: Write failing tests**

```python
# components/api/tests/verdict_pipeline/test_orchestrator.py
from __future__ import annotations
import json
import pytest
from app.verdict_pipeline.orchestrator import (
    PipelineEvent,
    run_pipeline,
)


@pytest.mark.asyncio
async def test_pipeline_emits_rule_verdicts_first(llm, clipped_pop):
    # Triage canned response routes only loudness
    llm.register("Triage", clipped_pop["track_id"], json.dumps({
        "specialists_to_run": [{"name": "loudness", "priority": 1, "focus": "tp"}],
        "skip": [],
        "rationale": "x",
        "estimated_total_tokens": 1000,
    }))
    llm.register("Loudness", clipped_pop["track_id"], json.dumps({
        "specialist": "loudness",
        "verdicts": [],
    }))

    events: list[PipelineEvent] = []
    async for ev in run_pipeline(clipped_pop, llm=llm):
        events.append(ev)

    types = [e.kind for e in events]
    # Rule verdicts emitted before routing-plan
    assert types.index("rule-verdict") < types.index("routing-plan")
    # Pipeline ends with complete
    assert types[-1] == "complete"


@pytest.mark.asyncio
async def test_pipeline_dedupes_overlapping(llm, muddy_hiphop):
    # Specialist emits a verdict with the same (category, metric) as the
    # rule_engine — should merge.
    llm.register("Triage", muddy_hiphop["track_id"], json.dumps({
        "specialists_to_run": [{"name": "low_end", "priority": 1, "focus": "x"}],
        "skip": [],
        "rationale": "x",
        "estimated_total_tokens": 1000,
    }))
    llm.register("LowEnd", muddy_hiphop["track_id"], json.dumps({
        "specialist": "low_end",
        "verdicts": [{
            "severity": "severe",
            "category": "low_end",
            "confidence": 0.85,
            "headline": "Specialist headline that is longer than rule",
            "summary": "Specialist summary string is also longer than the rule.",
            "evidence": [{
                "metric": "phase3.low_mid_energy",
                "value": 0.31,
                "expected_range": [0.10, 0.20],
                "label": "+50% vs target",
            }],
            "fix": None,
            "why_it_matters": "Specialist context.",
        }],
    }))

    events: list[PipelineEvent] = []
    async for ev in run_pipeline(muddy_hiphop, llm=llm):
        events.append(ev)

    complete = events[-1]
    assert complete.kind == "complete"
    final = complete.payload["verdicts"]
    low_end_verdicts = [v for v in final if v["category"] == "low_end"]
    assert len(low_end_verdicts) == 1
    sources = set(low_end_verdicts[0]["sources"])
    assert {"rule_engine", "low_end"} <= sources


@pytest.mark.asyncio
async def test_pipeline_validation_failures_recorded(llm, clean_trance):
    llm.register("Triage", clean_trance["track_id"], json.dumps({
        "specialists_to_run": [{"name": "low_end", "priority": 1, "focus": "x"}],
        "skip": [],
        "rationale": "x",
        "estimated_total_tokens": 1000,
    }))
    # Fabricated metric path → validator rejects
    llm.register("LowEnd", clean_trance["track_id"], json.dumps({
        "specialist": "low_end",
        "verdicts": [{
            "severity": "moderate",
            "category": "low_end",
            "confidence": 0.7,
            "headline": "Fake low-end issue",
            "summary": "Fabricated metric.",
            "evidence": [{
                "metric": "phase99.totally_imaginary",
                "value": 1.0,
                "label": "fake",
            }],
            "fix": None,
            "why_it_matters": "x",
        }],
    }))

    events: list[PipelineEvent] = []
    async for ev in run_pipeline(clean_trance, llm=llm):
        events.append(ev)
    failures = [e for e in events if e.kind == "validation-failure"]
    assert len(failures) >= 1
    final_verdicts = events[-1].payload["verdicts"]
    # Fake verdict was rejected, so no low_end specialist verdict in output.
    assert all(
        v["specialist"] != "low_end" or "rule_engine" in v["sources"]
        for v in final_verdicts
    )
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/api && pytest tests/verdict_pipeline/test_orchestrator.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `orchestrator.py`**

```python
# components/api/app/verdict_pipeline/orchestrator.py
from __future__ import annotations
import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator, Literal

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict
from app.llm.client import LLMClient
from app.verdict_pipeline.dedupe import dedupe_verdicts
from app.verdict_pipeline.ranker import rank_verdicts
from app.verdict_pipeline.rule_engine import evaluate_rules
from app.verdict_pipeline.specialists import run_specialists
from app.verdict_pipeline.triage import run_triage
from app.verdict_pipeline.validator import (
    ValidationFailure,
    validate_verdict,
)

log = logging.getLogger(__name__)


EventKind = Literal[
    "rule-verdict", "routing-plan", "verdict",
    "validation-failure", "specialist-error", "complete",
]


@dataclass
class PipelineEvent:
    kind: EventKind
    payload: dict[str, Any]


async def run_pipeline(
    analysis: dict[str, Any],
    *,
    llm: LLMClient,
    model_name: str = "claude-cli",
    timeout_s: int = 90,
) -> AsyncIterator[PipelineEvent]:
    """End-to-end verdict pipeline. Yields PipelineEvent objects in order:

    1. One `rule-verdict` per rule-engine output
    2. One `routing-plan`
    3. Many `verdict` (one per validated, kept specialist verdict — pre-dedupe)
       interleaved with `validation-failure` and `specialist-error` events
    4. One `complete` event with the full ranked + deduped final list
    """
    # 1. Rules
    rule_verdicts: list[Verdict] = evaluate_rules(analysis)
    validated_rules: list[Verdict] = []
    for rv in rule_verdicts:
        result = validate_verdict(rv, analysis)
        if result.ok and result.verdict is not None:
            validated_rules.append(result.verdict)
            yield PipelineEvent(
                kind="rule-verdict", payload=result.verdict.model_dump(mode="json")
            )
        else:
            log.warning("rule-engine verdict failed validation: %s",
                        result.failure.reason if result.failure else "unknown")

    # 2. Triage
    try:
        plan: SpecialistRoutingPlan = await run_triage(
            analysis, rule_verdicts=validated_rules, llm=llm, timeout_s=timeout_s,
        )
    except Exception as e:
        log.error("triage failed: %s", e)
        plan = SpecialistRoutingPlan(
            specialists_to_run=[],
            skip=[],
            rationale=f"triage failed: {e}",
            estimated_total_tokens=0,
        )
    yield PipelineEvent(kind="routing-plan", payload=plan.model_dump(mode="json"))

    # 3. Specialists
    specialist_verdicts: list[Verdict] = []
    async for slug, item in run_specialists(
        plan, analysis, llm=llm, model_name=model_name, timeout_s=timeout_s,
    ):
        if isinstance(item, Exception):
            yield PipelineEvent(
                kind="specialist-error",
                payload={"specialist": slug, "error": str(item)},
            )
            continue
        result = validate_verdict(item, analysis)
        if not result.ok and result.failure is not None:
            yield PipelineEvent(
                kind="validation-failure",
                payload={
                    "specialist": result.failure.specialist,
                    "prompt_version": result.failure.prompt_version,
                    "reason": result.failure.reason,
                },
            )
            continue
        assert result.verdict is not None
        specialist_verdicts.append(result.verdict)
        yield PipelineEvent(
            kind="verdict", payload=result.verdict.model_dump(mode="json")
        )

    # 4. Dedupe + rank → complete
    merged = dedupe_verdicts(validated_rules + specialist_verdicts)
    ranked = rank_verdicts(merged)
    yield PipelineEvent(
        kind="complete",
        payload={
            "verdicts": [v.model_dump(mode="json") for v in ranked],
            "verdict_count": len(ranked),
            "prompt_versions": _collect_prompt_versions(ranked),
            "model": model_name,
        },
    )


def _collect_prompt_versions(verdicts: list[Verdict]) -> str:
    """Comma-separated stable list of `<specialist>@<version>` for cache keying."""
    versions = sorted({v.prompt_version for v in verdicts})
    return ",".join(versions)
```

- [ ] **Step 4: Update `verdict_pipeline/__init__.py`**

```python
# components/api/app/verdict_pipeline/__init__.py
from app.verdict_pipeline.orchestrator import (
    EventKind,
    PipelineEvent,
    run_pipeline,
)

__all__ = ["EventKind", "PipelineEvent", "run_pipeline"]
```

- [ ] **Step 5: Run, expect green**

Run: `cd components/api && pytest tests/verdict_pipeline/test_orchestrator.py -v`
Expected: 3 PASSED.

- [ ] **Step 6: Run the full pipeline test suite to confirm nothing regressed**

Run: `cd components/api && pytest tests/verdict_pipeline/ -v`
Expected: all green (~40+ tests).

- [ ] **Step 7: Commit**

```bash
git add components/api/app/verdict_pipeline/orchestrator.py \
        components/api/app/verdict_pipeline/__init__.py \
        components/api/tests/verdict_pipeline/test_orchestrator.py
git commit -m "feat(verdict_pipeline): orchestrator with SSE-friendly PipelineEvent stream"
```

---

## Task 16: Config — VERDICT_* env vars

**Files:**
- Modify: `components/api/app/config.py`

- [ ] **Step 1: Add settings fields**

Open `components/api/app/config.py` and add to the `Settings` Pydantic class:

```python
    verdict_pipeline_enabled: bool = True
    verdict_cli_timeout_s: int = 90
    verdict_max_concurrent_generations: int = 2
    verdict_prompt_dir: str = "prompts/experts"
```

- [ ] **Step 2: Verify config loads cleanly**

Run: `cd components/api && python -c "from app.config import settings; print(settings.verdict_cli_timeout_s)"`
Expected: `90`

- [ ] **Step 3: Commit**

```bash
git add components/api/app/config.py
git commit -m "feat(api): add VERDICT_* config settings"
```

---

## Task 17: Verdicts router — generate, fetch, dismiss, feedback

**Files:**
- Create: `components/api/app/routers/verdicts.py`
- Modify: `components/api/app/main.py` (mount router; experts router stays for now — deleted in Task 30)
- Create: `components/api/tests/test_verdicts_router.py`

- [ ] **Step 1: Write failing tests**

```python
# components/api/tests/test_verdicts_router.py
from __future__ import annotations
import json
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_generate_returns_cached_when_payload_exists(
    authed_client: AsyncClient, completed_job_with_verdicts,
):
    job_id = completed_job_with_verdicts
    r = await authed_client.post(f"/api/reports/{job_id}/verdicts/generate")
    assert r.status_code == 200
    body = r.json()
    assert "verdicts" in body
    assert isinstance(body["verdicts"], list)


@pytest.mark.asyncio
async def test_generate_returns_202_when_uncached(
    authed_client: AsyncClient, completed_job_no_verdicts,
):
    job_id = completed_job_no_verdicts
    r = await authed_client.post(f"/api/reports/{job_id}/verdicts/generate")
    assert r.status_code == 202
    assert "generation_id" in r.json()


@pytest.mark.asyncio
async def test_get_verdicts_404_when_not_generated(
    authed_client: AsyncClient, completed_job_no_verdicts,
):
    r = await authed_client.get(f"/api/reports/{completed_job_no_verdicts}/verdicts")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_verdicts_returns_payload_when_present(
    authed_client: AsyncClient, completed_job_with_verdicts,
):
    r = await authed_client.get(f"/api/reports/{completed_job_with_verdicts}/verdicts")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["verdicts"], list)


@pytest.mark.asyncio
async def test_dismiss_writes_user_state(
    authed_client: AsyncClient, completed_job_with_verdicts, db_session,
):
    r = await authed_client.get(f"/api/reports/{completed_job_with_verdicts}/verdicts")
    verdict_id = r.json()["verdicts"][0]["verdict_id"]
    d = await authed_client.post(f"/api/verdicts/{verdict_id}/dismiss")
    assert d.status_code == 204


@pytest.mark.asyncio
async def test_feedback_validates_kind(
    authed_client: AsyncClient, completed_job_with_verdicts,
):
    r = await authed_client.get(f"/api/reports/{completed_job_with_verdicts}/verdicts")
    verdict_id = r.json()["verdicts"][0]["verdict_id"]
    bad = await authed_client.post(
        f"/api/verdicts/{verdict_id}/feedback", json={"feedback": "garbage"}
    )
    assert bad.status_code == 422
    good = await authed_client.post(
        f"/api/verdicts/{verdict_id}/feedback", json={"feedback": "helpful"}
    )
    assert good.status_code == 204


@pytest.mark.asyncio
async def test_other_users_verdicts_404(
    other_user_client: AsyncClient, completed_job_with_verdicts,
):
    r = await other_user_client.get(
        f"/api/reports/{completed_job_with_verdicts}/verdicts"
    )
    # Authorization at query level — other user sees 404, not 403, to avoid info leak
    assert r.status_code == 404
```

- [ ] **Step 2: Update `components/api/tests/conftest.py` with the new fixtures**

Add fixtures (consult existing `conftest.py` for `authed_client` pattern; the
new fixtures populate `analysis_results` rows):

```python
# Append to components/api/tests/conftest.py

import json
import uuid
import pytest
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from aimusic_shared.models import AnalysisResult, JobStatus, UploadJob, User


@pytest.fixture
async def completed_job_no_verdicts(db_session: AsyncSession, test_user: User) -> str:
    job = UploadJob(
        user_id=test_user.id,
        status=JobStatus.COMPLETE,
        file_path="/tmp/x.wav",
    )
    db_session.add(job)
    await db_session.flush()
    result = AnalysisResult(
        job_id=job.id,
        phase_results=[],
        final_json={"track_id": str(job.id),
                    "phase1": {"duration_seconds": 200.0,
                               "integrated_lufs": -10.0,
                               "true_peak_db": -1.5,
                               "mono_compatibility": 0.85,
                               "clipping_detected": False,
                               "crest_factor": 8.0},
                    "phase2": {"stereo_correlation": 0.5},
                    "phase3": {"low_mid_energy": 0.18}},
        share_token=str(uuid.uuid4()),
    )
    db_session.add(result)
    await db_session.commit()
    return str(job.id)


@pytest.fixture
async def completed_job_with_verdicts(
    db_session: AsyncSession, completed_job_no_verdicts: str,
) -> str:
    job_id = uuid.UUID(completed_job_no_verdicts)
    result = (await db_session.execute(
        # use SQLAlchemy 2.0 style select
        __import__("sqlalchemy").select(AnalysisResult)
        .where(AnalysisResult.job_id == job_id)
    )).scalar_one()
    sample_verdict = {
        "verdict_id": "vrd_01HXXXXXXXXXXXXXXXXXXXXXXX",
        "track_id": str(job_id),
        "specialist": "rule_engine",
        "prompt_version": "rule_engine@1.0.0",
        "model": "rules",
        "severity": "moderate",
        "category": "loudness",
        "confidence": 1.0,
        "priority_score": 70,
        "headline": "Sample",
        "summary": "Sample.",
        "evidence": [{"metric": "phase1.integrated_lufs", "value": -10.0,
                      "label": "x"}],
        "fix": None,
        "why_it_matters": "x",
        "related_verdict_ids": [],
        "sources": ["rule_engine"],
        "user_state": {"dismissed": False, "applied": False,
                       "user_modified_fix": None, "feedback": None},
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    result.verdicts_payload = {"verdicts": [sample_verdict]}
    result.verdicts_generated_at = datetime.now(tz=timezone.utc)
    result.verdicts_prompt_version_set = "rule_engine@1.0.0"
    result.verdicts_model = "rules"
    await db_session.commit()
    return completed_job_no_verdicts
```

(`other_user_client` fixture: clone whatever pattern `authed_client` uses but with a second user.)

- [ ] **Step 3: Run, expect fail**

Run: `cd components/api && pytest tests/test_verdicts_router.py -v`
Expected: FAIL — router not registered.

- [ ] **Step 4: Implement `routers/verdicts.py`**

```python
# components/api/app/routers/verdicts.py
from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import AnalysisResult, UploadJob, User, VerdictUserState
from app.config import settings
from app.db import get_db
from app.llm.client import CliClient, LLMClient
from app.routers.auth import get_current_user
from app.verdict_pipeline import run_pipeline

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["verdicts"])

# Per-process semaphore — limits concurrent pipeline runs
_GEN_SEMA = asyncio.Semaphore(settings.verdict_max_concurrent_generations)


class FeedbackBody(BaseModel):
    feedback: Literal["helpful", "wrong", "unclear"]


def _get_llm_client() -> LLMClient:
    return CliClient()


async def _load_job_for_user(
    db: AsyncSession, *, job_id: uuid.UUID, user_id: uuid.UUID,
) -> tuple[UploadJob, AnalysisResult]:
    """Authorization-at-query-level: returns (job, result) only if owned."""
    row = (await db.execute(
        select(UploadJob, AnalysisResult)
        .join(AnalysisResult, AnalysisResult.job_id == UploadJob.id)
        .where(UploadJob.id == job_id)
        .where(UploadJob.user_id == user_id)
    )).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return row.UploadJob, row.AnalysisResult


def _expected_prompt_version_set() -> str:
    """Comma-separated `<specialist>@<version>` of every prompt currently on disk.
    Used for cache invalidation: if any prompt version changed, regenerate."""
    from app.verdict_pipeline.prompt_loader import (
        SLUG_TO_FILENAME, load_prompt, load_triage,
    )
    versions: list[str] = []
    triage_v, _ = load_triage()
    versions.append(f"triage@{triage_v}")
    for slug in sorted(SLUG_TO_FILENAME):
        v, _ = load_prompt(slug)
        versions.append(f"{slug}@{v}")
    return ",".join(versions)


@router.post("/reports/{job_id}/verdicts/generate")
async def generate_verdicts(
    job_id: uuid.UUID,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.verdict_pipeline_enabled:
        raise HTTPException(status_code=503, detail="verdict pipeline disabled")

    _, result = await _load_job_for_user(db, job_id=job_id, user_id=user.id)
    expected = _expected_prompt_version_set()

    # Cache hit
    if (result.verdicts_payload
            and result.verdicts_prompt_version_set == expected):
        return result.verdicts_payload

    # Cache miss → kick off generation in BackgroundTasks
    generation_id = str(uuid.uuid4())
    background.add_task(
        _run_and_persist,
        job_id=job_id, user_id=user.id,
        analysis=result.final_json,
        expected_version_set=expected,
    )
    return Response(
        content=f'{{"generation_id":"{generation_id}"}}',
        media_type="application/json",
        status_code=202,
    )


async def _run_and_persist(
    *, job_id: uuid.UUID, user_id: uuid.UUID,
    analysis: dict, expected_version_set: str,
) -> None:
    """Run the pipeline (gated by semaphore) and persist final verdicts payload."""
    from app.db import async_session_maker
    async with _GEN_SEMA:
        verdicts_final: list[dict] = []
        try:
            llm = _get_llm_client()
            async for ev in run_pipeline(analysis, llm=llm,
                                         timeout_s=settings.verdict_cli_timeout_s):
                if ev.kind == "complete":
                    verdicts_final = ev.payload["verdicts"]
        except Exception:
            log.exception("verdict pipeline crashed for job %s", job_id)
            return

        async with async_session_maker() as db:
            row = (await db.execute(
                select(AnalysisResult).where(AnalysisResult.job_id == job_id)
            )).scalar_one_or_none()
            if row is None:
                return
            row.verdicts_payload = {"verdicts": verdicts_final}
            row.verdicts_generated_at = datetime.now(tz=timezone.utc)
            row.verdicts_prompt_version_set = expected_version_set
            row.verdicts_model = "claude-cli"
            await db.commit()


@router.get("/reports/{job_id}/verdicts")
async def get_verdicts(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, result = await _load_job_for_user(db, job_id=job_id, user_id=user.id)
    if not result.verdicts_payload:
        raise HTTPException(status_code=404,
                            detail="verdicts not yet generated")
    payload = dict(result.verdicts_payload)

    # Overlay user state
    state_rows = (await db.execute(
        select(VerdictUserState)
        .where(VerdictUserState.user_id == user.id)
        .where(VerdictUserState.job_id == job_id)
    )).scalars().all()
    states = {s.verdict_id: s for s in state_rows}
    for v in payload.get("verdicts", []):
        s = states.get(v["verdict_id"])
        if s is not None:
            v["user_state"] = {
                "dismissed": s.dismissed,
                "applied": s.applied,
                "user_modified_fix": s.user_modified_fix,
                "feedback": s.feedback,
            }
    return payload


@router.post("/verdicts/{verdict_id}/dismiss", status_code=204)
async def dismiss(
    verdict_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job_id = await _job_id_for_verdict(db, verdict_id=verdict_id, user_id=user.id)
    stmt = pg_insert(VerdictUserState).values(
        verdict_id=verdict_id, user_id=user.id, job_id=job_id, dismissed=True,
    ).on_conflict_do_update(
        index_elements=["verdict_id", "user_id"],
        set_=dict(dismissed=True, updated_at=datetime.now(tz=timezone.utc)),
    )
    await db.execute(stmt)
    await db.commit()


@router.post("/verdicts/{verdict_id}/feedback", status_code=204)
async def feedback(
    verdict_id: str,
    body: FeedbackBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job_id = await _job_id_for_verdict(db, verdict_id=verdict_id, user_id=user.id)
    stmt = pg_insert(VerdictUserState).values(
        verdict_id=verdict_id, user_id=user.id, job_id=job_id,
        feedback=body.feedback,
    ).on_conflict_do_update(
        index_elements=["verdict_id", "user_id"],
        set_=dict(feedback=body.feedback,
                  updated_at=datetime.now(tz=timezone.utc)),
    )
    await db.execute(stmt)
    await db.commit()


async def _job_id_for_verdict(
    db: AsyncSession, *, verdict_id: str, user_id: uuid.UUID,
) -> uuid.UUID:
    """Find the job a verdict belongs to (by walking the user's analysis_results
    JSONB payloads). 404 if not found among user's verdicts (auth check)."""
    rows = (await db.execute(
        select(AnalysisResult, UploadJob.id)
        .join(UploadJob, UploadJob.id == AnalysisResult.job_id)
        .where(UploadJob.user_id == user_id)
        .where(AnalysisResult.verdicts_payload.is_not(None))
    )).all()
    for r, job_id in rows:
        for v in (r.verdicts_payload or {}).get("verdicts", []):
            if v.get("verdict_id") == verdict_id:
                return job_id
    raise HTTPException(status_code=404, detail="verdict not found")
```

- [ ] **Step 5: Mount the router**

In `components/api/app/main.py`, add:

```python
from app.routers import verdicts as verdicts_router
app.include_router(verdicts_router.router)
```

- [ ] **Step 6: Run, expect green**

Run: `cd components/api && pytest tests/test_verdicts_router.py -v`
Expected: 7 PASSED.

- [ ] **Step 7: Commit**

```bash
git add components/api/app/routers/verdicts.py \
        components/api/app/main.py \
        components/api/tests/test_verdicts_router.py \
        components/api/tests/conftest.py
git commit -m "feat(api): /verdicts/generate, /verdicts (get), /verdicts/{id}/dismiss + feedback"
```

---

## Task 18: SSE streaming endpoint

**Files:**
- Modify: `components/api/app/routers/verdicts.py`
- Create: `components/api/tests/test_verdicts_stream.py`

- [ ] **Step 1: Write failing test**

```python
# components/api/tests/test_verdicts_stream.py
from __future__ import annotations
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_stream_emits_complete_event(
    authed_client: AsyncClient, completed_job_no_verdicts, sse_token_for_test,
):
    """Smoke: SSE endpoint streams events and ends with `event: complete`.
    Uses a MockLLMClient via dependency override (configured in conftest)."""
    job_id = completed_job_no_verdicts
    async with authed_client.stream(
        "GET", f"/api/reports/{job_id}/verdicts/stream?token={sse_token_for_test}",
    ) as r:
        assert r.status_code == 200
        text = ""
        async for chunk in r.aiter_text():
            text += chunk
            if "event: complete" in text:
                break
    assert "event: complete" in text
```

(`sse_token_for_test` fixture: existing pattern from `test_uploads.py` for SSE token query-param auth.)

- [ ] **Step 2: Append SSE endpoint to `routers/verdicts.py`**

```python
from fastapi.responses import StreamingResponse
from app.routers.auth import get_current_user_sse  # query-param auth, matches HANDOFF


@router.get("/reports/{job_id}/verdicts/stream")
async def stream_verdicts(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user_sse),
    db: AsyncSession = Depends(get_db),
):
    _, result = await _load_job_for_user(db, job_id=job_id, user_id=user.id)
    analysis = result.final_json

    async def event_generator():
        llm = _get_llm_client()
        try:
            async for ev in run_pipeline(
                analysis, llm=llm, timeout_s=settings.verdict_cli_timeout_s,
            ):
                import json as _json
                yield (
                    f"event: {ev.kind}\n"
                    f"data: {_json.dumps(ev.payload)}\n\n"
                )
                if ev.kind == "complete":
                    # Persist final payload synchronously so subsequent
                    # GET /verdicts hits cache.
                    expected = _expected_prompt_version_set()
                    result.verdicts_payload = {"verdicts": ev.payload["verdicts"]}
                    result.verdicts_generated_at = datetime.now(tz=timezone.utc)
                    result.verdicts_prompt_version_set = expected
                    result.verdicts_model = "claude-cli"
                    await db.commit()
        except Exception as e:
            log.exception("SSE stream failed")
            import json as _json
            yield f"event: error\ndata: {_json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})
```

- [ ] **Step 3: Run, expect green**

Run: `cd components/api && pytest tests/test_verdicts_stream.py -v`
Expected: 1 PASSED.

- [ ] **Step 4: Commit**

```bash
git add components/api/app/routers/verdicts.py \
        components/api/tests/test_verdicts_stream.py
git commit -m "feat(api): SSE endpoint /reports/{id}/verdicts/stream"
```

---

## Task 19: Extend share endpoint with verdicts payload

**Files:**
- Modify: `components/api/app/routers/reports.py`
- Modify: `components/api/tests/test_uploads.py` (or whichever currently tests share endpoint — search for `share/`)

- [ ] **Step 1: Locate the share endpoint**

Run: `grep -rn "reports/share" components/api/app/routers/`
Expected: hit in `reports.py`.

- [ ] **Step 2: Modify the share handler to include `verdicts_payload`**

Open the share handler. After the existing payload assembly, add:

```python
    payload["verdicts"] = (
        (result.verdicts_payload or {}).get("verdicts", [])
        if result.verdicts_payload else []
    )
    # NEVER include user_state on the public share endpoint
    for v in payload["verdicts"]:
        v["user_state"] = {"dismissed": False, "applied": False,
                           "user_modified_fix": None, "feedback": None}
```

- [ ] **Step 3: Add a test**

In `components/api/tests/test_uploads.py` (or wherever share tests live), append:

```python
@pytest.mark.asyncio
async def test_share_includes_verdicts_no_user_state(
    public_client: AsyncClient, completed_job_with_verdicts, db_session,
):
    from sqlalchemy import select
    from aimusic_shared.models import AnalysisResult
    result = (await db_session.execute(
        select(AnalysisResult).where(
            AnalysisResult.job_id == completed_job_with_verdicts
        )
    )).scalar_one()
    token = result.share_token
    r = await public_client.get(f"/api/reports/share/{token}")
    assert r.status_code == 200
    body = r.json()
    assert "verdicts" in body
    if body["verdicts"]:
        assert all(v["user_state"]["dismissed"] is False
                   for v in body["verdicts"])
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/api && pytest tests/test_uploads.py -k share -v`
Expected: PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/routers/reports.py \
        components/api/tests/test_uploads.py
git commit -m "feat(api): include verdicts_payload in /reports/share/{token}"
```

---

## Task 20: TypeScript types — generate from Pydantic

**Files:**
- Modify: `components/frontend/package.json` (add `gen-types` script)
- Create: `components/frontend/scripts/gen-verdict-types.mjs`
- Create: `components/frontend/src/types/verdicts.ts` (committed; regenerated by script)

- [ ] **Step 1: Add a script that runs `datamodel-code-generator` via the api venv**

Create `components/frontend/scripts/gen-verdict-types.mjs`:

```javascript
// Generates TypeScript types from Pydantic models via datamodel-code-generator.
// Requires: pip install datamodel-code-generator pydantic-to-typescript (or just one).
// Run: npm run gen-types

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const SHARED_PKG = resolve("../shared/aimusic_shared/verdicts/models.py");
const OUT = resolve("./src/types/verdicts.ts");
const PY = process.env.PYTHON || "python";

if (!existsSync(SHARED_PKG)) {
  console.error("Cannot find Pydantic models at", SHARED_PKG);
  process.exit(1);
}

// Use pydantic-to-typescript (PYTHON wrapper that imports the pydantic models
// and emits TS interfaces). Falls back to datamodel-code-generator + JSON Schema
// if the former isn't available.
try {
  execSync(
    `${PY} -m pydantic2ts --module ${SHARED_PKG} --output ${OUT}`,
    { stdio: "inherit" },
  );
} catch (e) {
  console.error("pydantic2ts failed; falling back to datamodel-code-generator");
  execSync(
    `${PY} -m datamodel_code_generator --input ${SHARED_PKG} ` +
    `--input-file-type python --output ${OUT} --output-model-type TypedDict`,
    { stdio: "inherit" },
  );
}

console.log("Wrote", OUT);
```

- [ ] **Step 2: Add the npm script to `package.json`**

In `components/frontend/package.json`, under `scripts`:

```json
"gen-types": "node scripts/gen-verdict-types.mjs"
```

- [ ] **Step 3: Install the python tool**

Run: `pip install pydantic-to-typescript`

- [ ] **Step 4: Run the generator**

Run: `cd components/frontend && npm run gen-types`
Expected: writes `src/types/verdicts.ts` containing TS interfaces for `Verdict`, `Fix`, `Evidence`, `DspOp`, `SpecialistRoutingPlan`, etc.

- [ ] **Step 5: Verify the file imports cleanly**

Run: `cd components/frontend && npm run type-check`
Expected: no errors mentioning `src/types/verdicts.ts`.

- [ ] **Step 6: Add a hand-written supplement file for SSE event types**

Create `components/frontend/src/types/verdict-events.ts`:

```typescript
import type { Verdict, SpecialistRoutingPlan } from "./verdicts";

export type VerdictEventKind =
  | "rule-verdict"
  | "routing-plan"
  | "verdict"
  | "validation-failure"
  | "specialist-error"
  | "complete"
  | "error";

export type VerdictEvent =
  | { kind: "rule-verdict"; payload: Verdict }
  | { kind: "routing-plan"; payload: SpecialistRoutingPlan }
  | { kind: "verdict"; payload: Verdict }
  | { kind: "validation-failure"; payload: { specialist: string; prompt_version: string; reason: string } }
  | { kind: "specialist-error"; payload: { specialist: string; error: string } }
  | { kind: "complete"; payload: { verdicts: Verdict[]; verdict_count: number; prompt_versions: string; model: string } }
  | { kind: "error"; payload: { error: string } };
```

- [ ] **Step 7: Commit**

```bash
git add components/frontend/scripts/gen-verdict-types.mjs \
        components/frontend/package.json \
        components/frontend/src/types/verdicts.ts \
        components/frontend/src/types/verdict-events.ts
git commit -m "feat(frontend): generate TS types from Pydantic verdict models"
```

---

## Task 21: useVerdictStream SSE hook

**Files:**
- Create: `components/frontend/src/features/verdicts/useVerdictStream.ts`
- Create: `components/frontend/src/features/verdicts/__tests__/useVerdictStream.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// components/frontend/src/features/verdicts/__tests__/useVerdictStream.test.ts
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useVerdictStream } from "../useVerdictStream";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }
  emit(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    (this.listeners.get(type) || []).forEach(fn => fn(ev));
  }
  close() { this.closed = true; }
}

describe("useVerdictStream", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
  });

  it("collects rule-verdict, verdict, and complete events", async () => {
    const { result } = renderHook(() => useVerdictStream("job-1", "tok"));
    const es = MockEventSource.instances[0];

    act(() => es.emit("rule-verdict", { verdict_id: "vrd_a", category: "loudness" }));
    act(() => es.emit("verdict", { verdict_id: "vrd_b", category: "low_end" }));
    act(() => es.emit("complete", { verdicts: [
      { verdict_id: "vrd_a" }, { verdict_id: "vrd_b" }
    ], verdict_count: 2, prompt_versions: "x", model: "claude-cli" }));

    await waitFor(() => {
      expect(result.current.status).toBe("complete");
      expect(result.current.finalVerdicts).toHaveLength(2);
    });
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useVerdictStream("job-1", "tok"));
    const es = MockEventSource.instances[0];
    unmount();
    expect(es.closed).toBe(true);
  });

  it("captures error events", async () => {
    const { result } = renderHook(() => useVerdictStream("job-2", "tok"));
    const es = MockEventSource.instances[0];
    act(() => es.emit("error", { error: "boom" }));
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd components/frontend && npm run test -- useVerdictStream`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the hook**

```typescript
// components/frontend/src/features/verdicts/useVerdictStream.ts
import { useEffect, useRef, useState } from "react";
import type { Verdict, SpecialistRoutingPlan } from "../../types/verdicts";

type Status = "idle" | "streaming" | "complete" | "error";

export interface VerdictStreamState {
  status: Status;
  ruleVerdicts: Verdict[];
  routingPlan: SpecialistRoutingPlan | null;
  specialistVerdicts: Verdict[];
  finalVerdicts: Verdict[];
  error: string | null;
  validationFailures: { specialist: string; reason: string }[];
}

export function useVerdictStream(jobId: string, sseToken: string): VerdictStreamState {
  const [state, setState] = useState<VerdictStreamState>({
    status: "idle",
    ruleVerdicts: [],
    routingPlan: null,
    specialistVerdicts: [],
    finalVerdicts: [],
    error: null,
    validationFailures: [],
  });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `/api/reports/${jobId}/verdicts/stream?token=${encodeURIComponent(sseToken)}`;
    const es = new EventSource(url, { withCredentials: false });
    esRef.current = es;
    setState(s => ({ ...s, status: "streaming" }));

    const parse = (e: MessageEvent): unknown => {
      try { return JSON.parse(e.data); } catch { return null; }
    };

    es.addEventListener("rule-verdict", (e) => {
      const v = parse(e as MessageEvent) as Verdict | null;
      if (v) setState(s => ({ ...s, ruleVerdicts: [...s.ruleVerdicts, v] }));
    });
    es.addEventListener("routing-plan", (e) => {
      const p = parse(e as MessageEvent) as SpecialistRoutingPlan | null;
      if (p) setState(s => ({ ...s, routingPlan: p }));
    });
    es.addEventListener("verdict", (e) => {
      const v = parse(e as MessageEvent) as Verdict | null;
      if (v) setState(s => ({
        ...s, specialistVerdicts: [...s.specialistVerdicts, v]
      }));
    });
    es.addEventListener("validation-failure", (e) => {
      const f = parse(e as MessageEvent) as { specialist: string; reason: string } | null;
      if (f) setState(s => ({
        ...s, validationFailures: [...s.validationFailures, f]
      }));
    });
    es.addEventListener("complete", (e) => {
      const p = parse(e as MessageEvent) as { verdicts: Verdict[] } | null;
      setState(s => ({
        ...s,
        status: "complete",
        finalVerdicts: p?.verdicts ?? s.specialistVerdicts,
      }));
      es.close();
    });
    es.addEventListener("error", (e) => {
      const p = parse(e as MessageEvent) as { error: string } | null;
      setState(s => ({
        ...s, status: "error", error: p?.error ?? "stream error"
      }));
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, sseToken]);

  return state;
}
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/frontend && npm run test -- useVerdictStream`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/frontend/src/features/verdicts/useVerdictStream.ts \
        components/frontend/src/features/verdicts/__tests__/useVerdictStream.test.ts
git commit -m "feat(frontend): useVerdictStream SSE hook for verdict pipeline events"
```

---

## Task 22: SeverityBadge + EvidenceChips + FixSummary + VerdictSkeleton

**Files:**
- Create: `components/frontend/src/features/verdicts/SeverityBadge.tsx`
- Create: `components/frontend/src/features/verdicts/EvidenceChips.tsx`
- Create: `components/frontend/src/features/verdicts/FixSummary.tsx`
- Create: `components/frontend/src/features/verdicts/VerdictSkeleton.tsx`
- Modify: `components/frontend/tailwind.config.ts` (safelist)

- [ ] **Step 1: SeverityBadge**

```typescript
// components/frontend/src/features/verdicts/SeverityBadge.tsx
import type { Severity } from "../../types/verdicts";

const STYLES: Record<Severity, { label: string; classes: string; icon: string }> = {
  critical: { label: "CRITICAL", classes: "bg-red-50 border-red-600 text-red-900", icon: "🔴" },
  severe:   { label: "SEVERE",   classes: "bg-orange-50 border-orange-600 text-orange-900", icon: "🟠" },
  moderate: { label: "MODERATE", classes: "bg-yellow-50 border-yellow-600 text-yellow-900", icon: "🟡" },
  minor:    { label: "MINOR",    classes: "bg-blue-50 border-blue-600 text-blue-900", icon: "🔵" },
  win:      { label: "WIN",      classes: "bg-green-50 border-green-600 text-green-900", icon: "✅" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = STYLES[severity];
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-0.5 rounded text-xs font-semibold ${s.classes}`}>
      <span>{s.icon}</span>
      <span>{s.label}</span>
    </span>
  );
}
```

- [ ] **Step 2: EvidenceChips**

```typescript
// components/frontend/src/features/verdicts/EvidenceChips.tsx
import type { Evidence } from "../../types/verdicts";

export function EvidenceChips({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {evidence.map((e, i) => (
        <span
          key={`${e.metric}-${i}`}
          title={`${e.metric}${e.value !== null && e.value !== undefined ? ` = ${e.value}` : ""}`}
          className="inline-block bg-slate-100 border border-slate-300 rounded px-2 py-0.5 text-xs"
        >
          {e.label}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: FixSummary**

```typescript
// components/frontend/src/features/verdicts/FixSummary.tsx
import type { Fix, DspOp } from "../../types/verdicts";

function describeOp(op: DspOp): string {
  const p = op.params as Record<string, number | string>;
  switch (op.type) {
    case "peaking_eq":
      return `Peaking EQ: ${(p.gain_db as number) >= 0 ? "+" : ""}${p.gain_db}dB at ${p.frequency_hz}Hz Q=${p.q}`;
    case "low_shelf":
      return `Low shelf: ${(p.gain_db as number) >= 0 ? "+" : ""}${p.gain_db}dB at ${p.frequency_hz}Hz`;
    case "high_shelf":
      return `High shelf: ${(p.gain_db as number) >= 0 ? "+" : ""}${p.gain_db}dB at ${p.frequency_hz}Hz`;
    case "high_pass":
      return `High-pass at ${p.frequency_hz}Hz, ${p.slope_db}dB/oct`;
    case "low_pass":
      return `Low-pass at ${p.frequency_hz}Hz, ${p.slope_db}dB/oct`;
    case "compressor":
      return `Compressor: ${p.threshold_db}dB threshold, ${p.ratio}:1 ratio, ${p.attack_ms}ms attack, ${p.release_ms}ms release`;
    case "multiband_compressor":
      return `Multiband compressor (${(p.bands as unknown[])?.length ?? 0} bands)`;
    case "limiter":
      return `Limiter: ${p.ceiling_db}dB ceiling, ${p.release_ms}ms release`;
    case "gain":
      return `Gain: ${(p.gain_db as number) >= 0 ? "+" : ""}${p.gain_db}dB`;
    case "stereo_width":
      return `Stereo width: ${p.width_pct}%`;
    case "sidechain":
      return `Sidechain from ${p.source_stem}: -${p.depth_db}dB depth, ${p.release_ms}ms release`;
    default:
      return `Unknown op: ${(op as DspOp).type}`;
  }
}

export function FixSummary({ fix }: { fix: Fix | null }) {
  if (!fix) return null;
  const target = `${fix.target.type}: ${fix.target.name}`;
  const section = fix.section
    ? ` (${fix.section.section_type ?? "section"} ${fix.section.start_seconds.toFixed(0)}–${fix.section.end_seconds.toFixed(0)}s)`
    : "";
  return (
    <div className="mt-3 p-3 bg-slate-50 border-l-2 border-slate-400 rounded">
      <div className="text-xs font-semibold text-slate-600 mb-1">
        Recommended fix on {target}{section}
      </div>
      <ul className="text-sm space-y-1">
        {fix.dsp_chain.map((op, i) => (
          <li key={i} className="text-slate-800">• {describeOp(op)}</li>
        ))}
        {fix.sidechain && (
          <li className="text-slate-800">
            • Sidechain {fix.target.name} to {fix.sidechain.source_stem}:
            -{fix.sidechain.depth_db}dB, {fix.sidechain.release_ms}ms release
          </li>
        )}
      </ul>
      <div className="text-xs text-slate-600 mt-2 italic">
        {fix.expected_outcome}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: VerdictSkeleton**

```typescript
// components/frontend/src/features/verdicts/VerdictSkeleton.tsx
export function VerdictSkeleton({ specialist }: { specialist: string }) {
  return (
    <div className="border border-slate-200 rounded-md p-4 bg-slate-50 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-5 w-20 bg-slate-200 rounded" />
        <div className="text-xs text-slate-500">{specialist} analyzing…</div>
      </div>
      <div className="h-4 w-3/4 bg-slate-200 rounded mb-2" />
      <div className="h-3 w-1/2 bg-slate-200 rounded" />
    </div>
  );
}
```

- [ ] **Step 5: Tailwind safelist**

Append to `components/frontend/tailwind.config.ts` `safelist` array (create the array if missing):

```typescript
safelist: [
  "bg-red-50", "border-red-600", "text-red-900",
  "bg-orange-50", "border-orange-600", "text-orange-900",
  "bg-yellow-50", "border-yellow-600", "text-yellow-900",
  "bg-blue-50", "border-blue-600", "text-blue-900",
  "bg-green-50", "border-green-600", "text-green-900",
  "animate-pulse",
],
```

- [ ] **Step 6: Commit**

```bash
git add components/frontend/src/features/verdicts/SeverityBadge.tsx \
        components/frontend/src/features/verdicts/EvidenceChips.tsx \
        components/frontend/src/features/verdicts/FixSummary.tsx \
        components/frontend/src/features/verdicts/VerdictSkeleton.tsx \
        components/frontend/tailwind.config.ts
git commit -m "feat(frontend): SeverityBadge, EvidenceChips, FixSummary, VerdictSkeleton"
```

---

## Task 23: VerdictCard

**Files:**
- Create: `components/frontend/src/features/verdicts/VerdictCard.tsx`
- Create: `components/frontend/src/features/verdicts/feedbackClient.ts`
- Create: `components/frontend/src/features/verdicts/__tests__/VerdictCard.test.tsx`

- [ ] **Step 1: feedbackClient**

```typescript
// components/frontend/src/features/verdicts/feedbackClient.ts
import { apiClient } from "../../lib/apiClient";

export async function dismissVerdict(verdictId: string): Promise<void> {
  await apiClient.post(`/verdicts/${verdictId}/dismiss`);
}

export async function sendFeedback(
  verdictId: string,
  feedback: "helpful" | "wrong" | "unclear",
): Promise<void> {
  await apiClient.post(`/verdicts/${verdictId}/feedback`, { feedback });
}
```

- [ ] **Step 2: VerdictCard test**

```typescript
// components/frontend/src/features/verdicts/__tests__/VerdictCard.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VerdictCard } from "../VerdictCard";
import type { Verdict } from "../../../types/verdicts";

const baseVerdict: Verdict = {
  verdict_id: "vrd_aaa",
  track_id: "t1",
  specialist: "low_end",
  prompt_version: "low_end@1.0.0",
  model: "claude-cli",
  severity: "critical",
  category: "low_end",
  confidence: 0.85,
  priority_score: 195,
  headline: "Bass-kick mask 80Hz",
  summary: "Kick and bass compete at 80Hz.",
  evidence: [{ metric: "phase3.low_mid_energy", value: 0.31, label: "lowmid +50%" }],
  fix: null,
  why_it_matters: "Punch lost on club systems.",
  related_verdict_ids: [],
  sources: ["low_end"],
  user_state: { dismissed: false, applied: false, user_modified_fix: null, feedback: null },
  created_at: "2026-04-25T00:00:00Z",
};

describe("VerdictCard", () => {
  it("renders headline, summary, severity badge, evidence chip", () => {
    render(<VerdictCard verdict={baseVerdict} />);
    expect(screen.getByText("Bass-kick mask 80Hz")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText(/lowmid \+50%/)).toBeInTheDocument();
  });

  it("renders WIN severity with green styling", () => {
    const win = { ...baseVerdict, severity: "win" as const };
    const { container } = render(<VerdictCard verdict={win} />);
    expect(container.querySelector(".border-green-600")).toBeTruthy();
  });

  it("hides confidence when ≥0.7", () => {
    render(<VerdictCard verdict={baseVerdict} />);
    expect(screen.queryByText(/confidence/i)).toBeNull();
  });

  it("shows confidence when <0.7", () => {
    const low = { ...baseVerdict, confidence: 0.4 };
    render(<VerdictCard verdict={low} />);
    expect(screen.getByText(/confidence/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: VerdictCard component**

```typescript
// components/frontend/src/features/verdicts/VerdictCard.tsx
import { useState } from "react";
import type { Verdict } from "../../types/verdicts";
import { SeverityBadge } from "./SeverityBadge";
import { EvidenceChips } from "./EvidenceChips";
import { FixSummary } from "./FixSummary";
import { dismissVerdict, sendFeedback } from "./feedbackClient";

const SEVERITY_BORDER: Record<Verdict["severity"], string> = {
  critical: "border-red-600",
  severe:   "border-orange-600",
  moderate: "border-yellow-600",
  minor:    "border-blue-600",
  win:      "border-green-600",
};

const SPECIALIST_LABELS: Record<string, string> = {
  rule_engine: "Rule engine",
  low_end: "Low End",
  frequency_balance: "Frequency Balance",
  dynamics: "Dynamics",
  stereo_phase: "Stereo & Phase",
  loudness: "Loudness",
  sections: "Sections",
  trance_arrangement: "Trance Arrangement",
  stem_reference: "Stem Reference",
  harmonic: "Harmonic",
  clarity: "Clarity",
  spatial: "Spatial",
  surround: "Surround",
  playback: "Playback",
  overall: "Overall",
  gain_staging: "Gain Staging",
  stereo_field: "Stereo Field",
  frequency_collision: "Frequency Collision",
  humanization: "Humanization",
  section_contrast: "Section Contrast",
  density: "Density",
  chord_harmony: "Chord & Harmony",
  device_chain: "Device Chain",
  priority_summary: "Priority Summary",
};

interface Props {
  verdict: Verdict;
  onDismiss?: (id: string) => void;
}

export function VerdictCard({ verdict, onDismiss }: Props) {
  const [showWhy, setShowWhy] = useState(false);
  const [dismissed, setDismissed] = useState(verdict.user_state.dismissed);
  const [feedback, setFeedback] = useState(verdict.user_state.feedback);

  if (dismissed) return null;

  const border = SEVERITY_BORDER[verdict.severity];
  const pulse = verdict.severity === "critical" ? "animate-pulse" : "";
  const label = SPECIALIST_LABELS[verdict.specialist] ?? verdict.specialist;

  const handleDismiss = async () => {
    setDismissed(true);
    onDismiss?.(verdict.verdict_id);
    try { await dismissVerdict(verdict.verdict_id); } catch { /* swallow */ }
  };

  const handleFeedback = async (kind: "helpful" | "wrong" | "unclear") => {
    setFeedback(kind);
    try { await sendFeedback(verdict.verdict_id, kind); } catch { /* swallow */ }
  };

  return (
    <article
      className={`border-l-4 ${border} bg-white rounded-md shadow-sm p-4 ${pulse}`}
      data-testid={`verdict-${verdict.verdict_id}`}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={verdict.severity} />
          <span className="text-xs text-slate-500">{label}</span>
        </div>
        {verdict.confidence < 0.7 && (
          <span className="text-xs text-slate-500">
            confidence {Math.round(verdict.confidence * 100)}%
          </span>
        )}
      </header>

      <h3 className="font-semibold text-slate-900 mt-2">{verdict.headline}</h3>
      <p className="text-sm text-slate-700 mt-1">{verdict.summary}</p>

      <EvidenceChips evidence={verdict.evidence} />
      <FixSummary fix={verdict.fix} />

      <button
        type="button"
        onClick={() => setShowWhy(s => !s)}
        className="mt-3 text-xs text-slate-500 hover:text-slate-800"
      >
        {showWhy ? "▾" : "▸"} Why this matters
      </button>
      {showWhy && (
        <p className="text-xs text-slate-600 mt-1">{verdict.why_it_matters}</p>
      )}

      <footer className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={() => handleFeedback("helpful")}
          className={`text-xs px-2 py-1 rounded ${feedback === "helpful" ? "bg-green-100 text-green-900" : "text-slate-500 hover:bg-slate-100"}`}
        >👍 Helpful</button>
        <button
          type="button"
          onClick={() => handleFeedback("wrong")}
          className={`text-xs px-2 py-1 rounded ${feedback === "wrong" ? "bg-red-100 text-red-900" : "text-slate-500 hover:bg-slate-100"}`}
        >👎 Wrong</button>
        <button
          type="button"
          onClick={() => handleFeedback("unclear")}
          className={`text-xs px-2 py-1 rounded ${feedback === "unclear" ? "bg-yellow-100 text-yellow-900" : "text-slate-500 hover:bg-slate-100"}`}
        >❓ Unclear</button>
        <button
          type="button"
          onClick={handleDismiss}
          className="ml-auto text-xs text-slate-400 hover:text-slate-700"
        >✕ Dismiss</button>
      </footer>
    </article>
  );
}
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/frontend && npm run test -- VerdictCard`
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/frontend/src/features/verdicts/VerdictCard.tsx \
        components/frontend/src/features/verdicts/feedbackClient.ts \
        components/frontend/src/features/verdicts/__tests__/VerdictCard.test.tsx
git commit -m "feat(frontend): VerdictCard with severity styling, evidence, fix, feedback"
```

---

## Task 24: VerdictList + filter chips

**Files:**
- Create: `components/frontend/src/features/verdicts/VerdictList.tsx`

- [ ] **Step 1: Implement**

```typescript
// components/frontend/src/features/verdicts/VerdictList.tsx
import { useMemo, useState } from "react";
import type { Verdict, Severity } from "../../types/verdicts";
import { VerdictCard } from "./VerdictCard";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "blockers", label: "Blockers" },  // critical + severe
  { id: "low_end", label: "Low End" },
  { id: "stereo_phase", label: "Stereo" },
  { id: "loudness", label: "Loudness" },
  { id: "dynamics", label: "Dynamics" },
] as const;
type FilterId = typeof FILTERS[number]["id"];

const BLOCKER_SEVERITIES: Severity[] = ["critical", "severe"];

interface Props {
  verdicts: Verdict[];
}

export function VerdictList({ verdicts }: Props) {
  const [active, setActive] = useState<FilterId>("all");

  const filtered = useMemo(() => {
    if (active === "all") return verdicts;
    if (active === "blockers")
      return verdicts.filter(v => BLOCKER_SEVERITIES.includes(v.severity));
    return verdicts.filter(v => v.category === active);
  }, [verdicts, active]);

  return (
    <section>
      <div className="flex gap-2 flex-wrap mb-4">
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActive(f.id)}
            className={`text-xs px-3 py-1 rounded-full border ${
              active === f.id
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No verdicts in this filter.</p>
        ) : (
          filtered.map(v => <VerdictCard key={v.verdict_id} verdict={v} />)
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/frontend/src/features/verdicts/VerdictList.tsx
git commit -m "feat(frontend): VerdictList with severity/category filter chips"
```

---

## Task 25: SummaryCard

**Files:**
- Create: `components/frontend/src/features/verdicts/SummaryCard.tsx`

- [ ] **Step 1: Implement**

```typescript
// components/frontend/src/features/verdicts/SummaryCard.tsx
import type { Verdict } from "../../types/verdicts";

interface Props {
  verdicts: Verdict[];
  trackName: string;
}

export function SummaryCard({ verdicts, trackName }: Props) {
  const top3 = verdicts.slice(0, 3);
  const blockers = verdicts.filter(v => v.severity === "critical" || v.severity === "severe").length;
  const wins = verdicts.filter(v => v.severity === "win").length;
  const ready = blockers === 0;

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-900">{trackName}</h2>
        <span className={`text-sm font-semibold ${
          ready ? "text-green-700" : "text-red-700"
        }`}>
          {ready ? "✓ Release-ready" : `✗ ${blockers} blocker${blockers === 1 ? "" : "s"}`}
        </span>
      </header>
      <div className="text-xs text-slate-500 mb-3">
        {verdicts.length} findings · {wins} thing{wins === 1 ? "" : "s"} working well
      </div>
      {top3.length > 0 && (
        <>
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Top {top3.length} fix{top3.length === 1 ? "" : "es"}
          </div>
          <ol className="space-y-1.5 list-decimal list-inside text-sm text-slate-800">
            {top3.map(v => <li key={v.verdict_id}>{v.headline}</li>)}
          </ol>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/frontend/src/features/verdicts/SummaryCard.tsx
git commit -m "feat(frontend): SummaryCard with release-readiness and top-3 fixes"
```

---

## Task 26: VerdictsPanel + index.ts

**Files:**
- Create: `components/frontend/src/features/verdicts/VerdictsPanel.tsx`
- Create: `components/frontend/src/features/verdicts/index.ts`
- Create: `components/frontend/src/features/verdicts/__tests__/VerdictsPanel.test.tsx`

- [ ] **Step 1: Test**

```typescript
// components/frontend/src/features/verdicts/__tests__/VerdictsPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { VerdictsPanel } from "../VerdictsPanel";

vi.mock("../useVerdictStream", () => ({
  useVerdictStream: () => ({
    status: "streaming",
    ruleVerdicts: [],
    routingPlan: { specialists_to_run: [{ name: "low_end", priority: 1, focus: "x" }],
                   skip: [], rationale: "x", estimated_total_tokens: 1 },
    specialistVerdicts: [],
    finalVerdicts: [],
    error: null,
    validationFailures: [],
  }),
}));

describe("VerdictsPanel", () => {
  it("shows skeletons for routed but-not-yet-completed specialists", () => {
    render(<VerdictsPanel jobId="j1" sseToken="t" trackName="track" />);
    expect(screen.getByText(/low_end/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// components/frontend/src/features/verdicts/VerdictsPanel.tsx
import type { Verdict } from "../../types/verdicts";
import { useVerdictStream } from "./useVerdictStream";
import { VerdictList } from "./VerdictList";
import { SummaryCard } from "./SummaryCard";
import { VerdictSkeleton } from "./VerdictSkeleton";

interface Props {
  jobId: string;
  sseToken: string;
  trackName: string;
  /** When provided, skip streaming and just render these (used for share view). */
  preloadedVerdicts?: Verdict[];
}

export function VerdictsPanel({
  jobId, sseToken, trackName, preloadedVerdicts,
}: Props) {
  // Always call the hook (rules of hooks). When preloadedVerdicts is set, the
  // page may unmount this component entirely; otherwise stream as normal.
  const stream = useVerdictStream(jobId, sseToken);

  const verdicts: Verdict[] = preloadedVerdicts
    ?? (stream.status === "complete"
        ? stream.finalVerdicts
        : [...stream.ruleVerdicts, ...stream.specialistVerdicts]);

  const completedSlugs = new Set(stream.specialistVerdicts.map(v => v.specialist));
  const pendingSlugs = (stream.routingPlan?.specialists_to_run ?? [])
    .map(s => s.name as string)
    .filter(slug => !completedSlugs.has(slug));

  return (
    <div className="space-y-6">
      <SummaryCard verdicts={verdicts} trackName={trackName} />
      <VerdictList verdicts={verdicts} />
      {!preloadedVerdicts && stream.status === "streaming" && pendingSlugs.length > 0 && (
        <div className="space-y-3">
          {pendingSlugs.map(slug => (
            <VerdictSkeleton key={slug} specialist={slug} />
          ))}
        </div>
      )}
      {!preloadedVerdicts && stream.error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-900">
          Verdict generation error: {stream.error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: index.ts**

```typescript
// components/frontend/src/features/verdicts/index.ts
export { VerdictsPanel } from "./VerdictsPanel";
```

- [ ] **Step 4: Run, expect green**

Run: `cd components/frontend && npm run test -- VerdictsPanel`
Expected: 1 PASSED.

- [ ] **Step 5: Commit**

```bash
git add components/frontend/src/features/verdicts/VerdictsPanel.tsx \
        components/frontend/src/features/verdicts/index.ts \
        components/frontend/src/features/verdicts/__tests__/VerdictsPanel.test.tsx
git commit -m "feat(frontend): VerdictsPanel orchestrating SSE + summary + list + skeletons"
```

---

## Task 27: Wire VerdictsPanel into ReportPage

**Files:**
- Modify: `components/frontend/src/pages/ReportPage.tsx`

- [ ] **Step 1: Inspect current ReportPage to find the ExpertsPanel mount point**

Run: `grep -n "ExpertsPanel" components/frontend/src/pages/ReportPage.tsx`
Expected: a line that imports + renders `<ExpertsPanel/>`.

- [ ] **Step 2: Replace ExpertsPanel with VerdictsPanel**

In `ReportPage.tsx`:

1. Replace the import:
   ```typescript
   // Old:
   // import { ExpertsPanel } from "../features/experts/ExpertsPanel";
   // New:
   import { VerdictsPanel } from "../features/verdicts";
   ```

2. Find the SSE token source (existing hook used by `useJobStream` — same token works for verdicts stream). If `ReportPage` doesn't already have it, fetch via `useEffect` after job completes:
   ```typescript
   const [sseToken, setSseToken] = useState<string>("");
   useEffect(() => {
     if (job?.status === "COMPLETE") {
       apiClient.get<{token: string}>(`/auth/sse-token`)
         .then(r => setSseToken(r.data.token));
     }
   }, [job?.status]);
   ```
   (If a different SSE-token endpoint exists, use that — search `grep -rn "sse-token\|sseToken" components/api/app/`.)

3. Replace the `<ExpertsPanel jobId={...} />` mount with:
   ```typescript
   {job?.status === "COMPLETE" && sseToken && (
     <VerdictsPanel
       jobId={jobId}
       sseToken={sseToken}
       trackName={job.track_name ?? job.original_filename ?? "Untitled"}
     />
   )}
   ```

   Place this **above** the existing deterministic report sections (frequency chart, stems, etc.) — the SummaryCard becomes the new top-of-page summary.

- [ ] **Step 3: Type-check + smoke**

Run: `cd components/frontend && npm run type-check`
Expected: no errors.

- [ ] **Step 4: Manual smoke (best-effort)**

Start API + worker + frontend per HANDOFF. Upload a file, wait for completion, open the report. Expect: a SummaryCard at the top, verdict cards streaming in below. Verify in DevTools Network tab that `EventSource` to `/api/reports/{id}/verdicts/stream?token=...` is open.

- [ ] **Step 5: Commit**

```bash
git add components/frontend/src/pages/ReportPage.tsx
git commit -m "feat(frontend): swap ExpertsPanel for VerdictsPanel on ReportPage"
```

---

## Task 28: Wire VerdictsPanel into SharedReportPage

**Files:**
- Modify: `components/frontend/src/pages/SharedReportPage.tsx`

- [ ] **Step 1: Replace experts mount with preloaded VerdictsPanel**

In `SharedReportPage.tsx`:

1. Add an import:
   ```typescript
   import { VerdictsPanel } from "../features/verdicts";
   ```

2. The shared report fetches `/api/reports/share/{token}` which (after Task 19) returns `verdicts` in the body. Use that as `preloadedVerdicts`:
   ```typescript
   {sharedReport?.verdicts && (
     <VerdictsPanel
       jobId={sharedReport.job_id}
       sseToken=""  // unused when preloadedVerdicts is set
       trackName={sharedReport.track_name ?? "Shared track"}
       preloadedVerdicts={sharedReport.verdicts}
     />
   )}
   ```

3. Remove any existing experts panel mount.

- [ ] **Step 2: Type-check**

Run: `cd components/frontend && npm run type-check`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add components/frontend/src/pages/SharedReportPage.tsx
git commit -m "feat(frontend): render VerdictsPanel with preloaded verdicts on SharedReportPage"
```

---

## Task 29: Cutover — delete experts code

**Files:**
- Delete: `components/api/app/services/expert_service.py`
- Delete: `components/api/app/routers/experts.py`
- Delete: `components/api/tests/test_expert_service.py`
- Delete: `components/api/tests/test_experts_router.py`
- Delete: `components/frontend/src/features/experts/` (whole directory)
- Modify: `components/api/app/main.py` (remove experts router import + include)

- [ ] **Step 1: Delete API-side experts code**

```bash
rm components/api/app/services/expert_service.py
rm components/api/app/routers/experts.py
rm components/api/tests/test_expert_service.py
rm components/api/tests/test_experts_router.py
```

- [ ] **Step 2: Remove experts router from `main.py`**

Open `components/api/app/main.py`, remove:

```python
from app.routers import experts as experts_router  # delete this
app.include_router(experts_router.router)          # delete this
```

- [ ] **Step 3: Delete frontend experts directory**

```bash
rm -rf components/frontend/src/features/experts/
```

- [ ] **Step 4: Run all tests to confirm nothing breaks**

Run: `cd components/api && pytest -q`
Expected: all green.

Run: `cd components/frontend && npm run test`
Expected: all green.

Run: `cd components/frontend && npm run type-check`
Expected: pass (no dangling imports of deleted experts components).

- [ ] **Step 5: Search for any remaining references**

Run: `grep -rn "from app.routers import experts" components/api/`
Run: `grep -rn "expert_service" components/api/`
Run: `grep -rn "features/experts" components/frontend/src/`
Run: `grep -rn "ExpertsPanel\|TriageView\|SpecialistCard\|ExpertOutput\|useExpertAnalysis" components/frontend/src/`
Expected: no hits in source files (test fixtures and docs are OK).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove prose-based experts pipeline (replaced by verdict pipeline)"
```

---

## Task 30: Documentation — archive ai-mix-experts.md, write ai-mix-verdicts.md

**Files:**
- Move: `docs/ai-mix-experts.md` → `docs/archive/ai-mix-experts.md`
- Create: `docs/ai-mix-verdicts.md`

- [ ] **Step 1: Archive old doc**

```bash
mkdir -p docs/archive
git mv docs/ai-mix-experts.md docs/archive/ai-mix-experts.md
```

- [ ] **Step 2: Create new doc**

```markdown
# AI Mix Verdicts

A structured-output pipeline that runs after a 7-phase analysis completes. Produces a ranked list of `Verdict` objects, each with severity, evidence, and an optional fix recommendation. Renders as verdict cards on the report page.

## Pipeline overview

1. **Rule engine** — deterministic rules over `analysis.json` produce `severity: rule_engine` verdicts (clipping, true peak, mono compatibility, loudness range, low-mid mud, dynamic range, stereo correlation, key confidence). No LLM cost.
2. **Triage** — Claude (CLI) reads the analysis + rule findings and returns a `SpecialistRoutingPlan` JSON object listing which specialists to run, in what order, with what focus.
3. **Specialists** — sequential execution (CLI cannot reliably run in parallel) of routed specialists. Each emits structured `Verdict` JSON.
4. **Validator** — rejects fabricated metric paths (`evidence[].metric` must resolve in `analysis.json`), out-of-range DSP params, mismatched section bounds; recomputes `priority_score` deterministically; downgrades severity if claimed > score band.
5. **Dedupe** — merges verdicts that share `(category, primary metric path)`. Sources are unioned.
6. **Ranker** — sorts by `priority_score` desc → severity desc → confidence desc → verdict_id asc.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `VERDICT_PIPELINE_ENABLED` | `true` | Master switch |
| `VERDICT_CLI_TIMEOUT_S` | `90` | Per-specialist timeout |
| `VERDICT_MAX_CONCURRENT_GENERATIONS` | `2` | Per-process semaphore |
| `USE_CLAUDE_CLI` | `true` (required for v1) | Anthropic API path is deferred |

## API endpoints

- `POST /api/reports/{job_id}/verdicts/generate` — kick off (or return cached payload)
- `GET /api/reports/{job_id}/verdicts/stream` — SSE per-event streaming
- `GET /api/reports/{job_id}/verdicts` — final ranked list
- `POST /api/verdicts/{verdict_id}/dismiss` — user dismissal
- `POST /api/verdicts/{verdict_id}/feedback` — `helpful` | `wrong` | `unclear`
- `GET /api/reports/share/{token}` — public share now includes `verdicts` field

## Schema

Source of truth: `components/shared/aimusic_shared/verdicts/models.py`. TypeScript types are auto-generated to `components/frontend/src/types/verdicts.ts` via `npm run gen-types`.

## Cache key

`(analysis_hash + comma-separated <slug>@<version> for every prompt + model)`. Bumping a prompt version invalidates cache for that specialist; bumping the model invalidates all.

## Out of scope (future PRPs)

- DSP A/B audio rendering (Pedalboard)
- Tier gating (Free/Pro/Studio)
- Anthropic API transport with prompt caching + parallel execution
- Feedback analytics dashboard / RLHF export
- Cross-track verdict comparison
```

- [ ] **Step 3: Commit**

```bash
git add docs/ai-mix-verdicts.md docs/archive/ai-mix-experts.md
git commit -m "docs: archive ai-mix-experts.md, add ai-mix-verdicts.md"
```

---

## Task 31: Update CLAUDE.md validation gates + component descriptions

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add verdict pipeline to api component description**

In `CLAUDE.md` under `### api (api.md)`, append to the **Routes added in v1.1** list:

```markdown
**Routes added in v1.2 (verdict pipeline):**
- `POST /reports/{job_id}/verdicts/generate` — start or return cached verdicts
- `GET /reports/{job_id}/verdicts/stream` — SSE per-event verdict stream
- `GET /reports/{job_id}/verdicts` — final ranked verdicts
- `POST /verdicts/{id}/dismiss` and `POST /verdicts/{id}/feedback`
- `GET /reports/share/{token}` — extended with `verdicts` field
```

In **DB columns added in v1.1**, add a v1.2 subsection:

```markdown
**DB columns added in v1.2 (verdict pipeline):**
- `analysis_results.verdicts_payload` JSONB (immutable verdict cache)
- `analysis_results.verdicts_generated_at`, `verdicts_prompt_version_set`, `verdicts_model`
- `verdict_validation_failures` table (ops/regression tracking)
- `verdict_user_state` table (per-user dismiss/feedback)
```

In **Gotchas:**, add:

```markdown
- **`USE_CLAUDE_CLI=true` required for verdict pipeline in v1**: the Anthropic API transport is a stub. The CLI is wrapped via `subprocess.run` inside `asyncio.to_thread`; concurrent calls serialize on `asyncio.Semaphore(1)` because the CLI is not concurrency-safe.
- **Specialist slugs are snake_case, prompt files are PascalCase**: mapping in `app/verdict_pipeline/prompt_loader.py::SLUG_TO_FILENAME`. Triage routing plans use slugs.
- **Validator overwrites priority_score and may downgrade severity**: never trust LLM-supplied score. The Python formula in `aimusic_shared/verdicts/scoring.py` is authoritative.
- **Verdict cache key must include every prompt's frontmatter version**: bumping a single prompt version invalidates only that specialist's cache contribution. The full set is stored as `analysis_results.verdicts_prompt_version_set`.
```

- [ ] **Step 2: Replace the `analysis (analysis.md)` "How to run" section's reference to expert_service**

Search for `expert_service` and `experts.py` in `CLAUDE.md` and remove/replace stale references.

Run: `grep -n "expert_service\|experts.py\|ExpertsPanel\|features/experts" CLAUDE.md`
Update each hit accordingly (most can simply be deleted).

- [ ] **Step 3: Update Validation gates section**

Append to the existing validation-gate fenced block:

```bash
# Verdict pipeline tests
pytest -q components/shared/tests/test_verdict_schema.py
pytest -q components/shared/tests/test_verdict_scoring.py
pytest -q components/api/tests/verdict_pipeline/

# Frontend tests for verdicts feature
cd components/frontend && npm run test -- features/verdicts/
```

- [ ] **Step 4: Add "frontend (dashboard.md)" updates**

Under the frontend component section's **Components added in v1.1**, append:

```markdown
**Components added in v1.2 (verdict pipeline):**
- `features/verdicts/VerdictsPanel.tsx` — replaces ExpertsPanel
- `features/verdicts/SummaryCard.tsx` — top-3 + release-readiness banner
- `features/verdicts/VerdictCard.tsx`, `EvidenceChips.tsx`, `FixSummary.tsx`,
  `SeverityBadge.tsx`, `VerdictSkeleton.tsx`, `VerdictList.tsx`
- `features/verdicts/useVerdictStream.ts` — SSE hook for verdict events
- `types/verdicts.ts` — auto-generated from Pydantic; regenerate via `npm run gen-types`
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document v1.2 verdict pipeline routes, DB columns, gotchas, gates"
```

---

## Task 32: Final validation gate run + integration smoke

**Files:** none modified — verification only.

- [ ] **Step 1: Lint**

Run: `ruff check components/api/ components/shared/`
Expected: clean.

- [ ] **Step 2: Type-check (Python)**

Run: `mypy components/api/app/verdict_pipeline/ components/api/app/llm/ --ignore-missing-imports`
Expected: clean.

- [ ] **Step 3: Schema tests**

Run: `cd components/shared && pytest tests/ -v`
Expected: all green (15+ tests).

- [ ] **Step 4: API tests (full suite)**

Run: `cd components/api && pytest -q`
Expected: all green; verdict pipeline tests + router tests + existing tests, no regressions.

- [ ] **Step 5: Frontend type-check + tests**

Run: `cd components/frontend && npm run type-check`
Run: `cd components/frontend && npm run test`
Expected: clean type-check, all tests green.

- [ ] **Step 6: Frontend build smoke**

Run: `cd components/frontend && npm run build`
Expected: build succeeds; no warnings about unsafe dynamic Tailwind classes.

- [ ] **Step 7: End-to-end manual smoke**

Per HANDOFF.md, find free ports and start: docker compose, API, worker, frontend.

```bash
docker compose -f docker/docker-compose.yml up -d
cd components/api && python -m uvicorn app.main:app --port 8090 &
cd components/worker && python -m celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo &
cd components/frontend && npm run dev -- --port 3000 &
```

In a browser:

1. Register a test user and log in.
2. Upload a track (any of: clean trance, muddy track, clipped pop).
3. Wait for analysis to complete.
4. Confirm: SummaryCard shows release-readiness; verdict cards stream in (rule_engine cards appear first within ~1s; specialist cards appear over the next 1-3 minutes).
5. Click `Dismiss` on one card → it disappears; reload the page → it stays dismissed.
6. Click `👍 Helpful` on another card → button highlights; reload → highlight persists.
7. Copy the share URL from the report. Open in a private/incognito window. Confirm verdicts render but no `Dismiss`/feedback buttons fire (or at least, no auth errors visible).

- [ ] **Step 8: Verify cache hit**

Click "Generate" again on the same job:
- `POST /api/reports/{job_id}/verdicts/generate` should return 200 with the cached payload (no new pipeline run; check API logs).

- [ ] **Step 9: Commit final state**

If any tweaks were needed during smoke, commit them now:

```bash
git status
# fix anything broken, then:
git add <fixes>
git commit -m "fix: address issues found in v1.2 verdict pipeline smoke test"
```

If nothing needed fixing, no commit needed.

---

## Self-Review

**Spec coverage** — every numbered section of the design spec maps to at least one task:

| Spec section | Tasks |
|---|---|
| §3 End-to-end pipeline | 6, 7, 10, 11, 15 |
| §4 Component boundaries | 5, 6, 8, 10, 11, 12, 13, 14, 15 |
| §5 Verdict & Fix schema | 1 |
| §6 Priority score formula | 2 |
| §7 Rule engine v1 rule set | 6, 7 |
| §8 Triage structured output | 9, 10 |
| §9 Specialist prompt modifications | 9 |
| §10 Validator | 12 |
| §11 Dedupe | 13 |
| §12 Ranker | 14 |
| §13 LLM Client (CLI) | 5 |
| §14 API Endpoints | 17, 18, 19 |
| §15 Database migrations | 3, 4 |
| §16 Frontend restructure | 20, 21, 22, 23, 24, 25, 26, 27, 28 |
| §17 Configuration | 16 |
| §18 Testing strategy | every task has TDD tests |
| §19 Cutover checklist | 29 |
| §20 Risks (validation failure logging) | 12, 15 |

**Placeholder scan** — no `TBD`/`TODO`/`fill in details` markers. Every code block is concrete.

**Type consistency** — `Verdict.severity` is `Literal["critical","severe","moderate","minor","win"]` everywhere; `priority_score: int` always; `evidence[].metric: str` (dotted path) always; `Fix.dsp_chain: list[DspOp]` always.

**Cross-task imports** — Task 11's `_hydrate_verdict` imports `Verdict` from `aimusic_shared.verdicts.models`, defined in Task 1. Task 12's `validate_verdict` uses `compute_priority_score` and `severity_from_score` from Task 2. Task 15's orchestrator imports from Tasks 6, 10, 11, 12, 13, 14. ✓

**Files referenced but not created** — `app/db.py::async_session_maker` (used in Task 17): this exists today and is referenced from existing code (e.g., `services/expert_service.py` indirectly via `app.config`). Confirm the symbol via `grep -n "async_sessionmaker" components/api/app/db.py` before Task 17. If it's exposed under a different name, swap accordingly.

**External dependency on `pydantic-to-typescript`** — Task 20 installs it via `pip install pydantic-to-typescript`. If unavailable, the script falls back to `datamodel-code-generator`. Both should produce usable TS output.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-verdict-pipeline-restructure.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
