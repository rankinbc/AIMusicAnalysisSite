import os
import uuid
import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import create_engine, String, Float, Integer, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.dialects.postgresql import UUID, JSONB
from celery import Task

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/music_analyzer"
)


class Base(DeclarativeBase):
    pass


class JobStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


class UploadJob(Base):
    __tablename__ = "upload_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[JobStatus] = mapped_column(SAEnum(JobStatus), nullable=False)
    current_phase: Mapped[int] = mapped_column(Integer, default=0)
    phase_name: Mapped[str] = mapped_column(String(100), default="")
    phase_pct: Mapped[float] = mapped_column(Float, default=0.0)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    reference_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("upload_jobs.id"), unique=True, nullable=False)
    phase_results: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    final_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CustomTask(Task):
    """Base task class that creates a DB session per task execution (not at import time)."""
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


def update_job_phase(session, job_id: str, phase: int, phase_name: str, pct: float, status: Optional[JobStatus] = None):
    from datetime import timezone
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
        created_at=datetime.now(),
    )
    session.add(result)
    update_job_phase(session, job_id, 7, "Complete", 1.0, status=JobStatus.COMPLETE)
