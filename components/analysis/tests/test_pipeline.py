"""Comprehensive tests for the audio_analysis package.

Heavy ML models (Demucs, torchopenl3) are patched out so tests run without
GPU or large model downloads.  A synthetic stereo sine WAV is generated
in-memory for each test that needs audio input.
"""

from __future__ import annotations

import numpy as np
import os
from pathlib import Path
from unittest.mock import patch
import pytest
import soundfile as sf


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def make_test_wav(tmp_path: Path, duration_s: float = 3.0, sr: int = 44100) -> Path:
    """Generate a synthetic stereo sine wave WAV for testing."""
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    left = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    right = (0.3 * np.sin(2 * np.pi * 441 * t)).astype(np.float32)
    audio = np.column_stack([left, right])
    wav_path = tmp_path / "test_track.wav"
    sf.write(str(wav_path), audio, sr)
    return wav_path


# ---------------------------------------------------------------------------
# Converters
# ---------------------------------------------------------------------------

class TestConverters:
    def test_to_wav_wav_input(self, tmp_path):
        from audio_analysis.converters import to_wav

        src = make_test_wav(tmp_path)
        result = to_wav(src)
        assert result.exists()
        assert result.suffix == ".wav"
        os.unlink(result)

    def test_to_wav_returns_path(self, tmp_path):
        from audio_analysis.converters import to_wav

        src = make_test_wav(tmp_path)
        result = to_wav(src)
        assert isinstance(result, Path)
        os.unlink(result)

    def test_to_wav_different_from_input(self, tmp_path):
        """to_wav must write to a *new* temp file, not overwrite the input."""
        from audio_analysis.converters import to_wav

        src = make_test_wav(tmp_path)
        result = to_wav(src)
        try:
            assert result != src
        finally:
            if result.exists():
                os.unlink(result)


# ---------------------------------------------------------------------------
# Phase 1
# ---------------------------------------------------------------------------

class TestPhase1:
    def test_lufs_axis_contract(self, tmp_path):
        """Verify pyloudnorm receives (samples, channels) float64 — not (channels, samples)."""
        from audio_analysis.phases import phase1_universal

        wav = make_test_wav(tmp_path)
        result = phase1_universal.analyze(wav)
        assert "lufs" in result
        assert isinstance(result["lufs"], float)
        # LUFS is always negative for typical audio content
        assert result["lufs"] < 0

    def test_returns_all_keys(self, tmp_path):
        from audio_analysis.phases import phase1_universal

        wav = make_test_wav(tmp_path)
        result = phase1_universal.analyze(wav)
        for key in ["lufs", "rms", "bpm", "bands", "stereo_correlation", "stereo_width", "structure"]:
            assert key in result, f"Missing key: {key}"

    def test_bands_has_7_entries(self, tmp_path):
        from audio_analysis.phases import phase1_universal

        wav = make_test_wav(tmp_path)
        result = phase1_universal.analyze(wav)
        assert len(result["bands"]) == 7

    def test_band_names(self, tmp_path):
        from audio_analysis.phases import phase1_universal

        wav = make_test_wav(tmp_path)
        result = phase1_universal.analyze(wav)
        expected = {"sub_bass", "bass", "low_mid", "mid", "upper_mid", "presence", "air"}
        assert set(result["bands"].keys()) == expected

    def test_stereo_correlation_range(self, tmp_path):
        """Stereo correlation must be in [-1, 1]."""
        from audio_analysis.phases import phase1_universal

        wav = make_test_wav(tmp_path)
        result = phase1_universal.analyze(wav)
        assert -1.0 <= result["stereo_correlation"] <= 1.0

    def test_mono_input_does_not_raise(self, tmp_path):
        """Mono WAV (single channel) should be handled without error."""
        from audio_analysis.phases import phase1_universal

        sr = 44100
        t = np.linspace(0, 2.0, int(sr * 2.0), endpoint=False)
        mono = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
        mono_path = tmp_path / "mono.wav"
        sf.write(str(mono_path), mono, sr)

        result = phase1_universal.analyze(mono_path)
        assert "lufs" in result
        assert result["stereo_correlation"] == 1.0
        assert result["stereo_width"] == 0.0


