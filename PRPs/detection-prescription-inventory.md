# Analysis → Problem → Fix: data-vs-consumers inventory

> Groundwork for splitting the verdict path into two engines: a **detection engine**
> (measurements → ranked, grounded problems) and a **prescription engine** (problems → DSP fixes).
> Compiled 2026-06-25 by reading the actual code, not docstrings. Branch: `listen-ui-overhaul`
> (rule engine here is pre-Tier-1; master has loudness+stereo fixed → 5 dead rules instead of 8).

## TL;DR — three findings that reframe the whole problem

1. **The specialist + triage LLM prompts address a schema that no longer exists.**
   Every prompt under `components/worker/prompts/experts/*.md` tells the model to read
   `audio_analysis.loudness.integrated_lufs`, `audio_analysis.dynamics.crest_factor_db`,
   `audio_analysis.frequency.low_mid_energy`, `audio_analysis.clipping.has_clipping`,
   `stem_analysis.clashes[]`, `section_analysis.sections[]`, etc. But the worker hands them the
   **flattened v2 `final_json`** — keys are `phase1.lufs`, `phase1.bands.low_mid`,
   `phase1.clipping_detected`, `phase4.clashes`, `phase7.section_scores`. The two schemas barely
   overlap. The `grounding_preamble` (`input_grounding.py`) does **not** remap them — it only
   states which inputs were provided. Net effect: the specialists work *in spite of* their
   instructions, improvising over whatever they can pattern-match in the raw JSON dump.

2. **The validator silently drops any verdict that obeys the prompt.**
   `validator.py::_resolve_path` requires `evidence[].metric` to resolve in the flattened
   `final_json`. The prompts' own examples cite `audio_analysis.loudness.integrated_lufs` and
   friends. A model that faithfully follows its instructions produces evidence paths that don't
   resolve → the whole verdict is rejected (`metric path … does not resolve`). So the prompts
   actively steer the model toward rejection; only verdicts where the model *ignored* the field
   guide and cited a real `phaseN.*` path survive. There is no retry/feedback loop — rejected
   verdicts just vanish.

3. **The deterministic layer is almost entirely dead, so detection rests on LLM improvisation.**
   On `master`, 5 of 11 rules are dead (read fields the pipeline never emits); on this branch, 8.
   Meanwhile the pipeline measures far more than any rule reads. The rich data is there — almost
   nothing deterministic consumes it. This is the strongest argument for a real detection engine:
   it would read the *actual* emitted schema (impossible to drift, it's the same dict the pipeline
   writes) and turn measurements into grounded problems before any LLM is involved.

**Consequence for the two-engine design:** detection should be a strong, mostly-deterministic pass
over the real `final_json`; the LLM's job shrinks to *prescription* — given a confirmed problem
with its measured value already attached, produce the fix chain. That removes the schema-guessing
burden the specialists carry today and makes the validator's "must resolve" rule a non-issue
(detection emits real paths by construction).

### This is NOT branch confusion — it's three coexisting schemas
Verified, not assumed:
- `git diff master...listen-ui-overhaul` on `Loudness.md`, `flatten_analysis.py`, and
  `phase1_universal.py` → **byte-identical**. The drift is on `master` too, not a stale branch.
- The literal `audio_analysis.* / section_analysis.* / stem_analysis.*` schema appears in **no live
  code** — only the archived v1 design docs (`PRPs/archive/2026-04-24_ai-mix-experts.md`,
  `…_v1_ai_music_analyzer.md`). The single production pipeline (`audio_analysis.run_pipeline`)
  emits `phaseN`-list shape, confirmed at `phase1_universal.py:158` returning `lufs` (not
  `integrated_lufs`), no `crest_factor`, no `key_detection_confidence`, `bands` as a dict.

There are **three** schemas in the tree, mutually inconsistent:

| # | Schema | Where it lives | Example keys |
|---|---|---|---|
| **1 — Production** | what the pipeline actually emits | `audio_analysis` package → DB `analyses.final_json` (flattened to `phaseN.*`) | `phase1.lufs`, `phase1.bands.low_mid`, `phase1.clipping_detected`, genre at `phase2.genre` |
| **2 — Rule/fixture** | what the rule engine reads + what its test fixtures contain | `rule_engine.py` + `tests/verdict_pipeline/fixtures/analyses/*.json` | `phase1.integrated_lufs`, `phase1.crest_factor`, `phase1.key_detection_confidence`, top-level `genre_hint`, `phase3.low_mid_energy` |
| **3 — Prompt** | what the LLM prompts tell the model to read | `prompts/experts/*.md` | `audio_analysis.loudness.integrated_lufs`, `audio_analysis.dynamics.crest_factor_db`, `section_analysis.sections[]` |

