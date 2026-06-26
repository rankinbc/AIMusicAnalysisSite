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

# ── Problem-record taxonomy (IDENTIFY tier) ──
ProblemSource = Literal["rule_engine", "llm_identifier"]
DataTier = Literal["audio_only", "stems", "project_midi"]
ProblemKind = Literal["fault", "observation", "integrity"]


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
        "q": (0.1, 18.0),
    },
    "high_shelf": {
        "frequency_hz": (20.0, 22000.0),
        "gain_db": (-24.0, 24.0),
        "q": (0.1, 18.0),
    },
    "high_pass": {
        "frequency_hz": (20.0, 22000.0),
        "slope_db": (6.0, 96.0),
        "q": (0.1, 18.0),
    },
    "low_pass": {
        "frequency_hz": (20.0, 22000.0),
        "slope_db": (6.0, 96.0),
        "q": (0.1, 18.0),
    },
    "compressor": {
        "threshold_db": (-60.0, 0.0),
        "ratio": (1.0, 20.0),
        "attack_ms": (0.1, 1000.0),
        "release_ms": (1.0, 5000.0),
        "knee_db": (0.0, 24.0),
        "makeup_gain_db": (0.0, 24.0),
    },
    "multiband_compressor": {
        "bands": None,          # list of band dicts; not range-checked here
        "frequency_hz": (20.0, 22000.0),
        "threshold_db": (-60.0, 0.0),
        "ratio": (1.0, 20.0),
        "attack_ms": (0.1, 1000.0),
        "release_ms": (1.0, 5000.0),
    },
    "limiter": {
        "ceiling_db": (-6.0, 0.0),
        "threshold_db": (-60.0, 0.0),
        "release_ms": (1.0, 5000.0),
        "lookahead_ms": (0.0, 10.0),
    },
    "gain": {
        "gain_db": (-24.0, 24.0),
    },
    "stereo_width": {
        "width_pct": (0.0, 200.0),
        # Bass mono-maker crossover; 0 = off. Mirrors the rack `ms.monoMakerHz`
        # knob (frontend data.ts, range 0-400). Added with the Phase-4 mono/stereo solvers.
        "mono_below_hz": (0.0, 400.0),
    },
    "sidechain": {
        "source_stem": None,    # string
        "depth_db": (0.0, 24.0),
        "release_ms": (1.0, 5000.0),
        "ratio": (1.0, 20.0),
        "threshold_db": (-60.0, 0.0),
        "attack_ms": (0.1, 1000.0),
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

    # ── Problem-record fields (IDENTIFY tier). All optional w/ defaults so
    #    existing constructors + persistence are unaffected. ──
    problem_id: Optional[str] = None       # STABLE "<category>.<slug>.<index>"
    kind: ProblemKind = "fault"
    source: ProblemSource = "rule_engine"
    data_tier: DataTier = "audio_only"
    fixable: bool = True
    suspected: bool = False
    where: Optional[dict[str, Any]] = None  # {section_type, start_seconds, end_seconds}
    refines: Optional[str] = None           # parent composite problem_id (set by the refiner)

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
