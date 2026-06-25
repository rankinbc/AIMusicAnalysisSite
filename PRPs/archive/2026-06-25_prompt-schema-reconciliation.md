# PRP: Reconcile the 14 expert prompts to the real `final_json` schema

## ✅ SHIPPED 2026-06-25 (full-EMIT scope)

Executed at the user's chosen **full-EMIT** scope (not the prompts-only draft
below). What actually landed:

- **Pipeline EMIT** — `phase1_universal.analyze()` now emits 11 new metrics:
  `crest_factor`, `key_detection_confidence` (Krumhansl key-profile fit),
  `spectral_centroid_hz`, `spectral_contrast`, `spectral_flatness`,
  `loudness_range_lu`, `short_term_max_lufs`, `momentary_max_lufs`, and
  `transients.{avg_transient_strength,transient_count,transients_per_second}`.
  Crest = `peak_dbfs − 20·log10(rms)` (the draft's `peak_dbfs − rms` was WRONG —
  `phase1.rms` is linear). Windowed loudness via per-window `pyloudnorm.Meter`,
  bounded to ≤300/150 windows.
- **Contract** — 11 leaves added to `contract_extras.json::manual_leaves`;
  regenerated → 175 leaves (was 164).
- **Prompts** — all 14 reconciled to real `phaseN.*` paths; with EMIT, former
  REMOVE rows became RENAME. Zero legacy tokens remain in any of the 27 prompts.
- **Rules revived** — emitting `crest_factor`/`key_detection_confidence` made
  `excessive_dynamic_range`, `tiny_dynamic_range`, `key_detection_low_confidence`
  live; their `xfail` tests were converted to real fires + no-fire.
  `low_mid_mud_*` stay dead (need `phase3.low_mid_energy`/`genre_hint`).
- **Baseline** — `prompts: []` (was 152); `rules: 4` (was 7); `fixtures: 20`
  (was 30).
- **Validation** — analysis 131 ✓, worker verdict_pipeline+inspector 174 ✓,
  3 ratchet gates ✓, ruff ✓.
- **Known limits / follow-ups**: (1) a few non-metric fields remain DERIVE/DROP
  (composite scores, issue lists, interpretation labels) — they have no scalar
  source. (2) Windowed-loudness adds ~3-6 s to phase 1 on long CPU tracks
  (acceptable; optimize with a single-pass K-weighting later). (3) `key_detection
  _low_confidence` firing rate in production should be monitored (Krumhansl
  threshold 0.5). (4) The lint regex can't validate array-item sub-fields
  (`section_scores[].x`, `per_stem.role.x`) — these were hand-verified against
  the real schema.

Original prompts-only plan retained below for reference.

---

## Purpose
Rewrite the 14 LLM specialist/Triage prompts so every data field they direct the
model to read is a path the pipeline **actually emits** (`phaseN.*` per
`schemas/final_json.contract.json`), eliminating the dead
`audio_analysis.* / section_analysis.* / stem_analysis.*` namespace, and burn the
152 prompt entries out of `schemas/_schema_drift_baseline.json`.

## Core Principles
1. **Prompts-only + baseline.** No `components/analysis` pipeline changes, no new
   metrics, no migration, no frontend. Every fix is achievable by RENAME or by
   DERIVE-inline from already-emitted fields. (Metrics that would need a real new
   pipeline computation are removed here and tracked as a follow-up — see Out of
   Scope.)
2. **The contract is ground truth.** `schemas/final_json.contract.json`
   (`leaf_paths` + `dynamic_prefixes` + `bare_top_level_allowed`) defines what
   resolves. Never invent a path; never introduce a `phaseN.*` token the contract
   doesn't emit (that creates NEW drift and fails the lint red).
3. **The lint is the gate.** `prompt_paths()` extracts only tokens matching
   `\b(?:phase[1-9]|audio_analysis|section_analysis|stem_analysis)(?:\.\w+(?:\[\d+\])?)+`.
   So: (a) every remaining legacy-namespace token must be gone; (b) every new
   `phaseN.*` token must resolve; (c) bare field names with no namespace prefix
   (e.g. a prose mention of "peak_dbfs") are invisible to the lint — but prefer
   real `phase1.peak_dbfs` paths so the field-guide stays correct.
