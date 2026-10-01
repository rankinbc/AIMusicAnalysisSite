"""Fix wave FW3 (final review I3) — a brief never ends as an error or cut off.

Every non-success terminal in ``mode="brief"`` must finish the row
``complete`` with the template brief and publish a terminal ``done`` frame,
and the brief must not honour the ``coach:cancel:{id}`` key (the row is
authoritative; a visitor who closes the tab must find a finished brief on
return). The same inputs in ``qa`` mode behave exactly as before.
"""
from __future__ import annotations

import json
import uuid
from types import SimpleNamespace

import pytest

from tests.test_coach_brief_mode import (  # noqa: F401 — pytest fixtures
    _fetch_message, _seed_analysis, _seed_brief_pair, _seed_conversation,
    _stub_redis, sqlite_db,
)

SENT = "<<<EVIDENCE>>>"


def _seed_qa_pair(s, conversation_id):
    from datetime import datetime, timezone  # noqa: PLC0415

    from aimusic_shared.models import CoachMessage  # noqa: PLC0415
    uid, aid = uuid.uuid4(), uuid.uuid4()
    s.add(CoachMessage(
        id=uid, conversation_id=conversation_id, role="user", status="complete",
        content="How is my low end?", mode="qa", completed_at=datetime.now(tz=timezone.utc),
    ))
    s.add(CoachMessage(
        id=aid, conversation_id=conversation_id, role="assistant", status="pending",
        content="", mode="qa",
    ))
    return uid, aid


def _stub_stream(monkeypatch, chunks=None, raise_after=None, honour_cancel=True):
    """A fake streaming gateway: yields ``chunks`` as deltas then a final
    event; ``raise_after`` raises a RuntimeError after that many chunks.
    When ``honour_cancel`` and the actor's cancel_check reports a cancel
    before the first token, it stops like the real gateway does."""
    from app import coach_actor  # noqa: PLC0415

    def fake_stream(**kwargs):
        cancel = kwargs.get("cancel_check")
        for i, c in enumerate(chunks or []):
            if honour_cancel and cancel is not None and cancel():
                return
            if raise_after is not None and i >= raise_after:
                raise RuntimeError("boom mid-stream")
            yield SimpleNamespace(kind="delta", text=c)
        yield SimpleNamespace(kind="final", result=SimpleNamespace(llm_call_id=None))

    monkeypatch.setattr(coach_actor.gateway, "stream_complete_sync", fake_stream)


def _run(sqlite_db, mode):  # noqa: F811
    from app import coach_actor  # noqa: PLC0415
    with sqlite_db.SessionFactory.begin() as s:
        analysis_id = _seed_analysis(s)
        cid = _seed_conversation(s, analysis_id)
        uid, aid = (_seed_brief_pair if mode == "brief" else _seed_qa_pair)(s, cid)
    coach_actor.coach_reply.fn(str(cid), str(uid), str(aid))
    with sqlite_db.SessionFactory() as s:
        row = _fetch_message(s, aid)
        return row.status, row.content


def _frames(fake_redis):
    return [json.loads(p)["type"] for _, p in fake_redis.published]


_CASES = {
    "empty_stream": dict(chunks=[]),
    "unparseable_section_2": dict(chunks=["Your mix is warm. ", SENT, "{not json"]),
    "failed_validation": dict(chunks=["Your mix is warm. ", SENT, json.dumps({"kind": "bogus"})]),
    "numeric_claim_without_evidence": dict(
        chunks=["Your mix sits at -6 LUFS. ", SENT, json.dumps({"kind": "answer", "evidence": []})]),
    "exception_mid_stream": dict(chunks=["Your mix ", "is warm"], raise_after=1),
    "no_sentinel_partial": dict(chunks=["Your mix is warm and the low end"]),
}


@pytest.mark.parametrize("case", sorted(_CASES))
def test_brief_failure_finishes_with_the_template(sqlite_db, monkeypatch, _stub_redis, case):  # noqa: F811
    _stub_stream(monkeypatch, **_CASES[case])
    status, content = _run(sqlite_db, "brief")
    assert status == "complete"
    from app.coach_lib.brief_template import build_template_brief  # noqa: PLC0415
    assert content == build_template_brief([])
    frames = _frames(_stub_redis)
    assert frames and frames[-1] == "done"
    assert "error" not in frames


@pytest.mark.parametrize("case", ["empty_stream", "unparseable_section_2",
                                  "failed_validation", "numeric_claim_without_evidence",
                                  "exception_mid_stream"])
def test_qa_failure_still_errors(sqlite_db, monkeypatch, _stub_redis, case):  # noqa: F811
    _stub_stream(monkeypatch, **_CASES[case])
    status, _ = _run(sqlite_db, "qa")
    assert status == "error"


def test_brief_ignores_the_cancel_key(sqlite_db, monkeypatch, _stub_redis):  # noqa: F811
    monkeypatch.setattr(_stub_redis, "exists", lambda key: True, raising=False)
    body = "Your mix is warm and wide."
    _stub_stream(monkeypatch, chunks=[body, SENT, json.dumps({"kind": "answer", "evidence": []})])
    status, content = _run(sqlite_db, "brief")
    assert status == "complete"
    assert content == body


def test_qa_still_honours_the_cancel_key(sqlite_db, monkeypatch, _stub_redis):  # noqa: F811
    monkeypatch.setattr(_stub_redis, "exists", lambda key: True, raising=False)
    _stub_stream(monkeypatch, chunks=["Low end is ", "fine.", SENT, json.dumps({"kind": "answer", "evidence": []})])
    status, _ = _run(sqlite_db, "qa")
    assert status == "error"  # cancelled before the first token, nothing streamed
