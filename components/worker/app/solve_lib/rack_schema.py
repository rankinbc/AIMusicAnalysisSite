"""Rack manifest mirror — kept in sync with the Listen rack's
``components/frontend-spectr-v2/src/features/listen-rack/data.ts``.

The frontend owns the canonical schema; this is a hand-mirror the preset
compiler uses to translate ``DspOp`` (snake_case) into rack module params
(camelCase). When data.ts changes the order/bands/param keys, update here.
"""
from __future__ import annotations

# Canonical signal-chain order (data.ts RACK_MANIFEST order). Never reordered.
ORDER: list[str] = [
    "djfilter", "eq", "gate", "comp", "sat", "bitcrusher", "ms",
    "pan", "tremolo", "delay", "reverb", "limiter", "trim",
]

# The eq module's 8 freq-assignable band slots (default centers).
EQ_BANDS: list[float] = [60.0, 170.0, 350.0, 700.0, 1400.0, 3500.0, 7000.0, 14000.0]


def nearest_band_slot(freq_hz: float) -> int:
    """Index of the eq band slot whose default center is closest to *freq_hz*."""
    return min(range(len(EQ_BANDS)), key=lambda i: abs(EQ_BANDS[i] - freq_hz))


# DspOp.type -> rack module id. Types absent here can't live on a master rack
# (sidechain, multiband_compressor) -> the compiler diverts them to advice.
DSPTYPE_TO_MODULE: dict[str, str] = {
    "peaking_eq": "eq",
    "low_shelf": "eq",
    "high_shelf": "eq",
    "high_pass": "eq",
    "low_pass": "eq",
    "compressor": "comp",
    "limiter": "limiter",
    "stereo_width": "ms",
    "gain": "trim",
}

# Per-module snake_case (DspOp param) -> camelCase (rack module param).
PARAM_MAP: dict[str, dict[str, str]] = {
    "comp": {
        "threshold_db": "thresholdDb", "ratio": "ratio", "attack_ms": "attackMs",
        "release_ms": "releaseMs", "knee_db": "kneeDb", "makeup_gain_db": "makeupDb",
    },
    "limiter": {
        "ceiling_db": "ceilingDb", "release_ms": "releaseMs", "lookahead_ms": "lookaheadMs",
    },
    "trim": {"gain_db": "gainDb"},
    # ms is special-cased in the compiler (width_pct -> width as a ratio).
}

# DspOp eq-family type -> rack eq band `type` value.
EQ_BAND_TYPE: dict[str, str] = {
    "peaking_eq": "peaking",
    "low_shelf": "lowshelf",
    "high_shelf": "highshelf",
    "high_pass": "highpass",
    "low_pass": "lowpass",
}
