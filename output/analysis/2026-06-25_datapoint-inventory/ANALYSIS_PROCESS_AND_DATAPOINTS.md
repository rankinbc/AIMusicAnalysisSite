# SPECTR Analysis System — Process Summary & Complete Datapoint Inventory

**Generated:** 2026-06-25
**Scope:** `components/analysis/` — the `audio_analysis` 7-phase pipeline (+ optional ALS phase 8, mix-translation phase 9)
**Purpose:** Trace the entire analysis system and enumerate EVERY datapoint that is technically extractable — including intermediate values computed in a script and discarded before the next stage. This is the universe of data we *could* surface, not just what currently ships in `final_json`.

> **Legend**
> - **EXPOSED** — the value lands in the dict returned by its phase (and therefore in `analyses.final_json`).
> - **INTERNAL** — the value is computed during analysis and then discarded / used only as an intermediate. **Technically recoverable** by lifting it into the return dict.

---

## PART 1 — Analysis Process Summary

### 1.1 Entry point & orchestration

`run_pipeline(file_path, reference_path=None, als_file_path=None, genre_hint=None, progress_cb=None, stem_paths=None, reference_stem_paths=None, stem_mode="grouped", defer_structure=False)` in `pipeline.py` is the single public entry point.

**Flow:**

1. **Convert** — `converters.to_wav()` decodes the upload (MP3/FLAC/WAV) and resamples to a temporary **44.1 kHz WAV**. MP3 decoding adds ±70 ms beat-timing variance, so every phase reads the WAV, never the original. The temp WAV is always deleted in a `finally` block.
2. **Phase loop** — `run_single_phase()` is called for phases **1, 2, 3, 4, 5, 6, 7, 9** in order (note: phase 8 is handled separately; phase numbering skips from 7 → 9). Each returns a `PhaseResult` (`phase`, `name`, `status` ∈ {ok, failed, skipped}, `data`, `error`). On `ok`, its `data` dict is folded into a `phase_data[num]` map that downstream phases read from.
3. **Phase 8 (ALS)** — runs only if `als_file_path` is provided; `analyze_als()` parses the Ableton project.
4. **Finalize** — `finalize_result()` derives the top-level rollups (overall score, grade, top fixes, danceability, coach copy) from the assembled `phase_data`.

**Per-phase isolation:** each phase is wrapped in try/except — one phase failing produces `status="failed"` with an `error` string but never aborts the run. Downstream phases that depend on a failed phase fall back to defaults (e.g. genre → `"other"`).

**Dependency graph (what each phase reads from upstream):**

| Phase | Reads from |
|-------|-----------|
| 1 Universal | (raw WAV only) |
| 2 Genre | phase 1 (`bpm`, `bands`) |
| 3 Genre-specific | phase 1 (`bands`, `stereo_width`, `bpm`), phase 2 (`genre`) |
| 4 Stems/Clash | raw WAV (+ optional `stem_paths`) |
| 5 Reference | phase 1, phase 2 (`genre`), optional reference track + reference stems |
| 6 Gap | phase 1, phase 2 (`genre`) |
| 7 Arrangement | phase 1 (`structure`, `bpm`, `duration_seconds`), phase 2 (`genre`) |
| 8 ALS | `.als` file only (independent) |
| 9 Translation | raw WAV only |

### 1.2 Specialized re-run / deferral entry points

- **`run_single_phase(n, …)`** — runs exactly one phase against an already-converted WAV. Building block for everything below.
- **`rerun_single_phase(n, …)`** — re-runs ONE phase and merges it into a prior result in place, re-deriving rollups. **No cascade** — re-running phase N does not re-run its dependents. Used by the BFF per-phase "Re-run" buttons (phases 2–8).
- **`detect_structure_and_rescore(…)`** — the background half of **deferred structure detection**. When the main run used `defer_structure=True`, Phase 1 emitted a placeholder; this later runs allin1 structure detection, patches phase-1's `structure` sub-dict, and re-scores phase 7.
- **`finalize_result(…)`** — shared rollup derivation so full-run and re-run stay byte-consistent.

