# Design brief — "Watch the analysis happen" (real-time progress)

**Audience:** designer (Claude design).
**Date:** 2026-06-15.
**Status:** Tier B per-phase live progress is **implemented** — design against real data.

---

## What we're designing

After a user uploads a track (mix, optionally + stems + `.als` + reference), the app dispatches
one analysis job and navigates to `/songs/$songId/results/$jobId`. While the job runs we want a
satisfying **real-time "watch it happen"** experience that reveals the result as each step
completes. This brief gives the exact steps, the live data available, and the existing UI to
build on.

**Tempo reality (design for this):** the whole pipeline is **fast — ~5–15s** for an audio-only
track (each phase <1–2s; the slow Demucs path is disabled). This is a quick, momentum-driven
reveal, not a long progress bar. Don't make the user feel like they're waiting; make each step
*land*.

---

## The steps (in order)

One job (`analyze_audio_job`) runs a fixed pipeline. Phases 1–7 always run; phase 8 only when an
`.als` is attached. Each phase is independently try/caught → it can land `ok` / `failed` /
`skipped` without killing the rest.

| # | Worker phase name (`current_phase`) | UI label (existing) | What it reveals on completion |
|---|---|---|---|
| 1 | Universal Mix Analysis | **Mix analysis** | `lufs`, `true_peak_db`, `peak_dbfs`, `clipping_detected`, `bpm`, `detected_key`, `duration_seconds`, `bands` (7), `stereo_correlation`, `stereo_width`, `mono_compatibility` |
| 2 | Genre Detection | **Genre detection** | `genre`, `confidence` |
| 3 | Genre-Specific Scoring | **Genre scoring** | `total_score`, `sub_scores`, `notes[]` |
| 4 | Stem Separation & Clash | **Stem clash** | `band_energy`, `clashes[]`; `stems`/`clash_matrix` if stems attached |
| 5 | Reference Comparison | **Reference comparison** | `preset_name`, `checks{}` (genre preset; per-version reference is not wired yet) |
| 6 | Gap Analysis | **Gap analysis** | `percentile`, `gaps{}`, `profile_source` |
| 7 | Arrangement Advice | **Arrangement advice** | `overall_score`, `grade`, `section_scores`, `suggestions[]` |
| 8 | ALS Analysis *(only if `.als`)* | **Ableton project** | `health_score`, `tempo`, `total_devices`, `plugin_list`, MIDI stats |

**After the pipeline:** the result also carries top-level `overall_score`, `grade` (A–F),
`danceability_score`, `coach_name`, `coach_intro`, `top_fixes[]` / `coached_fixes[]`.

**Separate, on-demand (not this job):** **AI specialist verdicts** (23 specialists, triage-routed)
and the **reference analyzer**. The Analysis tab already models these as "virtual" rows with
unlock hints.

---

## Live data contract (what the UI can read mid-run)

Two transports exist on the BFF:

- **Polling (in use today):** `GET /api/jobs/{id}` every 2s via the `useJob` hook; stops at
  `complete`/`failed`.
- **SSE:** `GET /api/jobs/{id}/stream` — `event: status` frames, server-polls the DB at 1.5s,
  closes on terminal state.
- **Results:** `GET /api/jobs/{id}/results` once `complete` → `finalJson` (the per-phase data above).

**Live status payload — the fields that change during a run:**

```ts
{
  status,         // 'pending' | 'processing' | 'complete' | 'failed' | 'awaiting_stem_mapping'
  currentPhase,   // ← NOW the real phase name, e.g. "Genre Detection" (Tier B)
  phasePct,       // ← NOW an OVERALL 0..1 fraction across all phases (Tier B)
  errorMessage,   // populated on failure
  dispatchedAt, startedAt, completedAt, failedAt  // ISO timestamps for elapsed/state
}
```

### ✅ Tier B is implemented
Previously `currentPhase` only emitted `"starting" → "complete"/"failed"` and `phasePct` only
`0 → 1`. **Now** the worker reports per-phase progress: `currentPhase` is the live phase name and
`phasePct` climbs as an overall fraction (denominator 7, or 8 with `.als`). So a true
**"Step 4/8 · Stem clash · 58%"** ticker is feedable from real data — no further backend work.
*(Applies to new jobs run after 2026-06-15.)*

### Status state machine
```
pending ──▶ processing ──▶ complete
                     └────▶ failed        (errorMessage set)
awaiting_stem_mapping  (only when stems need confirmation before dispatch)
```

---

## Suggested experience (design freedom here)

- **A live step list** of the 7–8 phases, each lighting up pending → running → done as
  `currentPhase` advances; the active row shows a sub-progress feel from `phasePct`.
- **Progressive reveal:** as the job completes, swap to the report — grade pill + the 4 headline
  metrics from phase 1 (LUFS, true peak, BPM, key), then the deeper tabs.
- **Per-phase failure:** a phase can fail while others succeed — design a non-alarming "skipped/
  couldn't compute" state per row, not a whole-run error (whole-run error only when `status` is
  `failed`).
- **Momentum over patience:** because it's ~5–15s, favor lively transitions and a confident
  "done!" moment over a slow determinate bar.

---

## Existing building blocks (build on these, don't redo)

- `features/results/AnalysisTab.tsx` — `PipelineDial` (circular `done/total`), per-phase status
  list (`✓ / running / ! / pending`), **unlock zones** (Stems / Reference / Ableton drop cards),
  and a **Current uploads** panel (now reflects real stems/.als state).
- `features/results/PhaseTimeline.tsx` — vertical phase list with status pills.
- Pending route `routes/_app/songs.$songId.results.$jobId.tsx` — currently shows a basic
  "Analysis in progress" line + a `phasePct` bar, then swaps to `ReportView` on `complete`. **This
  is the primary surface to redesign** into the live experience.
- UI label map: `PHASE_LABEL_OVERRIDES` in `AnalysisTab.tsx` (worker long names → short labels).

---

## Known constraints / notes for design

- **Reference is library-only right now.** A reference uploaded in the unified dialog is saved as
  a library track (Compare page) but is **not** attached to this version's analysis, so phase 5
  uses the genre preset only. The Analysis tab's reference row therefore shows "add reference."
  (A follow-up can wire per-version reference into the analysis.)
- **No pub/sub yet.** The SSE endpoint is honest server-side DB polling (1.5s); functionally
  real-time at this cadence, fine for design. Field casing on the SSE frame is PascalCase
  (`Status`, `CurrentPhase`, `PhasePct`); the REST poll DTO is camelCase.
- **Data we don't have:** per-phase wall-clock durations and file format/size aren't surfaced —
  don't design UI that depends on them (or treat as optional).

---

## Quick reference — endpoints

| Purpose | Method + path | Returns |
|---|---|---|
| Poll status | `GET /api/jobs/{id}` | `JobStatusDto` (status, currentPhase, phasePct, timestamps, errorMessage) |
| Stream status | `GET /api/jobs/{id}/stream` | SSE `event: status` frames |
| Results (when complete) | `GET /api/jobs/{id}/results` | `finalJson` with `phases[]` + top-level grade/score/coach |
