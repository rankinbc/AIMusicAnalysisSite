"""Tests for per-phase re-run (rerun_single_phase) — merge-in-place + rollup re-derivation.

The phase worker functions are patched so the test is deterministic and fast; we
only assert the MERGE behaviour (replace exactly one phase, preserve the rest,
re-derive rollups).
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf

from audio_analysis import rerun_single_phase


def make_wav(tmp_path: Path, dur: float = 2.0, sr: int = 44100) -> Path:
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    a = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    p = tmp_path / "t.wav"
    sf.write(str(p), np.column_stack([a, a]), sr)
    return p


def _prior() -> dict:
    """A minimal-but-realistic prior PipelineResult to re-run a phase against."""
    phases = [
        {"phase": 1, "name": "Universal Mix Analysis", "status": "ok",
         "data": {"bpm": 128.0, "duration_seconds": 120.0, "low_energy": 0.2,
                  "lufs": -10.0, "structure": {}}, "error": None},
        {"phase": 2, "name": "Genre Detection", "status": "ok",
         "data": {"genre": "house"}, "error": None},
        {"phase": 3, "name": "Genre-Specific Scoring", "status": "ok",
         "data": {"total_score": 70.0}, "error": None},
        {"phase": 4, "name": "Stem Separation & Clash", "status": "failed",
         "data": {}, "error": "boom"},
        {"phase": 5, "name": "Reference Comparison", "status": "ok",
         "data": {"status": "skipped"}, "error": None},
        {"phase": 6, "name": "Gap Analysis", "status": "ok",
         "data": {"percentile": 50}, "error": None},
        {"phase": 7, "name": "Arrangement Advice", "status": "ok",
         "data": {"suggestions": ["a", "b"]}, "error": None},
        {"phase": 8, "name": "ALS Analysis", "status": "skipped",
         "data": {}, "error": None},
    ]
    return {
        "file_path": "orig.wav", "phases": phases, "overall_score": 70.0,
        "grade": "C", "top_fixes": ["a", "b", "x"], "danceability_score": 50,
        "coach_name": "Coach", "coach_intro": "hi", "coached_fixes": [],
    }


def test_rerun_replaces_only_target_phase(tmp_path):
    wav = make_wav(tmp_path)
    prior = _prior()
    before = {p["phase"]: p for p in prior["phases"]}
    fake = {"band_energy": {}, "clashes": [], "stems": {"kick": {}}}

    with patch("audio_analysis.phases.phase4_stems.analyze", return_value=fake):
        merged = rerun_single_phase(4, str(wav), prior)

    after = {p["phase"]: p for p in merged["phases"]}
    # Phase 4 went failed → ok with the new data.
    assert after[4]["status"] == "ok"
    assert after[4]["data"] == fake
    # Every other phase is byte-identical.
    for n in (1, 2, 3, 5, 6, 7, 8):
        assert after[n] == before[n]
    # Rollups present.
    assert "overall_score" in merged and "grade" in merged
    assert len(merged["phases"]) == 8


def test_rerun_rederives_rollups(tmp_path):
    """Re-running phase 3 must recompute overall_score + grade from the new score."""
    wav = make_wav(tmp_path)
    prior = _prior()
    with patch(
        "audio_analysis.phases.phase3_genre_specific.score",
        return_value={"total_score": 95.0},
    ):
        merged = rerun_single_phase(3, str(wav), prior)
    assert merged["overall_score"] == 95.0
    assert merged["grade"] == "A"


def test_rerun_phase8_reparses_als(tmp_path):
    prior = _prior()
    fake8 = {"phase": 8, "name": "ALS Analysis", "status": "ok",
             "data": {"health_score": 88}, "error": None}
    with patch("audio_analysis.pipeline.analyze_als", return_value=fake8):
        merged = rerun_single_phase(8, "ignored.wav", prior, als_file_path="x.als")
    after = {p["phase"]: p for p in merged["phases"]}
    assert after[8]["status"] == "ok"
    assert after[8]["data"]["health_score"] == 88
    # Phase 8 re-run never touches the audio phases.
    assert after[1]["data"]["bpm"] == 128.0


def test_rerun_failed_phase_stays_failed_without_corrupting_others(tmp_path):
    wav = make_wav(tmp_path)
    prior = _prior()
    before = {p["phase"]: p for p in prior["phases"]}

    def boom(*_a, **_k):
        raise RuntimeError("still broken")

    with patch("audio_analysis.phases.phase6_gap.analyze", side_effect=boom):
        merged = rerun_single_phase(6, str(wav), prior)

    after = {p["phase"]: p for p in merged["phases"]}
    assert after[6]["status"] == "failed"
    assert after[6]["error"]
    for n in (1, 2, 3, 4, 5, 7, 8):
        assert after[n] == before[n]