### 1.3 Top-level rollups (`finalize_result`)

| Field | Derivation |
|-------|-----------|
| `overall_score` | phase 3 `total_score` if present, else `50 × (ok_phases / 8)` |
| `grade` | A≥90, B≥80, C≥70, D≥60, else F |
| `top_fixes` | priority-merged: phase 9 translation fixes (≤2) → phase 7 suggestions (≤3) → phase 4 clash descriptions (≤2), padded to exactly 3 |
| `danceability_score` | `danceability_score(bpm, onset_density, low_energy, genre)` — 0–100 |
| `coach_name`, `coach_intro`, `coached_fixes` | `generate_coached_fixes()` template voice referencing measured values |

### 1.4 Key DSP/analysis libraries

- **librosa** (numpy<2.0 hard-pinned) — STFT, mel spectrogram, chroma CQT, spectral descriptors, onset detection, HPSS, beat tracking.
- **pyloudnorm** — ITU-R BS.1770 LUFS / EBU R128 loudness. Axis order matters: audio must be `(samples, channels) float64`.
- **allin1 (all-in-one-fix) via Docker** — song-structure segmentation (intro/buildup/drop/breakdown/outro), beats, downbeats. Not in-process on Windows.
- **demucs** — stem separation. **Disabled by default** (`USE_DEMUCS = False`); phase 4 uses fast librosa-STFT spectral clash detection instead. Demucs path is 10–20 min CPU per track.
- **Stems classification** — import-light (librosa only, no torch) audio-content role detection.
- **ALS parser** — gunzip + ElementTree XML walk of the Ableton `.als` project file.

---

## PART 2 — Complete Datapoint Inventory

Organized by phase/module. "Status" column marks EXPOSED vs INTERNAL.

---

### Phase 1 — Universal Mix Analysis (`phase1_universal.py`)

The richest single phase. All measured against the mono/stereo 44.1 kHz WAV.

**Loudness (pyloudnorm / EBU R128)**

| Datapoint | Type | Meaning | Units/Range | Status |
|-----------|------|---------|-------------|--------|
| `lufs` | float | Integrated loudness | LUFS (≈ -70…-6) | EXPOSED |
| `momentary_max_lufs` | float | Max of 0.4 s momentary windows | LUFS | EXPOSED |
| `short_term_max_lufs` | float | Max of 3.0 s short-term windows | LUFS | EXPOSED |
| `loudness_range_lu` | float | EBU R128 LRA (P95 − P10 of gated short-term) | LU | EXPOSED |
| momentary series | list[float] | Full per-window 0.4 s loudness series | LUFS | **INTERNAL** |
| short_term series | list[float] | Full per-window 3.0 s loudness series | LUFS | **INTERNAL** |
| gated short-term series | ndarray | Relative-gated (within 20 dB of mean) series | LUFS | **INTERNAL** |

**7-band frequency energy (mel spectrogram, dB)** — all EXPOSED under `bands`

| Band | Approx Hz | Status |
|------|-----------|--------|
| `sub_bass` | ~20–50 | EXPOSED |
| `bass` | ~50–200 | EXPOSED |
| `low_mid` | ~200–500 | EXPOSED |
| `mid` | ~500–2k | EXPOSED |
| `upper_mid` | ~2k–5k | EXPOSED |
| `presence` | ~5k–8k | EXPOSED |
| `air` | ~8k–22k | EXPOSED |
| full mel spectrogram `S` / `S_db` | ndarray (128 × frames) | the entire time-frequency surface | **INTERNAL** |

**Stereo / imaging**

