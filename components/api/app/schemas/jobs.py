from typing import Any

from pydantic import BaseModel


class JobStatus(BaseModel):
    job_id: str
    status: str
    current_phase: int
    phase_name: str
    phase_pct: float


class JobResult(BaseModel):
    job_id: str
    result: dict[str, Any]
