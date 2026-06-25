# Expert-prompt rewrite guide (shared)

You are rewriting ONE LLM expert-prompt markdown file so every data field it
directs the model to read is a path the analysis pipeline ACTUALLY emits. The
worker feeds the model a flattened JSON addressed as `phaseN.<field>`. The old
`audio_analysis.* / section_analysis.* / stem_analysis.*` namespace is DEAD and
must be eliminated.

## Hard rules
1. Replace every legacy token (`audio_analysis.*`, `section_analysis.*`,
   `stem_analysis.*`) EVERYWHERE in the file — the "JSON Fields to Analyze"
   block, threshold tables, "Analysis Steps" pseudocode, "Common Problems",
   example snippets. Not just the field list.
2. Apply your file's mapping. Action codes:
   - `→ phaseN.x` = RENAME: use that real path verbatim.
   - `DERIVE: <expr>` = no field exists; rewrite the reference (and any threshold
     using it) to compute it inline from the given real paths.
   - `DROP` = no emitted source; delete the field row AND any threshold/output
     line that depends solely on it.
3. NEVER write a `phaseN.*` token that isn't in the Allowed Paths below (or an
   existing contract leaf). A non-resolving `phaseN.*` token = NEW drift = fails
   the gate red.
4. `phase1.rms` is LINEAR amplitude, not dB. Any "RMS in dB" reference →
   `DERIVE: 20·log10(phase1.rms)`. `phase1.peak_dbfs` and `phase1.true_peak_db`
   are already dB (rename freely).
5. `phase1.mono_compatibility` is a 0.0–1.0 FLOAT, not a bool. Thresholds that
   treated mono-compat as bool become `< 0.7`.
6. Band names differ: whole-mix = `phase1.bands.{sub_bass,bass,low_mid,mid,
   upper_mid,presence,air}`; stem/phase4 = `phase4.band_energy.{...,high_mid,...}`.
   `high_energy`→`phase1.bands.air`; `high_mid_energy`→`phase1.bands.upper_mid`.
7. DO NOT modify the "## Required Output" JSON-schema block at the bottom (the
   verdict contract — DSP types, params, severity enum). Leave it byte-identical.
8. Preserve the prompt's analysis logic, severities, and output format. Only the
   data addresses (and thresholds keyed on a DROPped field) change.
9. Top-level fields `grade` and `overall_score` are NOT namespace-prefixed; the
   gate never extracts them, so reference them in prose freely.

## Allowed Paths (everything that resolves)
phase1: lufs, rms, peak_dbfs, true_peak_db, clipping_detected,
clipped_sample_count, mono_compatibility, stereo_width, stereo_correlation,
low_energy, bpm, detected_key, duration_seconds,
bands.{sub_bass,bass,low_mid,mid,upper_mid,presence,air},
**crest_factor, key_detection_confidence, spectral_centroid_hz, spectral_contrast,
spectral_flatness, loudness_range_lu, short_term_max_lufs, momentary_max_lufs,
transients.{avg_transient_strength,transient_count,transients_per_second}**
phase2: genre, confidence, bpm
phase3: total_score, genre, sub_scores (dynamic), notes
phase4: band_energy.{sub_bass,bass,low_mid,mid,high_mid,presence,air}, clashes[]
  (.stems/.frequency_range/.severity), stems.{status,mode,per_stem (dynamic),
  clash_matrix[],balance_flags[]}
phase5: status, genre_context.{genre,preset_name,checks(dynamic)}, deltas(dynamic),
  per_stem_reference_deltas[], stem_reference_comparison
phase6: genre, percentile, gaps(dynamic)
phase7: overall_score, grade, total_duration, section_count, structure_score,
  length_score, eight_bar_score, energy_contrast_score, flow_score,
  component_scores.{structure,length,eight_bar,energy_contrast,flow},
  section_scores[], issues[], suggestions[], fixes[], violations[], metadata.*
phase9: spatial.*, surround.*, playback.* (incl. analysis[])
top-level (prose only): grade, overall_score, danceability_score, coached_fixes,
  top_fixes, coach_name, coach_intro

## Self-verify BEFORE returning (iterate until both clean)
```bash
# 1. No legacy tokens remain:
grep -nE '(audio_analysis|section_analysis|stem_analysis)\.' <your-file>   # expect: nothing

# 2. Every phaseN.* token resolves (run from components/worker):
python - <<'PY'
from app.verdict_lib.schema_contract import prompt_paths, path_resolves, load_contract
c = load_contract(); text = open(r"<ABS PATH TO YOUR FILE>", encoding="utf-8").read()
bad = sorted(p for p in prompt_paths(text) if not path_resolves(p, c))
print("BAD:", bad)        # expect: BAD: []
PY
```
Return only when grep is empty AND BAD is []. Report: the two check results +
a 2-line summary of what you changed.