| Datapoint | Type | Meaning | Range | Status |
|-----------|------|---------|-------|--------|
| `stereo_correlation` | float | Pearson L/R correlation | -1…1 | EXPOSED |
| `stereo_width` | float | Std dev of (L−R) difference signal | linear | EXPOSED |
| `mono_compatibility` | float | mono_rms / stereo_rms | 0…1 | EXPOSED |
| 2×2 correlation matrix | ndarray | full L/R covariance | — | **INTERNAL** |
| `stereo_rms`, `mono_rms`, `mono_sum` | float/ndarray | intermediate energy of stereo vs mono downmix | linear | **INTERNAL** |

**Peak / clipping**

| Datapoint | Type | Meaning | Units | Status |
|-----------|------|---------|-------|--------|
| `true_peak_db` | float | 4× oversampled inter-sample true peak (BS.1770-4) | dBTP | EXPOSED |
| `peak_dbfs` | float | Raw sample peak | dBFS | EXPOSED |
| `clipping_detected` | bool | Any sample ≥ 0.9999 | — | EXPOSED |
| `clipped_sample_count` | int | Count of clipped samples | count | EXPOSED |
| oversampled signal, linear peaks | ndarray/float | intermediates | linear | **INTERNAL** |

**Tempo / key**

| Datapoint | Type | Meaning | Range | Status |
|-----------|------|---------|-------|--------|
| `bpm` | float | librosa beat-tracking tempo | BPM | EXPOSED |
| `detected_key` | str | Krumhansl best-match pitch class | C…B (12) | EXPOSED |
| `key_detection_confidence` | float | Best Krumhansl profile correlation (tonal clarity) | 0…1 | EXPOSED |
| chroma CQT (12 × frames) | ndarray | full chromagram | — | **INTERNAL** |
| `chroma_mean` (12-vector) | ndarray | time-averaged pitch-class profile | — | **INTERNAL** |
| 24 Krumhansl profile correlations | floats | per-key (12 major + 12 minor) correlation — **a full key/mode estimate + 2nd-best key is recoverable here** | -1…1 | **INTERNAL** |

**Dynamics & spectral descriptors**

| Datapoint | Type | Meaning | Units | Status |
|-----------|------|---------|-------|--------|
| `crest_factor` | float | Peak-to-RMS ratio (dynamics proxy) | dB | EXPOSED |
| `rms` | float | Overall RMS energy | linear | EXPOSED |
| `duration_seconds` | float | Track length | s | EXPOSED |
| `spectral_centroid_hz` | float | Spectral center of mass (brightness) | Hz | EXPOSED |
| `spectral_contrast` | float | Peak-to-valley spectral contrast | dB | EXPOSED |
| `spectral_flatness` | float | Tonal vs noise (Wiener entropy) | 0…1 | EXPOSED |
| `low_energy` | float | RMS of 20–200 Hz band | linear | EXPOSED |
| `rms_dbfs` | float | RMS in dBFS (intermediate for crest) | dBFS | **INTERNAL** |

**Transients (`transients` sub-dict)** — all EXPOSED

| Datapoint | Meaning | Units |
|-----------|---------|-------|
| `avg_transient_strength` | mean onset strength (punchiness) | 0…1 |
| `transient_count` | total detected onsets | count |
| `transients_per_second` | attack density | Hz |
| onset envelope / onset indices | full per-frame onset strength curve + sample positions | **INTERNAL** |

**Structure (`structure` sub-dict — from allin1 via Docker, or deferred placeholder)** — EXPOSED

| Datapoint | Type | Meaning |
|-----------|------|---------|
| `available` | bool | did structure detection run |
| `deferred` | bool | pending background job |
| `detection_method` | str | "allin1-docker" |
| `bpm` | float | allin1's independent tempo |
| `beats` | list[float] | beat timestamps (s) |
| `downbeats` | list[float] | downbeat timestamps (s) |
| `segments[]` | list[dict] | each: `label`, `start`, `end` (intro/buildup/drop/breakdown/outro/…) |

---

### Phase 2 — Genre Detection (`phase2_genre.py`)

Simple BPM + presence-energy heuristic. Genres: dnb / trance / house / techno / other.

