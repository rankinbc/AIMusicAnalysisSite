# Stems Tab — Data Brief for UI Design

Goal: add a **Stems** tab to the results page (`components/frontend-spectr-v2/src/features/results/`).
This brief lists every piece of per-stem data the backend already produces, the exact endpoints/JSON
shapes, gating rules, and the integration points in the existing results page. No backend changes are
required to render any of this.

---

## 1. Two data layers — don't conflate them

| Layer | Keyed by | Source | What it is |
|---|---|---|---|
| **Physical stem files** | stem file id (GUID) | `GET /api/versions/{versionId}/stems` | The uploaded files: filename, detected/confirmed role, classifier confidence + evidence, playable audio |
| **Analysis metrics** | **role** (default "grouped" mode) or file label (`per_stem` mode) | `final_json.phase4.stems` | Measured levels/spectrum/stereo, clash matrix, balance flags |

In the default **grouped** mode, multiple files sharing a role (e.g. 6 hat stems) are summed into one
role bus and analyzed together — so metrics exist per **role**, not per file. Recommended structure:
role-level metric cards, with the physical files nested inside each role (name, confidence, play button).
Per-file metric rows only exist when `mode === "per_stem"`.

Roles (enum): `drums, kick, snare, hats, bass, vocals, lead, pad, fx, other`.

---

## 2. Physical stems — `GET /api/versions/{versionId}/stems`

Response: `{ classified: boolean, stems: StemRawDto[] }`. Each stem:

```json
{
  "id": "c8f145e6-ffa7-40cd-b42e-0c9ad615290b",
  "original_filename": "22_19-fbn 9-Imba Snare 19.flac",
  "detected_role": "hats",
  "confirmed_role": "hats",
  "confidence": 0.7,
  "evidence": "spectral: high-band 0.63, perc 0.50, crest 2.8, zcr 0.32"
}
```

- `detected_role` = classifier guess; `confirmed_role` = what the user confirmed (may differ — worth a
  subtle "reclassified" indicator when they diverge).
- `confidence` is 0–1. `evidence` is a human-readable spectral rationale — tooltip material.

## 3. Stem playback / waveform

