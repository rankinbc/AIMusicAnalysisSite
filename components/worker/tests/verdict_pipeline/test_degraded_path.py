"""Story 1.4 / FR16: degraded-verdict path.

Two axes of coverage:

A. The helpers in ``app.verdict_lib.degraded`` correctly write the notice
   and run the rule engine (with the right idempotency semantics).
B. The dramatiq actors (``run_triage`` / ``run_specialist``) catch
   :class:`LlmBudgetExceeded`, call the helpers, and return WITHOUT writing
   a fail-marker. This is the AC2 → AC3 surface — the BFF endpoint then
   serves the notice + the rule-engine verdicts to the frontend.

Tests stay DB-free: ``SessionFactory`` is replaced with a fake session
that captures ``.add(...)`` and ``.get(...)`` calls.
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Any

import pytest

from app.llm.gateway import (
    DEGRADATION_REASON_CIRCUIT_BREAKER,
    DEGRADATION_REASON_TIER_BUDGET,
    LlmBudgetExceeded,
)
from app.verdict_lib import degraded


def test_to_row_persists_problem_fields():
    """The degraded mapper must carry the 8 IDENTIFY-tier Problem fields through
    to the ORM row, or the deterministic engine's output is silently flattened."""
    from aimusic_shared.verdicts.models import Evidence
    from app.verdict_lib.rule_engine import _problem

    v = _problem(
        track_id="t", slug="clipping_count", severity="severe", category="clipping",
        headline="h", summary="s", why_it_matters="w",
        evidence=[Evidence(metric="phase1.clipped_sample_count", value=5.0, label="5")],
        data_tier="audio_only", suspected=False,
    )
    row = degraded._to_row(uuid.uuid4(), v)
    assert row.problem_id == "clipping.clipping_count.0"
    assert row.kind == "fault" and row.source == "rule_engine"
    assert row.data_tier == "audio_only" and row.fixable is True and row.suspected is False
    assert row.where is None and row.refines is None


# ── fake DB plumbing ────────────────────────────────────────────────────────


class _FakeAnalysis:
    """Minimal stand-in for the SQLAlchemy ORM ``Analysis`` row."""

    def __init__(self, analysis_id: uuid.UUID, final_json: dict[str, Any]):
        self.id = analysis_id
        self.user_id = uuid.uuid4()
        self.routing_plan: Any = None
        self.degradation_notice: Any = None
        self.final_json = final_json


class _FakeSession:
    """Captures Verdict rows added and lets the helper query/update the
    Analysis row in place. ``.execute(stmt).first()`` is faked by returning
    ``None`` (== "no rule-engine rows yet") unless ``preexisting_rule_rows``
    is set on the fixture.
    """

    def __init__(self, analysis: _FakeAnalysis, preexisting_rule_rows: bool = False):
        self.analysis = analysis
        self.preexisting_rule_rows = preexisting_rule_rows
        self.added: list[Any] = []

    def get(self, model, key):
        if key == self.analysis.id:
            return self.analysis
        return None

    def add(self, row):
        self.added.append(row)

    def execute(self, _stmt):
        outer = self

        class _Result:
            def first(self_inner):
                return ("vrd_already",) if outer.preexisting_rule_rows else None

            def scalar_one(self_inner):
                return None

        return _Result()


@pytest.fixture
def install_fake_sessions(monkeypatch, tmp_path):
    """Returns a setter that replaces ``SessionFactory.begin`` so each call
    yields a fresh-but-shared fake session view on the same analysis row.

    ``app.db_sync`` is imported lazily inside ``degraded.py`` helpers; we
    point it at a throwaway sqlite URL so the import succeeds, then swap
    ``SessionFactory`` for a fake afterwards.
    """
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'degraded.db'}")

    def _install(analysis: _FakeAnalysis, *, preexisting_rule_rows: bool = False):
        session = _FakeSession(analysis, preexisting_rule_rows=preexisting_rule_rows)

        @contextmanager
        def _begin():
            yield session

        class _Factory:
            @staticmethod
            def begin():
                return _begin()

        # Force the lazy import to resolve, then swap the symbol the helper
        # will read on its next invocation. NOTE: patch the sys.modules entry,
        # not `import app.db_sync as db_sync` — the as-import resolves via the
        # `app` package ATTRIBUTE, which can diverge from sys.modules when an
        # earlier test's fixture re-imported db_sync (the helper's lazy
        # `from app.db_sync import ...` reads sys.modules).
        import sys as _sys  # noqa: PLC0415
        import app.db_sync  # noqa: F401, PLC0415
        monkeypatch.setattr(_sys.modules["app.db_sync"], "SessionFactory", _Factory())
        return session

    return _install