| Datapoint | Type | Meaning | Range | Status |
|-----------|------|---------|-------|--------|
| `genre` | str | classified genre | 5 values | EXPOSED |
| `confidence` | float | heuristic confidence | 0.50…0.75 | EXPOSED |
| `bpm` | float | echoed tempo | BPM | EXPOSED |
| `presence_energy` | float | presence band used for techno override | dB | **INTERNAL** |

> Note: `onset_density` / `onset_count` are read by `finalize_result` from phase 2 if present (fallback computed from duration). The current phase-2 dict does not emit them, but the rollup expects them — a recoverable gap.

---

### Phase 3 — Genre-Specific Scoring (`phase3_genre_specific.py`)

Dispatches to a per-genre scorer. All return `score` + `sub_scores` + `notes`.

| Datapoint | Type | Meaning | Range | Status |
|-----------|------|---------|-------|--------|
| `total_score` | float | genre-fit composite (becomes `overall_score`) | 0–100 | EXPOSED |
| `genre` | str | echoed genre | — | EXPOSED |
| `sub_scores` | dict | per-component scores (see below) | 0–100 each | EXPOSED |
| `notes` | list[str] | advisory messages | — | EXPOSED |

**Genre-specific `sub_scores` components (all EXPOSED inside `sub_scores`):**

- **trance:** `air_energy`, `stereo_width`, `bpm_adherence`
- **house:** `bass_energy`, `bpm_adherence`
- **techno:** `mid_presence`, `minimal_air`, `bpm_adherence`
- **dnb:** `sub_bass_weight`, `bpm_adherence`
- **other:** `frequency_balance`, `stereo_width`

**INTERNAL** intermediates: `bass_avg`, `mid_avg`, `band_vals`, `spread`, per-band raw energies pulled from phase 1, `bpm_score` before naming.

---

### Phase 4 — Stem Separation & Clash (`phase4_stems.py`, `stems/`)

Two paths: **(a)** default fast spectral analysis of the full mix (no stems); **(b)** real per-stem analysis when `stem_paths` are supplied.

**Mix-level spectral clash (default path)**

| Datapoint | Type | Meaning | Status |
|-----------|------|---------|--------|
| `band_rms_db[name]` | float ×7 | RMS energy per frequency band (sub_bass…air) | EXPOSED |
| `clashes[]` | list[dict] | each `stems` (label), `frequency_range`, `severity` (high/moderate) — detects low-end buildup, low-mid congestion, high-mid harshness | EXPOSED |
| STFT magnitude `S`, `freqs`, per-band masks | ndarray | full time-frequency surface | **INTERNAL** |

**Per-stem metrics (`StemMetrics`, when stems present)** — all EXPOSED per stem

| Datapoint | Meaning | Units |
|-----------|---------|-------|
| `role` | detected stem role (10 roles) | enum |
| `duration_s` | stem length | s |
| `peak_db` | peak amplitude | dB |
| `rms_db` | RMS amplitude | dB |
| `lufs_integrated` | integrated loudness | LUFS |
| `dynamic_range_db` | peak − RMS | dB |
| `band_energy_db` | per-7-band energy | dB |
| `spectral_centroid_hz` | brightness | Hz |
| `dominant_frequencies_hz` | top-3 spectral peaks | Hz |
| `stereo_width` | side/mid RMS ratio | 0…1 |
| `pan_estimate` | L/R energy balance | -1…1 |
| `is_mono` | mono flag | bool |

**Clash matrix (`StemClash`, pairwise)** — EXPOSED

| Datapoint | Meaning | Range |
|-----------|---------|-------|
| `stem_a`, `stem_b` | the two clashing roles | enum |
| `band` | frequency band of clash | 7 bands |
| `overlap_severity` | geometric mean of band-energy ratios | 0…1 |
| `severity_tier` | info / warning / critical (thresholds 0.3/0.5/0.7) | enum |

**Balance flags (`BalanceFlag`)** — EXPOSED: `role`, `metric`, `observed`, `expected_range`, `direction` (too_low/too_high), `severity_tier`.

