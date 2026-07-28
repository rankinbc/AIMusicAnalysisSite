from typing import Literal, NotRequired, TypedDict

# Bumped when the final_json field set changes. "2.1.0" adds the Tier-B phase-1
# lifts: key_estimate, loudness_timeline, channel_balance, sub_30_energy.
# "2.2.0" adds per-phase wall-time: phases[].duration_s + root phase_durations.
ANALYSIS_SCHEMA_VERSION = "2.2.0"


class PhaseResult(TypedDict):
    phase: int
    name: str
    status: Literal["ok", "failed", "skipped"]
    data: dict
    error: str | None
    # Wall-clock seconds for this phase's run. NotRequired: phases merged from a
    # pre-2.2.0 stored final_json (rerun_single_phase) won't carry it.
    duration_s: NotRequired[float]


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
    # {phase_number_as_str: seconds} — derived in finalize_result from the
    # phases' duration_s; persisted to analyses.phase_durations by the worker.
    phase_durations: dict[str, float]
