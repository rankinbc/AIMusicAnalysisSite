"""Phase 5 — Reference track comparison: feature deltas vs a reference mix.

When *genre* is supplied the output also includes a ``genre_context`` block
with preset checks (LUFS, BPM, stereo correlation) drawn from the curated
genre preset library.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

_SEVERITY_THRESHOLDS = [
    (1.0, "ok"),
    (3.0, "minor"),
    (6.0, "moderate"),
]


def _severity(delta: float) -> str:
    abs_delta = abs(delta)
    for threshold, label in _SEVERITY_THRESHOLDS:
        if abs_delta < threshold:
            return label
    return "significant"


def _build_genre_context(genre: str, phase1_result: dict) -> dict:
    """Build genre preset check block from Phase 1 metrics."""
    from ..genre_presets import get_preset

    preset = get_preset(genre)
    if preset is None:
        return {"genre": genre, "preset_name": genre, "checks": {}}

    checks: dict[str, dict] = {}

    # LUFS
    lufs = phase1_result.get("lufs", -70.0)
    diff = abs(lufs - preset.target_lufs)
    if diff > preset.lufs_tolerance * 2:
        lufs_status = "critical"
    elif diff > preset.lufs_tolerance:
        lufs_status = "warning"
    else:
        lufs_status = "ok"
    checks["lufs"] = {
        "status": lufs_status,
        "message": (
            f"LUFS {lufs:.1f} — target {preset.target_lufs:.0f} for {preset.name}"
            if lufs_status != "ok"
            else f"LUFS {lufs:.1f} on target for {preset.name}"
        ),
        "value": lufs,
        "target": preset.target_lufs,
    }

    # BPM
    bpm = phase1_result.get("bpm", 0.0)
    if preset.bpm_min <= bpm <= preset.bpm_max:
        bpm_status, bpm_msg = "ok", (
            f"BPM {bpm:.0f} in range for {preset.name} ({preset.bpm_min}–{preset.bpm_max})"
        )
    else:
        bpm_status, bpm_msg = "warning", (
            f"BPM {bpm:.0f} outside {preset.name} range ({preset.bpm_min}–{preset.bpm_max})"
        )
    checks["bpm"] = {"status": bpm_status, "message": bpm_msg, "value": bpm}

    # Stereo correlation
    corr = phase1_result.get("stereo_correlation", 1.0)
    if corr < 0:
        corr_status = "critical"
        corr_msg = f"Negative correlation {corr:.2f} — possible phase issue"
    elif corr < preset.correlation_min:
        corr_status = "warning"
        corr_msg = (
            f"Correlation {corr:.2f} too wide for {preset.name} "
            f"(min {preset.correlation_min:.2f})"
        )
    elif corr > preset.correlation_max:
        corr_status = "warning"
        corr_msg = (
            f"Correlation {corr:.2f} too narrow for {preset.name} "
            f"(max {preset.correlation_max:.2f})"
        )
    else:
        corr_status = "ok"
        corr_msg = f"Stereo width in range for {preset.name} ({corr:.2f})"
    checks["correlation"] = {"status": corr_status, "message": corr_msg, "value": corr}

    return {
        "genre": genre,
        "preset_name": preset.name,
        "checks": checks,
    }


def compare(
    wav_path: Path,
    reference_path: str | None,
    phase1_result: dict,
    progress_cb: Callable | None = None,
    genre: str | None = None,
) -> dict:
    """Compare the uploaded track against a reference track.

    Args:
        wav_path:       Path to the 44100 Hz WAV of the uploaded track.
        reference_path: Path to the reference audio file, or ``None`` to skip.
        phase1_result:  Phase 1 output for the uploaded track.
        progress_cb:    Optional ``(phase, name, pct)`` progress callback.
        genre:          Detected genre string (from Phase 2).  When supplied,
                        a ``genre_context`` block is added to the result.

    Returns:
        dict with keys: status, deltas (empty when skipped), and optionally
        genre_context when *genre* is provided.
    """
    if reference_path is None:
        result: dict = {"status": "skipped", "deltas": {}}
        if genre:
            result["genre_context"] = _build_genre_context(genre, phase1_result)
        return result

    # Run Phase 1 on the reference track to get its features
    from . import phase1_universal
    from ..converters import to_wav

    ref_wav: Path | None = None
    try:
        ref_wav = to_wav(reference_path)
        ref_result = phase1_universal.analyze(ref_wav)
    finally:
        if ref_wav is not None and ref_wav.exists():
            try:
                ref_wav.unlink()
            except OSError:
                pass

    deltas: dict[str, dict] = {}

    # LUFS delta
    lufs_delta = phase1_result.get("lufs", -70.0) - ref_result.get("lufs", -70.0)
    deltas["lufs"] = {"value": lufs_delta, "severity": _severity(lufs_delta)}

    # RMS delta
    rms_delta = phase1_result.get("rms", 0.0) - ref_result.get("rms", 0.0)
    deltas["rms"] = {"value": rms_delta, "severity": _severity(rms_delta * 20.0)}

    # Stereo correlation delta
    stereo_delta = phase1_result.get("stereo_correlation", 1.0) - ref_result.get(
        "stereo_correlation", 1.0
    )
    deltas["stereo_correlation"] = {
        "value": stereo_delta,
        "severity": _severity(stereo_delta * 10.0),
    }

    # Per-band deltas
    user_bands: dict = phase1_result.get("bands", {})
    ref_bands: dict = ref_result.get("bands", {})
    for band_name in user_bands:
        if band_name in ref_bands:
            band_delta = user_bands[band_name] - ref_bands[band_name]
            deltas[f"band_{band_name}"] = {
                "value": band_delta,
                "severity": _severity(band_delta),
            }

    logger.debug("Phase 5: computed %d deltas vs reference", len(deltas))

    result = {"status": "ok", "deltas": deltas}
    if genre:
        result["genre_context"] = _build_genre_context(genre, phase1_result)

    return result
