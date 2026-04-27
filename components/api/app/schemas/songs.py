from typing import Optional
from pydantic import BaseModel


class AnalysisSummary(BaseModel):
    job_id: str
    score: Optional[float] = None
    grade: Optional[str] = None
    created_at: str
    status: str


class SongSummary(BaseModel):
    song_id: str
    name: str
    genre_hint: Optional[str] = None
    latest_job_id: Optional[str] = None
    latest_score: Optional[float] = None
    latest_grade: Optional[str] = None
    analysis_count: int = 0
    last_analyzed: Optional[str] = None


class SongDetail(SongSummary):
    analyses: list[AnalysisSummary] = []
