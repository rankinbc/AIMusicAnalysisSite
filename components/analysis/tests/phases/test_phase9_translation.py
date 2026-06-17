"""Phase 9 — Mix Translation tests.

Per the project testing rule: one expected-use, one edge, one failure case.
Plus an anti-phase case that exercises the headline "collapses in mono" path
end to end (analyzer → phase dict).
"""

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from audio_analysis.phases import phase9_translation
from audio_analysis.pipeline import run_single_phase

SR = 44100
DUR_S = 3.0
N = int(SR * DUR_S)


def _write(path: Path, audio: np.ndarray) -> Path:
    sf.write(path, audio.astype(np.float32), SR)
    return path


@pytest.fixture
def stereo_mix(tmp_path) -> Path:
    """Decorrelated stereo: same tone with an independent noise bed per side."""
    t = np.arange(N) / SR
    rng = np.random.default_rng(0)
    tone = 0.3 * np.sin(2 * np.pi * 220 * t)
    left = tone + 0.05 * rng.normal(size=N)
    right = tone + 0.05 * rng.normal(size=N)
    return _write(tmp_path / "stereo.wav", np.stack([left, right], axis=1))


def test_phase9_stereo_returns_translation_metrics(stereo_mix: Path):
    """Expected use — all three analysis modes return well-formed sub-dicts."""
    data = phase9_translation.analyze(stereo_mix)

    assert set(data) == {"spatial", "surround", "playback"}

    surround = data["surround"]
    assert isinstance(surround["mono_compatibility"], float)
    assert 0.0 <= surround["mono_compatibility"] <= 100.0
    assert isinstance(surround["is_atmos_ready"], bool)

    playback = data["playback"]
    assert playback["bass_translation"] in {"good", "weak", "excessive"}
    assert isinstance(playback["crossfeed_safe"], bool)

    spatial = data["spatial"]
    for key in ("height_score", "depth_score", "width_consistency"):
        assert 0.0 <= spatial[key] <= 100.0

    # The dict is written to a Postgres JSONB column by the worker, so it must
    # contain only native types — no numpy scalars (e.g. crossfeed_safe).
    json.dumps(data)


def test_phase9_mono_is_mono_perfect(tmp_path):
    """Edge — a true-mono (1-D) source is perfectly mono-compatible."""
    t = np.arange(N) / SR
    mono = 0.3 * np.sin(2 * np.pi * 220 * t)
    path = _write(tmp_path / "mono.wav", mono)

    data = phase9_translation.analyze(path)

    assert data["surround"]["mono_compatibility"] == 100.0
    assert data["surround"]["is_atmos_ready"] is True


def test_phase9_antiphase_collapses_in_mono(tmp_path):
    """Headline path — L = -R cancels when summed, so mono compatibility is low."""
    t = np.arange(N) / SR
    tone = 0.3 * np.sin(2 * np.pi * 220 * t)
    path = _write(tmp_path / "antiphase.wav", np.stack([tone, -tone], axis=1))

    data = phase9_translation.analyze(path)

    assert data["surround"]["mono_compatibility"] < 50.0


def test_phase9_silent_audio_returns_defaults_without_crashing(tmp_path):
    """Edge — silent stereo hits the analyzers' internal fallbacks, no exception."""
    path = _write(tmp_path / "silent.wav", np.zeros((N, 2)))

    data = phase9_translation.analyze(path)

    assert set(data) == {"spatial", "surround", "playback"}
    assert isinstance(data["playback"]["bass_translation"], str)


def test_phase9_corrupt_file_marked_failed_via_pipeline(tmp_path):
    """Failure — a corrupt WAV propagates as a 'failed' PhaseResult, not a crash."""
    bad = tmp_path / "broken.wav"
    bad.write_bytes(b"not really audio")

    result = run_single_phase(9, wav_path=bad, phase_data={})

    assert result["phase"] == 9
    assert result["name"] == "Mix Translation"
    assert result["status"] == "failed"
    assert result["error"] is not None
    assert result["data"] == {}
