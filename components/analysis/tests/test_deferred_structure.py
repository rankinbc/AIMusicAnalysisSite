"""Deferred (background) structure detection: the defer_structure knob and the
detect_structure_and_rescore fill-in helper."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
import soundfile as sf

from audio_analysis import detect_structure_and_rescore, run_pipeline
from audio_analysis.phases import phase1_universal
from audio_analysis.structure.docker_allin1 import (
    Allin1Result,
    Allin1Segment,
    Allin1Unavailable,
    DockerAllin1,
)


def _wav(tmp_path: Path, secs: float = 8.0) -> Path:
    sr = 44100
    t = np.arange(int(secs * sr)) / sr
    audio = 0.3 * np.sin(2 * np.pi * 110 * t) + 0.2 * np.sin(2 * np.pi * 55 * t)
    out = tmp_path / "mix.wav"
    sf.write(out, audio.astype(np.float32), sr)
    return out


def _no_demucs():
    return patch("audio_analysis.phases.phase4_stems.get_model", return_value=None)


# ── T1: defer_structure ────────────────────────────────────────────────────

def test_phase1_defer_skips_detection(tmp_path):
    wav = _wav(tmp_path)
    # If defer worked, _detect_structure is never called — make it explode if it is.
    with patch.object(
        phase1_universal, "_detect_structure", side_effect=AssertionError("should not run")
    ):
        data = phase1_universal.analyze(wav, defer_structure=True)
    st = data["structure"]
    assert st["deferred"] is True
    assert st["available"] is False
    assert st["segments"] == []


def test_run_pipeline_defer_marks_phase7_pending(tmp_path):
    wav = _wav(tmp_path)
    with _no_demucs():
        result = run_pipeline(str(wav), defer_structure=True)
    phase7 = next(p["data"] for p in result["phases"] if p["phase"] == 7)
    assert phase7["arrangement_status"] == "pending"
    assert phase7["grade"] == "…"


# ── T2: detect_structure_and_rescore ───────────────────────────────────────

@pytest.mark.uses_docker_wrapper
def test_rescore_fills_in_structure(tmp_path):
    wav = _wav(tmp_path)
    with _no_demucs():
        prior = run_pipeline(str(wav), defer_structure=True)

    fake = Allin1Result(
        bpm=128.0,
        beats=[],
        downbeats=[],
        segments=[
            Allin1Segment("intro", 0.0, 60.0),
            Allin1Segment("drop", 60.0, 120.0),
            Allin1Segment("breakdown", 120.0, 150.0),
            Allin1Segment("outro", 150.0, 180.0),
        ],
    )
    with _no_demucs(), patch.object(DockerAllin1, "analyze", lambda self, p, **k: fake):
        merged = detect_structure_and_rescore(str(wav), prior)

    phase1 = next(p["data"] for p in merged["phases"] if p["phase"] == 1)
    phase7 = next(p["data"] for p in merged["phases"] if p["phase"] == 7)
    assert phase1["structure"]["available"] is True
    assert phase1["structure"].get("deferred") is not True
    assert phase7["arrangement_status"] == "scored"
    assert phase7["grade"] in {"A", "B", "C", "D", "F"}  # a real grade, not "…"/"N/A"


@pytest.mark.uses_docker_wrapper
def test_rescore_unavailable_is_not_assessed(tmp_path):
    wav = _wav(tmp_path)
    with _no_demucs():
        prior = run_pipeline(str(wav), defer_structure=True)

    def _boom(self, p, **k):
        raise Allin1Unavailable("image not found")

    with _no_demucs(), patch.object(DockerAllin1, "analyze", _boom):
        merged = detect_structure_and_rescore(str(wav), prior)

    phase1 = next(p["data"] for p in merged["phases"] if p["phase"] == 1)
    phase7 = next(p["data"] for p in merged["phases"] if p["phase"] == 7)
    assert phase1["structure"]["available"] is False
    assert phase1["structure"].get("deferred") is not True  # resolved, not pending
    assert phase7["arrangement_status"] == "unavailable"
    assert phase7["grade"] == "N/A"
