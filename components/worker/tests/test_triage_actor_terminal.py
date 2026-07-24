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
    def __init__(self, analysis, rule_rows=None):
        self._analysis = analysis
        self._rule_rows = rule_rows or []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, _model, _aid):
        return self._analysis

    def execute(self, _stmt):
        rows = self._rule_rows

        class _Result:
            def scalars(self_inner):
                class _Scalars:
                    def all(self_inner2):
                        return rows

                return _Scalars()

        return _Result()


def _setup(monkeypatch, analysis, rule_rows=None):
    monkeypatch.setattr(ta.SessionFactory, "begin", lambda: _FakeSession(analysis, rule_rows))
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


class _FakeRuleVerdict:
    def __init__(self, category, severity, headline):
        self.category = category
        self.severity = severity
        self.headline = headline


def test_run_triage_includes_rule_engine_findings_in_user_message(monkeypatch):
    """Task 2 / item 5: Triage's user message must carry the analysis's
    already-persisted rule-engine findings, not just the flattened analysis."""
    analysis = _Analysis()
    rule_rows = [_FakeRuleVerdict("low_end", "severe", "Kick/bass collision")]
    calls = _setup(monkeypatch, analysis, rule_rows=rule_rows)

    class _Result:
        text = (
            '{"specialists_to_run": [], "skip": [], '
            '"rationale": "ok", "estimated_total_tokens": 100}'
        )

    captured = {}

    def spy(**kwargs):
        captured["user"] = kwargs["user"]
        return _Result()

    monkeypatch.setattr(ta.gateway, "complete_sync", spy)

    ta.run_triage(str(uuid.uuid4()))

    assert calls["notice"] is None
    assert "user" in captured
    assert "rule_engine_findings" in captured["user"]
    assert "Kick/bass collision" in captured["user"]
    assert analysis.routing_plan is not None


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
