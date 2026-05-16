from typing import Any, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field


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


class SaveAsNewSong(BaseModel):
    action: Literal["new_song"]
    name: str = Field(..., min_length=1, max_length=200)
    genre_hint: Optional[str] = None
    label: Optional[str] = None
    notes: Optional[str] = None


class AddToExistingSong(BaseModel):
    action: Literal["add_to_song"]
    song_id: UUID
    label: Optional[str] = None
    notes: Optional[str] = None


SaveToLibraryBody = Union[SaveAsNewSong, AddToExistingSong]


class SaveToLibraryResult(BaseModel):
    song_id: str
    version_id: str
