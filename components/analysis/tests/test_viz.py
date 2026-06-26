"""Tests for the server-side result image renderer (audio_analysis.viz)."""
from __future__ import annotations

import sys

import numpy as np
import pytest
import soundfile as sf

from audio_analysis import viz


def _is_webp(data: bytes) -> bool:
    # WebP container: "RIFF" <4-byte size> "WEBP".
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def _write_tone(path, *, seconds: float = 3.0, sr: int = 44100, stereo: bool = False) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    mono = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    data = np.stack([mono, mono * 0.8], axis=1) if stereo else mono
    sf.write(str(path), data, sr)


def test_returns_two_webp_keys(tmp_path):
    wav = tmp_path / "tone.wav"
    _write_tone(wav)
    images = viz.render_analysis_images(str(wav))
    assert set(images) == {"spectrogram", "waveform"}
    assert _is_webp(images["spectrogram"])
    assert _is_webp(images["waveform"])


def test_size_bounded(tmp_path):
    wav = tmp_path / "tone.wav"
    _write_tone(wav, seconds=10.0)
    images = viz.render_analysis_images(str(wav))
    assert len(images["spectrogram"]) < 300_000
    assert len(images["waveform"]) < 300_000


def test_stereo_input(tmp_path):
    wav = tmp_path / "stereo.wav"
    _write_tone(wav, stereo=True)
    images = viz.render_analysis_images(str(wav))
    assert _is_webp(images["spectrogram"])
    assert _is_webp(images["waveform"])


def test_silent_input(tmp_path):
    wav = tmp_path / "silent.wav"
    sf.write(str(wav), np.zeros(44100, dtype=np.float32), 44100)
    images = viz.render_analysis_images(str(wav))
    # No div-by-zero; both still valid WebP.
    assert _is_webp(images["spectrogram"])
    assert _is_webp(images["waveform"])


def test_empty_signal_renders():
    assert _is_webp(viz.render_spectrogram(np.zeros(0, dtype=np.float32), 22050))
    assert _is_webp(viz.render_waveform(np.zeros(0, dtype=np.float32)))


def test_no_matplotlib():
    # The whole point of the LUT approach: never pull matplotlib into the worker.
    assert "matplotlib" not in sys.modules


def test_lut_shape():
    assert viz._MAGMA_LUT.shape == (256, 3)
    assert viz._MAGMA_LUT.dtype == np.uint8


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