def _clipping_analysis() -> dict[str, Any]:
    """A phase1 payload that fires the deterministic clipping rule.
    Already-flat shape — matches the shape ``flatten()`` produces, useful
    for tests that bypass the flatten step."""
    return {
        "phase1": {
            "clipping_detected": True,
            "clipped_sample_count": 1234,
            "true_peak_db": -1.5,
            "mono_compatibility": 0.95,
        },
    }


def _clipping_analysis_pipeline_shape() -> dict[str, Any]:
    """REAL pipeline-shape ``final_json`` — phases as a LIST. The degraded
    helper must call ``flatten()`` to turn this into the keyed form the rule
    engine reads, OR no verdicts persist (production regression caught by
    code review)."""
    return {
        "grade": "F",
        "overall_score": 42,
        "phases": [
            {
                "phase": 1,
                "name": "loudness",
                "data": {
                    "clipping_detected": True,
                    "clipped_sample_count": 1234,
                    "true_peak_db": -1.5,
                    "mono_compatibility": 0.95,
                },
            },
        ],
    }


# ── A. helper behavior ──────────────────────────────────────────────────────


def test_write_degradation_notice_sets_payload(install_fake_sessions):
    aid = uuid.uuid4()
    analysis = _FakeAnalysis(aid, final_json={})
    session = install_fake_sessions(analysis)

    degraded.write_degradation_notice(
        aid, reason=DEGRADATION_REASON_TIER_BUDGET, detail="tier=free over",
    )

    assert analysis.degradation_notice is not None
    assert analysis.degradation_notice["reason"] == DEGRADATION_REASON_TIER_BUDGET
    assert analysis.degradation_notice["detail"] == "tier=free over"
    assert "occurred_at" in analysis.degradation_notice
    # No verdict rows added — that's run_rule_engine_for_analysis's job.
    assert session.added == []


def test_write_degradation_notice_is_idempotent(install_fake_sessions):
    """First failure wins — a second write must NOT overwrite."""
    aid = uuid.uuid4()
    analysis = _FakeAnalysis(aid, final_json={})
    analysis.degradation_notice = {
        "reason": "tier_budget", "detail": "original", "occurred_at": "2026-06-15T00:00:00+00:00",
    }
    install_fake_sessions(analysis)

    degraded.write_degradation_notice(
        aid, reason=DEGRADATION_REASON_CIRCUIT_BREAKER, detail="later",
    )

    assert analysis.degradation_notice["reason"] == "tier_budget"
    assert analysis.degradation_notice["detail"] == "original"


def test_write_degradation_notice_missing_analysis_is_no_op(install_fake_sessions):
    """A missing analysis row should not crash the actor — it logs and
    returns. Tested via a different aid than the seeded one."""
    seeded = _FakeAnalysis(uuid.uuid4(), final_json={})
    install_fake_sessions(seeded)
    other_aid = uuid.uuid4()

    # Must not raise.
    degraded.write_degradation_notice(other_aid, reason=DEGRADATION_REASON_TIER_BUDGET)
    assert seeded.degradation_notice is None  # untouched


def test_run_rule_engine_persists_verdicts(install_fake_sessions):
    aid = uuid.uuid4()
    analysis = _FakeAnalysis(aid, final_json=_clipping_analysis())
    session = install_fake_sessions(analysis, preexisting_rule_rows=False)

    written = degraded.run_rule_engine_for_analysis(aid)

    assert written >= 1
    assert len(session.added) == written
    for row in session.added:
        # Two-pass Problem engine: specialist is "rule_engine.<slug>", each row
        # carries a stable problem_id, and source is rule_engine.
        assert row.specialist.startswith("rule_engine.")
        assert row.problem_id  # not None/empty — proves the Problem engine ran
        assert row.source == "rule_engine"
        assert row.analysis_id == aid
        assert row.severity in {"critical", "severe", "moderate", "minor", "win"}