**Per-stem rollup fields:** `truncated` (bool, stem count capped), `stem_count` (int) — EXPOSED.

**Demucs path (disabled):** per-stem `peak`, `rms_db`, `bass_rms`, `drums_rms` — currently dead code, recoverable if `USE_DEMUCS=True`.

**INTERNAL** band-energy ratios, overlap intermediates, group-sum buffers.

---

### Phase 4b — Stem Classification & Role Detection (`stems/classify.py`, `role_detector.py`)

Audio-content role classification (used at stage/classify time, feeds `StemProposal`).

**Per-stem classification features (`_features`)** — all **INTERNAL** (only `role`+`confidence`+`evidence` survive)

| Feature | Meaning | Range |
|---------|---------|-------|
| `rms` | window RMS | 0…1 |
| `peak` | window peak | 0…1 |
| `crest` | peak/RMS crest factor | ≥1 |
| `zcr` | zero-crossing rate (noisiness) | ~0…0.25 |
| `centroid` | spectral centroid | Hz |
| `perc_ratio` | percussive/(perc+harmonic) via HPSS | 0…1 |
| `onset_rate` | onsets per second | Hz |
| band ratios (×7) | per-band energy fraction | 0…1 each |
| `low` / `mids` / `high` aggregates | summed band groups | 0…1 |
| `percussive` | derived boolean (perc_ratio>0.45 or crest>5) | bool |

**`StemProposal` (EXPOSED to confirm UI):** `file`, `detected_role`, `confidence`, `evidence`. **`RoleProposal`:** `role`, `confidence` (filename match 0.9), `evidence`.

**Matcher (`matcher.py`):** `als_track` (fuzzy-matched .als track name, RapidFuzz ≥60) — EXPOSED; raw fuzzy match score — INTERNAL.

---

### Phase 5 — Reference Comparison (`phase5_reference.py`)

Two sub-blocks: genre-preset compliance checks + reference-track deltas.

**Genre-preset checks (`checks` dict)** — EXPOSED; runs even without a reference track

| Check | Fields | Meaning |
|-------|--------|---------|
| `lufs` | `value`, `status` (ok/warning/critical), `message` | loudness vs genre target ±tolerance |
| `bpm` | `value`, `status` (ok/warning), `message` | tempo vs genre BPM range |
| `correlation` | `value`, `status` (ok/warning/critical), `message` | stereo correlation vs genre min/max |

**Reference deltas (`deltas` dict, only with reference track)** — EXPOSED. Each entry: `value` + `severity` (ok/minor/moderate/significant).

| Delta key | Meaning | Units |
|-----------|---------|-------|
| `lufs` | loudness difference | dB |
| `rms` | RMS difference | dB |
| `stereo_correlation` | correlation difference | -2…2 |
| `band_{name}` ×7 | per-band energy difference | dB |

**Per-stem reference deltas (`per_stem_reference_deltas[]`, with reference stems)** — EXPOSED. Each: `role`, `metric`, `user_value`, `reference_value`, `delta`, `interpretation`, `severity_tier`. Compares every `StemMetrics` field (rms_db, lufs_integrated, stereo_width, per-band energy) against curated reference-library Demucs caches.

**Reference-library cached metrics** — full `StemMetrics` set per reference stem (loaded from `_stems_cache/*.stems.json`) — EXPOSED via deltas.

**INTERNAL:** raw `diff` gates, tolerance multipliers, severity-scaling factors.

---

### Phase 6 — Gap Analysis (`phase6_gap.py`)

Statistical comparison of an 11-dimension feature vector against genre profile distributions (percentile ranking).

**Feature vector (11 dims, `_build_feature_vector`)** — **INTERNAL** as a vector, but each surfaces as a gap

`[lufs, rms, bpm, stereo_width, sub_bass, bass, low_mid, mid, upper_mid, presence, air]`

**Per-gap output (`gaps[key]`)** — EXPOSED

