"""Task G3 — mode="brief" in the ``coach_reply`` actor.

Mirrors the fixture/helper shape of ``test_coach_actor.py`` (sqlite-backed
``SessionFactory``, a fake Redis publisher, a stubbed streaming gateway).
Lives OUTSIDE ``tests/llm/`` like ``test_coach_actor.py`` so the autouse
fixtures in ``tests/llm/conftest.py`` don't apply.
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.llm.errors import DEGRADATION_REASON_TIER_BUDGET
from app.llm.gateway import LlmBudgetExceeded, LlmInvocationError


@pytest.fixture(autouse=True)
def _stub_redis(monkeypatch):
    from app.coach_lib import stream_publisher  # noqa: PLC0415

    class FakeRedis:
        def __init__(self):
            self.published: list[tuple[str, str]] = []

        def publish(self, channel, payload):
            self.published.append((channel, payload))

        def exists(self, key):
            return False

    fake = FakeRedis()
    monkeypatch.setattr(stream_publisher, "_get_client", lambda: fake)
    monkeypatch.setattr(stream_publisher, "_client", fake)
    return fake


@pytest.fixture
def sqlite_db(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'coach_brief.db'}")
    saved = sys.modules.pop("app.db_sync", None)
    import app.db_sync as db_sync  # noqa: PLC0415

    from aimusic_shared.models import (  # noqa: PLC0415
        Analysis, CoachMessage, Conversation, Verdict,
    )
    Analysis.__table__.create(db_sync.engine)
    Conversation.__table__.create(db_sync.engine)
    CoachMessage.__table__.create(db_sync.engine)
    Verdict.__table__.create(db_sync.engine)

    yield db_sync

    import app  # noqa: PLC0415
    sys.modules.pop("app.db_sync", None)
    if saved is not None:
        sys.modules["app.db_sync"] = saved
        app.db_sync = saved
    elif hasattr(app, "db_sync"):
        del app.db_sync


def _seed_analysis(s, *, degradation_notice=None):
    from aimusic_shared.models import Analysis  # noqa: PLC0415
    aid = uuid.uuid4()
    s.add(Analysis(
        id=aid, job_id=uuid.uuid4(), user_id=uuid.uuid4(),
        final_json={"phases": [], "grade": "B"}, phase_durations={},
        degradation_notice=degradation_notice,
    ))
    return aid


def _seed_conversation(s, analysis_id):
    from aimusic_shared.models import Conversation  # noqa: PLC0415
    cid = uuid.uuid4()
    s.add(Conversation(id=cid, analysis_id=analysis_id, user_id=uuid.uuid4()))
    return cid


def _seed_brief_pair(s, conversation_id):
    """(user mode=brief complete, assistant mode=brief pending) pair — the
    BFF's server-authored trigger row shape (CoachBriefEndpoints.Post)."""
    from aimusic_shared.models import CoachMessage  # noqa: PLC0415
    now = datetime.now(tz=timezone.utc)
    uid = uuid.uuid4()
    aid = uuid.uuid4()
    s.add(CoachMessage(
        id=uid, conversation_id=conversation_id, role="user",
        status="complete", content="Give me your opening brief for this mix.",
        mode="brief", completed_at=now,
    ))
    s.add(CoachMessage(
        id=aid, conversation_id=conversation_id, role="assistant",
        status="pending", content="", mode="brief",
    ))
    return uid, aid


def _fetch_message(s, mid):
    from aimusic_shared.models import CoachMessage  # noqa: PLC0415
    return s.get(CoachMessage, mid)


def _stub_gateway_raises(monkeypatch, exc: Exception):
    from app import coach_actor  # noqa: PLC0415

    calls: list[dict] = []

    def fake_stream(**kwargs):
        calls.append(kwargs)
        raise exc
        yield  # pragma: no cover — makes this a generator function

    monkeypatch.setattr(coach_actor.gateway, "stream_complete_sync", fake_stream)
    return calls


# ── (i) LLM_FAKE completes, prompt_slug=coach_brief ─────────────────────────

def test_brief_mode_with_llm_fake_completes_with_coach_brief_slug(
    sqlite_db, monkeypatch,
):
    """AR41: the documented dev/CI default. Runs the REAL streaming gateway
    fake path (not a stub of coach_actor.gateway) so this proves the whole
    LLM_FAKE=1 round trip works for the new mode, not just that the actor
    calls whatever function is bound to that name.
    """
    from app import coach_actor  # noqa: PLC0415
    from app.llm import budget, gateway  # noqa: PLC0415
    from app.llm.settings import reset_llm_settings_cache  # noqa: PLC0415

    monkeypatch.setenv("LLM_FAKE", "1")
    monkeypatch.setattr(gateway, "record_llm_call", lambda **kw: "llm_FAKE_ROW")
    monkeypatch.setattr(budget, "check_budget", lambda *, tier, purpose, user_id: None)
    monkeypatch.setattr(budget, "record_outcome", lambda *, outcome: None)
    reset_llm_settings_cache()

    with sqlite_db.SessionFactory.begin() as s:
        analysis_id = _seed_analysis(s)
        cid = _seed_conversation(s, analysis_id)
        uid, aid = _seed_brief_pair(s, cid)

    coach_actor.coach_reply.fn(str(cid), str(uid), str(aid))
    reset_llm_settings_cache()

    with sqlite_db.SessionFactory() as s:
        row = _fetch_message(s, aid)
        assert row.status == "complete"
        assert row.content  # non-empty