4. **Preserve specialist capability.** A DROP must not silently delete a check the
   specialist needs — if the value is computable from emitted fields, DERIVE it
   inline; only fully REMOVE when there is no emitted source and no proxy.
5. **No semantic drift in advice.** Keep each prompt's analysis logic, thresholds,
   and output schema. Only the *data addresses* (and any threshold expressed in
   terms of a dropped field) change.

## Goal
After this PRP: `current_drift_offenders()["prompts"] == []`, the `prompts` array
in `_schema_drift_baseline.json` is empty (all 152 lines deleted), and
`tests/test_schema_contract_lints.py` is green (no new drift, no stale baseline).
The `rules` (7) and `fixtures` (30) baseline entries are untouched — out of scope.

## Why
- 14 of 27 prompts cite ~155 dead paths (`schemas/_schema_drift_baseline.json`
  `prompts`, 152 deduped). The worker feeds the model flattened `phaseN.*` JSON,
  so these field-guides point at nothing; `validator._resolve_path` silently drops
  any verdict that obeys them (see memory `final-json-schema-drift`).
- Net effect: the LLM specialists improvise field semantics over a blob whose
  documented schema is wrong. Fixing the field-guides is a prerequisite for the
  Problems/Actions tabs of the Analysis-page redesign to be reliable.

## What
Per-prompt, apply one of three handling verbs to each dead path, then delete the
corresponding baseline lines:
- **RENAME** → swap the legacy token for the resolving `phaseN.*` path.
- **DERIVE** → the value is computable from emitted fields; rewrite the reference
  (and any threshold/step using it) to compute it inline from real `phaseN.*`
  paths. Remove the legacy token.
- **REMOVE** → no emitted source and no proxy; delete the field row from the
  "JSON Fields to Analyze" block and any threshold/output line that depends solely
  on it. Remove the legacy token.

### Success Criteria
- [ ] Zero `audio_analysis.* / section_analysis.* / stem_analysis.*` tokens remain in any of the 14 prompts (`grep -rE '(audio_analysis|section_analysis|stem_analysis)\.' components/worker/prompts/experts/` returns nothing).
- [ ] Every `phaseN.*` token introduced resolves via `schema_contract.path_resolves` (no new drift).
- [ ] `schemas/_schema_drift_baseline.json` `prompts` array is `[]` (all 152 lines removed); `rules` and `fixtures` arrays unchanged.
- [ ] `pytest tests/test_schema_contract_lints.py -q` green (all 3 tests).
- [ ] `pytest tests/verdict_pipeline/ -q` green (no prompt-loader / orchestrator regressions).
- [ ] `ruff check` clean; no prompt's required-output JSON schema block was altered.

## All Needed Context

### Documentation & References
```yaml
- file: schemas/final_json.contract.json
  why: authoritative resolving-path set. Note band-name split — phase1.bands.* uses
       upper_mid; phase4.band_energy.* uses high_mid.
- file: components/worker/app/verdict_lib/schema_contract.py
  why: prompt_paths() extractor regex + path_resolves() (exact leaf | ancestor |
       dynamic prefix | bare_top_level_allowed). The gate's mechanics.
- file: components/worker/tests/test_schema_contract_lints.py
  why: the 2 ratchet tests. diff_stale fails red until you DELETE fixed baseline lines.
- file: schemas/_schema_drift_baseline.json
  why: the 152 prompt lines to burn down (delete after each prompt is fixed).
- file: components/worker/app/verdict_lib/prompt_loader.py
  why: SLUG_TO_FILENAME + TRIAGE_FILENAME — the canonical 14-file list the lint scans.
- file: components/worker/prompts/experts/Loudness.md
  why: representative structure — "## JSON Fields to Analyze" block + threshold
       tables + analysis-step pseudocode + required-output JSON schema (DO NOT TOUCH
       the output schema block).
- memory: final-json-schema-drift
  why: the three-schema history + why this matters.
```

### Gate mechanics (how to know a prompt is done)
```python
# Per-file check the executor runs after editing each prompt:
from app.verdict_lib.schema_contract import prompt_paths, path_resolves, load_contract
c = load_contract(); text = open(PROMPT).read()
bad = [p for p in prompt_paths(text) if not path_resolves(p, c)]
assert bad == []      # no dead/legacy tokens, no new drift
# path_resolves accepts ancestors (phase1.bands), dynamic prefixes
# (phase3.sub_scores, phase4.stems.per_stem), and exact leaves
# (phase9.playback.analysis[]). Top-level fields (grade, overall_score) are NOT
# namespace-prefixed, so the regex never extracts them — reference them in prose.
```

