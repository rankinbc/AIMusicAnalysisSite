from typing import Any

from pydantic import BaseModel


class StemMappingProposalDTO(BaseModel):
    file: str
    proposed_role: str
    proposed_als_track: str | None
    confidence: float


class JobStatus(BaseModel):
    job_id: str
    status: str
    current_phase: int
    phase_name: str
    phase_pct: float
    has_als: bool = False
    proposed_mapping: list[StemMappingProposalDTO] | None = None
    als_track_names: list[str] | None = None


class JobResult(BaseModel):
    job_id: str
    result: dict[str, Any]


class JobSummary(BaseModel):
    job_id: str
    status: str
    filename: str
    created_at: str
    score: float | None = None
    grade: str | None = None


class TrackVersionSummary(BaseModel):
    job_id: str
    filename: str
    score: float | None = None
    grade: str | None = None
    created_at: str


class TrackGroup(BaseModel):
    track_name: str
    version_count: int
    latest_score: float | None = None
    latest_grade: str | None = None
    versions: list[TrackVersionSummary]