def test_run_rule_engine_handles_real_pipeline_shape(install_fake_sessions):
    """Regression: production ``final_json`` is ``{"phases": [...]}`` — the
    helper MUST call ``flatten()`` to pivot phases into ``phaseN`` keys the
    rule engine reads, or rule verdicts never persist (silent zero-output)."""
    aid = uuid.uuid4()
    analysis = _FakeAnalysis(aid, final_json=_clipping_analysis_pipeline_shape())
    session = install_fake_sessions(analysis, preexisting_rule_rows=False)

    written = degraded.run_rule_engine_for_analysis(aid)

    assert written >= 1, "rule engine produced zero verdicts on real pipeline shape — flatten() likely missing"
    slugs = {row.problem_id.split(".")[1] for row in session.added if row.problem_id}
    assert "clipping_count" in slugs, (
        "clipping_count Problem should have fired on the real pipeline shape"
    )


def test_run_rule_engine_attaches_deterministic_fix_to_fixable_problem(install_fake_sessions):
    """Regression: the results page lost its device+parameters block because the
    SOLVE tier never ran in the analysis pipeline. Phase C2 now routes Problems
    through ``solve_lib.router.merge``, so a fixable Problem persists with a
    parameter-exact fix (the Listen rack reads ``fix.dsp_chain``)."""
    aid = uuid.uuid4()
    final = _clipping_analysis()
    final["phase2"] = {"genre": "techno"}  # genre-relative solver targets
    analysis = _FakeAnalysis(aid, final_json=final)
    session = install_fake_sessions(analysis, preexisting_rule_rows=False)

    written = degraded.run_rule_engine_for_analysis(aid)

    assert written >= 1
    clipping_rows = [r for r in session.added if r.category == "clipping"]
    assert clipping_rows, "expected a clipping Problem to fire"
    fixed = [r for r in clipping_rows if r.fix is not None]
    assert fixed, "clipping Problem should now carry a deterministic fix"
    # _to_row stores fix as model_dump() — a limiter is the master-rack move.
    assert fixed[0].fix["dsp_chain"][0]["type"] == "limiter"


def test_run_rule_engine_survives_solver_failure_and_keeps_problems(install_fake_sessions, monkeypatch):
    """A SOLVE-tier crash must degrade to Problems-only — never wipe the IDENTIFY
    output. The analysis still gets its Problem list, just without fixes."""
    import app.solve_lib.router as solve_router

    def _boom(*_a, **_k):
        raise RuntimeError("solver exploded")

    monkeypatch.setattr(solve_router, "merge", _boom)

    aid = uuid.uuid4()
    analysis = _FakeAnalysis(aid, final_json=_clipping_analysis())
    session = install_fake_sessions(analysis, preexisting_rule_rows=False)

    written = degraded.run_rule_engine_for_analysis(aid)

    assert written >= 1, "Problems must still persist when the SOLVE tier crashes"
    assert all(r.fix is None for r in session.added)  # degraded to no-fix


def test_run_rule_engine_idempotent_when_rule_rows_already_exist(install_fake_sessions):
    aid = uuid.uuid4()
    analysis = _FakeAnalysis(aid, final_json=_clipping_analysis())
    session = install_fake_sessions(analysis, preexisting_rule_rows=True)

    written = degraded.run_rule_engine_for_analysis(aid)

    assert written == 0
    assert session.added == []


def test_run_rule_engine_handles_missing_analysis(install_fake_sessions):
    seeded = _FakeAnalysis(uuid.uuid4(), final_json={})
    install_fake_sessions(seeded)

    written = degraded.run_rule_engine_for_analysis(uuid.uuid4())  # wrong id
    assert written == 0


# ── B. actor wiring ─────────────────────────────────────────────────────────


