"""Phase 9 — Mix Translation: will the mix survive phones, headphones, mono?

Wraps the vendored :class:`SpatialAnalyzer` (3D spatial, surround/mono, playback
optimization). Loads the WAV once and fans out to all three analysis modes. The
analyzer is the bedroom-producer headline feature: it answers "does my mix hold
up outside my room?"
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path
from typing import Callable

import librosa
import numpy as np

from audio_analysis.analyzers import SpatialAnalyzer

logger = logging.getLogger(__name__)


def _to_native(obj):
    """Coerce numpy scalars to native Python types so the result is JSON-safe.

    ``dataclasses.asdict`` preserves whatever the analyzer produced — e.g.
    ``crossfeed_safe`` is a ``numpy.bool_`` from a comparison — and the worker
    serializes this dict straight into a Postgres JSONB column, where numpy
    scalars raise ``TypeError``.
    """
    if isinstance(obj, dict):
        return {k: _to_native(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_native(v) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    return obj


def analyze(wav_path: Path, progress_cb: Callable | None = None) -> dict:
    """Run mix-translation analysis on *wav_path*.

    Args:
        wav_path:    Path to a 44100 Hz WAV file.
        progress_cb: Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys ``spatial`` (height/depth/width consistency), ``surround``
        (mono compatibility, phase coherence, Atmos readiness) and ``playback``
        (headphone/speaker scores, crossfeed safety, bass translation). Each
        sub-dict carries an ``analysis`` list of human-readable notes.
    """
    # librosa returns (channels, samples) for stereo, 1-D for a mono source.
    # CRITICAL: do NOT downmix to mono — the spatial/playback metrics
    # (mono_compatibility, phase, crossfeed) only mean anything on the stereo
    # array. The analyzer self-handles a true-mono (1-D) input via vstack, so we
    # feed librosa's output through unchanged — but collapse a degenerate
    # (1, N) into 1-D so the analyzer's mono branch (which keys off ndim==1)
    # triggers instead of mis-binding the right channel to the whole array.
    y, sr = librosa.load(str(wav_path), sr=44100, mono=False)
    sr = int(sr)
    if y.ndim == 2 and y.shape[0] == 1:
        y = y[0]

    analyzer = SpatialAnalyzer()
    spatial = analyzer.analyze_3d(y, sr)
    surround = analyzer.analyze_surround(y, sr)
    playback = analyzer.analyze_playback(y, sr)

    return _to_native({
        "spatial": asdict(spatial),
        "surround": asdict(surround),
        "playback": asdict(playback),
    })
