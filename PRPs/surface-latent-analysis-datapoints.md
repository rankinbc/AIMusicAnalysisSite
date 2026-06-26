name: "Surface Latent Analysis Datapoints — recover the ~300 computed-then-discarded values"
description: |
  Lift high-value INTERNAL datapoints (already computed inside the pipeline and thrown away)
  into `analyses.final_json`, then wire the worthwhile ones into AI specialist/coach context and
  new frontend visualizations. Additive-only, version-stamped, decimation-aware. Backed by the
  full datapoint inventory at `output/analysis/2026-06-25_datapoint-inventory/`.

---

## Goal

Recover the high-value datapoints the analysis pipeline **already computes and discards**, and make
them usable by (a) the AI specialists + coach and (b) new frontend visualizations. Eight datapoint
families (the per-section "true energy" item is deliberately deferred to a separate PRP — see Out of
Scope). End state: each becomes an **additive, optional** field on the relevant phase's `data` dict in
`final_json`, the verdict/coach pipeline can reason over the richer data, and the results UI renders
the new visual surfaces (loudness-over-time, key/mode, spectrogram, onset map, spatial radar).

## Why

- **We're leaving measured data on the floor.** ~300 datapoints are computed during a normal run and
  dropped. Re-surfacing them costs near-zero compute (the work is already done) but unlocks materially
  richer analysis and UI.
- **AI specialists are reasoning on summaries.** Feeding the loudness curve, full key/mode estimate,
  and spatial sub-metrics into specialist prompts lets them make grounded, specific verdicts instead
  of inferring from a single scalar.
- **The UI is metric-dense but visualization-poor.** A loudness-over-time graph, spectrogram, and
  key/mode readout are table-stakes for a "producer's analysis tool" and are essentially free here.
- **It hardens the data contract.** Doing this additively + version-stamped directly mitigates the
  known `final_json` schema-drift problem (see `[[final-json-schema-drift]]` memory) by establishing a
  disciplined "append-only, never rename, stamp the schema" pattern.

## What

For each of the 8 datapoint families: compute-already-exists → add to phase return dict (decimated
where large) → update the frontend TS contract → consume in AI prompts and/or render a visualization.

### Success Criteria

- [ ] All 8 families land in `final_json` as **new optional keys** — no existing key renamed/removed.
- [ ] `final_json` payload size stays bounded: no raw full-resolution arrays; every series/surface is
      decimated to a documented budget (see Decimation Budgets).
- [ ] Golden snapshot tests updated **intentionally** (new keys present, all prior keys byte-identical
      in value) — diff reviewed, not blanket-regenerated.
- [ ] Frontend `src/api/types.ts` extended with the new optional fields; `tsc --noEmit` clean.
- [ ] At least 4 new visualizations render in the results UI (loudness-over-time, key/mode readout,
      spectrogram heatmap, spatial radar) with honest empty/short-track states.
- [ ] At least 3 specialist prompts (`loudness`, `harmonic`/`chord_harmony`, `spatial`/`surround`)
      and the coach receive and reference the new data.
- [ ] An `analysis_schema_version` stamp is written alongside `final_json` so downstream tooling knows
      which fields to expect (ties into `[[version-analyses-followup]]`).
- [ ] All v2 gates green: `pytest components/analysis`, `pytest components/worker`, BFF build/test,
      frontend `tsc`/`lint`/`build`/`vitest`.

## All Needed Context

