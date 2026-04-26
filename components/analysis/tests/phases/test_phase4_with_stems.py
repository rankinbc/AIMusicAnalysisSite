from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from audio_analysis.phases import phase4_stems
from audio_analysis.stems.types import StemRole


@pytest.fixture(scope="module")
def short_mix(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("mix") / "mix.wav"
    sr = 44100
    t = np.arange(2 * sr) / sr
    # Mix a kick-ish thump + bass tone
    audio = 0.3 * np.sin(2 * np.pi * 60 * t) + 0.3 * np.sin(2 * np.pi * 200 * t)
    sf.write(out, audio.astype(np.float32), sr)
    return out


def test_phase4_no_stems_unchanged(short_mix: Path):
    """Without stem_paths, the legacy spectral path runs and stems dict is empty."""
    result = phase4_stems.analyze(short_mix, stem_paths=None)
    assert "band_energy" in result
    assert "clashes" in result
    assert result["stems"] == {}


def test_phase4_with_stems_adds_per_stem_and_clash_matrix(short_mix, synth_stem_files):
    stem_paths = {StemRole(r): p for r, p in synth_stem_files.items()}
    result = phase4_stems.analyze(short_mix, stem_paths=stem_paths)
    assert result["stems"]["status"] == "ok"
    assert "per_stem" in result["stems"]
    assert "clash_matrix" in result["stems"]
    assert StemRole.BASS.value in result["stems"]["per_stem"]


def test_phase4_with_stems_handles_failure_gracefully(short_mix, tmp_path):
    bad = tmp_path / "broken.flac"
    bad.write_bytes(b"not really audio")
    result = phase4_stems.analyze(
        short_mix, stem_paths={StemRole.BASS: bad}
    )
    assert result["stems"]["status"] == "failed"
    assert "error" in result["stems"]
