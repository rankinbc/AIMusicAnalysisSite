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
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
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
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column("email", String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column("hashed_password", String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column("is_active", Boolean, nullable=False, default=True)
    # Story 4.3 — mirror of EF AddAuthTokensAndEmailVerified (users side only;
    # auth_tokens itself has no mirror — the worker never reads it).
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(
        "email_verified_at", DateTime(timezone=True), nullable=True
    )
    # Story 4.4 — analysis-complete email opt-out (mirror of EF
    # AddNotifyAnalysisComplete).
    notify_analysis_complete: Mapped[bool] = mapped_column(
        "notify_analysis_complete", Boolean, nullable=False, default=True
    )
    # Story 4.6 — JWT token-versioning mirror (worker never bumps it).
    token_version: Mapped[int] = mapped_column(
        "token_version", Integer, nullable=False, default=1
    )
    # Story 10.5 — operator ban mirror (worker never writes these).
    banned_at: Mapped[Optional[datetime]] = mapped_column(
        "banned_at", DateTime(timezone=True), nullable=True
    )
    ban_reason: Mapped[Optional[str]] = mapped_column(
        "ban_reason", String(500), nullable=True
    )
    display_name: Mapped[Optional[str]] = mapped_column("display_name", String(80), nullable=True)
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
    # Story 3.4 — retention sweep marker (mirror of EF AddRawAudioPurgedAt).
    # Set when the raw audio objects were purged; paths remain as audit trail.
    raw_audio_purged_at: Mapped[Optional[datetime]] = mapped_column(
        "raw_audio_purged_at", DateTime(timezone=True), nullable=True
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


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    __table_args__ = (
        Index("ix_analysis_jobs_user_id_status", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Story 4.5 (AR24): nullable — anonymous jobs own device_id instead
    # (DB CHECK exactly-one, EF-side).
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    device_id: Mapped[Optional[str]] = mapped_column(
        "device_id", String(26), nullable=True
    )
    version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "version_id",
        UUID(as_uuid=True),
        ForeignKey("song_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    # Story 6.3 — song-less anon jobs carry their audio key directly
    # (audio/anon/{deviceId}/{jobId}/source.*); set only when version_id is null.
    file_path: Mapped[Optional[str]] = mapped_column("file_path", Text, nullable=True)
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
    # Story 3.2 — typed failure code (mirror of EF AnalysisJob.ErrorCode; the
    # column pre-exists in the DB). 'invalid_file' is the AR16 reversal trigger:
    # the BFF's GET /api/jobs/{id} hook refunds the credit spend when it sees it.
    error_code: Mapped[Optional[str]] = mapped_column("error_code", String(64), nullable=True)
    # Story 5.7 — mirror of EF AnalysisJob.RetryOfJobId (migration
    # 20260715131641_Story57FreeRetry). Links a free-retry job to its failed/
    # degraded origin. Written ONLY by the BFF free-retry dispatch; the worker
    # never sets it (mirrored to keep the ORM in lockstep with the schema).
    retry_of_job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "retry_of_job_id", UUID(as_uuid=True), nullable=True
    )
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
    # Story 4.5 (AR24): nullable — anonymous reports own device_id instead.
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    device_id: Mapped[Optional[str]] = mapped_column(
        "device_id", String(26), nullable=True
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
    # v3 closeout — mirror of EF AddAnalysisVersionStamps (2026-07-23)
    pipeline_version: Mapped[Optional[str]] = mapped_column("pipeline_version", String(40), nullable=True)
    rule_engine_version: Mapped[Optional[str]] = mapped_column("rule_engine_version", String(60), nullable=True)
    validator_version: Mapped[Optional[str]] = mapped_column("validator_version", String(60), nullable=True)
    prompt_set_version: Mapped[Optional[str]] = mapped_column("prompt_set_version", String(2000), nullable=True)
    phase_durations: Mapped[Any] = mapped_column("phase_durations", JSONB, nullable=False, default=dict)
    waveform_peaks_path: Mapped[Optional[str]] = mapped_column("waveform_peaks_path", String(500), nullable=True)
    # Storage keys for the server-rendered result images (WebP), written by
    # analyze_audio_job. Null when rendering was unavailable/failed.
    spectrogram_image_path: Mapped[Optional[str]] = mapped_column(
        "spectrogram_image_path", String(500), nullable=True
    )
    waveform_image_path: Mapped[Optional[str]] = mapped_column(
        "waveform_image_path", String(500), nullable=True
    )
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
    # ── Priority-score breakdown (results v4). Nullable — legacy rows are not
    #    backfilled; the UI degrades to score-only when null. ────────────────
    priority_base: Mapped[Optional[int]] = mapped_column("priority_base", Integer, nullable=True)
    priority_category_weight: Mapped[Optional[float]] = mapped_column(
        "priority_category_weight", Float, nullable=True
    )
    priority_scope_multiplier: Mapped[Optional[float]] = mapped_column(
        "priority_scope_multiplier", Float, nullable=True
    )
    scope: Mapped[Optional[str]] = mapped_column("scope", String(20), nullable=True)


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
    # Story 4.5 (AR24): nullable — anonymous conversations own device_id.
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    device_id: Mapped[Optional[str]] = mapped_column(
        "device_id", String(26), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False,
        server_default=func.now(),
    )


class Device(Base):
    """Story 4.5 (AR24) — anonymous device identity (mirror of EF Device).
    Worker reads it only for the 72 h unclaimed purge in sweep_retention."""

    __tablename__ = "devices"

    id: Mapped[str] = mapped_column("id", String(26), primary_key=True)
    ip_hash: Mapped[str] = mapped_column("ip_hash", String(64), nullable=False)
    ua_hash: Mapped[str] = mapped_column("ua_hash", String(64), nullable=False)
    claimed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "claimed_by_user_id", UUID(as_uuid=True), nullable=True
    )
    claimed_at: Mapped[Optional[datetime]] = mapped_column(
        "claimed_at", DateTime(timezone=True), nullable=True
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
    AR10). ``refusal_reason`` is set on assistant rows (and, story 12.6, stamped on the USER row of refused/errored turns so cap counts can exclude them) that emitted a
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
        CheckConstraint(
            "mode IN ('qa','teach','concise')", name="ck_coach_messages_mode",
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
    # teach-mode flag stamped on the user row by the BFF (story: teach-mode-coach;
    # extended adhoc-concise with a third value). Read by the coach_reply actor
    # to pick the TeachCoach prompt / concise style overlay + inject units.
    # "qa" | "teach" | "concise"
    mode: Mapped[str] = mapped_column(
        "mode", String(20), nullable=False, default="qa", server_default="qa",
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
    coach_meta: Mapped[dict | None] = mapped_column("coach_meta", JSONB, nullable=True)
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
    # Per-reference analyze lifecycle; analyzed bool stays in sync (true iff "analyzed").
    analysis_status: Mapped[str] = mapped_column(
        "analysis_status", String(16), nullable=False, default="pending"
    )
    analysis_error: Mapped[Optional[str]] = mapped_column("analysis_error", String, nullable=True)
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
    # Cached aggregate (mean±std per metric, phase-6 statistical-profile shape) +
    # invalidation fingerprint. Worker only reads the resolved profile from the job
    # payload — it never recomputes these.
    profile_json: Mapped[Optional[Any]] = mapped_column("profile_json", JSONB, nullable=True)
    profile_fingerprint: Mapped[Optional[str]] = mapped_column(
        "profile_fingerprint", String(64), nullable=True
    )
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


# Lifecycle-email send ledger (digest_key = "<event>:<id>"). Not an in-app inbox.
class Notification(Base):
    # Story 11.6 — mirror of the BFF's EF `Notification` (canonical: Notification.cs
    # + migration 20260702190631_AddNotifications). Two row shapes share the table:
    # EVENT rows (digest_key NULL, one per occurrence) and DIGEST rows (digest_key
    # "{recipient}:{type}:{version}:{yyyy-MM-dd}", rolling count). The partial
    # unique index on digest_key WHERE digest_key IS NOT NULL is raw SQL in the
    # EF migration — declared here for metadata completeness only.
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_recipient_updated", "recipient_user_id", "updated_at"),
        Index(
            "ux_notifications_digest_key",
            "digest_key",
            unique=True,
            postgresql_where=text("digest_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        "recipient_user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column("event_type", String(64), nullable=False)
    payload: Mapped[Optional[dict]] = mapped_column("payload", JSONB, nullable=True)
    digest_key: Mapped[Optional[str]] = mapped_column("digest_key", String(200), nullable=True)
    count: Mapped[int] = mapped_column("count", Integer, nullable=False, default=1)
    read_at: Mapped[Optional[datetime]] = mapped_column(
        "read_at", DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()
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
    "Notification",
]
