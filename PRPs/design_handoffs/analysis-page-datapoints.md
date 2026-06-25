# Analysis Results Page — Complete Datapoint Reference

Source of truth: `schemas/final_json.contract.json` (175 production-emitted leaves; updated 2026-06-25 — 🆕 markers flag the full-EMIT additions),
real samples in `schemas/samples/`, `components/shared/aimusic_shared/verdicts/models.py`
(verdicts/fixes), `components/worker/app/verdict_lib/rule_engine.py` (deterministic problems).

**How the blob is shaped.** The pipeline writes `analyses.final_json` as
`{ grade, overall_score, danceability_score, coach_*, top_fixes, phases: [ {phase, name, status, data}, … ] }`.
The verdict/rule layer reads a **flattened** view where each field is addressed as
`phaseN.<field>` (e.g. `phase1.lufs`). Both forms are listed below — use the nested
`data` form for rendering, the `phaseN.*` form when wiring the fix engine.

**Availability tiers** (what each phase needs to exist):
- **Mix only** (every analysis): phases 1, 2, 3, 6, 7, 9 + all top-level fields + phase 4 `band_energy`/`clashes`.
- **Stems uploaded**: phase 4 `stems.*` (grouped + per-stem) populates.
- **.als uploaded**: phase 8 + the separate `alsProject` blob on the results DTO.
- **Reference profile / genre profile**: phase 6 `gaps` (the comparison engine — drives Tab 5; runs against a user reference profile when attached, else the genre statistical profile). Legacy phase 5 + `per_stem_reference_deltas` are the older single-reference-file path.

