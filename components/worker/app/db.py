import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from celery import Task

from aimusic_shared.models import AnalysisResult, JobStatus, UploadJob  # noqa: F401

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/music_analyzer"
)


class CustomTask(Task):
    """Base task class — creates a DB session per task execution, not at import time."""
    _session = None
    _engine = None

    def before_start(self, task_id, args, kwargs):
        self._engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
        Session = sessionmaker(self._engine, expire_on_commit=False)
        self._session = Session()

    def after_return(self, status, retval, task_id, args, kwargs, einfo):
        if self._session:
            self._session.close()
            self._session = None
        if self._engine:
            self._engine.dispose()
            self._engine = None


def update_job_phase(
    session,
    job_id: str,
    phase: int,
    phase_name: str,
    pct: float,
    status: Optional[JobStatus] = None,
):
    job = session.get(UploadJob, uuid.UUID(job_id))
    if not job:
        return
    job.current_phase = phase
    job.phase_name = phase_name
    job.phase_pct = pct
    if status is not None:
        job.status = status
    if status == JobStatus.PROCESSING and job.started_at is None:
        job.started_at = datetime.now(timezone.utc)
    if status in (JobStatus.COMPLETE, JobStatus.FAILED):
        job.completed_at = datetime.now(timezone.utc)
    session.commit()


def finalize_job(session, job_id: str, pipeline_result: dict):
    result = AnalysisResult(
        id=uuid.uuid4(),
        job_id=uuid.UUID(job_id),
        phase_results=pipeline_result.get("phases", []),
        final_json=pipeline_result,
        share_token=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc),
    )
    session.add(result)
    # Explicit flush surfaces INSERT errors before update_job_phase runs its SELECT.
    # Without this, a failed autoflush leaves the session in PendingRollback and the
    # subsequent SELECT in update_job_phase also fails, leaving the job stuck in PROCESSING.
    session.flush()
    update_job_phase(session, job_id, 7, "Complete", 1.0, status=JobStatus.COMPLETE)
