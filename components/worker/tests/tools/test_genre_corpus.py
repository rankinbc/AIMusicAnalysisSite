"""Genre-corpus tuner — the pure parts (stats + propose) and the injectable measure.
The phase1 measurement itself needs audio_analysis + audio and is exercised live."""
from __future__ import annotations

import math

from app.tools.genre_corpus import measure, propose, stats


# ── stats ────────────────────────────────────────────────────────────────────

def test_summarize_percentiles():
    s = stats.summarize([1, 2, 3, 4, 5])
    assert s.n == 5
    assert s.median == 3.0
    assert s.p10 == 1.4   # linear interp: 1*0.6 + 2*0.4
    assert s.p90 == 4.6   # 4*0.4 + 5*0.6


def test_summarize_single_value():
    s = stats.summarize([7.0])
    assert s.median == s.p10 == s.p90 == 7.0 and s.n == 1


def test_aggregate_drops_none_and_nan():
    rows = [{"a": 1.0, "b": None}, {"a": 3.0, "b": math.nan}, {"a": 5.0}]
    agg = stats.aggregate(rows)
    assert set(agg) == {"a"}          # b had no finite values
    assert agg["a"].median == 3.0 and agg["a"].n == 3


# ── measure (injected analyze_fn — no audio needed) ──────────────────────────

def test_measure_extracts_and_derives():
    p1 = {
        "lufs": -7.0, "true_peak_db": -0.5, "crest_factor": 5.0, "loudness_range_lu": 4.0,
        "bpm": 130.0, "stereo_width": 0.4, "mono_compatibility": 0.9,
        "spectral_centroid_hz": 2500.0, "short_term_max_lufs": -3.0, "momentary_max_lufs": -2.0,
        "transients": {"avg_transient_strength": 0.8},
        "bands": {"low_mid": -12.0, "upper_mid": -20.0, "air": -40.0},
    }
    m = measure.measure_track("x.wav", analyze_fn=lambda _p: p1)
    assert m["lufs"] == -7.0 and m["crest_factor"] == 5.0
    assert m["plr"] == -0.5 - (-7.0)        # derived: true_peak - lufs
    assert m["st_spread"] == -3.0 - (-7.0)  # derived: short_term - lufs
    assert m["avg_transient_strength"] == 0.8 and m["band_air"] == -40.0


def test_measure_drops_absent_fields():
    m = measure.measure_track("x", analyze_fn=lambda _p: {"lufs": -7.0})
    assert m == {"lufs": -7.0}  # no derived (no true_peak/short_term), no other metrics


# ── propose ──────────────────────────────────────────────────────────────────

def _techno_current():
    return {"genre_profiles": {"techno": {
        "loudness": {
            "streaming": {"lufs_target": -14.0, "provenance": "standard"},
            "club": {"lufs_target": -6.5, "provenance": "rule_of_thumb"},
        },
        "dynamics": {"crest_db": {"target": 5.5, "provenance": "interpolation"}},
    }}}


def _measured_rows():
    return [
        {"lufs": -7.0, "true_peak_db": -0.5, "crest_factor": 5.0, "loudness_range_lu": 4.0,
         "bpm": 130.0, "plr": 6.5, "st_spread": 4.0, "avg_transient_strength": 0.9},
        {"lufs": -6.0, "true_peak_db": -0.3, "crest_factor": 4.5, "loudness_range_lu": 3.5,
         "bpm": 132.0, "plr": 5.7, "st_spread": 5.0, "avg_transient_strength": 0.8},
        {"lufs": -6.5, "true_peak_db": -0.8, "crest_factor": 6.0, "loudness_range_lu": 4.5,
         "bpm": 128.0, "plr": 5.7, "st_spread": 3.0, "avg_transient_strength": 1.0},
    ]


def test_propose_sets_measured_thresholds():
    current = _techno_current()
    agg = {"techno": stats.aggregate(_measured_rows())}
    res = propose.propose_updates(agg, current)
    p = res["proposed"]["genre_profiles"]["techno"]

    assert p["loudness"]["club"]["lufs_target"] == -6.5      # median of -7,-6.5,-6
    assert p["loudness"]["club"]["provenance"] == "measured"
    assert p["dynamics"]["crest_db"]["target"] == 5.0        # median of 4.5,5,6
    assert p["dynamics"]["crest_db"]["provenance"] == "measured"
    # new blocks created from the new metrics
    assert "stability" in p["loudness"] and p["loudness"]["stability"]["provenance"] == "measured"
    assert "transient_strength" in p["dynamics"]
    assert p["bpm"]["center"] == 130


def test_propose_preserves_streaming_and_does_not_mutate_input():
    current = _techno_current()
    agg = {"techno": stats.aggregate(_measured_rows())}
    res = propose.propose_updates(agg, current)

    # the -14 platform standard is never touched
    assert res["proposed"]["genre_profiles"]["techno"]["loudness"]["streaming"]["lufs_target"] == -14.0
    # input left untouched (deep copy)
    assert current["genre_profiles"]["techno"]["dynamics"]["crest_db"]["target"] == 5.5
    # changes recorded with old/new
    assert any(c["path"] == "dynamics.crest_db.target" and c["new"] == 5.0 for c in res["changes"])
    # report carries the raw stats
    assert res["report"]["techno"]["crest_factor"]["n"] == 3
