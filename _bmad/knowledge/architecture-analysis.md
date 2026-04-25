# Architecture — components/analysis

Installable Python package (`pip install -e components/analysis`). Single public entry point: `run_pipeline()`. All 7 analysis phases run sequentially with graceful per-phase error isolation.

## Public API (__init__.py)

```python
from audio_analysis import run_pipeline

result = run_pipeline(
    file_path: str,
    reference_path: str | None = None,
    progress_cb: Callable[[int, str, float], None] | None = None,
) -> PipelineResult
```

`progress_cb(phase, phase_name, pct)` — called by pipeline at each phase step; used by worker to write DB + Celery progress.

---

## Pipeline Orchestration (pipeline.py)

### Execution Flow

```
to_wav(file_path)                  → temp 44100 Hz WAV (cleaned in finally)
  ↓
Phase 1: Universal Analysis        → lufs, rms, bpm, bands, stereo, key, peak, clipping, mono, structure
  ↓
Phase 2: Genre Detection           → genre, confidence
  ↓
Phase 3: Genre-Specific Scoring    → total_score, sub_scores, notes
  ↓
Phase 4: Stem Separation & Clash   → stems, clashes (Demucs, 10–20 min CPU)
  ↓
Phase 5: Reference Comparison      → deltas vs reference track (skipped if no reference)
  ↓
Phase 6: Gap Analysis              → percentile vs genre reference library
  ↓
Phase 7: Arrangement Advice        → violations, fixes (requires Docker/Linux structure detection)
  ↓
Post-processing:
  overall_score = Phase 3 total_score (fallback: 50.0 * passed_phases/total)
  grade = A/B/C/D/F (90/80/70/60 thresholds)
  danceability_score = danceability_score(bpm, onset_density, low_energy, genre)
  top_fixes = Phase 7 fixes → Phase 4 clashes → padding to 3 items
  coached_fixes = generate_coached_fixes(phase1_data)
```

Each phase is wrapped in `try/except` — failures are recorded in `PhaseResult.error` but don't halt subsequent phases.

### Scoring Logic

- **Overall score**: `phase_results["phase3"]["total_score"]` if Phase 3 succeeded; else `50.0 * (ok_phases / 7)`
- **Grade**: 90+ → A, 80+ → B, 70+ → C, 60+ → D, else F
- **Top fixes extraction order**: Phase 7 arrangement fixes first, then Phase 4 clash descriptions, padded to exactly 3 items

---

## Schemas (schemas.py)

```python
class PhaseResult(TypedDict):
    phase: int                           # 1–7
    name: str                            # Human-readable phase name
    status: Literal["ok", "failed", "skipped"]
    data: dict                           # Phase-specific output
    error: str | None

class PipelineResult(TypedDict):
    file_path: str
    phases: list[PhaseResult]
    overall_score: float                 # 0–100
    grade: str                           # A–F
    top_fixes: list[str]                 # Always 3 items
    danceability_score: int              # 0–100
    coach_name: str
    coach_intro: str
    coached_fixes: list[str]             # Up to 5
```

Phase 1 key metrics are also promoted to the `final_json` root in the worker's finalize step: `true_peak_db`, `peak_dbfs`, `clipping_detected`, `clipped_sample_count`, `detected_key`, `mono_compatibility`.

---

## Phase 1: Universal Mix Analysis (phases/phase1_universal.py)

**Function:** `analyze(wav_path: Path) → dict`

### Measurements