# ---------------------------------------------------------------------------
# Phase 2
# ---------------------------------------------------------------------------

class TestPhase2:
    def test_dnb_classification(self, tmp_path):
        from audio_analysis.phases import phase2_genre

        wav = make_test_wav(tmp_path)
        phase1 = {"bpm": 174.0, "bands": {}, "stereo_width": 0.5}
        result = phase2_genre.classify(wav, phase1)
        assert result["genre"] == "dnb"

    def test_house_classification(self, tmp_path):
        from audio_analysis.phases import phase2_genre

        wav = make_test_wav(tmp_path)
        phase1 = {"bpm": 125.0, "bands": {"presence": -25.0}, "stereo_width": 0.5}
        result = phase2_genre.classify(wav, phase1)
        assert result["genre"] == "house"

    def test_trance_classification(self, tmp_path):
        from audio_analysis.phases import phase2_genre

        wav = make_test_wav(tmp_path)
        # Use presence energy that WON'T trigger techno override
        phase1 = {"bpm": 138.0, "bands": {"presence": -35.0}, "stereo_width": 0.6}
        result = phase2_genre.classify(wav, phase1)
        assert result["genre"] == "trance"

    def test_techno_override(self, tmp_path):
        """High presence energy + 128-140 BPM should flip classification to techno."""
        from audio_analysis.phases import phase2_genre

        wav = make_test_wav(tmp_path)
        phase1 = {"bpm": 135.0, "bands": {"presence": -10.0}, "stereo_width": 0.4}
        result = phase2_genre.classify(wav, phase1)
        assert result["genre"] == "techno"

    def test_result_has_required_keys(self, tmp_path):
        from audio_analysis.phases import phase2_genre

        wav = make_test_wav(tmp_path)
        result = phase2_genre.classify(wav, {"bpm": 120.0, "bands": {}})
        for key in ("genre", "confidence", "bpm"):
            assert key in result


# ---------------------------------------------------------------------------
# Phase 3
# ---------------------------------------------------------------------------

class TestPhase3:
    def test_score_returns_required_keys(self, tmp_path):
        from audio_analysis.phases import phase3_genre_specific

        wav = make_test_wav(tmp_path)
        phase1 = {"bpm": 125.0, "bands": {}, "stereo_width": 0.4}
        result = phase3_genre_specific.score(wav, "house", phase1)
        for key in ("genre", "total_score", "sub_scores", "notes"):
            assert key in result

    def test_score_in_range(self, tmp_path):
        from audio_analysis.phases import phase3_genre_specific

        wav = make_test_wav(tmp_path)
        phase1 = {"bpm": 174.0, "bands": {"sub_bass": -15.0}, "stereo_width": 0.5}
        result = phase3_genre_specific.score(wav, "dnb", phase1)
        assert 0.0 <= result["total_score"] <= 100.0

    def test_unknown_genre_uses_other_scorer(self, tmp_path):
        from audio_analysis.phases import phase3_genre_specific

        wav = make_test_wav(tmp_path)
        phase1 = {"bpm": 100.0, "bands": {}, "stereo_width": 0.3}
        result = phase3_genre_specific.score(wav, "reggae", phase1)
        assert result["genre"] == "reggae"


# ---------------------------------------------------------------------------
# Phase 5
# ---------------------------------------------------------------------------