| Field | Meaning |
|-------|---------|
| `user_val` | user's measured value |
| `genre_mean` | genre profile mean |
| `genre_std` | genre profile std dev |
| `delta` | difference from mean |
| `percentile` | percentile rank vs genre distribution (0–100) |
| `description` | plain-English percentile phrase |
| `acceptable_range` | [lo, hi] (p10/p90 or custom) |
| `in_range` | bool |

**Rollup:** `percentile` (overall, mean of per-metric percentiles), `profile_source` (profile name + track count) — EXPOSED.

**Percentile machinery (`genre_profile_loader.py`):** 7-anchor interpolation (min/p10/p25/p50/p75/p90/max), `describe_percentile` phrases ("very high (top 10%)" … "very low (bottom 10%)") — interpolation intermediates INTERNAL.

**INTERNAL:** `width_proxy` (1−|corr|), `ref_array`, `ref_means`, `lufs_scores`, per-track reference vectors.

---

### Phase 7 — Arrangement Advice (`phase7_arrangement.py`, `arrangement_scorer.py`)

Scores song structure (from phase-1 `structure`) against EDM-arrangement conventions. Returns `arrangement_status` ∈ {pending, unavailable, scored}.

**Top-level `ArrangementScore` (EXPOSED via `to_dict`)**

| Field | Meaning | Range |
|-------|---------|-------|
| `overall_score` | weighted composite | 0–100 |
| `grade` | A/B/C/D/F / N/A | — |
| `component_scores` | `{structure, length, eight_bar, energy_contrast, flow}` | 0–100 each |
| `structure_score` | required-section presence | 0–100 |
| `length_score` | section-length compliance | 0–100 |
| `eight_bar_score` | divisibility-by-8 compliance | 0–100 |
| `energy_contrast_score` | drop-vs-breakdown contrast | 0–100 |
| `flow_score` | logical section progression | 0–100 |
| `suggestions` | prioritized fix strings | — |

**Metadata (`metadata` sub-dict)** — EXPOSED: `total_bars`, `section_count`, `detected_tempo`, `has_intro`, `has_buildup`, `has_drop`, `has_breakdown`, `has_outro`, `energy_contrast_db`.

**Per-section scores (`section_scores[]`)** — EXPOSED: `section_type`, `start_time`, `end_time`, `duration`, `bars`, `score` (length), `eight_bar_compliant`, `time_range`, `issues[]`.

**Issues (`issues[]`)** — EXPOSED: `severity` (CRITICAL/WARNING/SUGGESTION), `message`, `section`, `fix_suggestion`.

**INTERNAL energy proxies** (notable — these are *derived from segment confidence*, not true RMS): `drop_energy_db`, `breakdown_energy_db`, `contrast_proxy`, plus per-section `deviation`, `closeness`, `shortfall`, `excess`, eight-bar `violations`/`penalty`, flow transition penalties, `section_types` set.

> ⚠️ Data-quality note: arrangement "energy" is a *pseudo-RMS derived from allin1 segment confidence*, not a measured loudness. A true measured per-section RMS/LUFS is technically extractable from phase 1's audio but is **not currently computed**.

---

### Phase 8 — ALS Project Analysis (`phase8_als.py`, `als/`)

Parses the Ableton `.als` (gzipped XML). The single deepest source of *non-audio* datapoints.

**Project metadata (EXPOSED)**

`health_score`, `grade`, `tempo`, `ableton_version`, `time_signature` (+ numerator/denominator), `sample_rate`, `total_duration_beats`, `total_duration_seconds`, `total_devices`, `disabled_devices`, `clutter_pct`, `plugin_list[]`, `has_humanized_midi`, `quantization_issues_count`, `total_chord_count`, `midi_note_count`, `audio_clip_count`.

**Per-track (EXPOSED)**

`id`, `name`, `track_type` (midi/audio/return/master/group), `color`, `is_muted`, `is_solo`, `volume_db`, `pan`, `device_count`, `disabled_count`, `devices[]`.