def test_triage_actor_catches_budget_exceeded_and_degrades(monkeypatch, tmp_path):
    """When ``gateway.complete_sync`` raises ``LlmBudgetExceeded``, the
    triage actor must (1) NOT raise, (2) call ``write_degradation_notice``,
    (3) call ``run_rule_engine_for_analysis``. Routing plan stays NULL."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'triage.db'}")
    from app import triage_actor

    aid = uuid.uuid4()
    fake_analysis = _FakeAnalysis(aid, final_json={"phase1": {}})

    @contextmanager
    def _begin():
        yield _FakeSession(fake_analysis)

    monkeypatch.setattr(triage_actor.SessionFactory, "begin", lambda: _begin())
    monkeypatch.setattr(
        triage_actor, "flatten",
        lambda raw: {"phase1": {}},
    )
    monkeypatch.setattr(
        triage_actor, "load_triage", lambda: ("1.0.0", "triage prompt body"),
    )
    monkeypatch.setattr(triage_actor, "load_triage_model", lambda: None)

    notice_calls: list[dict] = []
    rule_calls: list[uuid.UUID] = []
    monkeypatch.setattr(
        triage_actor, "write_degradation_notice",
        lambda aid_, *, reason, detail=None: notice_calls.append(
            {"aid": aid_, "reason": reason, "detail": detail},
        ),
    )
    monkeypatch.setattr(
        triage_actor, "run_rule_engine_for_analysis",
        lambda aid_: rule_calls.append(aid_) or 3,
    )

    def _raise_budget(**_kw):
        raise LlmBudgetExceeded(DEGRADATION_REASON_TIER_BUDGET, "over")

    monkeypatch.setattr(triage_actor.gateway, "complete_sync", _raise_budget)

    # Call the underlying function (.fn on a dramatiq actor unwraps to the
    # plain Python callable so we don't hit Redis).
    triage_actor.run_triage.fn(str(aid))

    assert len(notice_calls) == 1
    assert notice_calls[0]["aid"] == aid
    assert notice_calls[0]["reason"] == DEGRADATION_REASON_TIER_BUDGET
    assert rule_calls == [aid]


def test_specialist_actor_catches_budget_exceeded_and_degrades(monkeypatch, tmp_path):
    """``run_specialist``: when the gateway raises ``LlmBudgetExceeded`` the
    actor must persist the notice + ensure rule-engine verdicts exist and
    return WITHOUT writing a fail-marker (that would clutter the degraded UI)."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'specialist.db'}")
    from app import verdict_actor

    aid = uuid.uuid4()
    fake_analysis = _FakeAnalysis(aid, final_json={"phase1": {}})

    @contextmanager
    def _begin():
        yield _FakeSession(fake_analysis)

    monkeypatch.setattr(verdict_actor.SessionFactory, "begin", lambda: _begin())
    monkeypatch.setattr(verdict_actor, "flatten", lambda raw: {"phase1": {}})
    monkeypatch.setattr(
        verdict_actor, "load_prompt", lambda slug: ("1.0.0", "prompt body"),
    )
    monkeypatch.setattr(verdict_actor, "load_prompt_model", lambda slug: None)

    notice_calls: list[dict] = []
    rule_calls: list[uuid.UUID] = []
    fail_marker_calls: list[Any] = []
    monkeypatch.setattr(
        verdict_actor, "write_degradation_notice",
        lambda aid_, *, reason, detail=None: notice_calls.append(
            {"aid": aid_, "reason": reason},
        ),
    )
    monkeypatch.setattr(
        verdict_actor, "run_rule_engine_for_analysis",
        lambda aid_: rule_calls.append(aid_) or 2,
    )
    # raising=True (default) catches a rename/inline of the helper so the
    # "no fail-marker on degraded path" assertion can't pass vacuously.
    monkeypatch.setattr(
        verdict_actor, "_persist_fail_marker",
        lambda *args, **kw: fail_marker_calls.append((args, kw)),
        raising=True,
    )

    def _raise_budget(**_kw):
        raise LlmBudgetExceeded(DEGRADATION_REASON_CIRCUIT_BREAKER, "provider down")

    monkeypatch.setattr(verdict_actor.gateway, "complete_sync", _raise_budget)

    user_id = str(uuid.uuid4())
    verdict_actor.run_specialist.fn(str(aid), "low_end", user_id)

    assert len(notice_calls) == 1
    assert notice_calls[0]["reason"] == DEGRADATION_REASON_CIRCUIT_BREAKER
    assert rule_calls == [aid]
    # Critical: NO fail-marker on the degraded path — the banner is the UX.
    assert fail_marker_calls == []
