"""
Canonical SQLAlchemy ORM models — single source of truth for the DB schema.

Both `components/api` and `components/worker` import from here.
When you add a DB column:
  1. Add it here
  2. Add an Alembic migration in components/api/alembic/versions/
  3. Done — no other model files to update.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class JobStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    jobs: Mapped[list[UploadJob]] = relationship("UploadJob", back_populates="user", lazy="noload")


class UploadJob(Base):
    __tablename__ = "upload_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[JobStatus] = mapped_column(SAEnum(JobStatus), default=JobStatus.PENDING, nullable=False)
    current_phase: Mapped[int] = mapped_column(Integer, default=0)
    phase_name: Mapped[str] = mapped_column(String(100), default="")
    phase_pct: Mapped[float] = mapped_column(Float, default=0.0)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    reference_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    als_file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    genre_hint: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    track_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User", back_populates="jobs", lazy="noload")
    result: Mapped[Optional[AnalysisResult]] = relationship("AnalysisResult", back_populates="job", lazy="noload")


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("upload_jobs.id"), unique=True, nullable=False)
    phase_results: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    final_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    share_token: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()), index=True)
    verdicts_payload: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    verdicts_generated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verdicts_prompt_version_set: Mapped[Optional[str]] = mapped_column(
        String(2000), nullable=True
    )
    verdicts_model: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    job: Mapped[UploadJob] = relationship("UploadJob", back_populates="result", lazy="noload")


class VerdictUserState(Base):
    __tablename__ = "verdict_user_state"

    verdict_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("upload_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    applied: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    user_modified_fix: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    feedback: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