### Documentation & References
```yaml
- file: output/analysis/2026-06-25_datapoint-inventory/ANALYSIS_PROCESS_AND_DATAPOINTS.md
  why: THE source inventory. Part 3 lists the 9 high-value INTERNAL items with exact locations;
       Part 2 has every field per phase. This PRP implements 8 of those 9.

- file: PRPs/analysis-data-contract.md
  why: The authoritative frontend-facing shape of final_json (mirrors src/api/types.ts). §2 has the
       per-phase Phase{N}Data interfaces you extend. §9 is a real payload + the "shape notes" gotchas
       (band-key naming drift upper_mid vs high_mid; status:ok with empty data is normal).
  critical: Every field is OPTIONAL — phases fail/skip. New fields MUST be optional too. NEVER rename.

- file: components/analysis/src/audio_analysis/pipeline.py
  why: Orchestration. run_single_phase() dispatch + finalize_result() rollups. Adding fields = edit the
       phase modules' return dicts; pipeline.py itself rarely changes.
  critical: "run_pipeline output guarded byte-identical by the golden snapshots" (see CLAUDE.md per-
       phase re-run note). Adding keys WILL change snapshots — update them deliberately.

- file: components/analysis/tests/integration/test_phase_snapshots.py
  why: The golden-snapshot guard. Read how snapshots are stored/compared before you change pipeline
       output, or this is the test that "mysteriously" goes red.

- file: components/analysis/src/audio_analysis/phases/phase1_universal.py
  why: Items 1 (key/mode vector), 2 (loudness series), 3 (spectrogram), 4 (onset map) all originate
       here. Inventory cites the exact intermediate variables (chroma_mean, momentary/short_term
       series, S_db, onset_env/onsets).

- file: components/analysis/src/audio_analysis/analyzers/spatial_analyzer.py
  why: Item 5 (spatial internals: high_ratio, rms_std, sub/bass/midbass ratios, per-window corr).
       These are computed inside _calculate_* and folded into 0–100 scores, then lost.

- file: components/analysis/src/audio_analysis/stems/role_detector.py
  why: Item 6 (per-stem classification features in _features(): crest, zcr, centroid, perc_ratio,
       onset_rate, band ratios). Only the role label currently survives.

- file: components/analysis/src/audio_analysis/als/als_parser.py
  why: Item 7 (ALS device params{} — parsed at lines ~620-657 then mostly dropped). Needs an ALLOWLIST,
       not a dump (see Gotchas).

- file: components/analysis/src/audio_analysis/phases/phase6_gap.py
  why: Item 8 (the 11-dim feature vector + genre_std already in gaps; expose the raw vector + full
       distribution anchors for a "you vs genre" plot).

- file: components/frontend-spectr-v2/src/api/types.ts
  why: The hand-maintained BFF contract. Extend Phase1Data/Phase6Data etc. with the new optional keys.
  critical: TypeScript strict + verbatimModuleSyntax — import type for type-only imports.

- file: components/worker/app/verdict_lib/prompt_loader.py
  why: Specialist slug→prompt mapping. The new data must be threaded into the analysis context the
       specialists receive. Find where the analysis dict is serialized into the prompt.

- file: components/worker/prompts/experts/
  why: The specialist prompt markdown. Loudness/Harmonic/Spatial/Surround prompts get new data blocks.

- file: PRPs/archive/2026-04-24_gap-09-key-detection.md
  why: Prior art — how detected_key + key_detection_confidence were originally added. Mirror its
       phase1 + types + UI pattern for the key/mode expansion.
```

### Known Gotchas of our codebase & Library Quirks
```python
# CRITICAL: Golden snapshots guard run_pipeline output byte-for-byte.
#   Adding keys changes the snapshot. Regenerate INTENTIONALLY and diff: assert every PRE-EXISTING
#   key is unchanged in value, only NEW keys appear. A blanket "update snapshots" hides regressions.

# CRITICAL: final_json is JSONB — do NOT store raw arrays.
#   phase1 S_db is (128 bins x ~thousands of frames). Raw = multi-MB per analysis. DECIMATE.
#   Loudness series: 1 value / 0.5s. Spectrogram: <= 64 freq bins x <= 200 time cols (downsample).
#   Onsets: list of timestamps (already sparse) — cap at a few hundred, fine.

# CRITICAL: numpy types are not JSON-serializable.
#   np.float32/np.ndarray must be coerced to python float / list before returning. The pipeline
#   already does this for scalars; do the same for every new array (.tolist(), float(...)).

# CRITICAL: additive + optional only. Every phase can fail/skip → consumers treat all fields optional.
#   New keys must default to absent (don't emit on failure path) and never break an old reader.

# GOTCHA: band-key naming already drifts (phase1 "upper_mid" vs phase4 "high_mid"). Don't "fix" it
#   here — that's a breaking rename. Match the existing key set per phase.

# GOTCHA: ALS device params are unbounded + noisy (every plugin param). Dumping all = payload blowup
#   + PII-ish project internals. Use an ALLOWLIST of useful params per known device_type; cap total.

# GOTCHA: Phase 9 spatial analyzer returns dataclasses asdict()-ed. To expose internals, add fields to
#   the SpatialInfo/SurroundInfo/PlaybackInfo dataclasses (they flow out automatically) OR return a
#   separate "metrics" sub-dict. Prefer adding typed dataclass fields so asdict() carries them.

# GOTCHA: Per-stem features (item 6) only exist when stems were uploaded. Gate the field on stems
#   present, exactly like per_stem/clash_matrix today.
```

