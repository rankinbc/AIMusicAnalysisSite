# PRP: GAP-13 — Danceability Score

**Status:** Draft  
**Effort:** Half-day  
**Phase:** v1.1 — Genre-specific scoring

---

## Goal

Add a `danceability_score()` function to the analysis pipeline that computes a 0–100 integer score from BPM closeness to genre ideal, rhythmic onset density, and low-frequency energy, and display it prominently on the report.

## Why

- TrackScore.AI features danceability prominently; producers immediately understand and engage with the metric
- All three inputs (BPM, onset density, low energy) already exist in phase1/phase2 output — no new audio processing required
- Trance producers specifically are highly sensitive to tempo correctness, making this metric immediately actionable

## What

### Backend

**New file:** `analysis/scorers/danceability.py`

(Create the `analysis/scorers/` directory if it does not exist; add `__init__.py`)

```python
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
        low_energy: RMS energy of 20-200Hz band, float in [0, 1] range
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
```

**File:** `analysis/pipeline.py`

Import and call `danceability_score` after phase2 and genre detection:

```python
from analysis.scorers.danceability import danceability_score

# After phase1 and phase2 data is assembled, genre is detected:
dance_score = danceability_score(
    bpm=phase1_data["bpm"],
    onset_density=phase2_data["onset_density"],   # confirm key name
    low_energy=phase1_data["low_energy"],          # confirm key name
    genre=detected_genre
)
result_dict["danceability_score"] = dance_score
```

**If `onset_density` or `low_energy` do not exist yet:**

For `onset_density` (if only total onset count is available in phase2):
```python
onset_density = phase2_data["onset_count"] / phase1_data["duration_seconds"]
```

For `low_energy` (if not already computed in phase1):
Add to `phase1_universal.py`:
```python
# Low-frequency energy (20–200 Hz band)
stft = librosa.stft(audio_mono)
freqs = librosa.fft_frequencies(sr=sr)
low_band_mask = (freqs >= 20) & (freqs <= 200)
low_band_mag = np.abs(stft[low_band_mask, :])
low_energy = float(np.sqrt(np.mean(low_band_mag ** 2)))
# Normalize: typical trance low_energy is ~0.3-0.5 in this scale
# May need empirical calibration based on test tracks
```

### Frontend

**File:** Whichever component displays the overall score (likely `MixScore.tsx` or a scores section in `ReportPage.tsx`).

Add the danceability score as a prominent display adjacent to or below the overall score:

```tsx
// Danceability color coding
const danceabilityColor = (score: number): string => {
  if (score >= 75) return '#22c55e';   // green
  if (score >= 50) return '#eab308';   // yellow
  if (score >= 30) return '#f97316';   // orange
  return '#ef4444';                    // red
};

<div className="flex flex-col items-center">
  <div
    className="text-5xl font-bold"
    style={{ color: danceabilityColor(result.danceability_score) }}
  >
    {result.danceability_score}
  </div>
  <div className="text-sm text-gray-400 mt-1">Danceability</div>
  <div className="text-xs text-gray-500">
    {result.danceability_score >= 75 ? 'Floor-ready' :
     result.danceability_score >= 50 ? 'Decent groove' :
     result.danceability_score >= 30 ? 'Needs work' : 'Low energy / off-tempo'}
  </div>
</div>
```

## Tasks

### Task 1: Verify input availability
- [ ] Check `phase1_universal.py` output dict — confirm `bpm` key exists
- [ ] Check `phase2` output dict — confirm `onset_density` exists as onsets/sec; if not, compute from `onset_count / duration_seconds`
- [ ] Check `phase1` output dict — confirm `low_energy` (20–200 Hz RMS) exists; if not, add STFT band computation to phase1

### Task 2: Create danceability scorer
- [ ] Create `analysis/scorers/` directory with `__init__.py`
- [ ] Create `analysis/scorers/danceability.py` with `GENRE_IDEAL_BPM`, `GENRE_BPM_TOLERANCE`, and `danceability_score()` function
- [ ] Unit test the function with known inputs:
  - `danceability_score(138, 6.0, 0.4, "trance")` → expect ~90+
  - `danceability_score(100, 2.0, 0.1, "trance")` → expect ~20–35

### Task 3: Integrate into pipeline
- [ ] Import `danceability_score` in `pipeline.py`
- [ ] Call it after genre detection with the correct variable names from phase outputs
- [ ] Add `"danceability_score"` to `result_dict`
- [ ] Run a test analysis and confirm `danceability_score` appears in `final_json`

### Task 4: Frontend — display danceability score
- [ ] Add `danceability_score: number` to the TypeScript result interface
- [ ] Add `danceabilityColor()` helper function
- [ ] Add the score display element to the appropriate report section
- [ ] Add text label and descriptor ("Floor-ready" / "Decent groove" / etc.)

## Validation

- [ ] `danceability_score` key present in `final_json` as integer 0–100
- [ ] Trance track at 138 BPM with strong kick → score ≥ 70
- [ ] Trance track at 100 BPM (wrong tempo) → score ≤ 50
- [ ] Score visible in report UI with color coding
- [ ] No errors when `genre` is `None` or unrecognized (fallback to 128 BPM ideal)

## Anti-Patterns

- Do not hardcode genre to "trance" — `danceability_score()` must use the pipeline's detected genre
- Do not use raw onset count in place of onset density — must divide by duration to get onsets/second
- Do not require the `low_energy` normalization scale to be 0–1 — it is computed in arbitrary float units; calibrate the `/0.4` divisor based on real test tracks and adjust as needed
- Do not add this computation directly to `pipeline.py` inline — keep it in `analysis/scorers/danceability.py` for testability and to follow the module pattern
