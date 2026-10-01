"""run_specialist skips a slug that already has a verdict row (FW1 re-review).

The BFF's per-(analysis, slug) in-flight key lives 600 s. A run_specialist
message that waits longer than that in a backed-up queue lets a reload
re-POST and enqueue a SECOND message for the same slug. Without a check in the
actor both messages call the LLM (double spend) and persist two verdict sets.
The actor must therefore skip a slug whose verdict row already exists.
"""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import verdict_actor as va  # noqa: E402


class _Analysis:
    def __init__(self):
        self.id = uuid.uuid4()
        self.final_json = {"phases": []}
        self.job_id = None


class _FakeSession:
    def __init__(self, analysis, existing):
        self._analysis = analysis
        self._existing = existing

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, _model, _aid):
        return self._analysis

    def execute(self, _stmt):
        existing = self._existing

        class _Result:
            def first(self_inner):
                return ("01VERDICT",) if existing else None

        return _Result()


def _setup(monkeypatch, existing):
    analysis = _Analysis()
    monkeypatch.setattr(va.SessionFactory, "begin", lambda: _FakeSession(analysis, existing))
    calls = {"llm": 0, "fail": 0}

    def fake_prompt(_slug):
        return ("v1", "system")

    def fake_llm(**_k):
        calls["llm"] += 1
        raise va.LlmError("stop here")

    def fake_fail(*_a, **_k):
        calls["fail"] += 1

    monkeypatch.setattr(va, "load_prompt", fake_prompt)
    monkeypatch.setattr(va, "load_prompt_model", lambda _s: None)
    monkeypatch.setattr(va.gateway, "complete_sync", fake_llm)
    monkeypatch.setattr(va, "_persist_fail_marker", fake_fail)
    return analysis, calls


def test_existing_verdict_skips_the_llm(monkeypatch):
    analysis, calls = _setup(monkeypatch, existing=True)
    va.run_specialist.fn(str(analysis.id), "low_end", str(uuid.uuid4()))
    assert calls["llm"] == 0
    assert calls["fail"] == 0


def test_no_verdict_still_calls_the_llm(monkeypatch):
    analysis, calls = _setup(monkeypatch, existing=False)
    va.run_specialist.fn(str(analysis.id), "low_end", str(uuid.uuid4()))
    assert calls["llm"] >= 1
