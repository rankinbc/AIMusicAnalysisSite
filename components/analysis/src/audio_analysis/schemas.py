from typing import TypedDict, Literal

# Bumped when the final_json field set changes. "2.1.0" adds the Tier-B phase-1
# lifts: key_estimate, loudness_timeline, channel_balance, sub_30_energy.
ANALYSIS_SCHEMA_VERSION = "2.1.0"


class PhaseResult(TypedDict):
    phase: int
    name: str
    status: Literal["ok", "failed", "skipped"]
    data: dict
    error: str | None


class PipelineResult(TypedDict):
    file_path: str
    analysis_schema_version: str
    phases: list[PhaseResult]
    overall_score: float
    grade: str
    top_fixes: list[str]
    danceability_score: int
    coach_name: str
    coach_intro: str
    coached_fixes: list[str]
