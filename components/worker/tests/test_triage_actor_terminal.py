"""run_triage terminal failures write the degradation notice + rule findings (E5.3).

Previously the LlmError and parse/validation branches bare-returned, leaving
routing_plan AND degradation_notice NULL — so every ListVerdicts call
re-enqueued another LLM attempt (unbounded spend). Terminal failure must now
degrade exactly like budget exhaustion so the BFF's DegradationNotice guard
stops the enqueue loop.
"""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import triage_actor as ta  # noqa: E402
from app.llm.gateway import LlmError  # noqa: E402


class _Analysis:
    def __init__(self):
        self.routing_plan = None
        self.degradation_notice = None
        self.final_json = {"phases": []}
        self.user_id = uuid.uuid4()
        self.job_id = None


class _FakeSession:
    def __init__(self, analysis):
        self._analysis = analysis

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, _model, _aid):
        return self._analysis


def _setup(monkeypatch, analysis):
    monkeypatch.setattr(ta.SessionFactory, "begin", lambda: _FakeSession(analysis))
    monkeypatch.setattr(ta, "load_triage", lambda: ("v1", "system prompt"))
    monkeypatch.setattr(ta, "load_triage_model", lambda: None)
    calls: dict = {"notice": None, "rules": 0}

    def fake_notice(aid, *, reason, detail=None):
        calls["notice"] = (aid, reason, detail)

    def fake_rules(aid):
        calls["rules"] += 1
        return 0

    monkeypatch.setattr(ta, "write_degradation_notice", fake_notice)
    monkeypatch.setattr(ta, "run_rule_engine_for_analysis", fake_rules)
    return calls


def test_llm_error_writes_notice_and_runs_rules(monkeypatch):
    analysis = _Analysis()
    calls = _setup(monkeypatch, analysis)

    def boom(**_k):
        raise LlmError("model exploded")

    monkeypatch.setattr(ta.gateway, "complete_sync", boom)

    ta.run_triage(str(uuid.uuid4()))

    assert calls["notice"] is not None
    _aid, reason, detail = calls["notice"]
    assert reason == "triage_failed"
    assert "model exploded" in detail
    assert calls["rules"] == 1
    # routing_plan stays NULL — degradation is the terminal marker.
    assert analysis.routing_plan is None


def test_invalid_plan_writes_notice_and_runs_rules(monkeypatch):
    analysis = _Analysis()
    calls = _setup(monkeypatch, analysis)

    class _Result:
        text = "definitely not a routing plan"

    monkeypatch.setattr(ta.gateway, "complete_sync", lambda **_k: _Result())

    ta.run_triage(str(uuid.uuid4()))

    assert calls["notice"] is not None
    assert calls["notice"][1] == "triage_failed"
    assert calls["rules"] == 1
    assert analysis.routing_plan is None


def test_existing_degradation_notice_short_circuits(monkeypatch):
    # The Phase A guard: an already-degraded analysis must not burn another
    # LLM call (BFF race / dramatiq retry).
    analysis = _Analysis()
    analysis.degradation_notice = {"reason": "triage_failed"}
    calls = _setup(monkeypatch, analysis)

    def must_not_run(**_k):
        raise AssertionError("gateway must not be called")

    monkeypatch.setattr(ta.gateway, "complete_sync", must_not_run)

    ta.run_triage(str(uuid.uuid4()))

    assert calls["notice"] is None
    assert calls["rules"] == 0
