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

from .role_detector import detect_role
from .types import StemProposal, StemRole

# Analyze at most this many seconds per stem — bounds cost for long files.
_MAX_SECONDS = 20.0
_AUDIO_EXT = {".wav", ".flac", ".aif", ".aiff", ".mp3", ".ogg"}


def _pick_loudest_window(audio: np.ndarray, sr: int, win_s: float) -> np.ndarray:
    """Return the most energetic ``win_s`` slice of ``audio`` (2D samples×channels).

    Stem exports are often full-arrangement length where the instrument enters late,
    so the *leading* window is frequently silence. We center analysis on the loudest
    region instead. Coarse 0.5 s blocks keep this cheap on multi-minute files.
    """
    win = int(sr * win_s)
    if win <= 0 or len(audio) <= win:
        return audio
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio
    block = max(1, int(sr * 0.5))
    nblocks = len(mono) // block
    wblocks = max(1, win // block)
    if nblocks <= wblocks:
        return audio[:win]
    energy = np.array(
        [float(np.sum(mono[i * block:(i + 1) * block] ** 2)) for i in range(nblocks)]
    )
    csum = np.concatenate([[0.0], np.cumsum(energy)])
    window_energy = csum[wblocks:] - csum[:-wblocks]  # sliding sum over wblocks
    start = int(np.argmax(window_energy)) * block
    return audio[start:start + win]


def _load_window(path: Path, sr: int = 44100, max_seconds: float = _MAX_SECONDS) -> tuple[np.ndarray, int]:
    audio, file_sr = sf.read(path, always_2d=True, dtype="float32")
    audio = _pick_loudest_window(audio, file_sr, max_seconds)
    if file_sr != sr:
        audio = librosa.resample(audio.T, orig_sr=file_sr, target_sr=sr).T
    return np.ascontiguousarray(audio, dtype=np.float32), sr


def classify_one(path: Path, name: str | None = None, sr: int = 44100) -> StemProposal:
    """Classify a single stem. Filename-first (using ``name`` — the authoritative export
    name, since on-disk paths are UUIDs), falling back to audio content. Never raises —
    failures map to OTHER.
    """
    p = Path(path)
    # ``detect_role`` is filename-first then spectral fallback; pass the real export name
    # for the keyword match, not the UUID path. Load audio for the fallback path.
    display = Path(name) if name else p
    try:
        audio, used_sr = _load_window(p, sr)
        rp = detect_role(display, audio=audio, sr=used_sr)
        return StemProposal(file=p, role=rp.role, confidence=rp.confidence, evidence=rp.evidence)
    except Exception as exc:  # noqa: BLE001 — classification must be best-effort
        # Audio unreadable — still honor an authoritative filename keyword if present.
        rp = detect_role(display)
        if rp.role is not StemRole.OTHER:
            return StemProposal(file=p, role=rp.role, confidence=rp.confidence, evidence=rp.evidence)
        return StemProposal(file=p, role=StemRole.OTHER, confidence=0.0, evidence=f"classify failed: {exc}")


def classify_stems(
    paths: list[Path], names: list[str | None] | None = None, sr: int = 44100,
) -> list[StemProposal]:
    """Classify each stem. ``names[i]`` is the authoritative export filename for ``paths[i]``
    (on-disk paths are UUIDs); when omitted, the path's own name is used.
    """
    names = names or [None] * len(paths)
    return [classify_one(Path(p), n, sr) for p, n in zip(paths, names)]


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
