from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from audio_analysis.phases import phase5_reference
from audio_analysis.stems.types import StemRole


@pytest.fixture(scope="module")
def short_mix(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("mix5") / "mix.wav"
    sr = 44100
    t = np.arange(2 * sr) / sr
    sf.write(out, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sr)
    return out


def test_phase5_with_user_and_reference_stems_emits_deltas(short_mix, synth_stem_files):
    user_stems = {StemRole(r): p for r, p in synth_stem_files.items()}
    result = phase5_reference.compare(
        short_mix,
        reference_path=str(short_mix),
        phase1_result={},
        user_stem_paths=user_stems,
        reference_stem_paths=user_stems,
    )
    assert "per_stem_reference_deltas" in result
    assert len(result["per_stem_reference_deltas"]) > 0
    assert result["stem_reference_comparison"] == "ok"


def test_phase5_without_stems_unchanged(short_mix):
    result = phase5_reference.compare(
        short_mix,
        reference_path=None,
        phase1_result={},
    )
    assert "per_stem_reference_deltas" not in result
    assert result["status"] == "skipped"


def test_phase5_user_stems_only_marks_unavailable(short_mix, synth_stem_files):
    user_stems = {StemRole(r): p for r, p in synth_stem_files.items()}
    result = phase5_reference.compare(
        short_mix,
        reference_path=None,
        phase1_result={},
        user_stem_paths=user_stems,
        reference_stem_paths=None,
    )
    assert result.get("stem_reference_comparison") == "unavailable"
