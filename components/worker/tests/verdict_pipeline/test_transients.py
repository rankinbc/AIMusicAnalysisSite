"""Phase 3: transient + loudness-stability rules.

weak_transients / unstable_loudness (Tier-A singles) and lost_transients (Tier-C
composite). All fixable=False; suspected where the threshold is heuristic. Each:
fires / stays silent / guards absent data, and every emitted record validates.
"""
from __future__ import annotations

from app.verdict_lib import rule_engine as RE
from app.verdict_lib.validator import validate_verdict


def _a(phase1, genre=None):
    a = {"track_id": "t", "phase1": phase1}
    if genre is not None:
        a["phase2"] = {"genre": genre}
    return a


# ── weak_transients ──────────────────────────────────────────────────────────

def test_weak_transients_fires_on_low_onset():
    a = _a({"transients": {"avg_transient_strength": 0.3}})
    v = RE.weak_transients(a)
    assert v is not None
    assert v.category == "dynamics" and v.kind == "observation"
    assert v.suspected is True and v.fixable is False
    assert v.evidence[0].metric == "phase1.transients.avg_transient_strength"
    assert validate_verdict(v, a).ok


def test_weak_transients_silent_when_punchy():
    assert RE.weak_transients(_a({"transients": {"avg_transient_strength": 5.0}})) is None


def test_weak_transients_silent_when_absent():
    assert RE.weak_transients(_a({})) is None
    assert RE.weak_transients(_a({"transients": {}})) is None


# ── unstable_loudness ────────────────────────────────────────────────────────

def test_unstable_loudness_fires_on_wide_spread():
    a = _a({"lufs": -16.0, "short_term_max_lufs": -6.0, "momentary_max_lufs": -4.0})  # +10 LU
    v = RE.unstable_loudness(a)
    assert v is not None and v.category == "loudness" and v.kind == "fault"
    assert v.severity in ("moderate", "severe") and v.fixable is False
    assert validate_verdict(v, a).ok


def test_unstable_loudness_silent_when_consistent():
    a = _a({"lufs": -9.0, "short_term_max_lufs": -7.0, "momentary_max_lufs": -6.0})  # +2 LU
    assert RE.unstable_loudness(a) is None


def test_unstable_loudness_silent_when_absent():
    assert RE.unstable_loudness(_a({"lufs": -9.0})) is None


# ── lost_transients (composite) ──────────────────────────────────────────────

def _lost():
    return _a({"transients": {"avg_transient_strength": 0.3}, "crest_factor": 3.0})


def test_lost_transients_fires_and_suppresses_children():
    a = _lost()
    out = RE.evaluate_problems(
        a,
        singles=[("weak_transients", RE.weak_transients),
                 ("over_compression", RE.over_compression)],
        composites=[("lost_transients", ["weak_transients", "over_compression"],
                     RE.lost_transients)],
    )
    slugs = {v.problem_id.split(".")[1] for v in out}
    assert "lost_transients" in slugs and "weak_transients" not in slugs
    comp = next(v for v in out if v.problem_id.endswith("lost_transients.0"))
    assert comp.suspected is False and comp.confidence == 0.9 and comp.fixable is False
    assert validate_verdict(comp, a).ok


def test_lost_transients_silent_without_weak_child():
    a = _a({"transients": {"avg_transient_strength": 5.0}, "crest_factor": 3.0})
    assert RE.lost_transients(a, {}) is None


def test_lost_transients_silent_when_crest_healthy():
    a = _a({"transients": {"avg_transient_strength": 0.3}, "crest_factor": 11.0})
    assert RE.lost_transients(a, {"weak_transients": RE.weak_transients(a)}) is None


def test_lost_transients_techno_low_crest_gated_out():
    # techno crest_warn 4.0; crest 5.0 is healthy-for-techno -> not "lost".
    a = _a({"transients": {"avg_transient_strength": 0.3}, "crest_factor": 5.0}, genre="techno")
    assert RE.lost_transients(a, {"weak_transients": RE.weak_transients(a)}) is None


# ── registration ─────────────────────────────────────────────────────────────

def test_new_rules_registered():
    singles = {slug for slug, _fn in RE._SINGLES}
    composites = {slug for slug, _s, _fn in RE._COMPOSITES}
    assert {"weak_transients", "unstable_loudness"} <= singles
    assert "lost_transients" in composites
