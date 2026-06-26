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
    Numeric,
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
    # ── Library-redesign metadata (TEXT columns; no polymorphic FKs) ──────────
    description: Mapped[Optional[str]] = mapped_column("description", String(500), nullable=True)
    visual_template: Mapped[Optional[str]] = mapped_column("visual_template", String(16), nullable=True)
    visual_primary: Mapped[Optional[str]] = mapped_column("visual_primary", String(40), nullable=True)
    visual_secondary: Mapped[Optional[str]] = mapped_column("visual_secondary", String(40), nullable=True)
    reference_profile_kind: Mapped[Optional[str]] = mapped_column(
        "reference_profile_kind", String(8), nullable=True
    )
    reference_profile_id: Mapped[Optional[str]] = mapped_column(
        "reference_profile_id", String(64), nullable=True
    )
    # Per-song visibility. NOT NULL, default 'private'. Values: private, shared, public.
    visibility: Mapped[str] = mapped_column(
        "visibility", String(16), nullable=False, server_default="private", default="private"
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
    stem_analysis_mode: Mapped[str] = mapped_column(
        "stem_analysis_mode", String(16), nullable=False, server_default="grouped", default="grouped"
    )
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
    # Story 2.4: tier ("free" | "pro" | "credits") stamped by the BFF at dispatch
    # so the worker never reads billing tables. Mirrors EF AnalysisJob.Tier; the
    # column already exists in the DB (migration 20260616052555_AddFeatureFlagsAndJobTier).
    tier: Mapped[Optional[str]] = mapped_column("tier", String(16), nullable=True)
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
    # Story 1.4 / FR16: machine-readable degradation notice stamped by the
    # worker when budget is blown or the provider-outage circuit breaker
    # fires. Null on a healthy report. Shape:
    #   {"reason": "tier_budget|global_budget|circuit_breaker",
    #    "detail": "<operator-readable string>",
    #    "occurred_at": "<ISO-8601 UTC>"}
    # First failure wins (never overwritten while non-null). Read by the
    # BFF verdicts endpoint and rendered as the "rule-based findings only"
    # banner on the v2 frontend.
    degradation_notice: Mapped[Optional[Any]] = mapped_column(
        "degradation_notice", JSONB, nullable=True,
    )
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
    # ── IDENTIFY-tier Problem fields (deterministic rule engine) ────────────
    problem_id: Mapped[Optional[str]] = mapped_column("problem_id", String(80), nullable=True)
    kind: Mapped[str] = mapped_column("kind", String(20), nullable=False, default="fault")
    source: Mapped[str] = mapped_column("source", String(20), nullable=False, default="rule_engine")
    data_tier: Mapped[str] = mapped_column("data_tier", String(20), nullable=False, default="audio_only")
    fixable: Mapped[bool] = mapped_column("fixable", Boolean, nullable=False, default=True)
    suspected: Mapped[bool] = mapped_column("suspected", Boolean, nullable=False, default=False)
    # "where" is a SQL reserved word — SQLAlchemy quotes it. jsonb, nullable.
    where: Mapped[Optional[Any]] = mapped_column("where", JSONB, nullable=True)
    refines: Mapped[Optional[str]] = mapped_column("refines", String(80), nullable=True)


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


class Conversation(Base):
    """Story 1.5 / AR9: one conversation per (analysis, user). The BFF
    get-or-creates this row on the first POST to
    ``/coach/{analysisId}/messages``. All ``CoachMessage`` rows hang off
    this row; per-analysis coach caps (story 1.9) will count messages by
    joining on ``conversation_id``."""

    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("analysis_id", "user_id",
                         name="uq_conversations_analysis_user"),
        Index("ix_conversations_analysis_id", "analysis_id"),
        Index("ix_conversations_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        "id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    # Story 1.5 code review B-M1: EF migrations are the canonical schema
    # and the project's convention is no DB-level foreign keys (see the
    # other entities — Verdict, AnalysisJob, etc. — none declare FKs
    # either). The SQLAlchemy ``ForeignKey(...)`` declaration here would
    # MISREPRESENT the actual schema as ``CASCADE`` on delete; in reality
    # ownership integrity is enforced at the BFF endpoint layer. We keep
    # ``ForeignKey`` here so the ORM relationship metadata is correct
    # (e.g. for joins), but with NO ``ondelete=`` argument so the SA
    # mirror doesn't claim a cascade the database never enforces.
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        "analysis_id",
        UUID(as_uuid=True),
        ForeignKey("analyses.id"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False,
        server_default=func.now(),
    )


class CoachMessage(Base):
    """Story 1.5 / AR9 / AR10: one row per turn in a coach conversation.

    Rows with ``role="user"`` are written by the BFF inline on POST.
    Rows with ``role="assistant"`` are written by the BFF in
    ``status="pending"`` on the same POST and then UPDATED by the
    ``coach_reply`` dramatiq actor when the LLM call returns
    (``status`` transitions to ``complete``/``refused``/``error``).

    ``evidence`` carries the citation chips that survived resolution
    against the in-memory context bundle (unresolvable paths dropped per
    AR10). ``refusal_reason`` is set on assistant rows that emitted a
    structured refusal: ``"missing_data"``, ``"out_of_scope"``,
    ``"injection_attempt"`` (from the prompt), or the coach-offline
    marker ``"coach_offline"`` written when ``LlmBudgetExceeded`` fires
    or the analysis is already degraded.
    """

    __tablename__ = "coach_messages"
    __table_args__ = (
        # Enum-as-string CHECKs mirror the EF declarations in AppDbContext.
        CheckConstraint(
            "role IN ('user','assistant')", name="ck_coach_messages_role",
        ),
        CheckConstraint(
            "status IN ('pending','complete','refused','error')",
            name="ck_coach_messages_status",
        ),
        Index(
            "ix_coach_messages_conversation_created_at",
            "conversation_id", "created_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        "id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    # Story 1.5 code review B-M1: see Conversation.analysis_id — no
    # ``ondelete=`` on the SA side because the EF migration creates no FK
    # constraint. Ownership integrity is enforced at the BFF layer.
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        "conversation_id",
        UUID(as_uuid=True),
        ForeignKey("conversations.id"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column("role", String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        "status", String(16), nullable=False, default="complete",
    )
    content: Mapped[str] = mapped_column("content", String, nullable=False, default="")
    evidence: Mapped[Optional[Any]] = mapped_column(
        "evidence", JSONB, nullable=True,
    )
    refusal_reason: Mapped[Optional[str]] = mapped_column(
        "refusal_reason", String(64), nullable=True,
    )
    # ULID of the matching ``llm_calls`` row when the assistant message hit
    # the gateway. Null on user rows AND on assistant rows that
    # short-circuited without a gateway call (coach_offline / budget).
    llm_call_id: Mapped[Optional[str]] = mapped_column(
        "llm_call_id", String(40), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False,
        server_default=func.now(),
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        "completed_at", DateTime(timezone=True), nullable=True,
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


class LlmCall(Base):
    """Per-call LLM metering (story 1.3, AR7). The worker's gateway is the sole
    writer (one row per call, every outcome). Mirrors the EF ``LlmCall`` entity;
    the BFF maps it read-only for operator dashboards."""

    __tablename__ = "llm_calls"
    __table_args__ = (
        Index("ix_llm_calls_created_at", "created_at"),
        Index("ix_llm_calls_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column("id", String(40), primary_key=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "user_id", UUID(as_uuid=True), nullable=True
    )
    tier: Mapped[Optional[str]] = mapped_column("tier", String(20), nullable=True)
    purpose: Mapped[str] = mapped_column("purpose", String(20), nullable=False)
    prompt_slug: Mapped[Optional[str]] = mapped_column("prompt_slug", String(64), nullable=True)
    prompt_version: Mapped[Optional[str]] = mapped_column(
        "prompt_version", String(120), nullable=True
    )
    model: Mapped[str] = mapped_column("model", String(60), nullable=False)
    input_tokens: Mapped[int] = mapped_column("input_tokens", Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column("output_tokens", Integer, nullable=False, default=0)
    cost_usd: Mapped[Any] = mapped_column("cost_usd", Numeric(12, 6), nullable=False, default=0)
    price_table_version: Mapped[Optional[str]] = mapped_column(
        "price_table_version", String(20), nullable=True
    )
    latency_ms: Mapped[int] = mapped_column("latency_ms", Integer, nullable=False, default=0)
    outcome: Mapped[str] = mapped_column("outcome", String(20), nullable=False)
    correlation_id: Mapped[Optional[str]] = mapped_column(
        "correlation_id", String(64), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
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


class RackPreset(Base):
    # Listen V3 (PRP-1). Version-scoped (owner derives via song_version -> song ->
    # user; NO user_id). source first-class: 'user' written today; 'coach'/'analysis'
    # reserved for the future generator. Portable via JSON export/import (no copied_from_id).
    __tablename__ = "rack_presets"
    __table_args__ = (
        CheckConstraint(
            "\"source\" IN ('user','coach','analysis')", name="ck_rack_presets_source"
        ),
        Index("ix_rack_presets_song_version_id", "song_version_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_version_id: Mapped[uuid.UUID] = mapped_column(
        "song_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column("name", String(120), nullable=False)
    source: Mapped[str] = mapped_column(
        "source", String(16), nullable=False, server_default="user", default="user"
    )
    chain_json: Mapped[Any] = mapped_column("chain_json", JSONB, nullable=False)
    # PRP-4 — FKs bound now that the room-session + grant tables exist (SET NULL:
    # deleting a session/grant severs the credit-chain pointer, never the preset).
    created_in_session_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "created_in_session_id",
        UUID(as_uuid=True),
        ForeignKey("listening_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    via_grant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "via_grant_id",
        UUID(as_uuid=True),
        ForeignKey("control_grants.id", ondelete="SET NULL"),
        nullable=True,
    )
    # PRP-3 — provenance when forked by accepting a reviewer suggestion (D4.5).
    from_suggestion_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "from_suggestion_id",
        UUID(as_uuid=True),
        ForeignKey("suggestions.id", ondelete="SET NULL"),
        nullable=True,
    )
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


class RackDraft(Base):
    # One autosaved working chain per version (UNIQUE song_version_id). Version-scoped.
    __tablename__ = "rack_drafts"
    __table_args__ = (
        UniqueConstraint("song_version_id", name="uq_rack_drafts_song_version_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_version_id: Mapped[uuid.UUID] = mapped_column(
        "song_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    chain_json: Mapped[Any] = mapped_column("chain_json", JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class VizPreset(Base):
    # Saved visualizer "looks" — user-scoped (the sole user-scoped exception).
    __tablename__ = "viz_presets"
    __table_args__ = (
        Index("ix_viz_presets_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column("name", String(120), nullable=False)
    viz_json: Mapped[Any] = mapped_column("viz_json", JSONB, nullable=False)
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


class ShareSetting(Base):
    # Listen V3 (PRP-2). Version-scoped sharing gate bundle, 1:1 with a version
    # (PK = song_version_id). ADDITIVE — analyses.share_token is untouched.
    __tablename__ = "share_settings"
    __table_args__ = (
        CheckConstraint(
            "\"visibility\" IN ('private','unlisted','public')",
            name="ck_share_settings_visibility",
        ),
        CheckConstraint(
            "\"comments_policy\" IN ('off','link','named')",
            name="ck_share_settings_comments_policy",
        ),
        CheckConstraint(
            "\"session_host_policy\" IN ('owner_only','invited')",
            name="ck_share_settings_host_policy",
        ),
        CheckConstraint(
            "\"session_join_policy\" IN ('invited','link','public')",
            name="ck_share_settings_join_policy",
        ),
        Index("uq_share_settings_share_token", "share_token", unique=True),
    )

    song_version_id: Mapped[uuid.UUID] = mapped_column(
        "song_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    visibility: Mapped[str] = mapped_column(
        "visibility", String(12), nullable=False, server_default="private", default="private"
    )
    share_token: Mapped[Optional[str]] = mapped_column("share_token", String(36), nullable=True)
    show_verdicts: Mapped[bool] = mapped_column("show_verdicts", Boolean, nullable=False, default=False)
    comments_policy: Mapped[str] = mapped_column(
        "comments_policy", String(8), nullable=False, server_default="link", default="link"
    )
    suggestions_allowed: Mapped[bool] = mapped_column(
        "suggestions_allowed", Boolean, nullable=False, server_default="true", default=True
    )
    bookmarking_allowed: Mapped[bool] = mapped_column(
        "bookmarking_allowed", Boolean, nullable=False, server_default="true", default=True
    )
    session_host_policy: Mapped[str] = mapped_column(
        "session_host_policy", String(12), nullable=False, server_default="owner_only", default="owner_only"
    )
    session_join_policy: Mapped[str] = mapped_column(
        "session_join_policy", String(8), nullable=False, server_default="link", default="link"
    )
    enabled_at: Mapped[Optional[datetime]] = mapped_column(
        "enabled_at", DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Invite(Base):
    # Listen V3 (PRP-2, D6.3). Named, tokenized version invite (session scope
    # reserved for PRP-4). Accepting binds invited_user_id + flips status.
    __tablename__ = "invites"
    __table_args__ = (
        CheckConstraint("\"scope\" IN ('version','session')", name="ck_invites_scope"),
        CheckConstraint("\"role\" IN ('reviewer','listener','host')", name="ck_invites_role"),
        CheckConstraint(
            "\"status\" IN ('pending','accepted','revoked')", name="ck_invites_status"
        ),
        Index("uq_invites_token", "token", unique=True),
        Index("ix_invites_song_version_id", "song_version_id"),
        Index("ix_invites_invited_user_id", "invited_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(
        "scope", String(8), nullable=False, server_default="version", default="version"
    )
    song_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "song_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    session_id: Mapped[Optional[uuid.UUID]] = mapped_column("session_id", UUID(as_uuid=True), nullable=True)
    invited_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "invited_user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    invited_email: Mapped[Optional[str]] = mapped_column("invited_email", String(255), nullable=True)
    invited_handle: Mapped[Optional[str]] = mapped_column("invited_handle", String(32), nullable=True)
    role: Mapped[str] = mapped_column("role", String(16), nullable=False)
    token: Mapped[str] = mapped_column("token", String(36), nullable=False)
    status: Mapped[str] = mapped_column(
        "status", String(10), nullable=False, server_default="pending", default="pending"
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        "created_by",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    accepted_at: Mapped[Optional[datetime]] = mapped_column(
        "accepted_at", DateTime(timezone=True), nullable=True
    )


class ListeningSession(Base):
    # Listen V3 (PRP-4, D3.1/D3.2). A live Room — JSON-first (mirrors
    # analyses.final_json): events_json is the Redis WAL flushed ONCE at finalize
    # by synthesize_recap (the sole flusher); recap_json is the derived recap.
    __tablename__ = "listening_sessions"
    __table_args__ = (
        CheckConstraint(
            "\"status\" IN ('live','ended')", name="ck_listening_sessions_status"
        ),
        Index("ix_listening_sessions_song_version_id", "song_version_id"),
        Index("ix_listening_sessions_host_id", "host_id"),
        Index("ix_listening_sessions_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_version_id: Mapped[uuid.UUID] = mapped_column(
        "song_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    host_id: Mapped[uuid.UUID] = mapped_column(
        "host_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        "status", String(8), nullable=False, server_default="live", default="live"
    )
    started_at: Mapped[datetime] = mapped_column(
        "started_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        "ended_at", DateTime(timezone=True), nullable=True
    )
    events_json: Mapped[Optional[Any]] = mapped_column("events_json", JSONB, nullable=True)
    recap_json: Mapped[Optional[Any]] = mapped_column("recap_json", JSONB, nullable=True)


class ControlGrant(Base):
    # Listen V3 (PRP-4, D3.5/D4.6). The provenance backbone: host delegates
    # rack|visuals control. FK target for rack_presets.via_grant_id — so it is the
    # EXCEPTION to JSON-first (written to Postgres immediately). ONE active holder
    # per (session, scope) via a partial-unique index (created in the EF migration,
    # not declarable here). anon grantee keys on anonId, not ip_hash.
    __tablename__ = "control_grants"
    __table_args__ = (
        CheckConstraint(
            "\"scope\" IN ('rack','visuals')", name="ck_control_grants_scope"
        ),
        Index("ix_control_grants_session_id", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        "session_id",
        UUID(as_uuid=True),
        ForeignKey("listening_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    scope: Mapped[str] = mapped_column("scope", String(8), nullable=False)
    grantee_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "grantee_user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    grantee_display_name: Mapped[Optional[str]] = mapped_column(
        "grantee_display_name", String(120), nullable=True
    )
    grantee_anon_id: Mapped[Optional[str]] = mapped_column(
        "grantee_anon_id", String(64), nullable=True
    )
    granted_by: Mapped[uuid.UUID] = mapped_column(
        "granted_by",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    granted_at: Mapped[datetime] = mapped_column(
        "granted_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        "revoked_at", DateTime(timezone=True), nullable=True
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
    # PRP-3 swapped the polymorphic CHECK to 3-way (+ target_version_id) and added
    # threading (parent_id) + author-owned status. Legacy /share rows (target_share_token)
    # stay valid; new V3 View comments use target_version_id.
    __tablename__ = "track_comments"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN target_share_token IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN target_published_track IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN target_version_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_track_comments_one_target",
        ),
        CheckConstraint(
            "\"status\" IN ('open','resolved','pinned','hidden')",
            name="ck_track_comments_status",
        ),
        Index("ix_track_comments_target_share_token", "target_share_token"),
        Index("ix_track_comments_target_version_id", "target_version_id"),
        Index("ix_track_comments_parent_id", "parent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    target_share_token: Mapped[Optional[str]] = mapped_column(
        "target_share_token", String(36), nullable=True
    )
    target_published_track: Mapped[Optional[uuid.UUID]] = mapped_column(
        "target_published_track", UUID(as_uuid=True), nullable=True
    )
    target_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "target_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "parent_id",
        UUID(as_uuid=True),
        ForeignKey("track_comments.id", ondelete="NO ACTION"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        "status", String(10), nullable=False, server_default="open", default="open"
    )
    suggestion_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "suggestion_id",
        UUID(as_uuid=True),
        ForeignKey("suggestions.id", ondelete="SET NULL"),
        nullable=True,
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
    # Durable signed-cookie anon id (CONVENTIONS §1); set for anon V3 View comments.
    author_anon_id: Mapped[Optional[str]] = mapped_column("author_anon_id", String(64), nullable=True)
    timestamp_seconds: Mapped[Optional[float]] = mapped_column("timestamp_seconds", Float, nullable=True)
    body: Mapped[str] = mapped_column("body", String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column("deleted_at", DateTime(timezone=True), nullable=True)


class ReviewerSuggestion(Base):
    # PRP-3 (D4.3). Non-owner chain proposal; the chain lives here (chain_json).
    # A RackPreset materializes only on accept (fork-to-preset) with from_suggestion_id.
    __tablename__ = "suggestions"
    __table_args__ = (
        CheckConstraint(
            "\"status\" IN ('proposed','auditioned','accepted','rejected')",
            name="ck_suggestions_status",
        ),
        Index("ix_suggestions_song_version_id", "song_version_id"),
        Index("ix_suggestions_from_user_id", "from_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_version_id: Mapped[uuid.UUID] = mapped_column(
        "song_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "from_user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    from_display_name: Mapped[Optional[str]] = mapped_column(
        "from_display_name", String(120), nullable=True
    )
    from_anon_id: Mapped[Optional[str]] = mapped_column("from_anon_id", String(64), nullable=True)
    chain_json: Mapped[Any] = mapped_column("chain_json", JSONB, nullable=False)
    comment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "comment_id",
        UUID(as_uuid=True),
        ForeignKey("track_comments.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_in_session_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "created_in_session_id",
        UUID(as_uuid=True),
        ForeignKey("listening_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    # via_grant_id has no FK by design (PRP-4) — it rides onto the adopted
    # preset's via_grant_id, which IS the FK to control_grants.
    via_grant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "via_grant_id", UUID(as_uuid=True), nullable=True
    )
    status: Mapped[str] = mapped_column(
        "status", String(10), nullable=False, server_default="proposed", default="proposed"
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        "resolved_at", DateTime(timezone=True), nullable=True
    )


class TrackBookmark(Base):
    # Listen V3 (PRP-6). Version-scoped bookmark (+t+note+identity opt-in), anon-capable
    # (nullable user_id + bookmarker_anon_id, not ip_hash). 3-way polymorphic CHECK
    # swapped from the original 2-way; legacy /share rows (target_share_token) stay valid.
    __tablename__ = "track_bookmarks"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN target_share_token IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN target_published_track IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN target_version_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_track_bookmarks_one_target",
        ),
        Index("ix_track_bookmarks_user_id", "user_id"),
        Index("ix_track_bookmarks_target_version_id", "target_version_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    target_share_token: Mapped[Optional[str]] = mapped_column(
        "target_share_token", String(36), nullable=True
    )
    target_published_track: Mapped[Optional[uuid.UUID]] = mapped_column(
        "target_published_track", UUID(as_uuid=True), nullable=True
    )
    target_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "target_version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    bookmarker_display_name: Mapped[Optional[str]] = mapped_column(
        "bookmarker_display_name", String(120), nullable=True
    )
    bookmarker_anon_id: Mapped[Optional[str]] = mapped_column(
        "bookmarker_anon_id", String(64), nullable=True
    )
    timestamp_seconds: Mapped[Optional[float]] = mapped_column(
        "timestamp_seconds", Float, nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column("note", String(280), nullable=True)
    identity_visible: Mapped[bool] = mapped_column(
        "identity_visible", Boolean, nullable=False, server_default="false", default=False
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
    "Conversation",
    "CoachMessage",
    "SessionNote",
    "ReferenceTrack",
    "ReferenceSet",
    "ReferenceSetMember",
    "CompareCache",
    "TrackComment",
    "TrackBookmark",
]