| Metric | Method | Output |
|--------|--------|--------|
| LUFS | pyloudnorm.Meter on (samples, channels) float64 | float (LUFS) |
| RMS | per-sample RMS across channels | float [0,1] |
| Duration | sample_count / sample_rate | float (seconds) |
| BPM | librosa.beat.beat_track() | float |
| Musical key | chroma_cqt, argmax over 12 semitones | str ("C", "C#", …"B") |
| 7 frequency bands | mel spectrogram 128 bins, averaged per band range | dict of dB values |
| Stereo correlation | Pearson correlation(L, R) | float [-1, 1] |
| Stereo width | std(L - R) | float ≥ 0 |
| Mono compatibility | mono_rms / stereo_rms | float [0, 1] |
| True peak dBTP | 4× upsampling (scipy.signal.resample_poly), max abs | float (dBTP) |
| Peak dBFS | 20 * log10(max\|sample\|) | float (dBFS) |
| Clipping | \|sample\| >= 0.9999 | bool + count |
| Low energy | STFT magnitude RMS of 20–200 Hz band | float |
| Structure | all_in_one_fix (Docker/Linux only) | {sections, beats} |

**7 frequency bands (mel bin ranges):**
- sub_bass (0–5), bass (5–20), low_mid (20–40), mid (40–60), upper_mid (60–80), presence (80–100), air (100–128)

**LUFS gotcha:** librosa loads `(channels, samples)` float32. pyloudnorm requires `(samples, channels)` float64. Always `audio.T.astype(float)` before pyloudnorm or LUFS values are silently wrong.

---

## Phase 2: Genre Detection (phases/phase2_genre.py)

**Function:** `classify(wav_path: Path, phase1_result: dict) → dict`

BPM-based classification:
- 160–180 BPM → dnb (0.75)
- 130–150 BPM → trance (0.70)
- 120–130 BPM → house (0.65)
- else → other (0.50)

Refinement: presence energy > -20 dB + 128–140 BPM → techno (0.60)

**Output:** `{"genre": str, "confidence": float, "bpm": float}`

---

## Phase 3: Genre-Specific Scoring (phases/phase3_genre_specific.py)

**Function:** `score(wav_path, genre, phase1_result) → dict`

Per-genre scorers (each sub-score 0–100; total = mean):

| Genre | Criteria |
|-------|----------|
| trance | air band > -30 dB; stereo width > 0.5; BPM 130–150 |
| house | bass+sub_bass > -20 dB avg; BPM 120–130 |
| techno | presence+upper_mid > -25 dB avg; minimal air; BPM 130–140 |
| dnb | sub_bass > -20 dB; BPM 160–180 |
| other | max_band − min_band < threshold; stereo width |

**Output:** `{"genre", "total_score", "sub_scores": dict, "notes": list[str]}`

---

## Phase 4: Stem Separation & Clash (phases/phase4_stems.py)

**Function:** `analyze(wav_path) → dict`

1. Demucs `htdemucs_ft` (segment=7) separates: drums, bass, other, vocals
2. Per stem: `peak_db`, `rms_db`
3. Clash detection: bass vs drums both RMS > -20 dB → clash; severity "high" if both > -12 dB

**Output:** `{"stems": dict, "clashes": list[dict]}`

**Performance:** 10–20 minutes CPU for 5-minute track. Gracefully returns empty result if Demucs not installed.

---

## Phase 5: Reference Comparison (phases/phase5_reference.py)

**Function:** `compare(wav_path, reference_path, phase1_result) → dict`

If `reference_path` is None → `{"status": "skipped", "deltas": {}}`

Otherwise: runs Phase 1 on reference, computes deltas for all metrics.

**Delta severity thresholds:** ok (<1.0), minor (1.0–3.0), moderate (3.0–6.0), significant (≥6.0)

**Scales applied:** LUFS raw, RMS ×20, stereo correlation ×10, bands raw

---

## Phase 6: Gap Analysis (phases/phase6_gap.py)

**Function:** `analyze(wav_path, genre, phase1_result) → dict`

- Reads JSON files from `data/reference_library/{genre}/`
- Feature vector: [lufs, rms, bpm, stereo_width, 7 bands] (11 features)
- Percentile via `scipy.stats.percentileofscore` on LUFS
- Per-feature gaps: user_val, genre_mean, delta

**Output:** `{"genre", "percentile", "gaps": dict}`

---