⚠️ **Two different band systems — NOT comparable** (do not diff or share a widget):
`phase1.bands` and `phase4.band_energy` are separate analyses that merely share 6
of 7 labels. Phase 1 cuts bands by **mel-spectrogram bins** (perceptual) and
reports `power_to_db(ref=max)` (normalized to the track's own peak); Phase 4 cuts
by **explicit Hz ranges** (`high_mid` = 2000–6000 Hz) and reports per-band **RMS
dB**. The 5th band is even named differently (`upper_mid` vs `high_mid`). Use
`phase1.bands.*` for the whole-mix tonal readout (General Stats) and
`phase4.band_energy.*` only for stems (Stems tab); never subtract one from the
other. Don't "fix" the name collision by aligning keys — that would falsely imply
they're the same measurement.

---

## TOP-LEVEL (header / hero — always present)

| Field | `flatten` path | Type | Notes |
|---|---|---|---|
| `grade` | `grade` | string `"A"`–`"F"` (or `"…"`/`"N/A"` for pending/unavailable arrangement) | Overall grade. Derived from `phase3.total_score`, **not** phase 7. |
| `overall_score` | `overall_score` | number 0–100 | Overall mix score. |
| `danceability_score` | `danceability_score` | int 0–100 | Genre-aware (BPM 40% / rhythm 40% / low-freq 20%). |
| `coach_name` | `coach_name` | string | Coach persona name. |
| `coach_intro` | `coach_intro` | string | One-paragraph coach intro. |
| `coached_fixes[]` | `coached_fixes` | string[] (≤5) | Template-voiced fix list referencing measured values. |
| `top_fixes[]` | `top_fixes` | string[] | Highest-priority fix headlines (rollup). |
| `file_path` | `file_path` | string | Source audio path. |

---

## TAB 1 — GENERAL STATS (from the audio file alone)

### Phase 1 — Universal Mix Analysis (`phases[].phase==1` → `data`)
Loudness / peak / dynamics / stereo / spectral — the core meter wall.

| Field (`data.*`) | `flatten` path | Type | Unit / range |
|---|---|---|---|
| `lufs` | `phase1.lufs` | number | Integrated LUFS (negative) |
| `rms` | `phase1.rms` | number | dBFS |
| `peak_dbfs` | `phase1.peak_dbfs` | number | dBFS |
| `true_peak_db` | `phase1.true_peak_db` | number | dBTP (4× oversampled) |
| `clipping_detected` | `phase1.clipping_detected` | bool | |
| `clipped_sample_count` | `phase1.clipped_sample_count` | int | |
| `mono_compatibility` | `phase1.mono_compatibility` | number | 0.0–1.0 RMS fold-down ratio |
| `stereo_width` | `phase1.stereo_width` | number | ratio |
| `stereo_correlation` | `phase1.stereo_correlation` | number | −1.0 … +1.0 |
| `low_energy` | `phase1.low_energy` | number | 20–200 Hz RMS |
| `bpm` | `phase1.bpm` | number | raw beat-tracked BPM |
| `detected_key` | `phase1.detected_key` | string | e.g. `"A#"` (chroma-CQT pitch class) |
| `key_detection_confidence` 🆕 | `phase1.key_detection_confidence` | number | 0.0–1.0 Krumhansl key-profile fit (<0.5 ≈ ambiguous/modal — qualify the key badge with it) |
| `duration_seconds` | `phase1.duration_seconds` | number | seconds |
| `bands.sub_bass` | `phase1.bands.sub_bass` | number | band energy (dB) |
| `bands.bass` | `phase1.bands.bass` | number | dB |
| `bands.low_mid` | `phase1.bands.low_mid` | number | dB |
| `bands.mid` | `phase1.bands.mid` | number | dB |
| `bands.upper_mid` | `phase1.bands.upper_mid` | number | dB (note: `upper_mid` here) |
| `bands.presence` | `phase1.bands.presence` | number | dB |
| `bands.air` | `phase1.bands.air` | number | dB |
| `structure` | (not flattened) | `{ sections[], beats[] }` | allin1 structure (deferred; feeds phase 7). May be a `{deferred:true}` placeholder while background detection runs. |

**🆕 Phase 1 metrics added 2026-06-25 (full-EMIT reconciliation).** These are now emitted on every analysis and are strong candidates for a **Dynamics**, **Loudness detail**, and **Tone/Clarity** group in General Stats.

| Field (`data.*`) | `flatten` path | Type | Unit / range — design use |
|---|---|---|---|
| `crest_factor` | `phase1.crest_factor` | number | dB (peak − RMS). **Punch / dynamic range** meter; <4 squashed, 8–14 healthy, >22 very wide |
| `loudness_range_lu` | `phase1.loudness_range_lu` | number | LU (EBU R128 LRA). Loudness variation across the track |
| `short_term_max_lufs` | `phase1.short_term_max_lufs` | number | LUFS (loudest 3 s window) |
| `momentary_max_lufs` | `phase1.momentary_max_lufs` | number | LUFS (loudest 0.4 s window) |
| `spectral_centroid_hz` | `phase1.spectral_centroid_hz` | number | Hz — **brightness** (low=dark, high=bright) |
| `spectral_contrast` | `phase1.spectral_contrast` | number | dB mean — **clarity / separation** (higher = clearer) |
| `spectral_flatness` | `phase1.spectral_flatness` | number | 0.0–1.0 — tonal↔noisy (0 tonal, →1 noise-like) |
| `transients.avg_transient_strength` | `phase1.transients.avg_transient_strength` | number | onset-envelope mean — attack energy |
| `transients.transient_count` | `phase1.transients.transient_count` | int | total detected onsets |
| `transients.transients_per_second` | `phase1.transients.transients_per_second` | number | onset density — **punch / busyness** |

> Together with the existing `lufs` / `true_peak_db`, the four loudness fields
> (`lufs`, `short_term_max_lufs`, `momentary_max_lufs`, `loudness_range_lu`) now
> support a full **streaming-readiness loudness panel** (integrated vs platform
> targets + peak windows + dynamics), and `crest_factor` + `transients.*` support a
> **dynamics/punch** readout that didn't exist when this doc was first written.

### Phase 2 — Genre Detection
| Field | `flatten` path | Type |
|---|---|---|
| `genre` | `phase2.genre` | string (**authoritative genre**) |
| `confidence` | `phase2.confidence` | number 0–1 |
| `bpm` | `phase2.bpm` | number (genre-model BPM) |

### Phase 3 — Genre-Specific Scoring (drives the overall grade)
| Field | `flatten` path | Type |
|---|---|---|
| `total_score` | `phase3.total_score` | number 0–100 → **source of top-level grade** |
| `genre` | `phase3.genre` | string |
| `sub_scores` | `phase3.sub_scores.*` | dynamic dict — keys vary by genre. Observed: `stereo_width`, `frequency_balance`. |
| `notes[]` | `phase3.notes` | string[] (often empty) |

### Phase 6 — Gap Analysis vs a profile (mix only; `gaps` needs a profile) → **drives Tab 5**
Runs **once** against a single effective profile: an attached **user reference
profile** if present, else the **genre statistical profile** (default fallback).
This is the engine for the Reference Comparison tab — see Tab 5.

| Field | `flatten` path | Type |
|---|---|---|
| `genre` | `phase6.genre` | string |
| `percentile` | `phase6.percentile` | number 0–100 |
| `gaps` | `phase6.gaps.*` | dynamic dict keyed by metric name. Each value: `{user_val, genre_mean, genre_std, acceptable_range:[lo,hi], delta, percentile, description, in_range}` (often empty unless a profile matched). Note: `genre_mean`/`genre_std` are the profile's mean/std regardless of profile kind. |
| `profile_kind` | `phase6.profile_kind` | `'user'｜'genre'｜'genre_statistical'` — which kind of profile produced the gaps. Drives the Tab 5 chip/label. Absent on older results ⇒ treat as genre. |
| `profile_name` | `phase6.profile_name` | string — display name (the user profile's name, or the genre name). |
| `profile_hue` | `phase6.profile_hue` | int｜null — hue for the user-profile chip (null for genre profiles). |
| `track_count` | `phase6.track_count` | int — how many reference tracks the profile aggregates ("based on N tracks"). |

### Phase 7 — Arrangement Advice (uses deferred allin1 structure)
| Field | `flatten` path | Type |
|---|---|---|
| `overall_score` | `phase7.overall_score` | number 0–100 |
| `grade` | `phase7.grade` | string |
| `total_duration` | `phase7.total_duration` | seconds |
| `section_count` | `phase7.section_count` | int |
| `structure_score` / `length_score` / `eight_bar_score` / `energy_contrast_score` / `flow_score` | `phase7.<name>_score` | number |
| `component_scores.{structure,length,eight_bar,energy_contrast,flow}` | `phase7.component_scores.*` | number |
| `section_scores[]` | `phase7.section_scores[]` | each: `{section_type, start_time, end_time, duration, bars, score, time_range, eight_bar_compliant, checks[], issues[]}` |
| `issues[]` | `phase7.issues[]` | each: `{severity, message, section, fix_suggestion}` |
| `suggestions[]` / `fixes[]` / `violations[]` | `phase7.suggestions` / `.fixes` / `.violations` | string[] |
| `metadata` | `phase7.metadata.*` | `{total_bars, section_count, detected_tempo, energy_contrast_db, has_intro, has_buildup, has_drop, has_breakdown, has_outro}` |
| `arrangement_status` | — | `'pending'｜'unavailable'｜'scored'` — **render state**: `pending` = background detection running (poll); `unavailable` = detector off; `scored` = real score. |

### Phase 9 — Mix Translation (spatial / playback readiness) — all scores 0–100
| Field | `flatten` path | Type |
|---|---|---|
| `spatial.height_score` / `depth_score` / `width_consistency` | `phase9.spatial.*` | number |
| `spatial.analysis[]` | `phase9.spatial.analysis` | string[] |
| `surround.mono_compatibility` / `phase_score` | `phase9.surround.*` | number |
| `surround.is_atmos_ready` | `phase9.surround.is_atmos_ready` | bool |
| `surround.analysis[]` | `phase9.surround.analysis` | string[] |
| `playback.headphone_score` / `speaker_score` | `phase9.playback.*` | number |
| `playback.crossfeed_safe` | `phase9.playback.crossfeed_safe` | bool |
| `playback.bass_translation` | `phase9.playback.bass_translation` | `'good'｜'weak'｜'excessive'` |
| `playback.analysis[]` | `phase9.playback.analysis` | string[] |

### Phase 4 — full-mix spectral (present even without stems)
| Field | `flatten` path | Type |
|---|---|---|
| `band_energy.{sub_bass,bass,low_mid,mid,high_mid,presence,air}` | `phase4.band_energy.*` | number (dB) — note `high_mid` not `upper_mid` |
| `clashes[]` | `phase4.clashes[]` | each: `{stems, frequency_range, severity}` (full-mix masking; `stems` is a label like `"low-end buildup"`) |

---

## TAB 2 — STEMS (only when stems uploaded → `phase4.stems`)

`phase4.stems` (`flatten` prefix `phase4.stems.*`):

| Field | `flatten` path | Type |
|---|---|---|
| `status` | `phase4.stems.status` | `"ok"｜"skipped"｜…` |
| `mode` | `phase4.stems.mode` | `"grouped"｜"per_stem"` |
| `per_stem` | `phase4.stems.per_stem.*` | dynamic dict keyed by **role** (`kick,snare,hats,drums,bass,vocals,lead,pad,fx,other`). |
| `clash_matrix[]` | `phase4.stems.clash_matrix[]` | each: `{stem_a, stem_b, band, overlap_severity, severity_tier}` |
| `balance_flags[]` | `phase4.stems.balance_flags[]` | each: `{role, metric, observed, expected_range, direction, severity_tier}` |

**Per-stem object** (`phase4.stems.per_stem.<role>`):
`lufs_integrated`, `rms_db`, `peak_db`, `dynamic_range_db`, `band_energy_db`,
`dominant_frequencies_hz`, `spectral_centroid_hz`, `stereo_width`, `pan_estimate`,
`is_mono`, `duration_s`.

**Stem upload metadata** (BFF, pre-analysis — `StemRawDto`):
`id, originalFilename, detectedRole, confidence, evidence, confirmedRole`.
Roles enum = `StemRole`. Audio is streamable at `GET /versions/{id}/stems/{stemId}/audio`.

---

## TAB 3 — .als PROJECT (only when .als uploaded)

Two independent sources:

### A. Phase 8 — server-side .als parse (`phase8.*`)
| Field | `flatten` path | Type |
|---|---|---|
| `health_score` / `grade` | `phase8.health_score` / `phase8.grade` | number / string |
| `tempo` | `phase8.tempo` | number |
| `ableton_version` | `phase8.ableton_version` | string |
| `time_signature` | `phase8.time_signature` | string |
| `total_devices` / `disabled_devices` / `clutter_pct` | `phase8.*` | number |
| `plugin_list[]` | `phase8.plugin_list` | string[] |
| `has_humanized_midi` | `phase8.has_humanized_midi` | bool |
| `quantization_issues_count` | `phase8.quantization_issues_count` | int |
| `total_chord_count` / `midi_note_count` / `audio_clip_count` | `phase8.*` | int |
| `total_duration_seconds` | `phase8.total_duration_seconds` | number |
| `tracks[]` | `phase8.tracks[]` | each: `{name, type, device_count, disabled_count, muted}` |
| `midi` | `phase8.midi.*` | `{total_clips, total_notes, empty_clips, short_clips, duplicate_clips, tracks_without_content, issues[]}` |
| `midi.issues[]` | `phase8.midi.issues[]` | each: `{track, clip, type, severity, description, fix}` |
| `arrangement` | `phase8.arrangement.*` | `{has_markers, total_sections, pattern, sections[]}` |
| `arrangement.sections[]` | `phase8.arrangement.sections[]` | each: `{name, start_beat, end_beat, duration_bars}` |

### B. `alsProject` — client-parsed project map (on `JobResultsDto.alsProject`, **not** in `final_json`)
`AlsProjectJson`: `schemaVersion, source, tempo, timeSignature,
timeSignatureNumerator, timeSignatureDenominator, abletonVersion, trackCount,
tracks[], devices[], plugins[]`.
`tracks[]` = `{index, name, type:'audio'|'midi', color, devices[]}`.

---

## TAB 4 — PROBLEMS (separate tracked list)

A "problem" = a **Verdict**. Two producers, same shape:
1. **Rule engine** (deterministic, always runs, LLM-independent) — `specialist:"rule_engine"`.
2. **AI specialists** (on-demand / batch) — `specialist:<slug>`.

### Verdict (`VerdictDto` wire / `Verdict` model)
| Field | Type | Notes |
|---|---|---|
| `id` / `verdict_id` | string (`vrd_…`) | |
| `specialist` | string | `"rule_engine"` or specialist slug |
| `severity` | `'critical'｜'severe'｜'moderate'｜'minor'｜'win'` | sort/priority key |
| `category` | enum (25 values) | `low_end, frequency_balance, dynamics, stereo_phase, loudness, sections, trance_arrangement, stem_reference, harmonic, clarity, spatial, surround, playback, overall, gain_staging, stereo_field, frequency_collision, humanization, section_contrast, density, chord_harmony, device_chain, priority_summary, clipping, mono_compatibility` |
| `confidence` | number 0–1 | |
| `priorityScore` / `priority_score` | int | **authoritative** ranking (Python-computed; never the LLM's) |
| `headline` | string ≤80 | |
| `summary` | string ≤300 | |
| `whyItMatters` / `why_it_matters` | string ≤200 | |
| `evidence[]` | `Evidence[]` | the measured proof (see below) |
| `fix` | `Fix｜null` | the actionable fix (see Actions) |
| `impact` / `metricLine` / `chartType` / `presetName` / `body` | string｜null | display extras |
| `sources` | string[] | provenance (`["rule_engine"]` etc.) |
| `related_verdict_ids` | string[] | dedupe/cluster links |
| `userState` | `{dismissed, applied, feedback}` | per-user overlay |

### Evidence (the datapoint a problem points at)
`{ metric: "phaseN.<field>", value, expected_range:[lo,hi], delta_pct, label,
frequency_range_hz:[lo,hi], stems[] }`.
`metric` is a real flattened path — it must resolve in `final_json` (validator
rejects ±>10% mismatch). This is the link from a problem back to its number.

### Deterministic rule catalog (always-on guardrail; thresholds are fixed)
| Rule | reads | fires when | severity / category |
|---|---|---|---|
| `clipping_detected` | `phase1.clipping_detected` (+`clipped_sample_count`) | clipping true | critical / clipping |
| `true_peak_over_minus_1` | `phase1.true_peak_db` | > −1.0 dBTP | severe / loudness |
| `mono_incompatible` | `phase1.mono_compatibility` | < 0.7 | severe / mono_compatibility |
| `loudness_too_high_for_streaming` | `phase1.lufs` | > −8.0 | moderate / loudness |
| `loudness_too_low_for_streaming` | `phase1.lufs` | < −20.0 | moderate / loudness |
| `stereo_correlation_negative` | `phase1.stereo_correlation` | < −0.1 | severe / stereo_phase |
| `excessive_dynamic_range` 🆕 | `phase1.crest_factor` | > 22 dB | minor / dynamics |
| `tiny_dynamic_range` 🆕 | `phase1.crest_factor` | < 4 dB | severe / dynamics |
| `key_detection_low_confidence` 🆕 | `phase1.key_detection_confidence` | < 0.5 | minor / harmonic |

> **9 of 11 rules are now live** (the 6 above + the 3 🆕 revived 2026-06-25). So the
> Problems tab now has deterministic dynamics + key-confidence findings on every
> analysis, not just clipping/loudness/stereo. Only **2 rules remain dead**:
> `low_mid_mud_trance` / `low_mid_mud_generic` (need `phase3.low_mid_energy` +
> genre — separate PRP). Design the Problems list assuming dynamics/harmonic
> rule-cards can appear.

### Reference-gated problem sources (only with stems/reference)
- `phase4.stems.balance_flags[]` and `phase4.stems.clash_matrix[]` (each carries
  `severity_tier`) → stem-balance / stem-clash problems.
- `phase5.per_stem_reference_deltas[]` (`severity_tier`, `interpretation`) →
  stem-vs-reference problems.
- `phase7.issues[]` (`severity`, `fix_suggestion`) → arrangement problems.
- `phase8.midi.issues[]` (`severity`, `fix`) → project-hygiene problems.

---

## TAB 5 — REFERENCE PROFILE COMPARISON

**Driven by phase 6** (`phase6.gaps` + `profile_*` fields above), which runs once
against the effective profile (attached **user reference profile** → **genre
statistical profile** default → none). This is the canonical content of the tab.
Render the percentile ring + per-metric gap rows (`user_val` vs `genre_mean`,
`acceptable_range`, `in_range`), labeled with `profile_kind` / `profile_name` /
`profile_hue` and "based on `track_count` tracks". See `analysis-page-states.md`
Tab 5 for the no-profile / not-ready / user-vs-genre / re-run-override states.

A profile is built/selected from the user's reference library
(`ReferenceSetDto` = a named set + hue + member count; `ReferenceDto` = one
analyzed reference track). The BFF aggregates a set's analyzed members into the
phase-6 `feature_statistics {mean, std}` shape (see the reference-profiles spec).

### Phase 5 — Reference Comparison (LEGACY single-reference-file path; `skipped` by default)
Not used by the reference-profile feature; retained for the older single-ref
delta. Stays `status:"skipped"` unless a single reference file is explicitly wired.
| Field | `flatten` path | Type |
|---|---|---|
| `status` | `phase5.status` | `"ok"｜"skipped"｜…` |
| `genre_context.genre` | `phase5.genre_context.genre` | string |
| `genre_context.preset_name` | `phase5.genre_context.preset_name` | string |
| `genre_context.checks` | `phase5.genre_context.checks.*` | dict keyed by check name. Observed keys: **`lufs`, `bpm`, `correlation`**. Each: `{status:'ok'|'warn'|'fail', message, value}`. |
| `deltas` | `phase5.deltas.*` | dynamic dict of metric → delta vs reference |
| `per_stem_reference_deltas[]` | `phase5.per_stem_reference_deltas[]` | each: `{role, metric, user_value, reference_value, delta, interpretation, severity_tier}` |
| `stem_reference_comparison` | `phase5.stem_reference_comparison` | container |

### Plus Phase 6 `gaps` (above) and the saved reference object (`ReferenceDto`):
`title, artist, genre, bpm, detectedKey, durationSeconds, lufs, truePeakDb,
dynamicRangeLu, stereoWidth, stereoCorrelation, bandLevels, tags` — the per-metric
target values to diff the user's track against.

---

## ACTIONS SECTION (mostly unchanged; problems now a separate list)

An "action" = a Verdict's **`fix`** (`Fix` model). This is the structured,
machine-checkable remediation:

| Field | Type | Notes |
|---|---|---|
| `fix_id` | string | |
| `target` | `{type:'stem'｜'master'｜'bus', name}` | what to process |
| `section` | `{start_seconds, end_seconds}｜null` | time-scoped fix (else whole track) |
| `dsp_chain[]` | `DspOp[]` | the ordered processing chain (see below) |
| `sidechain` | dict｜null | sidechain routing |
| `expected_outcome` | string | what the fix should achieve |
| `ableton_hint` | dict｜null | device/parameter hint for .als users |

**`DspOp` = `{type, params}`.** `type` ∈ `peaking_eq, low_shelf, high_shelf,
high_pass, low_pass, compressor, multiband_compressor, limiter, gain,
stereo_width, sidechain`. `params` are **range-validated** per type — these double
as the UI's editable controls + bounds:
- EQ (`peaking_eq`/shelves): `frequency_hz` 20–22000, `gain_db` −24…24, `q` 0.1–18
- `high_pass`/`low_pass`: `frequency_hz`, `slope_db` 6–96, `q`
- `compressor`: `threshold_db` −60…0, `ratio` 1–20, `attack_ms` 0.1–1000, `release_ms` 1–5000, `knee_db` 0–24, `makeup_gain_db` 0–24
- `multiband_compressor`: `bands` (list), + compressor params
- `limiter`: `ceiling_db` −6…0, `threshold_db`, `release_ms`, `lookahead_ms` 0–10
- `gain`: `gain_db` −24…24
- `stereo_width`: `width_pct` 0–200
- `sidechain`: `source_stem`, `depth_db` 0–24, `release_ms`, `ratio`, `threshold_db`, `attack_ms`

`userState.applied` / `userState.user_modified_fix` track action state per user.

---

## THE FIX-DETERMINATION SYSTEM — inputs available

Determining "what fix to apply for a problem" draws on:

1. **The measured value the problem points at** — `Evidence.metric` (a flattened
   `phaseN.*` path) + `Evidence.value` + `Evidence.expected_range`. This is the
   gap to close.
2. **The full flattened analysis** — every leaf in `final_json.contract.json`
   (175 paths) is addressable by the engine. Band energies (`phase1.bands.*` /
   `phase4.band_energy.*`), per-stem metrics (`phase4.stems.per_stem.<role>.*`),
   loudness/peak/stereo from phase 1, and the 🆕 dynamics (`crest_factor`),
   loudness-range (`loudness_range_lu`), and tone (`spectral_centroid_hz`/
   `spectral_contrast`/`spectral_flatness`) metrics are the primary fix inputs.
3. **The target** — `Fix.target.{type,name}` (master / bus / stem role).
4. **The constraint envelope** — the `DspOp` param ranges above bound any
   generated fix; a fix outside them is rejected at validation.
5. **Severity/category + priority_score** — to order and gate which problems get
   an action.
6. **Genre context** — `phase2.genre`, `phase6.gaps[].acceptable_range`,
   `phase5.genre_context.checks` give the per-genre "correct" targets.

The deterministic rule engine already encodes threshold→evidence for the 6 live
rules; extending it to also emit a `Fix` (currently `fix=None` for rule verdicts)
is the natural home for a rules-based fix determiner. LLM specialists already emit
`Fix` objects. Where the determiner lives (rule-engine extension vs a new
prescription engine) is the open design question flagged in
`PRPs/detection-prescription-inventory.md` (the "two-engine" split).