### Known Gotchas
```
# CRITICAL: do NOT introduce phase1.crest_factor / phase1.key_detection_confidence /
#   phase1.low_mid_energy / any centroid|LRA|transient|clarity token. The pipeline
#   does NOT emit them — they'd be NEW drift (test_no_unbaselined_schema_drift → red).
#   Crest factor MUST be derived inline: "crest = phase1.peak_dbfs − phase1.rms".
# CRITICAL: mono compatibility is a 0.0–1.0 FLOAT (phase1.mono_compatibility), not a
#   bool. Prompts that did `if is_mono_compatible == false` must become `< 0.7`.
# CRITICAL: band names differ. Whole-mix → phase1.bands.{sub_bass,bass,low_mid,mid,
#   upper_mid,presence,air}. Stem/phase4 → phase4.band_energy.{...,high_mid,...}.
#   high_energy→phase1.bands.air; high_mid_energy→phase1.bands.upper_mid.
# After fixing a prompt, its baseline lines become STALE → test_baseline_has_no_stale_
#   entries fails until you delete them. Delete prompt lines as you go (or all at the end).
# Do NOT touch the rules (7) or fixtures (30) baseline arrays — separate PRPs.
# The "## Required Output" JSON schema block at the bottom of each prompt is the
#   verdict contract — leave it byte-identical.
```

## Implementation Blueprint — the authoritative mapping (152 paths)

Handling verb per row. `RENAME`→real path. `DERIVE`→compute inline from the listed
real fields. `REMOVE`→delete field + dependent threshold/output.