The disease: **the only schema production emits (#1) is the one neither the rules (#2) nor the
prompts (#3) were written against.** And because the rule tests run on fixtures that encode schema
#2, the dead rules pass their tests while emitting nothing in production — green tests over a
fiction. (Confirmed: `clean_trance.json` top-level keys are `track_id, phase1, phase2, phase3,
genre_hint`; its `phase1` carries `integrated_lufs`, `crest_factor`, `key_detection_confidence` —
none of which production emits.) The Tier-1 PRP fixed the rule *reads* for loudness+stereo on
master; it did not touch the prompts (#3) or the fixtures' other v1 names.

---

## The consumer model — who reads `final_json`, and how

| Consumer | Slice received | Binding strength | Source |
|---|---|---|---|
| **Rule engine** (deterministic) | flattened `final_json`, reads specific dotted paths via `.get()` | **Hard** — code keys on exact fields; wrong name = silently dead | `verdict_lib/rule_engine.py` |
| **Triage** (LLM routing) | **entire** flattened `final_json` + rule-engine findings summary | Soft — picks which specialists run | `triage_actor.py` → `input_grounding.build_triage_user_message` |
| **Specialists** (LLM) | **entire** flattened `final_json` (dumped JSON) + focus note | Soft — improvised; prompt field-guide is drifted (Finding 1) | `verdict_actor.py` → `build_specialist_user_message` |
| **Validator** (deterministic) | resolves whatever `evidence.metric` path each verdict cites | **Hard gate** — arbitrary dotted path must resolve in flattened json | `verdict_lib/validator.py::_resolve_path` |
| **Rollups** (pipeline) | specific phase fields → summary | Hard | `analysis/pipeline.py` finalize |
| **Frontend** | top-level + `phases[*].data` per-phase fields | Render-only | `frontend-spectr-v2/src/features/results/` |

Key asymmetry: the only **hard** consumers of raw measurements are the rule engine (mostly dead)
and the validator (only checks values a verdict *already cited*). Everything that actually
produces findings today is **soft** LLM judgment over a JSON whose schema the prompts get wrong.

---

## Field-by-field inventory

Legend for **Consumed by**:
`RULE` = a working deterministic rule reads it ·
`rule✗` = a rule *tries* to read it but under a wrong/never-emitted name (dead) ·
`PROMPT` = a specialist prompt directs attention to this measurement (regardless of path drift) ·
`UI` = rendered in the results frontend ·
`ROLLUP` = feeds overall_score/grade/top_fixes/coach/danceability ·
`—` = nothing deterministic consumes it.

### Phase 1 — Universal Mix (always runs) · `phase1_universal.py:158`

| Emitted field | Consumed by | Deterministic-detectable? | Notes |
|---|---|---|---|
| `lufs` | UI, ROLLUP(coach), `rule✗` | **Yes** | Rules read `phase1.integrated_lufs` (master: fixed → `lufs`). Streaming-loudness bands are pure thresholds. |
| `true_peak_db` | RULE, UI, ROLLUP(coach) | **Yes** | One of 3 working rules. `> -1.0 dBTP`. |
| `peak_dbfs` | UI | **Yes** | Prompts want `dynamics.peak_db`. Feeds a real crest-factor if we compute it. |
| `rms` | UI | **Yes** | Prompts want `dynamics.rms_db`. Pair with peak for crest factor. |
| `bands{sub_bass,bass,low_mid,mid,upper_mid,presence,air}` | UI | **Yes** | Prompts want `frequency.<band>_energy` (flat, drifted). Band-balance ratios are deterministic. **Tier-3 low-mid mud lives here**, not `phase3.low_mid_energy`. |
| `stereo_correlation` | UI, `rule✗` | **Yes** | Rule reads `phase2.stereo_correlation` (master: fixed → `phase1`). |
| `stereo_width` | UI, ROLLUP(phase3 sub) | **Yes** | |
| `mono_compatibility` | RULE, UI, ROLLUP(coach) | **Yes** | Working rule (`< 0.7`). Float ratio; prompts expect `stereo.is_mono_compatible` bool. |
| `clipping_detected` | RULE, UI | **Yes** | Working rule. Prompts expect `clipping.has_clipping`. |
| `clipped_sample_count` | RULE, UI | **Yes** | Working rule evidence. Prompts expect `clipping.clip_count`. |
| `detected_key` | UI | partial | Prompts expect `harmonic.detected_key`. Key *value* deterministic; usefulness needs confidence (never emitted). |
| `low_energy` | ROLLUP(danceability) | **Yes** | 20–200 Hz RMS. Only consumed by the danceability scorer. |
| `bpm` | UI, ROLLUP(danceability), phase2/6/7 input | **Yes** | |
| `duration_seconds` | UI, validator(section sanity), phase7 input | n/a | Structural. |
| `structure{sections,beats}` | phase7 input | partial | Raw section list; phase7 turns it into scored sections. |

### Phase 2 — Genre (always runs) · `phase2_genre.py:27`

| Emitted field | Consumed by | Deterministic-detectable? | Notes |
|---|---|---|---|
| `genre` | UI, phase3/5/6 input, ROLLUP(danceability) | n/a | The genre key everything genre-aware *should* branch on. Rules instead read a non-existent top-level `genre_hint` (dead). |
| `confidence` | UI | n/a | Genre-classification confidence. Nothing gates on it. |
| `bpm` | (echo) | n/a | Duplicate of phase1.bpm. |
| *(not emitted)* `onset_count` / `onset_density` | ROLLUP(danceability) | — | Danceability expects these; computed on the fly in finalize, not stored. |

### Phase 3 — Genre Scoring (always runs) · `phase3_genre_specific.py:170`

| Emitted field | Consumed by | Deterministic-detectable? | Notes |
|---|---|---|---|
| `total_score` | **ROLLUP(overall_score)**, UI | n/a | This *is* the overall score when phase3 ran. |
| `sub_scores{…genre-specific…}` | UI | n/a | Keys vary by genre (air_energy, bpm_adherence, …). |
| `notes` | UI | n/a | Human-readable suggestions. |
| `genre` | UI | n/a | Echo. |
| *(not emitted)* `low_mid_energy` | `rule✗`×2 | — | Two mud rules read `phase3.low_mid_energy` — **never emitted**. The real low-mid lives at `phase1.bands.low_mid`. |

### Phase 4 — Stems/Clash (base always; per-stem gated) · `phase4_stems.py:177`

| Emitted field | Consumed by | Deterministic-detectable? | Notes |
|---|---|---|---|
| `band_energy{7 bands, dB}` | UI | **Yes** | Note band set differs from phase1 (`high_mid` vs `upper_mid`). |
| `clashes[]{stems,frequency_range,severity}` | UI, ROLLUP(top_fixes) | **Yes** | Spectral clash detection. Prompts expect `stem_analysis.clashes[]{stem1,stem2,overlap_amount}` (drifted names). |
| `stems` | (gate) | n/a | `{}` unless user stems uploaded. |
| `per_stem` / `clash_matrix` / `balance_flags` *(gated)* | UI | **Yes** | Only when stems uploaded. Rich per-stem metrics largely unconsumed deterministically. |

### Phase 5 — Reference (reference-gated) · `phase5_reference.py:182`

| Emitted field | Consumed by | Deterministic-detectable? | Notes |
|---|---|---|---|
| `status` | grounding(reference present), UI | n/a | `"skipped"` when no reference. |
| `deltas{lufs,rms,stereo_correlation,band_*}` | UI(Compare) | **Yes** | Each delta has value+severity. Strong detection signal — **only consumed when a reference exists** (rare). |
| `genre_context{checks}` | UI | **Yes** | LUFS/BPM/correlation checks vs genre preset. |
| `per_stem_reference_deltas` *(gated)* | UI | **Yes** | |

### Phase 6 — Gap Analysis (always runs) · `phase6_gap.py:106`

| Emitted field | Consumed by | Deterministic-detectable? | Notes |
|---|---|---|---|
| `percentile` | UI | n/a | Track's percentile vs genre profile. |
| `gaps{bpm,stereo_*,band_*}` | UI | **Yes** | Per-feature gap vs genre mean ± std with `in_range` bool. **This is essentially a ready-made deterministic detector that nothing in the verdict path consumes.** |
| `genre` / `profile_source` | UI | n/a | |

### Phase 7 — Arrangement (always runs) · `phase7_arrangement.py:37`

| Emitted field | Consumed by | Deterministic-detectable? | Notes |
|---|---|---|---|
| `suggestions[]` | ROLLUP(top_fixes), UI | n/a | Primary arrangement fixes. |
| `issues[]{severity,message,section,fix_suggestion}` | UI | **Yes** | Already-structured problems with severity + fix. Verdict path ignores them. |
| `overall_score`/`grade`/`component_scores`/`*_score` | UI | n/a | Arrangement-only score (distinct from mix grade). |
| `section_scores[]` | UI | **Yes** | Per-section breakdown. Prompts expect `section_analysis.sections[]` (drifted, richer). |
| `fixes`/`violations`/`section_count`/`metadata` | UI | n/a | Back-compat aliases + metadata. |

### Phase 8 — ALS (als-gated) · `phase8_als.py:74`

`health_score, grade, tempo, ableton_version, time_signature, total_devices, disabled_devices,
clutter_pct, plugin_list, has_humanized_midi, quantization_issues_count, total_chord_count,
midi_note_count, audio_clip_count, total_duration_seconds, tracks[], midi{}, arrangement{}`
→ **UI** (AlsHealthCard) + `input_grounding.als_project_map` uses `tracks[].name/devices` as the
authoritative "no hallucinated track names" list. Most are **deterministic-detectable** (clutter %,
disabled devices, quantization issues) but no rule consumes them. ALS present only when a `.als` is
uploaded.

### Phase 9 — Translation (always runs) · `phase9_translation.py:71`

| Emitted field | Consumed by | Deterministic-detectable? | Notes |
|---|---|---|---|
| `surround{mono_compatibility,phase_score,…}` | UI, ROLLUP(coach+top_fixes) | **Yes** | Coach reads `surround.mono_compatibility`. |
| `playback{headphone_score,speaker_score,bass_translation,crossfeed_safe}` | UI, ROLLUP(coach) | **Yes** | Coach reads `bass_translation`/`crossfeed_safe`. |
| `spatial{height,depth,width_consistency}` | UI | **Yes** | |

### Rollups (top-level) · `pipeline.py:137`

`overall_score` (=phase3.total_score) · `grade` (band of overall_score) · `top_fixes` (phase9→phase7→phase4,
capped 3) · `danceability_score` (phase1.bpm + phase2.onset + phase1.low_energy) · `coach_name`/`coach_intro`
(hardcoded) · `coached_fixes` (phase1 + phase9 + top_fixes) · `file_path`. All **UI**-rendered.

---

## Schema-drift catalog — what the prompts ask for vs. what is emitted

The prompts' `audio_analysis.* / section_analysis.* / stem_analysis.*` namespace vs. the actual
flattened `phaseN.*`. Three buckets:

**(a) Exists, but under a different path — model must guess; cited-as-instructed → validator-rejected**
| Prompt path | Actual emitted path |
|---|---|
| `audio_analysis.loudness.integrated_lufs` | `phase1.lufs` |
| `audio_analysis.loudness.true_peak_db` | `phase1.true_peak_db` |
| `audio_analysis.dynamics.peak_db` | `phase1.peak_dbfs` |
| `audio_analysis.dynamics.rms_db` | `phase1.rms` |
| `audio_analysis.clipping.has_clipping` | `phase1.clipping_detected` |
| `audio_analysis.clipping.clip_count` | `phase1.clipped_sample_count` |
| `audio_analysis.frequency.<band>_energy` | `phase1.bands.<band>` (dict, not flat) |
| `audio_analysis.stereo.correlation` | `phase1.stereo_correlation` |
| `audio_analysis.stereo.width_estimate` | `phase1.stereo_width` |
| `audio_analysis.harmonic.detected_key` | `phase1.detected_key` |
| `stem_analysis.clashes[]{stem1,stem2,overlap_amount}` | `phase4.clashes[]{stems,frequency_range,severity}` |
| `section_analysis.sections[]` | `phase7.section_scores[]` (different shape) |
| `audio_analysis.overall_score{component_scores,weakest_component}` | top-level `overall_score` (float) + `phase3` |

**(b) Prompt keys on it, but the v2 pipeline never emits it at all** — these are dead signals:
`dynamics.crest_factor_db` · `dynamics.is_over_compressed` · `loudness.short_term_max_lufs` ·
`loudness.momentary_max_lufs` · `loudness.loudness_range_lu` · `loudness.{spotify,apple_music,youtube}_diff_db` ·
`clipping.clip_positions` (timestamps) · `frequency.spectral_centroid_hz` · `frequency.balance_issues` ·
`frequency.problem_frequencies` · `transients.{transient_count,transients_per_second,avg_transient_strength,attack_quality}` ·
`harmonic.{key_confidence,camelot_code}` · `section_analysis.all_issues` · `section_analysis.clipping_timestamps`.

**(c) Dead rule-engine reads** (deterministic side of the same drift):
`phase1.integrated_lufs` (×2 rules) · `phase1.crest_factor` (×2) · `phase1.key_detection_confidence` ·
`phase2.stereo_correlation` · `phase3.low_mid_energy` (×2) · top-level `genre_hint` (×2).
On `master`, the loudness×2 + stereo are fixed; crest/key/low-mid/genre_hint remain dead.

---

## Deterministic-detectable vs. genuinely needs an LLM

**Deterministic (a code threshold over an emitted value — no LLM needed to *detect* the problem):**
loudness too hot/quiet · true-peak over −1 · clipping · mono incompatibility · negative stereo
correlation · band-balance / low-mid mud (from `phase1.bands`) · crest factor *(once we compute it
from peak−rms)* · every `phase6.gaps[*].in_range=false` · every `phase5.deltas[*].severity≥moderate`
*(when reference present)* · `phase4.clashes` · `phase7.issues` (already carry severity) · ALS
clutter / disabled-device / quantization thresholds. **The detection engine's job is to read these
directly and emit grounded problems with the real metric path + value attached.**

**Needs LLM judgment (the prescription engine's real job):**
- *Translating* a confirmed problem into a concrete, context-aware DSP fix chain (EQ moves, limiter
  settings, sidechain) — especially genre- and arrangement-aware ("for trance, …").
- Cross-signal synthesis & prioritization ("the mud + the weak mono fold-down + the low percentile
  are one root cause: an over-wide bass").
- Anything tied to musical intent the numbers can't express (is the wide dynamic range *artistic* or
  *a mastering miss?*), and naming exact Ableton devices/targets.
- ALS-grounded targeting (which track/device the fix applies to) — already scaffolded by
  `als_grounding_block`.

---

## Implications for the two-engine split (next design step)

1. **Detection engine** = a deterministic pass keyed on the *actual* `final_json` schema (reuse the
   real field names from this inventory; never a parallel namespace). Output: a normalized
   `Problem[]` list — `{category, severity, metric_path, value, expected_range, scope}` — already
   validator-clean because paths are emitted by construction. This subsumes the rule engine and
   harvests the currently-ignored deterministic signals (`phase6.gaps`, `phase5.deltas`,
   `phase7.issues`, `phase4.clashes`, ALS thresholds).
2. **Prescription engine** = the LLM specialists, but their prompt becomes *"here is a confirmed
   problem with its measured value — prescribe the fix"* instead of *"find problems in this JSON."*
   This kills the schema-guessing and the validator-rejection trap. The DSP-chain output contract
   (the bottom of every prompt) is already good and can stay.
3. **Triage** narrows from "which specialists should hunt" to "which confirmed problems warrant a
   prescriptive deep-dive" — cheaper and better-grounded.
4. **Before any of this is worth building, the prompt/schema drift must be acknowledged as the
   root cause** — otherwise a detection engine just sits next to specialists still reading a dead
   namespace. The cleanest sequencing: (a) finish the rule-engine field fixes (Tier-2 crest_factor,
   Tier-3 low-mid/key-confidence) so the deterministic floor is real; (b) reconcile the specialist
   prompts to the `phaseN.*` schema *or* (better) repoint them as prescription-only; (c) introduce
   the `Problem[]` contract between the two.

## Open questions to resolve before design
- Do we **emit a remapped `audio_analysis.*` view** for the LLM (cheap, makes prompts correct as-is)
  or **rewrite the prompts** to `phaseN.*` (honest, but touches every prompt)? The two-engine plan
  favors rewrite-as-prescription, which moots most of the field-guide sections.
- Should detection emit **one problem per signal** or **pre-merge** (e.g. mono + correlation + width
  → one "stereo field" problem) before handing to prescription? Affects dedupe placement.
- `phase6.gaps` and `phase5.deltas` are the richest untapped deterministic signals — confirm their
  numerical reliability before leaning on them (phase6 has a profile vs per-track fallback with
  different shapes).
