"""Audio format normalization — converts any input to 44100 Hz WAV.

IMPORTANT: The returned temp WAV path must be deleted by the caller in a
finally block.  Example::

    wav_path = to_wav(input_path)
    try:
        ...
    finally:
        if wav_path.exists():
            wav_path.unlink()
"""

from __future__ import annotations

import tempfile
from pathlib import Path


def to_wav(input_path: str | Path, target_sr: int = 44100) -> Path:
    """Convert *input_path* to a temporary 44100 Hz WAV file.

    Attempts soundfile.read first (native format support); falls back to
    librosa.load for formats soundfile cannot handle (e.g. MP3).

    Returns the :class:`~pathlib.Path` of the temporary WAV.  The caller
    is responsible for deleting it in a ``finally`` block — this function
    never removes the file.

    Args:
        input_path: Path to any audio file (WAV, FLAC, MP3, etc.).
        target_sr:  Target sample rate in Hz (default 44100).

    Returns:
        Path to the newly created temporary WAV file.
    """
    import numpy as np
    import soundfile as sf

    input_path = Path(input_path)

    # --- decode audio -------------------------------------------------------
    try:
        audio, sr = sf.read(str(input_path), always_2d=True)
        # soundfile returns (samples, channels) float64 — transpose to (samples, channels)
        # then resample if needed
        if sr != target_sr:
            import librosa

            # librosa expects (samples,) or (channels, samples); audio here is
            # (samples, channels) so we transpose for librosa then transpose back
            audio_lrs = librosa.resample(
                audio.T.astype(np.float32), orig_sr=sr, target_sr=target_sr
            )
            audio = audio_lrs.T  # back to (samples, channels)
    except Exception:
        # Fallback: librosa handles MP3 and other formats
        import librosa

        y, sr = librosa.load(str(input_path), sr=target_sr, mono=False)
        # librosa returns (channels, samples) or (samples,) for mono
        if y.ndim == 1:
            audio = y[:, np.newaxis].astype(np.float32)  # (samples, 1)
        else:
            audio = y.T.astype(np.float32)  # (channels, samples) → (samples, channels)

    # --- write to temp WAV --------------------------------------------------
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    import os

    os.close(fd)

    sf.write(tmp_path, audio.astype(np.float32), target_sr, subtype="PCM_16")

    return Path(tmp_path)