## Implementation Blueprint

### Decimation Budgets (design contract — enforce in code)

| Family | Raw form | Stored form | Budget |
|---|---|---|---|
| Loudness series | per-window 0.4s/3.0s arrays | `loudness_timeline: {t: number[], momentary: number[], short_term: number[]}` | ≤ 1 sample / 0.5 s, cap ~600 pts |
| Spectrogram | `S_db` 128×frames | `spectrogram: {freqs_hz: number[], times_s: number[], db: number[][]}` | ≤ 64 freq bins × ≤ 200 time cols |
| Onset map | onset env + indices | `onsets: {times_s: number[], strengths: number[]}` | cap ~400 onsets |
| Key/mode | 24 Krumhansl corrs | `key_estimate: {key, mode, confidence, second_key, second_mode, profile_corrs: number[24]}` | fixed 24 floats |
| Spatial internals | scattered intermediates | `spatial_metrics: {...}` flat scalar dict | ~15 scalars |
| Stem features | per-stem `_features` dict | per-stem `classification_features: {...}` | 7 scalars × stems |
| ALS params | every plugin param | `params: {...}` allowlisted | ≤ ~20 keys/device, capped |
| Gap vector | 11-dim + dist | `gap_vector: {features: string[], user: number[], genre_mean: number[], genre_std: number[]}` | fixed ~11 |

### Data models and structure

New optional fields on existing TypedDict/interface shapes — no new top-level structures. Example
(frontend `types.ts`, mirrored from the python return dicts):
```ts
interface Phase1Data {
  /* …existing… */
  key_estimate?: { key: string; mode: 'major'|'minor'; confidence: number;
                   second_key?: string; second_mode?: 'major'|'minor'; profile_corrs?: number[]; };
  loudness_timeline?: { t: number[]; momentary: number[]; short_term: number[]; };
  spectrogram?: { freqs_hz: number[]; times_s: number[]; db: number[][]; };
  onsets?: { times_s: number[]; strengths: number[]; };
}
interface Phase9Data { spatial_metrics?: Record<string, number>; /* +existing spatial/surround/playback */ }
interface Phase6Data { gap_vector?: { features: string[]; user: number[]; genre_mean: number[]; genre_std: number[] }; }
// Phase4 per_stem entries gain optional classification_features; Phase8 devices gain optional params.
```

### List of tasks (in order)

