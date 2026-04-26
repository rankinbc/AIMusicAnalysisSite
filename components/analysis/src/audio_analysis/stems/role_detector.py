"""Detect stem role from filename keywords first, falling back to spectral fingerprint."""
import re
from pathlib import Path

import numpy as np

from .types import RoleProposal, StemRole

# Custom token boundary: treat `_`, `-`, whitespace, digits, and string edges as separators.
# Standard `\b` doesn't help because `_` is a word character in regex.
_LB = r"(?:^|[\W_\d])"   # left boundary
_RB = r"(?:[\W_\d]|$)"   # right boundary


def _kw(*alternatives: str) -> re.Pattern[str]:
    body = "|".join(alternatives)
    return re.compile(rf"{_LB}(?:{body}){_RB}", re.I)


KEYWORD_PATTERNS: list[tuple[StemRole, re.Pattern[str]]] = [
    (StemRole.KICK, _kw(r"kick", r"bd", r"bass[\s_-]?drum")),
    (StemRole.SNARE, _kw(r"snare", r"sd")),
    (StemRole.HATS, _kw(r"hi[\s_-]?hats?", r"hats?", r"hh")),
    (StemRole.DRUMS, _kw(r"drums?", r"perc(?:ussion)?", r"beat")),
    (StemRole.BASS, _kw(r"bass(?!\s?drum)", r"sub", r"808")),
    (StemRole.VOCALS, _kw(r"vox", r"vocals?", r"lead\s?vox", r"singers?")),
    (StemRole.LEAD, _kw(r"lead", r"melody")),
    (StemRole.PAD, _kw(r"pad", r"strings?", r"atmos\w*")),
    (StemRole.FX, _kw(r"fx", r"riser", r"swoosh", r"impact", r"sfx")),
]


def _filename_match(stem: str) -> RoleProposal | None:
    for role, pattern in KEYWORD_PATTERNS:
        if pattern.search(stem):
            return RoleProposal(role=role, confidence=0.9, evidence=f"filename match: {pattern.pattern!r}")
    return None


def _band_energy_ratios(audio: np.ndarray, sr: int = 44100) -> dict[str, float]:
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    total = float((spec ** 2).sum() + 1e-12)
    bands = {
        "sub": (20, 60), "bass": (60, 200), "low_mid": (200, 600),
        "mid": (600, 2000), "high_mid": (2000, 6000),
        "presence": (6000, 12000), "air": (12000, 20000),
    }
    return {
        name: float((spec[(freqs >= lo) & (freqs < hi)] ** 2).sum()) / total
        for name, (lo, hi) in bands.items()
    }


def _spectral_classify(audio: np.ndarray) -> RoleProposal:
    r = _band_energy_ratios(audio)
    if r["sub"] + r["bass"] > 0.55 and r["air"] < 0.05:
        return RoleProposal(StemRole.BASS, 0.7, "spectral: low-band dominant")
    if r["high_mid"] + r["presence"] + r["air"] > 0.55 and r["sub"] + r["bass"] < 0.10:
        return RoleProposal(StemRole.HATS, 0.6, "spectral: high-band dominant")
    if 0.40 < r["mid"] + r["low_mid"] < 0.75 and r["sub"] < 0.10:
        return RoleProposal(StemRole.VOCALS, 0.55, "spectral: mid-band dominant")
    return RoleProposal(StemRole.OTHER, 0.3, "spectral: no clear dominant band")


def detect_role(file_path: Path, audio: np.ndarray | None = None) -> RoleProposal:
    """Filename-first role detection. Spectral fallback when audio is provided."""
    proposal = _filename_match(file_path.stem)
    if proposal is not None:
        return proposal
    if audio is not None:
        return _spectral_classify(audio)
    return RoleProposal(StemRole.OTHER, 0.2, "no filename match, no audio provided")
