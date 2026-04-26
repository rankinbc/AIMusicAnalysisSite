from pathlib import Path

import numpy as np
import soundfile as sf

from audio_analysis.stems.analyzer import analyze
from audio_analysis.stems.types import FreqBand, StemRole


def test_analyze_returns_per_stem_metrics(synth_stem_files: dict[str, Path]):
    paths = {StemRole(role): p for role, p in synth_stem_files.items()}
    result = analyze(paths)
    assert set(result.per_stem.keys()) == {StemRole.KICK, StemRole.BASS, StemRole.HATS, StemRole.VOCALS}
    bass = result.per_stem[StemRole.BASS]
    band_max = max(bass.band_energy_db, key=bass.band_energy_db.get)
    assert band_max in (FreqBand.BASS, FreqBand.LOW_MID)


def test_analyze_detects_clash_between_kick_and_bass(synth_stem_files):
    paths = {StemRole(role): p for role, p in synth_stem_files.items()}
    result = analyze(paths)
    pairs = {(c.stem_a, c.stem_b) for c in result.clash_matrix}
    pairs |= {(c.stem_b, c.stem_a) for c in result.clash_matrix}
    assert (StemRole.KICK, StemRole.BASS) in pairs


def test_analyze_handles_mono_file(tmp_path: Path):
    p = tmp_path / "mono_bass.flac"
    sf.write(p, np.sin(2 * np.pi * 110 * np.arange(44100) / 44100).astype(np.float32), 44100)
    result = analyze({StemRole.BASS: p})
    assert result.per_stem[StemRole.BASS].is_mono is True
    assert result.per_stem[StemRole.BASS].stereo_width == 0.0