`GET /api/versions/{versionId}/stems/{stemId}/audio` — Range-enabled streaming, accepts the JWT as
`?t=<token>` (same pattern as the main track audio; `<audio>`/WaveSurfer can't send headers).
Use WaveSurfer.js v7 (already a project dependency) for per-stem waveforms + solo playback.

## 4. Measured metrics — `final_json.phase4.stems`

The results payload (`GET /api/jobs/{jobId}/results`) contains `final_json`. Path: `phase4.stems`.

**Gate the whole tab on `phase4.stems.status === "ok"`** (it can be `"failed"` with an `error` string,
or absent entirely when no stems were uploaded).

### Grouped mode (default) — `mode: "grouped"`

```json
{
  "status": "ok",
  "mode": "grouped",
  "per_stem": {
    "kick": {
      "duration_s": 212.4,
      "peak_db": -3.1,
      "rms_db": -14.2,
      "lufs_integrated": -16.8,
      "dynamic_range_db": 11.1,
      "band_energy_db": { "sub": -18.2, "bass": -12.0, "low_mid": -24.5, "mid": -30.1, "high_mid": -38.0, "presence": -44.2, "air": -52.0 },
      "spectral_centroid_hz": 812.0,
      "dominant_frequencies_hz": [54.3, 108.6, 163.2],
      "stereo_width": 0.12,
      "pan_estimate": -0.02,
      "is_mono": true
    }
  },
  "clash_matrix": [
    { "stem_a": "kick", "stem_b": "bass", "band": "sub", "overlap_severity": 0.82, "severity_tier": "critical" }
  ],
  "balance_flags": [
    { "role": "bass", "metric": "rms_db", "observed": -9.1, "expected_range": [-16.0, -12.0], "direction": "too_high", "severity_tier": "warning" }
  ]
}
```

Field notes:
- `band_energy_db` — 7 fixed bands, band edges: sub 20–60 Hz, bass 60–200, low_mid 200–600,
  mid 600–2000, high_mid 2000–6000, presence 6000–12000, air 12000–20000. Sparkline / mini-bar material.
- `spectral_centroid_hz` — brightness proxy. `dominant_frequencies_hz` — top spectral peaks (could be
  annotated as note names client-side).
- `stereo_width` 0–1, `pan_estimate` −1..+1, `is_mono` boolean — chip material.
- `severity_tier` everywhere is `"info" | "warning" | "critical"` — maps to the existing pill/dot tones.
- `clash_matrix` — pairwise frequency-masking conflicts between roles. Natural fit for a matrix/heatmap
  or per-role clash badges. `overlap_severity` is 0–1.
- `balance_flags` — genre-relative loudness/metric deviations, directly renderable as sentences:
  "Bass RMS is −9.1 dB — hotter than the −16..−12 expected for this genre."

### Per-stem mode (opt-in) — `mode: "per_stem"`

Only when the user chose per-stem analysis at upload (`song_versions.stem_analysis_mode`):

```json
{
  "status": "ok",
  "mode": "per_stem",
  "per_stem_list": [ { "id": "<file label>", "role": "hats", ...same metric fields... } ],
  "clash_matrix": [ { "stem_a": "<label>", "stem_b": "<label>", "role_a": "hats", "role_b": "kick", "band": "sub", "overlap_severity": 0.5, "severity_tier": "warning" } ],
  "truncated": false,
  "stem_count": 23
}
```

- `truncated: true` means clash pairs were capped (600 pairs max, loudest stems kept) — show a note.
- `per_stem_list[].id` is the file *label* (filename stem), not the stem GUID — match to physical files
  by filename if linking the two layers.

## 5. Reference deltas — `final_json.phase5`

Only when a reference with stems (or cached library reference) was attached.
Gate on `phase5.stem_reference_comparison === "ok"` (can be `"unavailable"` or `"failed"` + `stem_reference_error`).

```json
"per_stem_reference_deltas": [
  {
    "role": "kick",
    "metric": "lufs_integrated",
    "user_value": -16.8,
    "reference_value": -13.5,
    "delta": -3.3,
    "interpretation": "Your kick is 3.3 dB quieter than the reference's",
    "severity_tier": "warning"
  }
]
```

`interpretation` is pre-written display copy. Good as a "vs reference" column on role cards, or a
dedicated section.

## 6. Stem AI verdicts (optional cross-link)

Three specialists are Triage-gated on stems being present: `stem_balance`, `stem_stereo_width`,
`stem_reference_delta`. Their verdict cards come from the existing verdicts endpoint
(`GET /api/reports/{jobId}/verdicts`). The Stems tab could deep-link to (or inline-filter) these
cards per role rather than re-rendering verdict UI.

---

## 7. Integration points (results page, v3)

- Tab list is pure assembly in `src/features/results/results-tabs-model.ts` (`buildResultsTabs`) —
  add a `stems` tab there, conditional like `hasProject`/`hasReference` (prop e.g. `hasStems`, from
  `final_json.phase4.stems?.status === "ok"`; optional badge = role count or stem count). Update
  `results-tab-keys.ts` and the unit test `__tests__/results-tabs-build.test.ts` (it asserts the
  DEV-false tab shape).
- Tab buttons render via `ResultsTabs.tsx` (`.rtab` classes, `Icon` glyphs — pick an existing `IconName`).
- Sibling tab content components live in the same folder (`TrackInfoTab.tsx`, `ReferenceTab.tsx`,
  `ProjectTab.tsx`) — follow their pattern for a `StemsTab.tsx`.
- Conventions: TypeScript strict + `import type`; CSS Modules + global utility classes
  (`.card`, `.pill[.tone]`, `.dot[.tone]`, `.btn`, `.label`, `.mono`); Recharts for charts; WaveSurfer v7
  for waveforms; no Tailwind/inline styles (except dynamic values like severity-computed color).

## 8. Empty/edge states to design

1. No stems uploaded → tab hidden entirely (like Project/Reference tabs).
2. `phase4.stems.status === "failed"` → decide: hide tab, or show tab with an error card + `error` string.
3. Grouped mode with several files per role → role card lists its member files.
4. `per_stem` mode with up to 100 stems → the list must scale (100 rows); `truncated` clash note.
5. Reference deltas absent (`unavailable`) → omit the "vs reference" affordance, don't show empty section.
6. Old analyses (pre-bulk-upload rows) — `stem_paths` legacy shape still analyzes; physical-file
   metadata (`stem_paths_raw`) may be missing → role cards must not require the file list to exist.

## 9. Suggested per-role card contents (everything above, composed)

Role badge · member file list (filename, confidence, evidence tooltip, solo-play/waveform) ·
LUFS / peak / RMS / dynamic-range stats · 7-band energy sparkline · width/pan/mono chip ·
clash badges vs other roles (severity-tinted) · balance-flag sentences · reference-delta lines ·
link to that role's specialist verdicts.