```yaml
Task 0 — Schema version stamp (foundation):
  ADD analysis_schema_version constant to audio_analysis (e.g. __init__.py: ANALYSIS_SCHEMA_VERSION = "2.1").
  EMIT it from finalize_result() into PipelineResult (new optional top-level field).
  PERSIST it on the analyses row (worker write path) — ties into [[version-analyses-followup]].
  WHY FIRST: every later field is gated/documented against this version.

Task 1 — Phase 1: key/mode expansion (item 1):
  MODIFY phase1_universal.py _key_detection_confidence (or a new _key_estimate()):
    - RETURN the full 24-profile correlation result, not just max.
    - DERIVE key, mode (major/minor from which half won), second_key/second_mode (2nd-best),
      confidence (best corr). Coerce all to python float.
  ADD key_estimate dict to the phase-1 return. KEEP detected_key + key_detection_confidence
    unchanged (back-compat) — key_estimate.key MUST equal detected_key.

Task 2 — Phase 1: loudness timeline (item 2):
  MODIFY the windowed-loudness block: it already builds momentary + short_term series for LRA.
  DECIMATE to budget, build loudness_timeline {t, momentary, short_term}. Add to phase-1 return.

Task 3 — Phase 1: spectrogram + onset map (items 3, 4):
  MODIFY phase1: S_db already exists (mel) — downsample to <=64x<=200, add spectrogram {freqs_hz,
    times_s, db}. onset_env + onsets already exist — add onsets {times_s, strengths} (cap).
  GUARD payload size; assert dims <= budget in a unit test.

Task 4 — Phase 9: spatial internals (item 5):
  MODIFY spatial_analyzer.py: add the intermediate scalars (high_ratio, rms_std, sub/bass/midbass
    ratios, avg_centroid, preservation_ratio, windowed-corr std) as fields on SpatialInfo/SurroundInfo/
    PlaybackInfo dataclasses so asdict() carries them — OR collect into a spatial_metrics dict in
    phase9_translation.analyze(). Add spatial_metrics to phase-9 return.

Task 5 — Phase 4: per-stem classification features (item 6):
  MODIFY role_detector._features to be reusable / capture its output; in the stems analyze path attach
    classification_features {crest, zcr, centroid_hz, perc_ratio, onset_rate, band_ratios{...}} to each
    per_stem entry. ONLY when stems present.

Task 6 — Phase 6: gap vector (item 8):
  MODIFY phase6_gap.py: the 11-dim user vector, genre_mean, genre_std already computed. Expose
    gap_vector {features, user, genre_mean, genre_std} alongside the existing gaps dict.

Task 7 — Phase 8: ALS device params allowlist (item 7):
  DEFINE an allowlist map device_type/name -> [useful param keys] (e.g. macro values, mix/return
    sends, key device params). In als_parser, filter device.params to the allowlist, cap count.
  ADD params (filtered) to each device entry. Document the allowlist; default to empty when unknown.

Task 8 — Frontend contract:
  MODIFY components/frontend-spectr-v2/src/api/types.ts: add all new optional fields (Task 1-7 shapes).
  RUN tsc --noEmit. NO renames.

Task 9 — AI specialist + coach context:
  FIND where the analysis dict is serialized into specialist/coach prompts (worker verdict_lib +
    prompt_loader). THREAD the new fields in.
  EDIT prompts: loudness (loudness_timeline), harmonic/chord_harmony (key_estimate), spatial+surround
    (spatial_metrics), coach (key_estimate + loudness_timeline summary). Keep prompts grounded —
    reference measured values, don't invent.

Task 10 — Frontend visualizations:
  ADD to features/results/ (CSS Modules + Recharts, per stack rules, NO Tailwind):
    - LoudnessTimeline (Recharts line: momentary + short_term vs t)
    - KeyModeReadout (key + mode + confidence + second-best)
    - SpectrogramHeatmap (canvas/heatmap from spectrogram.db)
    - SpatialRadar (Recharts radar over spatial_metrics)
    - (optional) OnsetMap, GapVectorPlot
  HANDLE empty/short-track states (fields absent → "not available" per the §9 contract gotchas).

Task 11 — Tests + golden snapshots:
  UNIT: each new field present, correct shape, within decimation budget, numpy coerced to json types,
    absent on phase-failure path. (analysis + worker tests.)
  GOLDEN: regenerate snapshots; diff-assert pre-existing keys byte-identical, only new keys added.
  FRONTEND: vitest for the new components' data-mapping + empty states.

Task 12 — Docs:
  UPDATE PRPs/analysis-data-contract.md §2 with the new optional fields (it's the living contract).
  UPDATE components/analysis README + CLAUDE.md analysis section if field inventory is referenced.
```

### Per-task pseudocode (critical details only)
```python
# Task 1 — key/mode (phase1_universal.py)
def _key_estimate(chroma_mean) -> dict:
    cm = _normalize(chroma_mean)                      # (12,)
    corrs = [pearson(cm, rotate(profile, i)) for profile in (MAJOR, MINOR) for i in range(12)]
    # corrs is 24 floats: indices 0-11 major rotations, 12-23 minor
    best = int(np.argmax(corrs)); second = int(np.argsort(corrs)[-2])
    return {
        "key": PITCH_CLASSES[best % 12], "mode": "major" if best < 12 else "minor",
        "confidence": float(corrs[best]),
        "second_key": PITCH_CLASSES[second % 12], "second_mode": "major" if second < 12 else "minor",
        "profile_corrs": [float(c) for c in corrs],   # JSON-safe
    }
    # INVARIANT: result["key"] == existing detected_key (don't diverge the two)

# Task 3 — spectrogram decimation
def _decimate_spectrogram(S_db, sr, hop, max_f=64, max_t=200) -> dict:
    f_idx = np.linspace(0, S_db.shape[0]-1, min(max_f, S_db.shape[0])).astype(int)
    t_idx = np.linspace(0, S_db.shape[1]-1, min(max_t, S_db.shape[1])).astype(int)
    db = S_db[np.ix_(f_idx, t_idx)]
    return {"freqs_hz": mel_to_hz(f_idx).tolist(),
            "times_s": (t_idx * hop / sr).tolist(),
            "db": np.round(db, 1).tolist()}           # round to shrink JSON
```