### Task 1 — ClarityAnalysis.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.clarity.brightness | REMOVE | no centroid emitted (follow-up EMIT) |
| audio_analysis.clarity.brightness_category | REMOVE | |
| audio_analysis.clarity.clarity_score | REMOVE | |
| audio_analysis.clarity.issues | REMOVE | |
| audio_analysis.clarity.masking_risk | REMOVE | (stem-only proxy `phase4.clashes[].severity` — don't substitute) |
| audio_analysis.clarity.recommendations | REMOVE | |
| audio_analysis.clarity.spectral_contrast | REMOVE | |
| audio_analysis.clarity.spectral_flatness | REMOVE | |
| audio_analysis.frequency | RENAME | `phase1.bands` |
| audio_analysis.frequency.balance_issues | REMOVE | |
| audio_analysis.frequency.spectral_centroid_hz | REMOVE | |
> ClarityAnalysis loses most inputs; reframe it to read `phase1.bands.*` proportions
> only. (Its richer brightness/clarity inputs need the follow-up EMIT PRP.)

### Task 2 — Dynamics.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.clipping.clip_count | RENAME | `phase1.clipped_sample_count` |
| audio_analysis.clipping.clip_positions | REMOVE | no per-clip timestamps |
| audio_analysis.clipping.has_clipping | RENAME | `phase1.clipping_detected` |
| audio_analysis.dynamics.crest_factor_db | DERIVE | `phase1.peak_dbfs − phase1.rms` |
| audio_analysis.dynamics.crest_interpretation | DERIVE | from derived crest in-prompt |
| audio_analysis.dynamics.dynamic_range_db | DERIVE | `phase1.peak_dbfs − phase1.rms` |
| audio_analysis.dynamics.is_over_compressed | DERIVE | derived crest < 8 |
| audio_analysis.dynamics.peak_db | RENAME | `phase1.peak_dbfs` |
| audio_analysis.dynamics.rms_db | RENAME | `phase1.rms` |
| audio_analysis.transients.attack_quality | REMOVE | no transient suite |
| audio_analysis.transients.avg_transient_strength | REMOVE | |
| audio_analysis.transients.transient_count | REMOVE | |
| audio_analysis.transients.transients_per_second | REMOVE | |
| section_analysis.sections | RENAME | `phase7.section_scores[]` |

### Task 3 — FrequencyBalance.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.frequency.balance_issues | REMOVE | |
| audio_analysis.frequency.bass_energy | RENAME | `phase1.bands.bass` |
| audio_analysis.frequency.high_energy | RENAME | `phase1.bands.air` |
| audio_analysis.frequency.high_mid_energy | RENAME | `phase1.bands.upper_mid` |
| audio_analysis.frequency.low_mid_energy | RENAME | `phase1.bands.low_mid` |
| audio_analysis.frequency.mid_energy | RENAME | `phase1.bands.mid` |
| audio_analysis.frequency.problem_frequencies | REMOVE | |
| audio_analysis.frequency.spectral_centroid_hz | REMOVE | |
| audio_analysis.frequency.sub_bass_energy | RENAME | `phase1.bands.sub_bass` |
| section_analysis.all_issues | RENAME | `phase7.issues[]` |
| section_analysis.sections | RENAME | `phase7.section_scores[]` |
| stem_analysis.clashes | RENAME | `phase4.clashes[]` (stem-keyed: `phase4.stems.clash_matrix[]`) |
| stem_analysis.stems | RENAME | `phase4.stems.per_stem` |

### Task 4 — HarmonicAnalysis.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.harmonic.camelot_notation | DERIVE | from `phase1.detected_key` via the Camelot table in-prompt |
| audio_analysis.harmonic.chord_changes_per_minute | REMOVE | no chord tracking |
| audio_analysis.harmonic.harmonic_complexity | REMOVE | |
| audio_analysis.harmonic.key | RENAME | `phase1.detected_key` |
| audio_analysis.harmonic.key_confidence | REMOVE | not emitted (follow-up EMIT) |
| audio_analysis.harmonic.key_consistency | REMOVE | |
| audio_analysis.harmonic.key_relationship | DERIVE | from `phase1.detected_key` |
| audio_analysis.overall_issues | REMOVE | no harmonic-scoped global list |
| audio_analysis.recommendations | REMOVE | |

### Task 5 — Loudness.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.clipping.clip_count | RENAME | `phase1.clipped_sample_count` |
| audio_analysis.clipping.clip_positions | REMOVE | |
| audio_analysis.clipping.has_clipping | RENAME | `phase1.clipping_detected` |
| audio_analysis.dynamics.crest_factor_db | DERIVE | `phase1.peak_dbfs − phase1.rms` |
| audio_analysis.dynamics.peak_db | RENAME | `phase1.peak_dbfs` |
| audio_analysis.dynamics.rms_db | RENAME | `phase1.rms` |
| audio_analysis.loudness.apple_music_diff_db | DERIVE | `phase1.lufs − (−16)` (constant in-prompt) |
| audio_analysis.loudness.integrated_lufs | RENAME | `phase1.lufs` |
| audio_analysis.loudness.loudness_range_lu | REMOVE | no LRA emitted (follow-up EMIT) |
| audio_analysis.loudness.momentary_max_lufs | REMOVE | |
| audio_analysis.loudness.short_term_max_lufs | REMOVE | |
| audio_analysis.loudness.spotify_diff_db | DERIVE | `phase1.lufs − (−14)` |
| audio_analysis.loudness.true_peak_db | RENAME | `phase1.true_peak_db` |
| audio_analysis.loudness.youtube_diff_db | DERIVE | `phase1.lufs − (−14)` |

### Task 6 — LowEnd.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.frequency.balance_issues | REMOVE | |
| audio_analysis.frequency.bass_energy | RENAME | `phase1.bands.bass` |
| audio_analysis.frequency.low_mid_energy | RENAME | `phase1.bands.low_mid` |
| audio_analysis.frequency.problem_frequencies | REMOVE | |
| audio_analysis.frequency.spectral_centroid_hz | REMOVE | |
| audio_analysis.frequency.sub_bass_energy | RENAME | `phase1.bands.sub_bass` |
| audio_analysis.stereo.correlation | RENAME | `phase1.stereo_correlation` |
| audio_analysis.stereo.is_mono_compatible | DERIVE | `phase1.mono_compatibility < 0.7` (float, not bool) |
| audio_analysis.stereo.width_estimate | RENAME | `phase1.stereo_width` |
| section_analysis.all_issues | RENAME | `phase7.issues[]` |
| section_analysis.sections | RENAME | `phase7.section_scores[]` |
| stem_analysis.clashes | RENAME | `phase4.clashes[]` / `phase4.stems.clash_matrix[]` |
| stem_analysis.masking_issues | REMOVE | proxy only: `phase4.stems.clash_matrix[].overlap_severity` (don't substitute) |
| stem_analysis.stems | RENAME | `phase4.stems.per_stem` |

### Task 7 — OverallScore.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.overall_score.component_scores | RENAME | `phase3.sub_scores` |
| audio_analysis.overall_score.component_weights | REMOVE | weights live in scorer, not final_json |
| audio_analysis.overall_score.grade | RENAME | `grade` (top-level — prose, not linted) |
| audio_analysis.overall_score.grade_description | DERIVE | from `grade` in-prompt |
| audio_analysis.overall_score.overall_score | RENAME | `overall_score` (top-level) |
| audio_analysis.overall_score.strongest_component | DERIVE | argmax of `phase3.sub_scores` |
| audio_analysis.overall_score.summary | REMOVE | (use `coach_intro`/`top_fixes` only if intended; else remove) |
| audio_analysis.overall_score.weakest_component | DERIVE | argmin of `phase3.sub_scores` |

### Task 8 — PlaybackOptimization.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.frequency.bass_energy | RENAME | `phase1.bands.bass` |
| audio_analysis.frequency.sub_bass_energy | RENAME | `phase1.bands.sub_bass` |
| audio_analysis.playback.bass_translation | RENAME | `phase9.playback.bass_translation` |
| audio_analysis.playback.crossfeed_safe | RENAME | `phase9.playback.crossfeed_safe` |
| audio_analysis.playback.headphone_issues | RENAME | `phase9.playback.analysis[]` |
| audio_analysis.playback.headphone_score | RENAME | `phase9.playback.headphone_score` |
| audio_analysis.playback.speaker_issues | RENAME | `phase9.playback.analysis[]` |
| audio_analysis.playback.speaker_score | RENAME | `phase9.playback.speaker_score` |
| audio_analysis.stereo.correlation | RENAME | `phase1.stereo_correlation` |
| audio_analysis.stereo.width_estimate | RENAME | `phase1.stereo_width` |

### Task 9 — Sections.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.dynamics.crest_factor_db | DERIVE | `phase1.peak_dbfs − phase1.rms` |
| audio_analysis.loudness.integrated_lufs | RENAME | `phase1.lufs` |
| audio_analysis.transients.attack_quality | REMOVE | |
| section_analysis.all_issues | RENAME | `phase7.issues[]` |
| section_analysis.clipping_timestamps | REMOVE | |
| section_analysis.section_summary | RENAME | `phase7.metadata` |
| section_analysis.sections | RENAME | `phase7.section_scores[]` |
| section_analysis.worst_section | DERIVE | min-score entry of `phase7.section_scores[]` |

### Task 10 — SpatialAnalysis.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.frequency | RENAME | `phase1.bands` |
| audio_analysis.spatial.depth_score | RENAME | `phase9.spatial.depth_score` |
| audio_analysis.spatial.height_score | RENAME | `phase9.spatial.height_score` |
| audio_analysis.spatial.perceived_depth | DERIVE | band from `phase9.spatial.depth_score` |
| audio_analysis.spatial.perceived_height | DERIVE | band from `phase9.spatial.height_score` |
| audio_analysis.spatial.spatial_balance | RENAME | `phase9.spatial.analysis[]` |
| audio_analysis.spatial.width_consistency | RENAME | `phase9.spatial.width_consistency` |
| audio_analysis.stereo.correlation | RENAME | `phase1.stereo_correlation` |
| audio_analysis.stereo.width_estimate | RENAME | `phase1.stereo_width` |

### Task 11 — StereoPhase.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.stereo.correlation | RENAME | `phase1.stereo_correlation` |
| audio_analysis.stereo.is_mono_compatible | DERIVE | `phase1.mono_compatibility < 0.7` (float) |
| audio_analysis.stereo.is_stereo | DERIVE | `phase1.stereo_width > 0` |
| audio_analysis.stereo.issues | REMOVE | |
| audio_analysis.stereo.phase_safe | DERIVE | `phase1.stereo_correlation > 0` |
| audio_analysis.stereo.width_category | DERIVE | bands of `phase1.stereo_correlation`/`phase1.stereo_width` |
| audio_analysis.stereo.width_estimate | RENAME | `phase1.stereo_width` |
| stem_analysis.stems | RENAME | `phase4.stems.per_stem` |

### Task 12 — SurroundCompatibility.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.stereo.correlation | RENAME | `phase1.stereo_correlation` |
| audio_analysis.stereo.is_mono_compatible | DERIVE | `phase1.mono_compatibility < 0.7` |
| audio_analysis.stereo.phase_safe | DERIVE | `phase1.stereo_correlation > 0` |
| audio_analysis.surround.center_energy | REMOVE | no center/side split emitted |
| audio_analysis.surround.is_mono_safe | DERIVE | from `phase9.surround.mono_compatibility` / `phase9.surround.phase_score` |
| audio_analysis.surround.lfe_content | REMOVE | proxy only `phase1.bands.sub_bass` (don't substitute) |
| audio_analysis.surround.mono_compatibility | RENAME | `phase9.surround.mono_compatibility` |
| audio_analysis.surround.phase_score | RENAME | `phase9.surround.phase_score` |
| audio_analysis.surround.side_energy | REMOVE | not emitted |

### Task 13 — TranceArrangement.md
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.detected_tempo | RENAME | `phase2.bpm` (or `phase7.metadata.detected_tempo`) |
| audio_analysis.dynamics.crest_factor_db | DERIVE | `phase1.peak_dbfs − phase1.rms` |
| audio_analysis.dynamics.dynamic_range_db | DERIVE | `phase1.peak_dbfs − phase1.rms` |
| audio_analysis.frequency.bass_energy | RENAME | `phase1.bands.bass` |
| section_analysis.all_issues | RENAME | `phase7.issues[]` |
| section_analysis.sections | RENAME | `phase7.section_scores[]` |
| section_analysis.worst_section | DERIVE | min-score entry of `phase7.section_scores[]` |

### Task 14 — Triage.md (object-level reads — map to the emitted sub-fields)
| dead path | handling | target / derivation |
|---|---|---|
| audio_analysis.channels | REMOVE | not emitted |
| audio_analysis.clipping | RENAME | `phase1.clipping_detected` (+ `phase1.clipped_sample_count`) |
| audio_analysis.detected_tempo | RENAME | `phase2.bpm` |
| audio_analysis.duration_seconds | RENAME | `phase1.duration_seconds` |
| audio_analysis.dynamics | RENAME | `phase1.peak_dbfs` (+ `phase1.rms`; crest = DERIVE) |
| audio_analysis.frequency | RENAME | `phase1.bands` |
| audio_analysis.harmonic | RENAME | `phase1.detected_key` |
| audio_analysis.loudness | RENAME | `phase1.lufs` (+ `phase1.true_peak_db`) |
| audio_analysis.overall_score | RENAME | `overall_score` (top-level) + `grade` |
| audio_analysis.sample_rate | REMOVE | not emitted |
| audio_analysis.stereo | RENAME | `phase1.stereo_correlation` (+ `phase1.stereo_width`, `phase1.mono_compatibility`) |
| audio_analysis.transients | REMOVE | not emitted |
| section_analysis.all_issues | RENAME | `phase7.issues[]` |
| section_analysis.clipping_timestamps | REMOVE | |
| section_analysis.sections | RENAME | `phase7.section_scores[]` |
| stem_analysis.clashes | RENAME | `phase4.clashes[]` / `phase4.stems.clash_matrix[]` |
| stem_analysis.masking_issues | REMOVE | proxy only (don't substitute) |
| stem_analysis.stems | RENAME | `phase4.stems.per_stem` |

### Task 15 — Burn down baseline + green the gate
- Delete every line in the `prompts` array of `schemas/_schema_drift_baseline.json`
  (leave it `[]`). Leave `rules` and `fixtures` arrays as-is.
- Run the gate (Validation Loop). Any stale entry left → a prompt still cites it
  (or you deleted a baseline line whose prompt path you didn't actually fix).

### Per-task recipe (apply to each of Tasks 1–14)
```
1. Read components/worker/prompts/experts/<Prompt>.md.
2. In the "## JSON Fields to Analyze" block: RENAME rows in place; rewrite DERIVE
   rows to show the inline computation from real phaseN.* fields; delete REMOVE rows.
3. Scan the WHOLE file (threshold tables, "Analysis Steps" pseudocode, "Common
   Problems", example snippets) for the same legacy tokens — update/remove every
   occurrence, not just the field-list block. Thresholds keyed on a REMOVEd field
   are deleted; thresholds keyed on a DERIVEd field reference the derivation.
4. Do NOT alter the "## Required Output" JSON schema block.
5. Verify: prompt_paths(text) has zero non-resolving paths (gate snippet above) and
   grep finds no legacy namespace token in the file.
6. Delete this prompt's lines from the baseline `prompts` array.
7. Commit (one commit per prompt keeps the diff reviewable).
```

## Validation Loop

### Level 1 — per-file (during each task)
```bash
cd components/worker
python - <<'PY'
from app.verdict_lib.schema_contract import prompt_paths, path_resolves, load_contract
c = load_contract(); import pathlib
p = pathlib.Path("prompts/experts/Loudness.md")          # swap per task
bad = [x for x in prompt_paths(p.read_text(encoding="utf-8")) if not path_resolves(x, c)]
print(p.name, "BAD:", bad)        # expect []
PY
```

### Level 2 — repo-wide grep (no legacy tokens anywhere)
```bash
grep -rnE '(audio_analysis|section_analysis|stem_analysis)\.' components/worker/prompts/experts/ \
  && echo "FAIL: legacy tokens remain" || echo "OK: clean"
```

### Level 3 — the ratchet gate + suite
```bash
cd components/worker
python -m pytest tests/test_schema_contract_lints.py -q       # 3 green
python -m pytest tests/verdict_pipeline/ -q                   # prompt-loader/orchestrator green
python -m ruff check app/ tests/
# Confirm baseline shrank:
python - <<'PY'
import json
b = json.load(open("../../schemas/_schema_drift_baseline.json"))
print("prompts:", len(b["prompts"]), "rules:", len(b["rules"]), "fixtures:", len(b["fixtures"]))
assert b["prompts"] == [], "prompts baseline not fully burned down"
assert len(b["rules"]) == 7 and len(b["fixtures"]) == 30, "out-of-scope arrays changed"
PY
```

## Final Validation Checklist
- [ ] No legacy namespace token in any prompt (Level 2 clean).
- [ ] `prompt_paths` resolves for all 14 prompts (Level 1 clean each).
- [ ] `_schema_drift_baseline.json` `prompts == []`; `rules`/`fixtures` untouched.
- [ ] `test_schema_contract_lints.py` 3 green; `tests/verdict_pipeline/` green; `ruff` clean.
- [ ] Each prompt's required-output JSON schema block unchanged (diff review).

## Anti-Patterns to Avoid
- ❌ Introducing a `phaseN.*` token the contract doesn't emit (crest_factor, centroid, LRA, transients, clarity, key_confidence) — that's NEW drift, fails red. DERIVE or REMOVE instead.
- ❌ Substituting a stem-only proxy for a whole-mix metric (masking_risk → clashes) — different semantics; REMOVE.
- ❌ Treating `mono_compatibility` as a bool — it's a 0–1 float.
- ❌ Mixing up band names (`high_mid` is phase4 only; whole-mix is `upper_mid`).
- ❌ Editing the required-output JSON schema or the verdict DSP constraints.
- ❌ Deleting `rules`/`fixtures` baseline lines (separate PRPs).
- ❌ Only fixing the field-list block while leaving legacy tokens in thresholds/examples.

## Out of Scope (track as follow-up PRPs)
- **EMIT pipeline metrics** (revives capability removed here AND the 7 dead rules /
  30 fixtures): `phase1.crest_factor` (`peak_dbfs − 20·log10(rms)`) and
  `phase1.key_detection_confidence` (chroma argmax margin) are the high-leverage two
  — already expected by the `rules`/`fixtures` baseline arrays. Lower tier:
  `spectral_centroid_hz`, ITU `loudness_range_lu`/`short_term`/`momentary` (pyloudnorm),
  transient suite, `spectral_contrast`/`flatness`. Touches `components/analysis` +
  contract regen. See `PRPs/rule-engine-tier1-field-fixes.md` "Out of Scope" and
  `PRPs/detection-prescription-inventory.md`.
- **Rule-engine + fixture burndown** (the 7 + 30 baseline entries) — gated on the
  EMIT work above.
```
