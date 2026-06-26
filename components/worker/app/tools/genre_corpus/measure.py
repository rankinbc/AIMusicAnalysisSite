"""Measure one reference track through phase1 — the SAME DSP the rule engine reads,
so a proposed threshold is directly comparable to what a rule will see in
production (no measurement drift).

``audio_analysis`` (heavy DSP) is imported lazily inside the default analyze fn, so
this module imports cleanly without it and ``measure_track`` is unit-testable with an
injected ``analyze_fn``.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

AnalyzeFn = Callable[[Path], dict[str, Any]]


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


def _extract(p1: dict[str, Any]) -> dict[str, float]:
    """Pull the scalar metrics we tune genre profiles from out of a phase1 result."""
    transients = p1.get("transients") or {}
    bands = p1.get("bands") or {}
    lufs = _num(p1.get("lufs"))
    true_peak = _num(p1.get("true_peak_db"))
    short_term = _num(p1.get("short_term_max_lufs"))

    out: dict[str, float | None] = {
        "lufs": lufs,
        "true_peak_db": true_peak,
        "crest_factor": _num(p1.get("crest_factor")),
        "loudness_range_lu": _num(p1.get("loudness_range_lu")),
        "bpm": _num(p1.get("bpm")),
        "stereo_width": _num(p1.get("stereo_width")),
        "mono_compatibility": _num(p1.get("mono_compatibility")),
        "spectral_centroid_hz": _num(p1.get("spectral_centroid_hz")),
        "avg_transient_strength": _num(transients.get("avg_transient_strength")),
        # band energies (dB) — reported for the qualitative spectral_tilt hints.
        "band_low_mid": _num(bands.get("low_mid")),
        "band_upper_mid": _num(bands.get("upper_mid")),
        "band_air": _num(bands.get("air")),
    }
    # Derived relationships (the same the new rules read).
    if lufs is not None and true_peak is not None:
        out["plr"] = true_peak - lufs                    # peak-to-loudness ratio
    if lufs is not None and short_term is not None:
        out["st_spread"] = short_term - lufs             # short-term-over-integrated
    return {k: v for k, v in out.items() if v is not None}


def _default_analyze(path: Path) -> dict[str, Any]:
    # Lazy heavy import — keeps this module importable (and tests runnable) without
    # the audio_analysis stack. defer_structure=True skips the slow allin1 step.
    from audio_analysis.phases import phase1_universal  # noqa: PLC0415
    return phase1_universal.analyze(path, defer_structure=True)


def measure_track(path: str | Path, *, analyze_fn: AnalyzeFn | None = None) -> dict[str, float]:
    """phase1-measure one audio file → the scalar metrics we tune from.

    ``analyze_fn`` is injectable for tests; the default runs ``audio_analysis``
    phase1 (deferring structure detection). librosa resamples any input to 44100 Hz.
    """
    fn = analyze_fn or _default_analyze
    return _extract(fn(Path(path)))
