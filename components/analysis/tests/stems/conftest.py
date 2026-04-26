"""Generate deterministic synthetic stems for tests. Avoids committing audio binaries."""
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

SR = 44100
DURATION_S = 4.0
N_SAMPLES = int(SR * DURATION_S)


def _stereo_silence() -> np.ndarray:
    return np.zeros((N_SAMPLES, 2), dtype=np.float32)


def _kick(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = _stereo_silence()
    for beat in range(int(DURATION_S * 2)):  # 120 BPM
        start = int(beat * SR / 2)
        env = np.exp(-np.linspace(0, 8, 4410)).astype(np.float32)
        tone = (np.sin(2 * np.pi * 60 * np.arange(4410) / SR) * env).astype(np.float32)
        end = min(start + 4410, N_SAMPLES)
        out[start:end, 0] += tone[: end - start] * 0.8
        out[start:end, 1] += tone[: end - start] * 0.8
    out += rng.normal(0, 1e-5, out.shape).astype(np.float32)
    return out


def _bass(seed: int = 0) -> np.ndarray:
    out = _stereo_silence()
    t = np.arange(N_SAMPLES) / SR
    tone = (np.sin(2 * np.pi * 110 * t) * 0.4).astype(np.float32)
    out[:, 0] = tone
    out[:, 1] = tone
    return out


def _hats(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = _stereo_silence()
    for n in range(int(DURATION_S * 8)):  # 16ths
        start = int(n * SR / 8)
        env = np.exp(-np.linspace(0, 12, 1100)).astype(np.float32)
        noise = rng.normal(0, 1, 1100).astype(np.float32) * env
        # Crude high-pass via difference
        noise = np.diff(noise, prepend=np.float32(0))
        end = min(start + 1100, N_SAMPLES)
        out[start:end, 0] += noise[: end - start] * 0.15
        out[start:end, 1] += noise[: end - start] * 0.15
    return out


def _vocals(seed: int = 0) -> np.ndarray:
    out = _stereo_silence()
    t = np.arange(N_SAMPLES) / SR
    f = 200 + 600 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t))
    phase = np.cumsum(2 * np.pi * f / SR)
    tone = (np.sin(phase) * 0.3).astype(np.float32)
    out[:, 0] = tone * 0.95
    out[:, 1] = tone * 1.05
    return out


@pytest.fixture(scope="session")
def synth_stems_dir(tmp_path_factory) -> Path:
    """Returns a directory containing 4 synthetic FLAC stems with known characteristics."""
    out = tmp_path_factory.mktemp("synth_stems")
    sf.write(out / "01_Kick.flac", _kick(), SR)
    sf.write(out / "02_Bass.flac", _bass(), SR)
    sf.write(out / "03_Hats.flac", _hats(), SR)
    sf.write(out / "04_Vox.flac", _vocals(), SR)
    return out


@pytest.fixture(scope="session")
def synth_stem_files(synth_stems_dir: Path) -> dict[str, Path]:
    return {
        "kick": synth_stems_dir / "01_Kick.flac",
        "bass": synth_stems_dir / "02_Bass.flac",
        "hats": synth_stems_dir / "03_Hats.flac",
        "vocals": synth_stems_dir / "04_Vox.flac",
    }
