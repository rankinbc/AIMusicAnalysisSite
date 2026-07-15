"""generate_fix_rack: re-runs the engine + synthesize on a completed analysis and
persists the compiled rack as a system RackPreset(source='analysis'), version-
scoped + idempotent. DB is faked (no Postgres).
"""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import Analysis, RackPreset  # noqa: E402
from app import fix_rack_actor as fra  # noqa: E402


class _Scalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _Scalars(self._rows)


class _FakeSession:
    def __init__(self, state):
        self._s = state

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, model, _id):
        return self._s["registry"].get(model)

    def add(self, obj):
        self._s["added"].append(obj)

    def delete(self, obj):
        self._s["deleted"].append(obj)

    def execute(self, _stmt):
        return _Result(self._s["existing"])


@pytest.fixture
def harness(monkeypatch):
    state = {"registry": {}, "added": [], "deleted": [], "existing": []}
    monkeypatch.setattr(fra.SessionFactory, "begin", lambda: _FakeSession(state))
    return state


@pytest.fixture
def stub_synth(monkeypatch):
    """Actor tests cover persistence wiring, not synthesis — stub it so no LLM
    is reached and the chain is deterministic."""
    out = {
        "chain": {"order": ["limiter"], "modules": {"limiter": {"enabled": True}},
                  "masterBypass": False},
        "leftover_advice": [], "change_log": [{"module": "limiter", "change": "added ceiling"}],
        "arbiter_notes": None, "degraded": False,
    }
    monkeypatch.setattr(fra, "synthesize", lambda problems, analysis, **k: out)
    return out


def _analysis(aid, vid, final_json):
    return Analysis(id=aid, job_id=uuid.uuid4(), user_id=uuid.uuid4(),
                    version_id=vid, song_id=uuid.uuid4(), song_name="My Track",
                    final_json=final_json)


def test_generate_fix_rack_writes_analysis_preset(harness, stub_synth):
    aid, vid = uuid.uuid4(), uuid.uuid4()
    harness["registry"][Analysis] = _analysis(
        aid, vid, {"phase1": {"true_peak_db": 0.5}, "phase2": {"genre": "techno"}})

    fra.generate_fix_rack(str(aid), str(uuid.uuid4()), "free")

    presets = [o for o in harness["added"] if isinstance(o, RackPreset)]
    assert len(presets) == 1
    p = presets[0]
    assert p.source == "analysis" and p.song_version_id == vid
    assert p.name.startswith("Fix rack")
    assert p.chain_json["modules"]["limiter"]["enabled"] is True


def test_generate_fix_rack_replaces_prior_analysis_preset(harness, stub_synth):
    aid, vid = uuid.uuid4(), uuid.uuid4()
    prior = RackPreset(song_version_id=vid, name="old", source="analysis", chain_json={})
    harness["existing"] = [prior]
    harness["registry"][Analysis] = _analysis(
        aid, vid, {"phase1": {"true_peak_db": 0.5}, "phase2": {"genre": "techno"}})

    fra.generate_fix_rack(str(aid), str(uuid.uuid4()), "free")

    assert prior in harness["deleted"]
    assert any(isinstance(o, RackPreset) for o in harness["added"])


def test_generate_fix_rack_skips_when_no_version(harness):
    aid = uuid.uuid4()
    harness["registry"][Analysis] = _analysis(aid, None, {"phase1": {}})

    fra.generate_fix_rack(str(aid), str(uuid.uuid4()), "free")

    assert not [o for o in harness["added"] if isinstance(o, RackPreset)]


def test_generate_fix_rack_survives_compute_error(harness, monkeypatch):
    # Phase 1 hardening: a compute-phase blow-up (bad final_json / solver bug) must
    # not raise out of the actor or half-write a preset.
    aid, vid = uuid.uuid4(), uuid.uuid4()
    harness["registry"][Analysis] = _analysis(aid, vid, {"phase1": {"true_peak_db": 0.5}})

    def _boom(_flat):
        raise RuntimeError("compute blew up")

    monkeypatch.setattr(fra, "evaluate_problems", _boom)
    fra.generate_fix_rack(str(aid), str(uuid.uuid4()), "free")  # must not raise

    assert not [o for o in harness["added"] if isinstance(o, RackPreset)]


def test_generate_fix_rack_persists_coach_meta(harness, stub_synth):
    aid, vid = uuid.uuid4(), uuid.uuid4()
    harness["registry"][Analysis] = _analysis(
        aid, vid, {"phase1": {"true_peak_db": 0.5}, "phase2": {"genre": "techno"}})

    fra.generate_fix_rack(str(aid), str(uuid.uuid4()), "free")

    p = next(o for o in harness["added"] if isinstance(o, RackPreset))
    assert p.coach_meta["change_log"][0]["change"] == "added ceiling"
    assert p.coach_meta["degraded"] is False
    assert p.coach_meta["arbiter_notes"] is None
