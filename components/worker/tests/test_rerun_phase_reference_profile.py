"""rerun_phase forwards the BFF-resolved reference_profile (reference-profiles Task 5).

The 4th positional arg (a resolved profile dict, or None) must reach
rerun_single_phase(..., reference_profile=...) unchanged.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

from app import rerun_phase_actor as rp


class _FakeSession:
    def __init__(self, registry: dict) -> None:
        self._registry = registry

    def __enter__(self) -> "_FakeSession":
        return self

    def __exit__(self, *_a) -> bool:
        return False

    def get(self, model, _id):
        return self._registry.get(model)


def _harness(monkeypatch) -> dict:
    version = SimpleNamespace(
        file_path="versions/x/source.wav",
        reference_path=None,
        als_file_path=None,
        stem_paths=None,
        stem_analysis_mode=None,
    )
    analysis = SimpleNamespace(version_id=uuid.uuid4(), final_json={"phases": []})
    job = SimpleNamespace(
        status=None, started_at=None, current_phase=None, phase_pct=None,
        completed_at=None, error_message=None, failed_at=None,
    )
    registry = {rp.AnalysisJob: job, rp.Analysis: analysis, rp.SongVersion: version}
    monkeypatch.setattr(rp.SessionFactory, "begin", lambda: _FakeSession(registry))

    captured: dict = {}

    def fake_rerun(phase, file_path, prior, **kw):
        captured.update(kw)
        return {"phases": [], "ok": True}

    monkeypatch.setattr(rp, "rerun_single_phase", fake_rerun)
    return captured


def test_user_profile_is_forwarded(monkeypatch):
    captured = _harness(monkeypatch)
    profile = {"kind": "user", "name": "Festival Trance",
               "feature_statistics": {"tempo": {"mean": 138.0, "std": 2.0}}}
    rp.rerun_phase(str(uuid.uuid4()), str(uuid.uuid4()), 6, reference_profile=profile)
    assert captured["reference_profile"] == profile


def test_default_none_when_omitted(monkeypatch):
    captured = _harness(monkeypatch)
    # 3-arg call (back-compat) → reference_profile defaults to None.
    rp.rerun_phase(str(uuid.uuid4()), str(uuid.uuid4()), 6)
    assert captured["reference_profile"] is None