**Per-device / plugin (EXPOSED)**

`name`, `type`, `device_type` (vst/au/max_for_live/native), `enabled`, `params{}` (per-parameter values — a large, mostly-untapped surface).

**MIDI clips & notes (EXPOSED)**

- Clip: `name`, `start_time`, `end_time`, `loop_start`, `loop_end`.
- Note: `pitch` (0–127), `velocity` (0–127), `start_time`, `duration`, `mute`.

**Audio clips (EXPOSED)**

`name`, `file_path`, `start_time`, `end_time`, `warp_mode` (Beats/Tones/Texture/Re-Pitch/Complex/Complex Pro), `original_tempo`.

**MIDI analysis per track (EXPOSED)**

`note_count`, `velocity_mean`, `velocity_std`, `velocity_range`, `humanization_score` (robotic/slightly_humanized/natural), `note_density_per_bar`, `chord_count`, `swing_ratio` (0.5 straight…0.75 swung), `quantization_errors[]`, `chords[]`.

**Quantization errors (EXPOSED):** `track_name`, `pitch`, `time`, `nearest_grid`, `error_beats`, `severity` (minor/notable/severe).

**Chord detection (EXPOSED):** `time`, `pitches[]`, `chord_name` (e.g. C, Am, Gmaj7), `duration`.

**MIDI clip quality (`MIDIClipStats`, EXPOSED):** `note_count`, `duration_beats`, `is_empty`, `is_very_short`, `unique_pitches`, `velocity_range`, `average_velocity`, `note_hash` (MD5 for dedup).

**MIDI rollup (EXPOSED):** `total_midi_tracks/clips/notes`, `empty_clips`, `short_clips`, `duplicate_clips`, `tracks_without_content`, `duplicate_groups[]`, `per_track_analysis{}`.

**MIDI issues (EXPOSED):** `track`, `clip`, `type` (empty/very_short/duplicate/low_velocity/quantization/no_content/all_clips_empty/all_clips_muted), `severity`, `description`, `fix`.

**Arrangement (from .als locators, EXPOSED):** `has_markers`, `total_sections`, `pattern` (verse-chorus/intro-buildup-drop/sectioned), per-section `name`/`start_beat`/`end_beat`/`duration_bars`.

**Also parsed (EXPOSED where surfaced):** locators (`time`,`name`), scenes (`index`,`name`,`tempo`), tempo automation (`time`,`tempo`, `has_tempo_changes`).

**INTERNAL:** raw XML tree, decompressed bytes, velocity variance intermediates, interval sets for chord matching, off-beat position lists, swing pre-clamp value, linear (pre-dB) volume.

---

### Phase 9 — Mix Translation (`phase9_translation.py`, `analyzers/spatial_analyzer.py`)

Runs three spatial analyzers; their dataclasses are `asdict()`-ed into `spatial`, `surround`, `playback`.

**`spatial` (3D imaging) — EXPOSED**

`height_score` (0–100, HF content → vertical perception), `depth_score` (0–100, correlation + dynamics), `width_consistency` (0–100, stereo image stability over time), `analysis[]` (text).

**`surround` (mono/phase) — EXPOSED**

`mono_compatibility` (0–100), `phase_score` (0–100, phase coherence), `is_atmos_ready` (bool), `analysis[]`.

**`playback` (translation) — EXPOSED**

`headphone_score` (0–100, crossfeed-simulated), `speaker_score` (0–100, bass management), `crossfeed_safe` (bool), `bass_translation` (good/weak/excessive), `analysis[]`.

**INTERNAL (large untapped set inside the spatial analyzer):** per-window correlation series, `high_ratio` (>8 kHz energy fraction), `avg_centroid`, `rms_std` (dynamics), `correlation_depth`, `dynamics_depth`, `preservation_ratio`, sub/bass/mid-bass energy ratios (`sub_ratio`, `bass_ratio`, `midbass_ratio`), crossfeed L/R correlations, windowed width correlation std. Each is a recoverable metric.

