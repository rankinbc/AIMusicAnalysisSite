"""generate_fix_rack: re-runs the engine + SOLVE on a completed analysis and
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


def _analysis(aid, vid, final_json):
    return Analysis(id=aid, job_id=uuid.uuid4(), user_id=uuid.uuid4(),
                    version_id=vid, song_id=uuid.uuid4(), song_name="My Track",
                    final_json=final_json)


def test_generate_fix_rack_writes_analysis_preset(harness):
    aid, vid = uuid.uuid4(), uuid.uuid4()
    harness["registry"][Analysis] = _analysis(
        aid, vid, {"phase1": {"true_peak_db": 0.5}, "phase2": {"genre": "techno"}})

    fra.generate_fix_rack(str(aid))

    presets = [o for o in harness["added"] if isinstance(o, RackPreset)]
    assert len(presets) == 1
    p = presets[0]
    assert p.source == "analysis" and p.song_version_id == vid
    assert p.name.startswith("Fix rack")
    assert p.chain_json["modules"]["limiter"]["enabled"] is True


def test_generate_fix_rack_replaces_prior_analysis_preset(harness):
    aid, vid = uuid.uuid4(), uuid.uuid4()
    prior = RackPreset(song_version_id=vid, name="old", source="analysis", chain_json={})
    harness["existing"] = [prior]
    harness["registry"][Analysis] = _analysis(
        aid, vid, {"phase1": {"true_peak_db": 0.5}, "phase2": {"genre": "techno"}})

    fra.generate_fix_rack(str(aid))

    assert prior in harness["deleted"]
    assert any(isinstance(o, RackPreset) for o in harness["added"])


def test_generate_fix_rack_skips_when_no_version(harness):
    aid = uuid.uuid4()
    harness["registry"][Analysis] = _analysis(aid, None, {"phase1": {}})

    fra.generate_fix_rack(str(aid))

    assert not [o for o in harness["added"] if isinstance(o, RackPreset)]
