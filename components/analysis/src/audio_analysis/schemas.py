from typing import TypedDict, Literal


class PhaseResult(TypedDict):
    phase: int
    name: str
    status: Literal["ok", "failed", "skipped"]
    data: dict
    error: str | None


class PipelineResult(TypedDict):
    file_path: str
    phases: list[PhaseResult]
    overall_score: float
    grade: str
    top_fixes: list[str]
    danceability_score: int
    coach_name: str
    coach_intro: str
    coached_fixes: list[str]
