import json
import os
import time
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
import soundfile as sf

from audio_analysis.reference_library.pre_demucs import process_reference_library
from audio_analysis.stems.types import StemRole


def _write_short_wav(path: Path) -> None:
    sr = 44100
    sf.write(path, (0.2 * np.sin(2 * np.pi * 220 * np.arange(sr) / sr)).astype(np.float32), sr)


def test_skips_when_cache_is_newer(tmp_path: Path):
    src = tmp_path / "lib" / "track1.wav"
    src.parent.mkdir()
    _write_short_wav(src)
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    cache = cache_dir / "track1.stems.json"
    cache.write_text("{}")
    os.utime(cache, (time.time() + 10, time.time() + 10))

    with patch("audio_analysis.reference_library.pre_demucs._run_demucs") as mock_demucs:
        process_reference_library(library_dir=src.parent, cache_dir=cache_dir)
    mock_demucs.assert_not_called()


def test_processes_when_cache_missing(tmp_path: Path, synth_stem_files):
    src = tmp_path / "lib" / "track1.wav"
    src.parent.mkdir()
    _write_short_wav(src)
    cache_dir = tmp_path / "cache"

    fake_separated = {
        StemRole.BASS: synth_stem_files["bass"],
        StemRole.DRUMS: synth_stem_files["kick"],
    }
    with patch(
        "audio_analysis.reference_library.pre_demucs._run_demucs",
        return_value=fake_separated,
    ) as mock_demucs:
        process_reference_library(library_dir=src.parent, cache_dir=cache_dir)
    mock_demucs.assert_called_once_with(src)
    out_file = cache_dir / "track1.stems.json"
    assert out_file.exists()
    payload = json.loads(out_file.read_text())
    assert "per_stem" in payload
    assert "bass" in payload["per_stem"]