---

### Rollups & Coaching (`recommendations.py`, `coach.py`, `scorers/danceability.py`)

**Translation fixes (`recommendations.py`):** priority-ordered fix list (0–6 severity) derived from phase 9 (`mono_compatibility`, `phase_score`, `bass_translation`, `crossfeed_safe`, `width_consistency`). Priorities INTERNAL, messages EXPOSED.

**Coach (`coach.py`) — EXPOSED:** `coach_name`, `coach_intro`, `coached_fixes[]` (≤5). Conditions referenced: lufs vs -14/-9 targets, `clipping_detected` + `clipped_sample_count`, `true_peak_db`, `mono_compatibility`, phase-9 surround mono / bass translation / crossfeed.

**Danceability (`danceability.py`) — EXPOSED `danceability_score` (0–100):** weighted 40% BPM-closeness-to-genre-ideal + 40% rhythm onset density (target 8/s) + 20% low-frequency energy (target 0.4 RMS). Per-genre ideal BPM + tolerance tables. `bpm_score`/`rhythm_score`/`energy_score`/`raw` components INTERNAL.

---

## PART 3 — Notable "Computed-then-Discarded" Datapoints Worth Surfacing

These are technically available *today* with minimal change — they are already computed but dropped:

1. **Full 24-key Krumhansl correlation vector** (phase 1) — currently only best-match key + confidence survive. Second-best key, major/minor mode, and full key-profile distances are right there.
2. **Loudness time-series** (phase 1) — momentary (0.4 s) and short-term (3.0 s) full series are computed for LRA then discarded. A loudness-over-time graph is free.
3. **Full mel/STFT spectrogram surfaces** (phases 1, 4) — only band aggregates survive; the full time-frequency data exists transiently.
4. **Onset envelope + onset sample positions** (phase 1) — only count/strength/rate survive; the full transient map is computed.
5. **Spatial analyzer internals** (phase 9) — `high_ratio`, `rms_std`, sub/bass/mid-bass energy ratios, per-window correlation series, crossfeed correlations — ~15 metrics discarded after being folded into 0–100 scores.
6. **Per-stem classification features** (phase 4b) — 7 spectral/temporal features (crest, zcr, centroid, perc_ratio, onset_rate, band ratios) computed per stem, only the role label survives.
7. **ALS device `params{}`** (phase 8) — every plugin parameter value is parsed; almost none is surfaced beyond plugin names.
8. **Per-section measured energy** (phase 7) — currently *faked* from segment confidence. True per-section RMS/LUFS is extractable from phase-1 audio but not computed.
9. **Gap-analysis raw feature vector + genre std** (phase 6) — the 11-dim vector and full distribution stats exist; only percentile summaries ship.

---

## PART 4 — Counts (approximate)

| Phase / module | EXPOSED | INTERNAL (recoverable) |
|----------------|---------|------------------------|
| Phase 1 + structure | ~40 | ~30 |
| Phase 2 | 3 | 1 |
| Phase 3 | 4 + ~12 sub-scores | ~6 |
| Phase 4 + stems | ~60 | ~85 |
| Phase 5 | ~25 | ~10 |
| Phase 6 | ~20 | ~10 |
| Phase 7 + scorer | ~45 | ~35 |
| Phase 8 ALS | ~300 | ~85 |
| Phase 9 + spatial | ~16 | ~30 |
| Rollups/coach/dance | ~10 | ~12 |
| **Total** | **~530 EXPOSED** | **~300 INTERNAL** |

**Grand total: ~800+ distinct technically-extractable datapoints** across the analysis system, of which roughly two-thirds already reach `final_json` and one-third are computed and discarded but recoverable.

---

*Traced from `components/analysis/src/audio_analysis/` at commit on branch `ai-analysis-v2`. Line numbers referenced in the source-of-truth agent traces; this summary aggregates them. Where a phase has two code paths (e.g. demucs vs spectral, stems vs no-stems), both are included.*
