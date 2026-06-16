"""Audio-content stem classification + a standalone tuning CLI.

Public entry: ``classify_stems(paths) -> list[StemProposal]``. Content-based — it
classifies by the stem's *sound*, not its filename (per the bulk-upload design).
Import-light: librosa / soundfile / numpy only — NEVER demucs/torch/openl3 — so it
stays fast enough to run at upload time over many stems.

Tuning CLI (decoupled from run_pipeline):
    python -m audio_analysis.stems.classify <dir-or-files...>
prints `<filename> <role> <confidence> <evidence>` per file so the feature
thresholds in ``role_detector`` can be iterated against real stems.
"""
from __future__ import annotations

import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from .role_detector import _spectral_classify
from .types import StemProposal, StemRole

# Analyze at most this many seconds per stem — bounds cost for long files.
_MAX_SECONDS = 20.0
_AUDIO_EXT = {".wav", ".flac", ".aif", ".aiff", ".mp3", ".ogg"}


def _load_window(path: Path, sr: int = 44100, max_seconds: float = _MAX_SECONDS) -> tuple[np.ndarray, int]:
    audio, file_sr = sf.read(path, always_2d=True, dtype="float32")
    if max_seconds and len(audio) > int(file_sr * max_seconds):
        audio = audio[: int(file_sr * max_seconds)]
    if file_sr != sr:
        audio = librosa.resample(audio.T, orig_sr=file_sr, target_sr=sr).T
    return np.ascontiguousarray(audio, dtype=np.float32), sr


def classify_one(path: Path, sr: int = 44100) -> StemProposal:
    """Classify a single stem by audio content. Never raises — failures map to OTHER."""
    p = Path(path)
    try:
        audio, used_sr = _load_window(p, sr)
        rp = _spectral_classify(audio, used_sr)
        return StemProposal(file=p, role=rp.role, confidence=rp.confidence, evidence=rp.evidence)
    except Exception as exc:  # noqa: BLE001 — classification must be best-effort
        return StemProposal(file=p, role=StemRole.OTHER, confidence=0.0, evidence=f"classify failed: {exc}")


def classify_stems(paths: list[Path], sr: int = 44100) -> list[StemProposal]:
    """Classify each stem by audio content. Returns one StemProposal per input path."""
    return [classify_one(Path(p), sr) for p in paths]


def _gather(args: list[str]) -> list[Path]:
    files: list[Path] = []
    for a in args:
        p = Path(a)
        if p.is_dir():
            files += sorted(x for x in p.iterdir() if x.suffix.lower() in _AUDIO_EXT)
        elif p.exists():
            files.append(p)
    return files


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print("usage: python -m audio_analysis.stems.classify <dir-or-files...>")
        return 2
    files = _gather(argv)
    if not files:
        print("no audio files found")
        return 1
    for prop in classify_stems(files):
        print(f"{prop.file.name:40.40} {prop.role.value:7} {prop.confidence:.2f}  {prop.evidence}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
