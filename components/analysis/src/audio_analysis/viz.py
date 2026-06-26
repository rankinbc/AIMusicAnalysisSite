"""Server-side result images: mel spectrogram + loudness-colored waveform.

These are the only two result visuals that genuinely need the raw decoded signal
(an FFT / peak pass over the whole track) — everything else on the results page is
small arrays/scalars already in ``final_json`` and is rendered client-side.

Rendered with Pillow + numpy + librosa ONLY (no matplotlib — heavier import, larger
output, and we don't want axis chrome baked into the pixels; the frontend overlays
freq/time labels). Output is WebP, dark-theme `magma` colormap, fixed pixel
dimensions so the file size is bounded regardless of track length.
"""
from __future__ import annotations

import io

import librosa
import numpy as np
from PIL import Image, ImageDraw

# Fixed output dimensions — bound the file size for any track length.
SPEC_W, SPEC_H = 1024, 256
WAVE_W, WAVE_H = 1024, 160

# dB floor for the spectrogram normalization (0 dB at the track's peak).
_DB_FLOOR = 80.0

# Magma control points (perceptually uniform; reads well on the dark UI).
# Interpolated to a 256-entry RGB LUT — avoids depending on matplotlib's colormaps.
_MAGMA_ANCHORS = np.array(
    [
        [0, 0, 4],
        [28, 16, 68],
        [79, 18, 123],
        [129, 37, 129],
        [181, 54, 122],
        [229, 80, 100],
        [251, 135, 97],
        [254, 194, 135],
        [252, 253, 191],
    ],
    dtype=np.float64,
)


def _magma_lut() -> np.ndarray:
    xp = np.linspace(0.0, 1.0, len(_MAGMA_ANCHORS))
    x = np.linspace(0.0, 1.0, 256)
    lut = np.empty((256, 3), dtype=np.uint8)
    for c in range(3):
        lut[:, c] = np.clip(np.interp(x, xp, _MAGMA_ANCHORS[:, c]), 0, 255).astype(np.uint8)
    return lut


_MAGMA_LUT = _magma_lut()


def render_analysis_images(file_path: str, *, sr: int = 22050) -> dict[str, bytes]:
    """Decode ``file_path`` once and render both result images.

    Returns ``{"spectrogram": <webp bytes>, "waveform": <webp bytes>}``. A modest
    22.05 kHz mono load is plenty for thumbnails and keeps the decode fast.
    """
    y, native_sr = librosa.load(file_path, sr=sr, mono=True)
    return {
        "spectrogram": render_spectrogram(y, int(native_sr)),
        "waveform": render_waveform(y),
    }


def render_spectrogram(y: np.ndarray, sr: int) -> bytes:
    """Mel power spectrogram → dB → normalized → magma LUT → WebP."""
    if y.size == 0:
        grid = np.zeros((SPEC_H, SPEC_W))
    else:
        mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=SPEC_H, fmax=sr // 2)
        mel_db = librosa.power_to_db(mel, ref=np.max)
        norm = np.clip((mel_db + _DB_FLOOR) / _DB_FLOOR, 0.0, 1.0)
        cols = norm.shape[1]
        if cols == 0:
            grid = np.zeros((SPEC_H, SPEC_W))
        else:
            # Resample the time axis to a fixed width (cheap index resample).
            idx = np.linspace(0, cols - 1, SPEC_W).astype(int)
            grid = norm[:, idx]
    rgb = _MAGMA_LUT[(grid * 255).astype(np.uint8)]
    # Flip vertically so low frequencies sit at the bottom (the conventional layout).
    img = Image.fromarray(np.flipud(rgb), "RGB")
    return _encode_webp(img)


def render_waveform(y: np.ndarray) -> bytes:
    """Peak-envelope overview, each column tinted by local RMS (loudness heat)."""
    img = Image.new("RGBA", (WAVE_W, WAVE_H), (0, 0, 0, 0))
    if y.size:
        draw = ImageDraw.Draw(img)
        mid = WAVE_H // 2
        n = max(1, y.size // WAVE_W)
        peaks = np.zeros(WAVE_W)
        rms = np.zeros(WAVE_W)
        for x in range(WAVE_W):
            seg = y[x * n : (x + 1) * n]
            if seg.size:
                peaks[x] = float(np.abs(seg).max())
                rms[x] = float(np.sqrt(np.mean(seg**2)))
        pmax = peaks.max() or 1.0
        rmax = rms.max() or 1.0
        for x in range(WAVE_W):
            h = int((peaks[x] / pmax) * (mid - 2))
            c = _MAGMA_LUT[int(np.clip(rms[x] / rmax, 0.0, 1.0) * 255)]
            draw.line([(x, mid - h), (x, mid + h)], fill=(int(c[0]), int(c[1]), int(c[2]), 255))
    return _encode_webp(img)


def _encode_webp(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=80, method=4)
    return buf.getvalue()
