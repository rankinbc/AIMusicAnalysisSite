"""Pydantic schemas for /versions/ endpoints."""
from typing import Optional

from pydantic import BaseModel, Field


class VersionPatch(BaseModel):
    version_number: Optional[int] = Field(default=None, ge=1)
    label: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = None


class AnalysisInVersionDetail(BaseModel):
    job_id: str
    status: str
    score: Optional[float] = None
    grade: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None


class VersionDetail(BaseModel):
    version_id: str
    song_id: str
    version_number: int
    label: Optional[str] = None
    notes: Optional[str] = None
    file_path: str
    has_reference: bool
    has_als: bool
    has_stems: bool
    created_at: str
    analyses: list[AnalysisInVersionDetail] = []
