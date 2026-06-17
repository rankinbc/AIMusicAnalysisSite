"""Stem classifier regression tests.

Covers the three bugs behind the "everything is hats" misclassification:
  1. fixed leading-window landing on silence  -> loudest-window selection
  2. silence forced into a confident role       -> silence guard
  3. authoritative export name ignored          -> filename-first via name=
"""
from __future__ import annotations

import numpy as np
import soundfile as sf

from audio_analysis.stems.classify import _pick_loudest_window, classify_one
from audio_analysis.stems.role_detector import _spectral_classify, detect_role
from audio_analysis.stems.types import StemRole


# ── window selection ─────────────────────────────────────────────────────────

def test_pick_loudest_window_skips_leading_silence():
    sr = 1000
    audio = np.zeros((10_000, 1), dtype=np.float32)
    audio[6_000:8_000, 0] = 0.8  # energy only in a late 2 s region
    win = _pick_loudest_window(audio, sr, win_s=2.0)
    assert len(win) == 2_000
    assert float(np.sqrt(np.mean(win**2))) > 0.5  # grabbed the loud region, not silence


def test_pick_loudest_window_returns_whole_when_short():
    sr = 1000
    audio = np.ones((500, 1), dtype=np.float32)
    assert _pick_loudest_window(audio, sr, win_s=2.0).shape == (500, 1)


# ── silence guard ────────────────────────────────────────────────────────────

def test_spectral_classify_silence_is_other():
    sr = 44_100
    near_silent = (np.random.RandomState(0).randn(sr, 1) * 1e-6).astype(np.float32)
    rp = _spectral_classify(near_silent, sr)
    assert rp.role is StemRole.OTHER
    assert "near-silent" in rp.evidence


# ── filename-first keywords ──────────────────────────────────────────────────

def test_keyword_additions():
    from pathlib import Path
    assert detect_role(Path("Main Clap.wav")).role is StemRole.SNARE
    assert detect_role(Path("Crash 1.wav")).role is StemRole.HATS
    assert detect_role(Path("Floor Tom.wav")).role is StemRole.DRUMS


# ── classify_one integration ─────────────────────────────────────────────────

def _write(tmp_path, name, signal, sr=44_100):
    p = tmp_path / name
    sf.write(p, signal.astype(np.float32), sr)
    return p


def test_filename_wins_over_audio(tmp_path):
    # On-disk name is a UUID; the authoritative export name says "Kick" -> KICK,
    # even though the audio is high-frequency noise (would spectrally read as hats).
    sr = 44_100
    noise = np.random.RandomState(1).randn(sr, 1).astype(np.float32) * 0.3
    p = _write(tmp_path, "0200a6ab-uuid.wav", noise, sr)
    prop = classify_one(p, name="23_2 Kick.wav", sr=sr)
    assert prop.role is StemRole.KICK
    assert prop.confidence >= 0.8


def test_spectral_fallback_after_leading_silence(tmp_path):
    # Non-matching name -> spectral path. 25 s silence then a low sustained sine:
    # the loudest-window must skip the silence and classify it as low-end (bass).
    sr = 44_100
    t = np.arange(5 * sr) / sr
    tone = 0.3 * np.sin(2 * np.pi * 55.0 * t)
    signal = np.concatenate([np.zeros(25 * sr), tone]).astype(np.float32)[:, None]
    p = _write(tmp_path, "synth-uuid.wav", signal, sr)
    prop = classify_one(p, name="23_2 14-MonoPoly.wav", sr=sr)
    assert prop.role in (StemRole.BASS, StemRole.KICK)  # low-end, NOT hats/other
    assert prop.role is not StemRole.OTHER
