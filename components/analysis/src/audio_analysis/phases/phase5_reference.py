"""Phase 5 — Reference track comparison: feature deltas vs a reference mix."""

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


def compare(
    wav_path: Path,
    reference_path: str | None,
    phase1_result: dict,
    progress_cb: Callable | None = None,
) -> dict:
    """Compare the uploaded track against a reference track.

    Args:
        wav_path:      Path to the 44100 Hz WAV of the uploaded track.
        reference_path: Path to the reference audio file, or ``None`` to skip.
        phase1_result: Phase 1 output for the uploaded track.
        progress_cb:   Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: status, deltas (empty when skipped).
    """
    if reference_path is None:
        return {"status": "skipped", "deltas": {}}

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
    deltas["rms"] = {"value": rms_delta, "severity": _severity(rms_delta * 20.0)}  # scale

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

    return {"status": "ok", "deltas": deltas}