### Integration Points
```yaml
DATABASE:
  - No schema change required for final_json (JSONB, additive). 
  - OPTIONAL: add analysis_schema_version column on analyses (Task 0) — EF Core migration + the
    manual partial-index discipline noted in bff/README if any index touched (not needed here).
WORKER:
  - Specialist/coach prompt context serialization — thread new fields (Task 9).
FRONTEND:
  - src/api/types.ts (contract), features/results/* (viz), no new layout state (feature-folder owns it).
DOCS:
  - PRPs/analysis-data-contract.md is the living contract — update in the same PR.
```

## Validation Loop

### Level 1: Syntax & Style
```bash
ruff check components/analysis/src/ components/worker/
mypy components/analysis/src/audio_analysis/ components/worker/app/ --ignore-missing-imports
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
```

### Level 2: Unit Tests
```bash
pytest -q components/analysis/tests/      # new-field shape + budget + json-safety + absent-on-fail
pytest -q components/worker/tests/        # prompt context includes new fields
cd components/frontend-spectr-v2 && npx vitest run   # viz data-mapping + empty states
```
Key assertions:
- `key_estimate["key"] == detected_key` (no divergence).
- `len(spectrogram["db"]) <= 64` and `len(spectrogram["db"][0]) <= 200`.
- every new value passes `json.dumps(...)` (no numpy types).
- on a forced phase-1 failure, new keys are ABSENT (not null garbage).
- golden snapshot diff: pre-existing keys unchanged, only additions.

### Level 3: Integration Test
```bash
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &
cd components/worker && python -m dramatiq app.dramatiq_app &
cd components/frontend-spectr-v2 && npm run dev &
# Upload a real track, open results: loudness-over-time + key/mode + spectrogram + spatial radar render.
# Inspect GET /api/jobs/{id}/results → finalJson has new keys; payload size sane (<~1MB).
```

## Final Validation Checklist
- [ ] `pytest components/analysis` + `components/worker` green
- [ ] BFF `dotnet build && dotnet test` green
- [ ] Frontend `tsc --noEmit`, `lint --max-warnings 0`, `build`, `vitest run` green
- [ ] Golden snapshots updated intentionally; pre-existing values byte-identical
- [ ] `final_json` payload measured < ~1 MB on a 5-min track (decimation works)
- [ ] No renamed/removed keys (grep the contract diff)
- [ ] `analysis-data-contract.md` updated
- [ ] 4+ visualizations render with honest empty states for short/failed tracks

## Out of Scope (track separately)
- **Per-section measured "true energy" (inventory item 9 / phase-7 energy gap).** Phase 7 currently
  fakes per-section energy from allin1 segment *confidence*. Computing real per-section RMS/LUFS from
  phase-1 audio is a **scoring-logic change** (it alters `energy_contrast_score` → `overall`/`grade`),
  so it needs its own PRP with re-baselined scoring + golden snapshots. Cross-ref `[[final-json-schema-drift]]`
  and the detection-engine spec.
- Full-resolution (undecimated) spectrogram/loudness export (e.g. for a download) — future, behind an
  explicit endpoint, never in `final_json`.

## Anti-Patterns to Avoid
- ❌ Dumping raw `S_db` / full loudness arrays into JSONB — always decimate to budget.
- ❌ Renaming existing keys to "clean up" drift — additive only; the contract is load-bearing.
- ❌ Blanket-regenerating golden snapshots — diff and verify only-additions.
- ❌ Returning numpy types — coerce to python float/list at the return boundary.
- ❌ Emitting new fields on a phase's failure path — gate on success, keep them optional.
- ❌ Dumping every ALS plugin param — allowlist + cap.
```
