"""Detect stem role from filename keywords first, falling back to spectral fingerprint."""
import re
from pathlib import Path

import librosa
import numpy as np

from .types import RoleProposal, StemRole

# Custom token boundary: treat `_`, `-`, whitespace, digits, and string edges as separators.
# Standard `\b` doesn't help because `_` is a word character in regex.
_LB = r"(?:^|[\W_\d])"   # left boundary
_RB = r"(?:[\W_\d]|$)"   # right boundary

# Below this RMS a window is effectively digital silence (the noise/dither floor):
# a real-content stem sits at ~1e-2+, an empty/unused track export at ~1e-5. Forcing
# a role on silence is what produced the "everything is hats" misclassification.
_SILENCE_RMS = 1e-4


def _kw(*alternatives: str) -> re.Pattern[str]:
    body = "|".join(alternatives)
    return re.compile(rf"{_LB}(?:{body}){_RB}", re.I)


KEYWORD_PATTERNS: list[tuple[StemRole, re.Pattern[str]]] = [
    (StemRole.KICK, _kw(r"kick", r"bd", r"bass[\s_-]?drum")),
    (StemRole.SNARE, _kw(r"snare", r"sd", r"clap", r"rim(?:shot)?")),
    (StemRole.HATS, _kw(r"hi[\s_-]?hats?", r"hats?", r"hh", r"crash", r"ride", r"cymbals?")),
    (StemRole.DRUMS, _kw(r"drums?", r"perc(?:ussion)?", r"beat", r"toms?")),
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


def _to_mono(audio: np.ndarray) -> np.ndarray:
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio
    return np.ascontiguousarray(mono, dtype=np.float32)


def _features(audio: np.ndarray, sr: int) -> dict[str, float]:
    """DSP features for content-based role classification (import-light: librosa only)."""
    mono = _to_mono(audio)
    n = len(mono)
    dur = n / sr if sr else 0.0
    rms = float(np.sqrt(np.mean(mono ** 2)) + 1e-12)
    peak = float(np.max(np.abs(mono)) + 1e-12)
    crest = peak / rms
    try:
        zcr = float(librosa.feature.zero_crossing_rate(mono)[0].mean())
    except Exception:
        zcr = 0.0
    try:
        centroid = float(librosa.feature.spectral_centroid(y=mono, sr=sr).mean())
    except Exception:
        centroid = 0.0
    try:
        harm, perc = librosa.effects.hpss(mono)
        pe, he = float(np.sum(perc ** 2)), float(np.sum(harm ** 2))
        perc_ratio = pe / (pe + he + 1e-12)
    except Exception:
        perc_ratio = 0.0
    try:
        onsets = librosa.onset.onset_detect(y=mono, sr=sr, units="frames")
        onset_rate = (len(onsets) / dur) if dur > 0 else 0.0
    except Exception:
        onset_rate = 0.0
    return {
        "crest": crest, "zcr": zcr, "centroid": centroid,
        "perc_ratio": perc_ratio, "onset_rate": onset_rate,
    }


def _spectral_classify(audio: np.ndarray, sr: int = 44100) -> RoleProposal:
    """Content-based classifier: band-energy distribution + transient/tonal features.

    Ordered rules; the first strong match wins. Distinguishes percussive low-end
    (kick) from sustained low-end (bass) via onset rate + percussive ratio + crest —
    the single most important split for producers.
    """
    # Silence guard: a near-silent window has no instrument to fingerprint — its flat
    # noise floor spreads across the wide high-frequency bands and would otherwise be
    # misread as "hats". Return OTHER instead of fabricating a confident role.
    mono_guard = audio.mean(axis=1) if audio.ndim == 2 else audio
    rms = float(np.sqrt(np.mean(mono_guard.astype(np.float64) ** 2))) if mono_guard.size else 0.0
    if rms < _SILENCE_RMS:
        return RoleProposal(StemRole.OTHER, 0.2, f"spectral: near-silent (rms {rms:.5f})")
    r = _band_energy_ratios(audio, sr)
    f = _features(audio, sr)
    low = r["sub"] + r["bass"]
    high = r["presence"] + r["air"]
    mids = r["low_mid"] + r["mid"] + r["high_mid"]
    # perc_ratio (HPSS) + crest are reliable transient indicators; onset_rate is NOT
    # trustworthy on sustained tones (a pure sine reports spurious onsets), so it is
    # used only for human-readable evidence, never as a gate.
    percussive = f["perc_ratio"] > 0.45 or f["crest"] > 5.0
    ev = f"perc {f['perc_ratio']:.2f}, crest {f['crest']:.1f}, zcr {f['zcr']:.2f}"

    # Hats: high-band dominant, noisy, percussive.
    if high > 0.45 and f["zcr"] > 0.10 and percussive:
        return RoleProposal(StemRole.HATS, 0.7, f"spectral: high-band {high:.2f}, {ev}")

    # Kick: low-end dominant AND percussive (vs sustained bass).
    if low > 0.5 and percussive:
        return RoleProposal(StemRole.KICK, 0.7, f"spectral: low-band {low:.2f} + transient ({ev})")

    # Bass: low-end dominant AND sustained.
    if low > 0.5:
        return RoleProposal(StemRole.BASS, 0.7, f"spectral: low-band {low:.2f}, sustained ({ev})")

    # Snare: mid / high-mid energy, percussive, broadband.
    if (r["mid"] + r["high_mid"]) > 0.35 and percussive and f["zcr"] > 0.05:
        return RoleProposal(StemRole.SNARE, 0.6, f"spectral: mid-band percussive ({ev})")

    # Drums (full bus): broadband percussive with energy in both low and mids.
    if percussive and low > 0.2 and mids > 0.2:
        return RoleProposal(StemRole.DRUMS, 0.55, f"spectral: broadband percussive ({ev})")

    # Vocals: mid-dominant, harmonic, sustained.
    if mids > 0.4 and not percussive:
        return RoleProposal(StemRole.VOCALS, 0.55, f"spectral: mid-band {mids:.2f}, harmonic ({ev})")

    # Lead vs Pad: mid/high harmonic & sustained. Pad = very steady (low crest).
    if (r["mid"] + r["high_mid"]) > 0.35 and not percussive:
        if f["crest"] < 2.0:
            return RoleProposal(StemRole.PAD, 0.5, f"spectral: sustained mid/high, low crest {f['crest']:.1f}")
        return RoleProposal(StemRole.LEAD, 0.5, f"spectral: mid/high harmonic, centroid {f['centroid']:.0f}Hz")

    # FX: noisy / atonal.
    if f["zcr"] > 0.15:
        return RoleProposal(StemRole.FX, 0.4, f"spectral: noisy/atonal ({ev})")

    return RoleProposal(StemRole.OTHER, 0.3, "spectral: no clear dominant band")


def detect_role(
    file_path: Path, audio: np.ndarray | None = None, sr: int = 44100,
) -> RoleProposal:
    """Filename-first role detection. Content-based spectral fallback when audio is provided."""
    proposal = _filename_match(file_path.stem)
    if proposal is not None:
        return proposal
    if audio is not None:
        return _spectral_classify(audio, sr)
    return RoleProposal(StemRole.OTHER, 0.2, "no filename match, no audio provided")
