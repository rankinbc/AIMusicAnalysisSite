# SQLAlchemy 2.0 mirror of the EF Core entities in
# components/bff/src/Spectr.Data/Entities/. EF Core owns all schema migrations.
# When EF entities change, regenerate this file.
#
# DO NOT introduce columns or tables here that don't exist in EF Core entities.
# If you need a new column, add it in C# first, run the migration, then mirror here.
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


# ── Job status string constants (replaces former JobStatus enum) ──────────────
JOB_STATUS_PENDING = "pending"
JOB_STATUS_PROCESSING = "processing"
JOB_STATUS_COMPLETE = "complete"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_AWAITING_STEM_MAPPING = "awaiting_stem_mapping"
JOB_STATUS_ALL = frozenset({
    JOB_STATUS_PENDING,
    JOB_STATUS_PROCESSING,
    JOB_STATUS_COMPLETE,
    JOB_STATUS_FAILED,
    JOB_STATUS_AWAITING_STEM_MAPPING,
})


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("handle", name="uq_users_handle"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column("email", String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column("hashed_password", String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column("is_active", Boolean, nullable=False, default=True)
    handle: Mapped[Optional[str]] = mapped_column("handle", String(32), nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column("display_name", String(80), nullable=True)
    bio: Mapped[Optional[str]] = mapped_column("bio", String(500), nullable=True)
    avatar_hue: Mapped[Optional[int]] = mapped_column("avatar_hue", SmallInteger, nullable=True)
    banner_hue: Mapped[Optional[int]] = mapped_column("banner_hue", SmallInteger, nullable=True)
    accent: Mapped[Optional[str]] = mapped_column("accent", String(16), nullable=True)
    public_link: Mapped[Optional[str]] = mapped_column("public_link", String(200), nullable=True)
    ui_prefs: Mapped[Optional[Any]] = mapped_column("ui_prefs", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column("token_hash", String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column("expires_at", DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column("revoked_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Song(Base):
    __tablename__ = "songs"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_songs_user_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column("name", String(200), nullable=False)
    genre_hint: Mapped[Optional[str]] = mapped_column("genre_hint", String(50), nullable=True)
    default_reference_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "default_reference_id", UUID(as_uuid=True), nullable=True
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column("archived_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class SongVersion(Base):
    __tablename__ = "song_versions"
    __table_args__ = (
        UniqueConstraint("song_id", "version_number", name="uq_song_versions_song_number"),
        CheckConstraint('"version_number" > 0', name="ck_song_versions_version_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_id: Mapped[uuid.UUID] = mapped_column(
        "song_id",
        UUID(as_uuid=True),
        ForeignKey("songs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column("version_number", Integer, nullable=False)
    label: Mapped[Optional[str]] = mapped_column("label", String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column("notes", String, nullable=True)
    file_path: Mapped[str] = mapped_column("file_path", String(500), nullable=False)
    reference_path: Mapped[Optional[str]] = mapped_column("reference_path", String(500), nullable=True)
    als_file_path: Mapped[Optional[str]] = mapped_column("als_file_path", String(500), nullable=True)
    stem_paths_raw: Mapped[Optional[Any]] = mapped_column("stem_paths_raw", JSONB, nullable=True)
    stem_paths: Mapped[Optional[Any]] = mapped_column("stem_paths", JSONB, nullable=True)
    is_current: Mapped[bool] = mapped_column("is_current", Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    __table_args__ = (
        Index("ix_analysis_jobs_user_id_status", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column("status", String(32), nullable=False, default=JOB_STATUS_PENDING)
    current_phase: Mapped[str] = mapped_column("current_phase", String(64), nullable=False, default="")
    phase_pct: Mapped[float] = mapped_column("phase_pct", Float, nullable=False, default=0.0)
    reference_id: Mapped[Optional[uuid.UUID]] = mapped_column("reference_id", UUID(as_uuid=True), nullable=True)
    task_id: Mapped[Optional[str]] = mapped_column("task_id", String(255), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column("error_message", String, nullable=True)
    dispatched_at: Mapped[datetime] = mapped_column(
        "dispatched_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    started_at: Mapped[Optional[datetime]] = mapped_column("started_at", DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column("completed_at", DateTime(timezone=True), nullable=True)
    failed_at: Mapped[Optional[datetime]] = mapped_column("failed_at", DateTime(timezone=True), nullable=True)


class Analysis(Base):
    __tablename__ = "analyses"
    __table_args__ = (
        UniqueConstraint("job_id", name="uq_analyses_job_id"),
        UniqueConstraint("share_token", name="uq_analyses_share_token"),
        Index("ix_analyses_user_id", "user_id"),
        Index("ix_analyses_version_id", "version_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        "job_id",
        UUID(as_uuid=True),
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    song_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "song_id",
        UUID(as_uuid=True),
        ForeignKey("songs.id", ondelete="CASCADE"),
        nullable=True,
    )
    song_name: Mapped[Optional[str]] = mapped_column("song_name", String(200), nullable=True)
    final_json: Mapped[Any] = mapped_column("final_json", JSONB, nullable=False, default=dict)
    phase_durations: Mapped[Any] = mapped_column("phase_durations", JSONB, nullable=False, default=dict)
    waveform_peaks_path: Mapped[Optional[str]] = mapped_column("waveform_peaks_path", String(500), nullable=True)
    stem_metrics: Mapped[Optional[Any]] = mapped_column("stem_metrics", JSONB, nullable=True)
    # Triage routing plan — `{specialists_to_run: [...], skip, rationale,
    # estimated_total_tokens}`. Written by the `run_triage` actor when the
    # BFF lazy-fires it on first ListVerdicts call. Null until generated;
    # never recomputed once non-null.
    routing_plan: Mapped[Optional[Any]] = mapped_column("routing_plan", JSONB, nullable=True)
    share_token: Mapped[Optional[str]] = mapped_column("share_token", String(36), nullable=True)
    share_show_verdicts: Mapped[bool] = mapped_column(
        "share_show_verdicts", Boolean, nullable=False, default=False
    )
    share_enabled_at: Mapped[Optional[datetime]] = mapped_column(
        "share_enabled_at", DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Verdict(Base):
    __tablename__ = "verdicts"
    __table_args__ = (
        Index("ix_verdicts_analysis_id", "analysis_id"),
        Index("ix_verdicts_analysis_id_specialist", "analysis_id", "specialist"),
    )

    # ULID string ("vrd_..."), not a Guid — preserves Python-side
    # aimusic_shared.verdicts.ulid_helpers.new_verdict_id() compatibility.
    id: Mapped[str] = mapped_column("id", String(40), primary_key=True)
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        "analysis_id",
        UUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="CASCADE"),
        nullable=False,
    )
    specialist: Mapped[str] = mapped_column("specialist", String(64), nullable=False)
    prompt_version: Mapped[str] = mapped_column("prompt_version", String(120), nullable=False)
    model: Mapped[str] = mapped_column("model", String(60), nullable=False)
    severity: Mapped[str] = mapped_column("severity", String(20), nullable=False)
    category: Mapped[str] = mapped_column("category", String(40), nullable=False)
    confidence: Mapped[float] = mapped_column("confidence", Float, nullable=False)
    priority_score: Mapped[int] = mapped_column("priority_score", Integer, nullable=False)
    impact: Mapped[str] = mapped_column("impact", String(8), nullable=False, default="med")
    chart_type: Mapped[Optional[str]] = mapped_column("chart_type", String(20), nullable=True)
    headline: Mapped[str] = mapped_column("headline", String(120), nullable=False)
    summary: Mapped[Optional[str]] = mapped_column("summary", String(400), nullable=True)
    body: Mapped[Optional[str]] = mapped_column("body", String, nullable=True)
    metric_line: Mapped[Optional[str]] = mapped_column("metric_line", String(240), nullable=True)
    why_it_matters: Mapped[Optional[str]] = mapped_column("why_it_matters", String(280), nullable=True)
    preset_name: Mapped[Optional[str]] = mapped_column("preset_name", String(120), nullable=True)
    evidence: Mapped[Any] = mapped_column("evidence", JSONB, nullable=False, default=list)
    fix: Mapped[Optional[Any]] = mapped_column("fix", JSONB, nullable=True)
    sources: Mapped[Any] = mapped_column("sources", JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class VerdictUserState(Base):
    __tablename__ = "verdict_user_state"

    verdict_id: Mapped[str] = mapped_column(
        "verdict_id",
        String(40),
        ForeignKey("verdicts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    dismissed: Mapped[bool] = mapped_column("dismissed", Boolean, nullable=False, default=False)
    applied: Mapped[bool] = mapped_column("applied", Boolean, nullable=False, default=False)
    user_modified_fix: Mapped[Optional[Any]] = mapped_column("user_modified_fix", JSONB, nullable=True)
    feedback: Mapped[Optional[str]] = mapped_column("feedback", String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class PromptVersion(Base):
    """Operator-controlled prompt-version pin (FR48). NULL pinned_version =
    serve the live prompt file's frontmatter version. The worker's prompt
    loader reads this (TTL-cached); only the operator writes."""

    __tablename__ = "prompt_versions"

    slug: Mapped[str] = mapped_column("slug", String(64), primary_key=True)
    pinned_version: Mapped[Optional[str]] = mapped_column(
        "pinned_version", String(32), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SessionNote(Base):
    __tablename__ = "session_notes"
    __table_args__ = (
        Index("ix_session_notes_version_id_user_id", "version_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id: Mapped[uuid.UUID] = mapped_column(
        "version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    t_seconds: Mapped[float] = mapped_column("t_seconds", Float, nullable=False)
    text: Mapped[str] = mapped_column("text", String, nullable=False)
    pinned: Mapped[bool] = mapped_column("pinned", Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ReferenceTrack(Base):
    __tablename__ = "reference_tracks"

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column("title", String(200), nullable=False)
    artist: Mapped[Optional[str]] = mapped_column("artist", String(120), nullable=True)
    source: Mapped[str] = mapped_column("source", String(20), nullable=False, default="file")
    source_url: Mapped[Optional[str]] = mapped_column("source_url", String(500), nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column("file_path", String(500), nullable=True)
    genre: Mapped[Optional[str]] = mapped_column("genre", String(50), nullable=True)
    bpm: Mapped[Optional[float]] = mapped_column("bpm", Float, nullable=True)
    detected_key: Mapped[Optional[str]] = mapped_column("detected_key", String(10), nullable=True)
    duration_seconds: Mapped[Optional[float]] = mapped_column("duration_seconds", Float, nullable=True)
    lufs: Mapped[Optional[float]] = mapped_column("lufs", Float, nullable=True)
    true_peak_db: Mapped[Optional[float]] = mapped_column("true_peak_db", Float, nullable=True)
    dynamic_range_lu: Mapped[Optional[float]] = mapped_column("dynamic_range_lu", Float, nullable=True)
    stereo_width: Mapped[Optional[float]] = mapped_column("stereo_width", Float, nullable=True)
    stereo_correlation: Mapped[Optional[float]] = mapped_column("stereo_correlation", Float, nullable=True)
    band_levels: Mapped[Optional[Any]] = mapped_column("band_levels", JSONB, nullable=True)
    tags: Mapped[Any] = mapped_column("tags", JSONB, nullable=False, default=list)
    analyzed: Mapped[bool] = mapped_column("analyzed", Boolean, nullable=False, default=False)
    used_count: Mapped[int] = mapped_column("used_count", Integer, nullable=False, default=0)
    notes: Mapped[Optional[str]] = mapped_column("notes", String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ReferenceSet(Base):
    __tablename__ = "reference_sets"

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column("name", String(120), nullable=False)
    hue: Mapped[Optional[int]] = mapped_column("hue", SmallInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ReferenceSetMember(Base):
    __tablename__ = "reference_set_members"

    set_id: Mapped[uuid.UUID] = mapped_column(
        "set_id",
        UUID(as_uuid=True),
        ForeignKey("reference_sets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    reference_id: Mapped[uuid.UUID] = mapped_column(
        "reference_id",
        UUID(as_uuid=True),
        ForeignKey("reference_tracks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class CompareCache(Base):
    __tablename__ = "compare_cache"
    __table_args__ = (
        UniqueConstraint(
            "track_version_id",
            "reference_id",
            name="uq_compare_cache_track_version_reference",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    track_version_id: Mapped[uuid.UUID] = mapped_column(
        "track_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    reference_id: Mapped[uuid.UUID] = mapped_column(
        "reference_id",
        UUID(as_uuid=True),
        ForeignKey("reference_tracks.id", ondelete="CASCADE"),
        nullable=False,
    )
    match_score: Mapped[int] = mapped_column("match_score", Integer, nullable=False)
    sub_scores: Mapped[Any] = mapped_column("sub_scores", JSONB, nullable=False, default=dict)
    delta_metrics: Mapped[Any] = mapped_column("delta_metrics", JSONB, nullable=False, default=list)
    suggestions: Mapped[Any] = mapped_column("suggestions", JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TrackComment(Base):
    __tablename__ = "track_comments"
    __table_args__ = (
        CheckConstraint(
            "(target_share_token IS NOT NULL AND target_published_track IS NULL) "
            "OR (target_share_token IS NULL AND target_published_track IS NOT NULL)",
            name="ck_track_comments_one_target",
        ),
        Index("ix_track_comments_target_share_token", "target_share_token"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    target_share_token: Mapped[Optional[str]] = mapped_column(
        "target_share_token", String(36), nullable=True
    )
    target_published_track: Mapped[Optional[uuid.UUID]] = mapped_column(
        "target_published_track", UUID(as_uuid=True), nullable=True
    )
    author_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "author_user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    author_display_name: Mapped[Optional[str]] = mapped_column(
        "author_display_name", String(120), nullable=True
    )
    author_ip_hash: Mapped[Optional[bytes]] = mapped_column("author_ip_hash", LargeBinary, nullable=True)
    timestamp_seconds: Mapped[Optional[float]] = mapped_column("timestamp_seconds", Float, nullable=True)
    body: Mapped[str] = mapped_column("body", String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column("deleted_at", DateTime(timezone=True), nullable=True)


class TrackBookmark(Base):
    __tablename__ = "track_bookmarks"
    __table_args__ = (
        CheckConstraint(
            "(target_share_token IS NOT NULL AND target_published_track IS NULL) "
            "OR (target_share_token IS NULL AND target_published_track IS NOT NULL)",
            name="ck_track_bookmarks_one_target",
        ),
        Index("ix_track_bookmarks_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_share_token: Mapped[Optional[str]] = mapped_column(
        "target_share_token", String(36), nullable=True
    )
    target_published_track: Mapped[Optional[uuid.UUID]] = mapped_column(
        "target_published_track", UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )


__all__ = [
    "Base",
    "JOB_STATUS_PENDING",
    "JOB_STATUS_PROCESSING",
    "JOB_STATUS_COMPLETE",
    "JOB_STATUS_FAILED",
    "JOB_STATUS_AWAITING_STEM_MAPPING",
    "JOB_STATUS_ALL",
    "User",
    "RefreshToken",
    "Song",
    "SongVersion",
    "AnalysisJob",
    "Analysis",
    "Verdict",
    "VerdictUserState",
    "SessionNote",
    "ReferenceTrack",
    "ReferenceSet",
    "ReferenceSetMember",
    "CompareCache",
    "TrackComment",
    "TrackBookmark",
]
