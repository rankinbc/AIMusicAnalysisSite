"""The optional live-results hook (``phase_done_cb``) on run_pipeline and the
early phase-1 sub-results (``partial_cb``) on phase1_universal.analyze.

Contract: purely observational. It fires once per finished phase (with the
PhaseResult + seconds) and several times during phase 1 (``seconds=None`` +
a sub-result dict), and the pipeline result is identical with or without it —
even when the hook raises.
"""
from __future__ import annotations

import copy
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf


def _wav(tmp_path: Path, duration_s: float = 3.0, sr: int = 44100) -> Path:
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    mono = (0.4 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    out = tmp_path / "mix.wav"
    sf.write(out, np.stack([mono, mono * 0.9], axis=1), sr)
    return out


def _strip_timing(result: dict) -> dict:
    r = copy.deepcopy(dict(result))
    r.pop("phase_durations", None)
    r.pop("file_path", None)
    for p in r.get("phases", []):
        p.pop("duration_s", None)
    return r


def _run(wav: Path, **kw):
    from audio_analysis import run_pipeline

    with patch("audio_analysis.phases.phase4_stems.get_model", return_value=None):
        return run_pipeline(str(wav), **kw)


def test_phase1_partial_cb_emits_headline_measurements_early(tmp_path):
    from audio_analysis.phases import phase1_universal

    seen: list[dict] = []
    data = phase1_universal.analyze(_wav(tmp_path), defer_structure=True, partial_cb=seen.append)

    merged: dict = {}
    for d in seen:
        merged.update(d)
    for key in ("lufs", "true_peak_db", "bpm", "detected_key", "key_estimate", "clipping_detected"):
        assert key in merged, key
        assert merged[key] == data[key]
    # Headline order: loudness first, key last.
    assert "lufs" in seen[0]
    assert "detected_key" in seen[-1]


def test_phase1_partial_cb_error_is_swallowed(tmp_path):
    from audio_analysis.phases import phase1_universal

    def boom(_d):
        raise RuntimeError("observer broke")

    wav = _wav(tmp_path)
    with_boom = phase1_universal.analyze(wav, defer_structure=True, partial_cb=boom)
    plain = phase1_universal.analyze(wav, defer_structure=True)
    assert with_boom["lufs"] == plain["lufs"]
    assert with_boom["detected_key"] == plain["detected_key"]


def test_run_pipeline_reports_every_phase_with_seconds(tmp_path):
    calls: list[tuple] = []
    result = _run(_wav(tmp_path), defer_structure=True,
                  phase_done_cb=lambda *a: calls.append(a))

    done = [c for c in calls if c[3] is not None]
    early = [c for c in calls if c[3] is None]
    assert [c[0] for c in done] == [1, 2, 3, 4, 5, 6, 7, 9, 8]
    for phase, name, pr, seconds in done:
        assert isinstance(seconds, float)
        assert pr["phase"] == phase
        assert pr["name"] == name
        assert seconds == pr["duration_s"]
    # Durations match what the final result persists.
    assert {str(c[0]): c[3] for c in done} == result["phase_durations"]
    # Early phase-1 sub-results arrive BEFORE phase 1's done call.
    assert early and all(c[0] == 1 for c in early)
    assert calls.index(early[-1]) < calls.index(done[0])


def test_run_pipeline_result_unchanged_by_hook_even_when_it_raises(tmp_path):
    wav = _wav(tmp_path)

    def boom(*_a):
        raise RuntimeError("observer broke")

    plain = _run(wav, defer_structure=True)
    hooked = _run(wav, defer_structure=True, phase_done_cb=boom)
    assert _strip_timing(hooked) == _strip_timing(plain)
    assert all(p["status"] != "failed" for p in hooked["phases"] if p["phase"] in (1, 2))


def test_failed_phase_is_reported(tmp_path):
    calls: list[tuple] = []

    def failing_score(*_a, **_k):
        raise RuntimeError("Simulated phase 3 failure")

    with patch("audio_analysis.phases.phase3_genre_specific.score", side_effect=failing_score):
        _run(_wav(tmp_path), defer_structure=True, phase_done_cb=lambda *a: calls.append(a))

    p3 = next(c for c in calls if c[0] == 3 and c[3] is not None)
    assert p3[2]["status"] == "failed"
    assert "Simulated" in p3[2]["error"]
