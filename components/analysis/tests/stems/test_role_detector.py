from pathlib import Path

import pytest
import soundfile as sf

from audio_analysis.stems.role_detector import detect_role
from audio_analysis.stems.types import StemRole


@pytest.mark.parametrize("filename,expected", [
    ("01_Kick.flac", StemRole.KICK),
    ("02_Bass.wav", StemRole.BASS),
    ("Snare_top.flac", StemRole.SNARE),
    ("hi-hats.wav", StemRole.HATS),
    ("Lead Vocal.flac", StemRole.VOCALS),
    ("Synth_Lead.wav", StemRole.LEAD),
    ("Pad_warm.flac", StemRole.PAD),
    ("Riser_FX.wav", StemRole.FX),
])
def test_filename_keywords(tmp_path: Path, filename: str, expected: StemRole):
    p = tmp_path / filename
    p.write_bytes(b"")
    result = detect_role(p, audio=None)
    assert result.role == expected
    assert result.confidence >= 0.8
    assert "filename" in result.evidence


def test_unknown_filename_falls_back_to_other_when_no_audio(tmp_path: Path):
    p = tmp_path / "track_07.flac"
    p.write_bytes(b"")
    result = detect_role(p, audio=None)
    assert result.role == StemRole.OTHER
    assert result.confidence < 0.5


def test_spectral_classifies_bass_when_filename_unknown(synth_stem_files):
    bass_path = synth_stem_files["bass"]
    audio, _ = sf.read(bass_path, always_2d=True)
    fake = bass_path.parent / "track_99.flac"
    if not fake.exists():
        fake.write_bytes(bass_path.read_bytes())
    result = detect_role(fake, audio=audio)
    assert result.role == StemRole.BASS
    assert "spectral" in result.evidence
