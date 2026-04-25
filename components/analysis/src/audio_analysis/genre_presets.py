"""Genre presets — target values ported from the AbletonAIAnalysis reference library.

Each preset carries the metrics that are directly comparable to the outputs
of Phase 1 universal analysis: integrated LUFS, BPM range, and L/R stereo
correlation range.  Frequency-band percentage targets are omitted here because
Phase 1 uses mel-bin dBFS values which are not on the same scale as the
Hz-range energy-percentage targets in the source project.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class GenrePreset:
    name: str
    description: str

    # Loudness
    target_lufs: float      # Integrated LUFS for streaming
    lufs_tolerance: float   # ±dB — beyond this is 'warning'; double is 'critical'

    # BPM
    bpm_min: int
    bpm_max: int

    # Stereo correlation (L/R Pearson coefficient, −1 to +1)
    correlation_min: float
    correlation_max: float

    # Frequency below which bass should be mono (informational)
    bass_mono_below_hz: int


GENRE_PRESETS: dict[str, GenrePreset] = {
    "trance": GenrePreset(
        name="Trance",
        description="Uplifting/progressive trance with emotional breakdowns and impactful drops",
        target_lufs=-14.0,
        lufs_tolerance=3.0,
        bpm_min=136,
        bpm_max=145,
        correlation_min=0.3,
        correlation_max=0.6,
        bass_mono_below_hz=150,
    ),
    "house": GenrePreset(
        name="House",
        description="Deep/tech house with groovy basslines and 4-on-the-floor kick",
        target_lufs=-14.0,
        lufs_tolerance=3.0,
        bpm_min=120,
        bpm_max=128,
        correlation_min=0.35,
        correlation_max=0.65,
        bass_mono_below_hz=120,
    ),
    "techno": GenrePreset(
        name="Techno",
        description="Industrial/peak-time techno with driving rhythms and dark atmosphere",
        target_lufs=-14.0,
        lufs_tolerance=3.0,
        bpm_min=128,
        bpm_max=140,
        correlation_min=0.4,
        correlation_max=0.7,
        bass_mono_below_hz=100,
    ),
    "dnb": GenrePreset(
        name="Drum & Bass",
        description="High-energy DnB with rolling breaks and heavy sub bass",
        target_lufs=-14.0,
        lufs_tolerance=3.0,
        bpm_min=170,
        bpm_max=180,
        correlation_min=0.25,
        correlation_max=0.55,
        bass_mono_below_hz=150,
    ),
    "progressive": GenrePreset(
        name="Progressive House/Trance",
        description="Melodic progressive with long builds and subtle transitions",
        target_lufs=-14.0,
        lufs_tolerance=3.0,
        bpm_min=122,
        bpm_max=132,
        correlation_min=0.3,
        correlation_max=0.55,
        bass_mono_below_hz=140,
    ),
}


def get_preset(genre: str) -> Optional[GenrePreset]:
    """Return the preset for *genre* (case-insensitive), or None."""
    return GENRE_PRESETS.get(genre.lower().strip())