# ── (ii) degraded analysis → template brief, status=complete ────────────────

def test_brief_mode_on_degraded_analysis_ends_complete_with_template_body(
    sqlite_db, monkeypatch,
):
    from app import coach_actor  # noqa: PLC0415

    with sqlite_db.SessionFactory.begin() as s:
        analysis_id = _seed_analysis(s, degradation_notice={
            "reason": DEGRADATION_REASON_TIER_BUDGET,
            "detail": "tier=free spent=$5.00 ceiling=$5.00",
            "occurred_at": "2026-06-15T12:00:00+00:00",
        })
        cid = _seed_conversation(s, analysis_id)
        uid, aid = _seed_brief_pair(s, cid)

    calls = _stub_gateway_raises(monkeypatch, RuntimeError("must not be called"))
    coach_actor.coach_reply.fn(str(cid), str(uid), str(aid))

    assert calls == [], "degraded short-circuit must never reach the gateway"
    with sqlite_db.SessionFactory() as s:
        row = _fetch_message(s, aid)
        assert row.status == "complete"          # NOT refused/coach_offline
        assert row.content
        assert row.refusal_reason is None


# ── (iii) LlmBudgetExceeded → template brief, status=complete ───────────────

def test_brief_mode_on_budget_exceeded_ends_complete_with_template_body(
    sqlite_db, monkeypatch,
):
    from app import coach_actor  # noqa: PLC0415

    with sqlite_db.SessionFactory.begin() as s:
        analysis_id = _seed_analysis(s)
        cid = _seed_conversation(s, analysis_id)
        uid, aid = _seed_brief_pair(s, cid)

    exc = LlmBudgetExceeded(
        reason=DEGRADATION_REASON_TIER_BUDGET,
        detail="tier=free spent=$5.00 ceiling=$5.00",
    )
    _stub_gateway_raises(monkeypatch, exc)
    coach_actor.coach_reply.fn(str(cid), str(uid), str(aid))

    with sqlite_db.SessionFactory() as s:
        row = _fetch_message(s, aid)
        assert row.status == "complete"          # NOT refused
        assert row.content
        assert row.refusal_reason is None


# ── (iv) qa mode on the same two conditions is unchanged ────────────────────

def test_qa_mode_still_refuses_offline_on_degraded_analysis(sqlite_db, monkeypatch):
    from app import coach_actor  # noqa: PLC0415
    from aimusic_shared.models import CoachMessage  # noqa: PLC0415

    with sqlite_db.SessionFactory.begin() as s:
        analysis_id = _seed_analysis(s, degradation_notice={
            "reason": DEGRADATION_REASON_TIER_BUDGET,
            "detail": "tier=free spent=$5.00 ceiling=$5.00",
            "occurred_at": "2026-06-15T12:00:00+00:00",
        })
        cid = _seed_conversation(s, analysis_id)
        now = datetime.now(tz=timezone.utc)
        uid = uuid.uuid4()
        aid = uuid.uuid4()
        s.add(CoachMessage(id=uid, conversation_id=cid, role="user",
                            status="complete", content="What's my grade?",
                            mode="qa", completed_at=now))
        s.add(CoachMessage(id=aid, conversation_id=cid, role="assistant",
                            status="pending", content="", mode="qa"))

    coach_actor.coach_reply.fn(str(cid), str(uid), str(aid))

    with sqlite_db.SessionFactory() as s:
        row = _fetch_message(s, aid)
        assert row.status == "refused"
        assert row.refusal_reason == "coach_offline"
        assert row.content == coach_actor.COACH_OFFLINE_BODY


def test_qa_mode_still_errors_on_llm_error(sqlite_db, monkeypatch):
    from app import coach_actor  # noqa: PLC0415
    from aimusic_shared.models import CoachMessage  # noqa: PLC0415

    with sqlite_db.SessionFactory.begin() as s:
        analysis_id = _seed_analysis(s)
        cid = _seed_conversation(s, analysis_id)
        now = datetime.now(tz=timezone.utc)
        uid = uuid.uuid4()
        aid = uuid.uuid4()
        s.add(CoachMessage(id=uid, conversation_id=cid, role="user",
                            status="complete", content="Tell me anything.",
                            mode="qa", completed_at=now))
        s.add(CoachMessage(id=aid, conversation_id=cid, role="assistant",
                            status="pending", content="", mode="qa"))

    _stub_gateway_raises(monkeypatch, LlmInvocationError("provider 500"))
    coach_actor.coach_reply.fn(str(cid), str(uid), str(aid))

    with sqlite_db.SessionFactory() as s:
        row = _fetch_message(s, aid)
        assert row.status == "error"
        assert "transient error" in row.content