## Phase 7: Arrangement Advice (phases/phase7_arrangement.py)

**Function:** `advise(structure_result, genre) → dict`

Rules applied to structure sections:
- **8-bar rule**: section length must be divisible by 8
- **Energy contrast**: variation between section energies must be > 0.1
- **EDM section completeness**: checks for intro, drop, breakdown, outro

Requires `all_in_one_fix` (Docker/Linux). Returns empty violations/fixes on Windows.

**Output:** `{"violations": list[str], "fixes": list[str], "section_count": int}`

---

## Danceability Scorer (scorers/danceability.py)

**Function:** `danceability_score(bpm, onset_density, low_energy, genre) → int`

```
bpm_score    = max(0, 1 - |bpm - ideal_bpm| / tolerance)   — 40% weight
rhythm_score = min(1, onset_density / 8.0)                   — 40% weight
energy_score = min(1, low_energy / 0.4)                      — 20% weight
raw = bpm_score*0.4 + rhythm_score*0.4 + energy_score*0.2
return round(raw * 100)  # 0–100
```

**Ideal BPM by genre:** trance 138, house 125, techno 135, dnb 174, dubstep 140, default 130

---

## Coach (coach.py)

**Function:** `generate_coached_fixes(analysis: dict) → dict`

Rule-based conditions checked in order:
1. LUFS < -16.0 → nudge limiter ceiling up
2. LUFS > -8.0 → pull back limiter
3. `clipping_detected = True` → reduce limiter ceiling 1–2 dB
4. `true_peak_db >= -1.0` → keep below -1.0 dBTP
5. `mono_compatibility < 0.70` → check widened elements for phase issues
6. Fallback: use `top_fixes` if none match

**Output:** `{"coach_name": "Coach", "coach_intro": str, "coached_fixes": list[str]}`

---

## Models.py — Singleton Loader

**Function:** `get_model(name: Literal["demucs", "openl3"]) → Any`

Thread-safe singleton via `threading.Lock()` + double-checked locking. Returns `None` if optional dependency not installed. Models survive across tasks in same worker process.

- **Demucs**: `Separator(model="htdemucs_ft", segment=7)`
- **OpenL3**: `torchopenl3` with mel256, music, 512-dim

Pre-loaded in worker's `worker_ready` signal to avoid first-task latency.

---

## Converters.py

**Function:** `to_wav(input_path, target_sr=44100) → Path`

1. Try soundfile first (`sf.read(always_2d=True)`)
2. Fallback to librosa (`librosa.load(mono=False)`)
3. Resample if needed, write `PCM_16` WAV to temp file
4. **Caller must delete temp file in `finally` block**

---

## Dependencies (pyproject.toml)

**Core:** librosa>=0.11,<1.0; soundfile; scipy; numpy<2.0 (hard pin); pyloudnorm; scikit-learn

**Optional [ml]:** demucs>=4.0; torch>=2.0; torchaudio; torchopenl3

**Python:** ≥3.11

**Critical pins:**
- `numpy<2.0` — librosa, numba, soundfile all break on numpy 2.x
- `torchopenl3` not `openl3` (openl3 requires TensorFlow, conflicts with PyTorch stack)
- `all-in-one-fix` not `allin1` (allin1 has no Windows wheels)

---

## Key Constraints

| Constraint | Reason |
|-----------|--------|
| Convert to 44100 Hz WAV first | MP3 decoding introduces ±70 ms beat/structure variance |
| numpy<2.0 pin | librosa + numba + soundfile all have 2.x incompatibilities |
| pyloudnorm expects (samples, channels) float64 | librosa returns (channels, samples) float32; always `.T.astype(float)` |
| Demucs via Python API only | subprocess would miss singleton model; 10–20 min CPU per track |
| Structure detection requires Docker/Linux | all-in-one-fix has no Windows wheels |
| TORCH_HOME=data/models | Keeps model weights inside repo, not ~/.cache/torch |
