"""Pydantic schemas for /songs/ endpoints."""
from typing import Optional

from pydantic import BaseModel, Field


class SongCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    genre_hint: Optional[str] = None


class SongPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    genre_hint: Optional[str] = None


class AnalysisSummary(BaseModel):
    job_id: str
    score: Optional[float] = None
    grade: Optional[str] = None
    created_at: str
    status: str


class VersionInSongDetail(BaseModel):
    version_id: str
    version_number: int
    label: Optional[str] = None
    notes: Optional[str] = None
    created_at: str
    latest_job_id: Optional[str] = None
    latest_score: Optional[float] = None
    latest_grade: Optional[str] = None
    analysis_count: int = 0


class SongSummary(BaseModel):
    song_id: str
    name: str
    genre_hint: Optional[str] = None
    version_count: int = 0
    latest_version_id: Optional[str] = None
    latest_job_id: Optional[str] = None
    latest_score: Optional[float] = None
    latest_grade: Optional[str] = None
    last_analyzed: Optional[str] = None
    created_at: str


class SongDetail(SongSummary):
    versions: list[VersionInSongDetail] = []
    archived_at: Optional[str] = None
