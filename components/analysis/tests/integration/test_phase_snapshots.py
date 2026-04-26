"""Snapshot regression tests for phases 4 and 5 with and without stems.

Set UPDATE_SNAPSHOTS=1 to regenerate the golden files; reviewer eyeballs
the diff before merging.
"""
import copy
import json
import os
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from audio_analysis.phases import phase4_stems, phase5_reference
from audio_analysis.stems.types import StemRole

GOLDEN_DIR = Path(__file__).parent / "golden"
UPDATE = bool(os.environ.get("UPDATE_SNAPSHOTS"))

# Fields removed from snapshots because they vary run-to-run or across
# floating-point implementations. Pure-data fields are kept.
_VOLATILE_KEYS = {"timestamp", "duration_ms", "task_id", "absolute_path"}
# Floats are rounded to this many decimals to absorb tiny FP noise.
_FLOAT_PRECISION = 2


def _normalize(value):
    if isinstance(value, dict):
        return {
            k: _normalize(v)
            for k, v in value.items()
            if k not in _VOLATILE_KEYS
        }
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    if isinstance(value, float):
        if value != value or value == float("inf") or value == float("-inf"):
            return str(value)
        return round(value, _FLOAT_PRECISION)
    return value


def _short_mix(tmp_path: Path) -> Path:
    out = tmp_path / "mix.wav"
    sr = 44100
    t = np.arange(2 * sr) / sr
    audio = 0.3 * np.sin(2 * np.pi * 110 * t) + 0.2 * np.sin(2 * np.pi * 60 * t)
    sf.write(out, audio.astype(np.float32), sr)
    return out


def _snapshot(name: str, actual: dict) -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    golden_path = GOLDEN_DIR / name
    if UPDATE or not golden_path.exists():
        golden_path.write_text(json.dumps(actual, indent=2, sort_keys=True))
        pytest.skip(f"snapshot updated: {golden_path}")
    expected = json.loads(golden_path.read_text())
    assert actual == expected, (
        f"snapshot drift in {name}; rerun with UPDATE_SNAPSHOTS=1 "
        f"and inspect the diff."
    )


def test_phase4_no_stems_snapshot(tmp_path: Path):
    mix = _short_mix(tmp_path)
    result = phase4_stems.analyze(mix, stem_paths=None)
    _snapshot("phase4_no_stems.json", _normalize(result))


def test_phase4_with_stems_snapshot(tmp_path: Path, synth_stem_files):
    mix = _short_mix(tmp_path)
    stem_paths = {StemRole(r): p for r, p in synth_stem_files.items()}
    result = phase4_stems.analyze(mix, stem_paths=stem_paths)
    _snapshot("phase4_with_stems.json", _normalize(result))


def test_phase5_with_stems_snapshot(tmp_path: Path, synth_stem_files):
    mix = _short_mix(tmp_path)
    stem_paths = {StemRole(r): p for r, p in synth_stem_files.items()}
    result = phase5_reference.compare(
        mix,
        reference_path=str(mix),
        phase1_result={},
        user_stem_paths=stem_paths,
        reference_stem_paths=stem_paths,
    )
    # Strip volatile reference-vs-mix deltas that depend on exact phase1 output
    cleaned = copy.deepcopy(result)
    cleaned.pop("deltas", None)
    _snapshot("phase5_with_stems.json", _normalize(cleaned))
