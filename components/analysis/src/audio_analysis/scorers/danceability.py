"""
Danceability scorer — genre-aware scoring based on BPM, rhythm density, and low energy.
All inputs come from existing phase1/phase2 pipeline outputs.
"""

GENRE_IDEAL_BPM: dict[str, float] = {
    "trance": 138.0,
    "progressive trance": 132.0,
    "psytrance": 145.0,
    "house": 125.0,
    "deep house": 122.0,
    "techno": 135.0,
    "dnb": 174.0,
    "drum and bass": 174.0,
    "dubstep": 140.0,
    "progressive": 130.0,
    "electro": 128.0,
}

# Tolerances (BPM units) — score hits 0 at this distance from ideal
GENRE_BPM_TOLERANCE: dict[str, float] = {
    "trance": 20.0,
    "house": 15.0,
    "techno": 20.0,
    "dnb": 25.0,
    "default": 20.0,
}


def danceability_score(
    bpm: float,
    onset_density: float,   # onsets per second — from phase2 onset detection
    low_energy: float,      # RMS of 20–200 Hz band — from phase1 spectral analysis
    genre: str,
) -> int:
    """
    Returns a danceability score 0–100.

    Weights:
      BPM closeness to genre ideal: 40%
      Rhythmic onset density:       40%
      Sub-bass / low energy:        20%

    Args:
        bpm: Detected BPM (e.g., 138.0)
        onset_density: Onsets per second (e.g., 4.0 = 4 hits/sec)
        low_energy: RMS energy of 20-200Hz band, arbitrary float units
        genre: Genre string (case-insensitive)
    """
    genre_key = genre.lower().strip()

    # BPM score
    ideal_bpm = GENRE_IDEAL_BPM.get(genre_key, 128.0)
    tolerance = GENRE_BPM_TOLERANCE.get(genre_key, GENRE_BPM_TOLERANCE["default"])
    bpm_score = max(0.0, 1.0 - abs(bpm - ideal_bpm) / tolerance)

    # Rhythm density score (target: 8 onsets/sec for EDM = max score)
    rhythm_score = min(1.0, onset_density / 8.0)

    # Low energy score (target: 0.4 RMS in low band = max score)
    energy_score = min(1.0, low_energy / 0.4)

    # Weighted composite
    raw = bpm_score * 0.4 + rhythm_score * 0.4 + energy_score * 0.2
    return round(raw * 100)
