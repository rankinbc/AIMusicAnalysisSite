"""Phase 4 — Stem separation via Demucs and frequency clash detection.

NOTE: Stem separation takes 10-20 minutes CPU for a 5-minute track.
Worker timeout must be set accordingly.  Temp stem files are cleaned by
the TemporaryDirectory context manager — no manual cleanup required here.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Callable

import librosa
import numpy as np

from ..models import get_model

logger = logging.getLogger(__name__)


def analyze(wav_path: Path, progress_cb: Callable | None = None) -> dict:
    """Separate stems with Demucs and detect frequency clashes.

    Args:
        wav_path:    Path to a 44100 Hz WAV file.
        progress_cb: Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: stems, clashes.
        Returns ``{"stems": {}, "clashes": [], "error": "..."}`` when
        Demucs is unavailable.
    """
    model = get_model("demucs")

    if model is None:
        return {"stems": {}, "clashes": [], "error": "demucs not available"}

    stems: dict[str, dict] = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        model.separate_audio_file(
            wav_path,
            shifts=1,
            overlap=0.25,
            output_dir=tmpdir,
        )

        for stem_name in ["drums", "bass", "other", "vocals"]:
            stem_files = list(Path(tmpdir).rglob(f"*{stem_name}*.wav"))
            if not stem_files:
                continue
            y_stem, _ = librosa.load(str(stem_files[0]), sr=44100)
            peak = float(
                librosa.amplitude_to_db(np.array([np.max(np.abs(y_stem))]))[0]
            )
            rms_val = float(np.sqrt(np.mean(y_stem**2)))
            rms_db = float(librosa.amplitude_to_db(np.array([rms_val]))[0])
            stems[stem_name] = {"peak_db": peak, "rms_db": rms_db}

    # -----------------------------------------------------------------------
    # Clash detection — compare bass vs drums in the low-frequency range
    # -----------------------------------------------------------------------
    clashes: list[dict] = []
    if "bass" in stems and "drums" in stems:
        bass_rms = stems["bass"]["rms_db"]
        drums_rms = stems["drums"]["rms_db"]
        # Both stems loud in the low-mid region → potential clash
        if bass_rms > -20.0 and drums_rms > -20.0:
            clashes.append(
                {
                    "stems": "bass vs drums",
                    "frequency_range": "sub-bass / bass (20-200 Hz)",
                    "severity": "high" if bass_rms > -12.0 and drums_rms > -12.0 else "moderate",
                }
            )

    logger.debug("Phase 4: stems=%s clashes=%d", list(stems.keys()), len(clashes))

    return {"stems": stems, "clashes": clashes}