class TestPhase5:
    def test_skipped_when_no_reference(self, tmp_path):
        from audio_analysis.phases import phase5_reference

        wav = make_test_wav(tmp_path)
        result = phase5_reference.compare(wav, None, {})
        assert result["status"] == "skipped"
        assert result["deltas"] == {}

    def test_compare_returns_deltas(self, tmp_path):
        from audio_analysis.phases import phase5_reference

        wav = make_test_wav(tmp_path)
        tmp_path_ref = tmp_path / "ref"
        tmp_path_ref.mkdir(exist_ok=True)
        ref = make_test_wav(tmp_path_ref)

        # Build a minimal phase1 result
        phase1 = {
            "lufs": -14.0, "rms": 0.1, "stereo_correlation": 0.9,
            "bands": {"sub_bass": -30.0, "bass": -25.0, "low_mid": -20.0,
                      "mid": -18.0, "upper_mid": -22.0, "presence": -25.0, "air": -35.0},
        }
        result = phase5_reference.compare(wav, str(ref), phase1)
        assert result["status"] == "ok"
        assert "lufs" in result["deltas"]


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

class TestPipeline:
    def test_pipeline_returns_all_7_phases(self, tmp_path):
        """All 7 phases should appear in the result."""
        from audio_analysis import run_pipeline

        wav = make_test_wav(tmp_path)
        with patch("audio_analysis.phases.phase4_stems.get_model", return_value=None):
            result = run_pipeline(str(wav))
        assert len(result["phases"]) == 7
        assert result["grade"] in ["A", "B", "C", "D", "F"]

    def test_phase_failure_does_not_abort_pipeline(self, tmp_path):
        """A single phase failure should not prevent remaining phases from running."""
        from audio_analysis import run_pipeline
        from audio_analysis.phases import phase3_genre_specific

        def failing_score(*args, **kwargs):
            raise RuntimeError("Simulated phase 3 failure")

        wav = make_test_wav(tmp_path)
        with patch("audio_analysis.phases.phase3_genre_specific.score", side_effect=failing_score):
            with patch("audio_analysis.phases.phase4_stems.get_model", return_value=None):
                result = run_pipeline(str(wav))

        phases = result["phases"]
        assert len(phases) == 7
        failed = [p for p in phases if p["status"] == "failed"]
        assert any(p["phase"] == 3 for p in failed)
        # Phases 4-7 still ran regardless of phase 3 failure
        later = [p for p in phases if p["phase"] > 3]
        assert len(later) == 4

    def test_pipeline_cleans_up_temp_wav(self, tmp_path):
        """Temporary WAV should be deleted after pipeline completes."""
        from audio_analysis import run_pipeline
        from audio_analysis import converters

        created_temps: list[Path] = []
        original_to_wav = converters.to_wav

        def tracking_to_wav(path, *args, **kwargs):
            result = original_to_wav(path, *args, **kwargs)
            created_temps.append(result)
            return result

        wav = make_test_wav(tmp_path)
        with patch("audio_analysis.pipeline.to_wav", side_effect=tracking_to_wav):
            with patch("audio_analysis.phases.phase4_stems.get_model", return_value=None):
                run_pipeline(str(wav))

        for temp in created_temps:
            assert not os.path.exists(temp), f"Temp file not cleaned up: {temp}"

    def test_top_fixes_has_3_items(self, tmp_path):
        from audio_analysis import run_pipeline

        wav = make_test_wav(tmp_path)
        with patch("audio_analysis.phases.phase4_stems.get_model", return_value=None):
            result = run_pipeline(str(wav))
        assert len(result["top_fixes"]) == 3

    def test_pipeline_result_keys(self, tmp_path):
        from audio_analysis import run_pipeline

        wav = make_test_wav(tmp_path)
        with patch("audio_analysis.phases.phase4_stems.get_model", return_value=None):
            result = run_pipeline(str(wav))
        for key in ("file_path", "phases", "overall_score", "grade", "top_fixes"):
            assert key in result

    def test_grade_mapping(self):
        from audio_analysis.pipeline import _score_to_grade

        assert _score_to_grade(95.0) == "A"
        assert _score_to_grade(85.0) == "B"
        assert _score_to_grade(75.0) == "C"
        assert _score_to_grade(65.0) == "D"
        assert _score_to_grade(55.0) == "F"
        assert _score_to_grade(0.0) == "F"
