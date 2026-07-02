"""Phase 5: the LLM-identifier stage — paid-tier gated, idempotent, budget-aware,
forces the identifier-tier fields, and persists findings as source='llm_identifier'.

DB + gateway are faked (no Postgres, no network).
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from app.llm.settings import reset_llm_settings_cache
from app.verdict_lib import identifiers as I

_FAKE_JSON = (
    '{"verdicts":[{"severity":"severe","category":"trance_arrangement",'
    '"confidence":0.8,"headline":"Weak drop payoff",'
    '"summary":"Drop scores 45 vs breakdown 40 - barely any contrast.",'
    '"evidence":[{"metric":"phase7.section_scores[1].score","value":45,"label":"drop 45"}],'
    '"why_it_matters":"The drop is the payoff; without contrast it falls flat."}]}'
)


def _final_json():
    return {"phases": [{"phase": 7, "name": "structure", "data": {"section_scores": [
        {"section_type": "breakdown", "score": 40},
        {"section_type": "drop", "score": 45},
    ]}}]}


_MIDI_FAKE_JSON = (
    '{"verdicts":[{"severity":"moderate","category":"chord_harmony","confidence":0.7,'
    '"headline":"Static harmony","summary":"Lead sits on one chord the whole track.",'
    '"evidence":[{"metric":"phase8.midi_analysis[0].chord_count","value":1,"label":"1 chord"}],'
    '"why_it_matters":"No harmonic movement."}]}'
)


def _midi_final_json():
    return {"phases": [{"phase": 8, "name": "ALS", "data": {"midi_analysis": [
        {"track_name": "Lead", "chord_count": 1, "note_density_per_bar": 2.0,
         "chords": [{"chord_name": "Am"}]},
    ]}}]}


# ── gate / eligibility / hydration (DB-free) ─────────────────────────────────

def test_identifiers_enabled_paid_only():
    reset_llm_settings_cache()
    assert I.identifiers_enabled("pro") is True
    assert I.identifiers_enabled("free") is False
    assert I.identifiers_enabled(None) is False


def test_run_returns_zero_for_free_tier_without_db():
    # The tier gate short-circuits before any DB / LLM access.
    assert I.run_llm_identifiers_for_analysis(uuid.uuid4(), tier="free", user_id=None) == 0


def test_eligible_gates_on_data():
    def slugs(flat):
        return [s.slug for s in I._eligible(flat)]

    # trance_arrangement (audio-only) needs phase7.section_scores
    assert slugs({"phase7": {"section_scores": [{"score": 1}]}}) == ["trance_arrangement"]
    # section_contrast + chord_harmony (.als) need phase8.midi_analysis
    midi = {"phase8": {"midi_analysis": [{"track_name": "Lead"}]}}
    assert set(slugs(midi)) == {"section_contrast", "chord_harmony"}
    # both data present -> all three eligible
    both = {"phase7": {"section_scores": [{"score": 1}]},
            "phase8": {"midi_analysis": [{"track_name": "Lead"}]}}
    assert set(slugs(both)) == {"trance_arrangement", "section_contrast", "chord_harmony"}
    # nothing -> none
    assert slugs({}) == []


def test_hydrate_identifier_forces_fields():
    raw = {
        "severity": "severe", "category": "trance_arrangement", "confidence": 0.8,
        "headline": "h", "summary": "s", "why_it_matters": "w",
        "evidence": [{"metric": "phase7.section_scores[0].score", "value": 40, "label": "x"}],
        # An LLM-emitted fix must be dropped:
        "fix": {"fix_id": "x", "target": {"type": "master", "name": "m"},
                "dsp_chain": [], "expected_outcome": "o"},
    }
    v = I._hydrate_identifier(raw, track_id="t", slug="trance_arrangement",
                              prompt_version="trance_arrangement@1.0.0", model="fake",
                              index=0, data_tier="audio_only")
    assert v.source == "llm_identifier"
    assert v.fix is None
    assert v.suspected is True
    assert v.data_tier == "audio_only"
    assert v.fixable is False
    assert v.problem_id == "trance_arrangement.trance_arrangement.0"


# ── integration (faked DB + gateway) ─────────────────────────────────────────

class _FakeSession:
    def __init__(self, analysis, *, existing=False):
        self.analysis = analysis
        self.existing = existing
        self.added: list = []

    def get(self, _model, key):
        return self.analysis if (self.analysis is not None and key == self.analysis.id) else None

    def add(self, row):
        self.added.append(row)

    def execute(self, _stmt):
        outer = self

        class _R:
            def first(self_inner):
                return ("vrd",) if outer.existing else None

        return _R()


@pytest.fixture
def install(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'ident.db'}")
    reset_llm_settings_cache()

    def _install(analysis, *, existing=False):
        session = _FakeSession(analysis, existing=existing)

        @contextmanager
        def _begin():
            yield session

        class _Factory:
            @staticmethod
            def begin():
                return _begin()

        # Patch the sys.modules entry, not `import ... as` — the as-import
        # resolves via the `app` package attribute, which can diverge from
        # sys.modules after another test's fixture re-imported db_sync.
        import sys as _sys  # noqa: PLC0415
        import app.db_sync  # noqa: F401, PLC0415
        monkeypatch.setattr(_sys.modules["app.db_sync"], "SessionFactory", _Factory())
        return session

    return _install


def _analysis(aid, final_json):
    return SimpleNamespace(id=aid, final_json=final_json)


def test_happy_path_persists_identifier(install, monkeypatch):
    aid = uuid.uuid4()
    session = install(_analysis(aid, _final_json()))
    from app.llm import gateway
    monkeypatch.setattr(gateway, "complete_sync",
                        lambda **kw: SimpleNamespace(text=_FAKE_JSON, model="fake"))

    n = I.run_llm_identifiers_for_analysis(aid, tier="pro", user_id=str(uuid.uuid4()))

    assert n == 1
    assert len(session.added) == 1
    row = session.added[0]
    assert row.source == "llm_identifier"
    assert row.specialist == "trance_arrangement"
    assert row.fixable is False
    assert row.problem_id and row.problem_id.startswith("trance_arrangement")


def test_idempotent_when_identifier_rows_exist(install, monkeypatch):
    aid = uuid.uuid4()
    install(_analysis(aid, _final_json()), existing=True)
    from app.llm import gateway
    calls: list = []
    monkeypatch.setattr(gateway, "complete_sync",
                        lambda **kw: calls.append(1) or SimpleNamespace(text=_FAKE_JSON, model="fake"))

    n = I.run_llm_identifiers_for_analysis(aid, tier="pro", user_id=None)

    assert n == 0
    assert calls == []  # no LLM call when identifier rows already exist


def test_skips_when_no_section_scores(install, monkeypatch):
    aid = uuid.uuid4()
    install(_analysis(aid, {"phases": [{"phase": 1, "name": "loudness", "data": {"lufs": -8.0}}]}))
    from app.llm import gateway
    calls: list = []
    monkeypatch.setattr(gateway, "complete_sync",
                        lambda **kw: calls.append(1) or SimpleNamespace(text=_FAKE_JSON, model="fake"))

    n = I.run_llm_identifiers_for_analysis(aid, tier="pro", user_id=None)

    assert n == 0 and calls == []  # no eligible identifier -> no call


def test_als_gated_identifiers_run_with_midi(install, monkeypatch):
    aid = uuid.uuid4()
    session = install(_analysis(aid, _midi_final_json()))
    from app.llm import gateway
    monkeypatch.setattr(gateway, "complete_sync",
                        lambda **kw: SimpleNamespace(text=_MIDI_FAKE_JSON, model="fake"))

    n = I.run_llm_identifiers_for_analysis(aid, tier="pro", user_id=None)

    assert n == 2  # section_contrast + chord_harmony both run on phase8.midi_analysis
    assert all(r.source == "llm_identifier" for r in session.added)
    assert all(r.data_tier == "project_midi" for r in session.added)


def test_budget_exceeded_stamps_notice_and_stops(install, monkeypatch):
    aid = uuid.uuid4()
    install(_analysis(aid, _final_json()))
    from app.llm import gateway
    from app.llm.gateway import LlmBudgetExceeded

    def _raise(**_kw):
        raise LlmBudgetExceeded("tier_budget", "over")

    monkeypatch.setattr(gateway, "complete_sync", _raise)
    import app.verdict_lib.degraded as D
    notices: list = []
    monkeypatch.setattr(D, "write_degradation_notice",
                        lambda aid_, *, reason, detail=None: notices.append(reason))

    n = I.run_llm_identifiers_for_analysis(aid, tier="pro", user_id=None)

    assert n == 0
    assert notices == ["tier_budget"]


# ── P1.2: trace_sink captures the full LLM request + response ────────────────

def test_trace_sink_captures_request_and_response(install, monkeypatch):
    aid = uuid.uuid4()
    install(_analysis(aid, _final_json()))
    from app.llm import gateway
    monkeypatch.setattr(gateway, "complete_sync",
                        lambda **kw: SimpleNamespace(text=_FAKE_JSON, model="fake"))

    sink: list = []
    n = I.run_llm_identifiers_for_analysis(aid, tier="pro", user_id=None, trace_sink=sink)

    assert n == 1 and len(sink) == 1
    rec = sink[0]
    assert rec["slug"] == "trance_arrangement"
    assert rec["request"]["system"] and rec["request"]["user"]  # full input payload
    assert rec["response"]["outcome"] == "ok"
    assert rec["response"]["raw"] == _FAKE_JSON                  # full output payload
    assert rec["response"]["parsed_verdicts"] == 1


def test_trace_sink_records_budget_exceeded(install, monkeypatch):
    aid = uuid.uuid4()
    install(_analysis(aid, _final_json()))
    from app.llm import gateway
    from app.llm.gateway import LlmBudgetExceeded

    def _raise(**_kw):
        raise LlmBudgetExceeded("tier_budget", "over")

    monkeypatch.setattr(gateway, "complete_sync", _raise)
    import app.verdict_lib.degraded as D
    monkeypatch.setattr(D, "write_degradation_notice", lambda *a, **k: None)

    sink: list = []
    I.run_llm_identifiers_for_analysis(aid, tier="pro", user_id=None, trace_sink=sink)

    assert len(sink) == 1
    assert sink[0]["response"]["outcome"] == "budget_exceeded"
