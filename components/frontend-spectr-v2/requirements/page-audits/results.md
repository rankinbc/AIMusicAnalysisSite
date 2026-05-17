# Results Page Audit

## Overview
Primary post-analysis view for an amateur/intermediate producer who just uploaded an audio file (and optionally stems/reference/.als). Surfaces the verdict (grade + score), an "AI Coach" fix queue, the full 7-phase pipeline status with unlock CTAs for missing artifact types, a frequency/stem-clash spectrum drilldown, a reference/percentile gap comparison, and an arrangement timeline. Primary outcome: producer leaves with a ranked, actionable to-do list and a clear sense of what more they could upload to get deeper analysis.

The page can be reached two ways: (1) directly after upload (no song context — one-off analysis), or (2) from a song's version list in the Library (carries a `songContext` and a back-link). Both modes render the same body; the header is the only differing surface.

## Subpages / variants
Single page with 5 tab views, all driven by one `track` payload:
- `AI Coach` (default) — ranked `COACH_FINDINGS`-style cards with body, metric line, fix steps, "Apply preset" CTA. `AICoachTab` is referenced by the router but its component body is missing from `results.jsx` (line 18 only); it's the asset called out as "the centerpiece of Results page" in `mock-data.jsx`.
- `Analysis` — `AnalysisTab`: pipeline dial, phase-by-phase timeline (`AnalysisPhaseList`), `UnlockBlock` upload zones for stems/reference/.als, side rail with current uploads + re-analyze + history log.
- `Spectrum` — `SpectrumTab`: 8-band bars vs. genre median + stem clash list.
- `Reference` — `ReferenceTab`: percentile hero + 7 `GapRow` rows (range/mean/yours dot plot).
- `Arrangement` — `ArrangementTab`: section ribbon + flagged-issue list.
- Also present but not in the tab list: `OverviewTab`, `AITab`, `StreamingTab`, `VerdictHero`. They're defined in `results.jsx` but never routed — appears to be design-iteration debris.

**Header variants:**
- **From Library / SongDetail flow**: `ResultsHeader` renders a small "← {songContext.name} · all versions" back link at the top (lines 27–37 of `results.jsx`). Clicking calls `onBackToSong` which navigates back to the song's version list (in `app.jsx` this is `setSelectedSongId(...) + setTab('library')`).
- **From direct upload / one-off**: `onBackToSong` and `songContext` are absent — the back link is conditionally hidden. The track title row renders alone. This is the "I just uploaded this from /upload, it isn't saved to the library yet" case.

## Data the page assumes

| Field | Status | Source today | Effort if not | Notes |
|---|---|---|---|---|
| `track.name`, `track.format`, `track.durationSec` | ⚠️ derivable | `SongVersion.label` + `UploadJob.file_path`; format/duration from `final_json.phase1.duration_seconds` + file extension | S (hours) | No `format` string ("WAV · 48k · 24-bit") computed today — derive from container probe at upload time or read from phase1 |
| `songContext` `{ id, name }` (back-link source) | ⚠️ derivable | `upload_jobs.version_id` → `song_versions.song_id` → `songs.name` | S (hours) | **NEW for this design.** The job already knows its `version_id` (when bound to a song). The BFF needs to walk one JOIN to populate `song_id` + `song_name` in the results envelope. When `version_id` is NULL (ad-hoc upload), omit the field — the header hides the back link automatically. Frontend already gates on `onBackToSong && songContext` |
| `track.grade`, `track.score` | ✅ exists | `final_json.grade`, `final_json.overall_score` | — | `pipeline.py:_score_to_grade` returns A–F (no +/-); mock uses `B+`. Sub-grades need a small post-processor |
| `track.bpm`, `track.key` | ✅ exists | `phase1.bpm`, `phase1.detected_key` | — | Key is a pitch class only ("A#") not "F# minor". Mode (major/minor) is **not computed** — would need 🔨 pipeline S (hours) to add a major/minor classifier on chroma |
| `track.genre.name`, `track.genre.confidence` | ⚠️ derivable | `phase2.genre` + `.confidence` | S | Genre slug is internal ("progressive_house") — UI needs display-name map. Confidence already in phase2 output |
| `track.percentile` | ⚠️ derivable | `final_json.phase6` percentile_scores mean | S | `phase6_gap` computes per-feature percentiles and averages them in `_analyze_with_profile`. Expose as single rollup field |
| `track.profileSource` | ⚠️ derivable | `phase6_gap` profile metadata (`track_count`, profile name) | S | Currently embedded in profile JSON; surface track_count + profile_name in phase6 output |
| `track.loudness.integrated/truePeak/rms/dynamicRange` | ✅ exists | `phase1.lufs`, `.true_peak_db`, `.rms`, `.crest_factor` | — | Dynamic range LU isn't explicitly named today — phase1 returns `rms` and `lufs`; DR is usually `lufs - lufs_short_term_max` or PLR. Verify; may be S to add formal `dynamic_range_lu` |
| `track.loudness.shortTermSeries` | 🔨 pipeline | Not computed | S (hours) | Phase1 returns single LUFS, not a time-series. Need to add `pyloudnorm.Meter.short_term_loudness` per-window pass; small change |
| `track.stereo.width/correlation/monoCompat` | ✅ exists | `phase1.stereo_width`, `.stereo_correlation`, `.mono_compatibility` | — | Already produced by phase1 per CLAUDE.md v1.1 notes |
| `track.frequency.bands[]` (8 bands, value 0–1, warn flag) | ⚠️ derivable | `phase1.bands` (7 bands sub→air, dB scale) | S | Mock uses 8 bands (SUB/BASS/L.MID/MID/H.MID/PRES/BRIL/AIR); pipeline produces 7. Either collapse to 7 in UI or split presence into pres+bril in phase1. `warn` flag is a UI-side threshold on band vs. genre median |
| `track.frequency.clarity` (0–100) | 🔨 pipeline | Not computed | S | "Clarity 74" is a fabricated score; need a definition (likely spectral flatness / centroid stability). Stub for v1 |
| `track.frequency.label` ("Bass-heavy") | 🔨 pipeline | Not computed | S | One-word tilt classifier; trivial rule on band ratios |
| `track.frequency.genreMedianBands[]` | ✅ exists | `phase6_gap` profile `feature_statistics.band_*` means | — | Already loaded from profile JSON; rewire to expose per-band medians on response |
| `track.danceScore` | ✅ exists | `final_json.danceability_score` | — | Already computed in pipeline.py |
| `track.streaming[]` (target/yours per platform) | ⚠️ derivable | Frontend constant + `phase1.lufs` | — | Platform LUFS targets are static. `streamingPassCount` is a UI rollup |
| `track.arrangement.sections[]` (t/l/bars/flag/start/end) | ⚠️ derivable | `phase1.structure` (allin1 output) | S–M | allin1 returns section list with start/end/label. Bar counts need BPM + start/end conversion. `flag` is a UI-side issue flag — needs a rule (e.g. abrupt LUFS drop). Requires Docker on Windows per CLAUDE gotcha |
| `track.arrangement.score` (0–100) | 🔨 pipeline | Not computed | S | Likely a rule on section variety / transitions; stub for v1 |
| `track.arrangement.issues[]` (strings) | ✅ exists | `final_json.phase7.suggestions` | — | Phase 7 already emits suggestion strings |
| `track.clashes[]` (a/b/range/pct/sev/fix) | ⚠️ derivable | `phase4.clash_matrix` (stem path) OR `clashes[]` (spectral fallback) | — | Stem path: full a×b clashes per `phase4_stems.py`. Spectral fallback only emits anonymous "low-end buildup" strings — UI's per-stem matrix only renders meaningfully when stems were uploaded |
| `track.gap[]` (Integrated LUFS, Bass Energy, etc. — userVal/mean/std/range/pct/delta/description) | ✅ exists | `phase6.gaps[]` | — | `phase6_gap._analyze_with_profile` already builds per-feature gap with user_value, profile mean+std, percentile, severity. Description text needs a small generator |
| `track.fixes[]` (Fix Queue items: title/metricLine/badge/body/coachFix) | ⚠️ derivable | `final_json.coached_fixes` (strings only) + `top_fixes` | M | Current `coach.py` returns flat strings — no structured `title/metricLine/badge/body`. Rely on the verdict pipeline output for richer fixes (see COACH_FINDINGS row) |
| `track.coach[]` / `COACH_FINDINGS` (LOCKED EXTENDED SHAPE — rank, specialist, sev, **impact**, **confidence**, title, **body**, **metricLine**, **chartType** enum, fix.title, **fix.steps[] with `kind` enum**, fix.why, **presetName**) | ⚠️ derivable | `analysis_results.verdicts_payload` (verdict pipeline) | S–M | The shape is now **locked** — see `mock-data.jsx` lines 269–403. Mapping from `aimusic_shared.verdicts.models.Verdict`: `severity→sev`, `confidence→confidence`, `headline→title`, `summary→body`, `evidence→metricLine`, `fix.dsp_chain[]→fix.steps[]`, `category→specialist`. **Missing today on the backend:** `rank` (post-rank ordering already in `verdicts_payload`), `impact` (high/med/low — needs to be added to Verdict model or derived from severity × confidence), `chart_type` enum (lufs/sidechain/eq-curve/arrangement/frequency — needs to be added to Verdict model or inferred from category), `preset_name` (needs to be added). `fix.steps[].kind` enum (plugin/automation/target/fx/check/arrangement/production) is **richer than current `dsp_chain[].type`** — either widen the Verdict model schema or write a frontend adapter |
| `track.coachSummary` (total/critical/warning/info, specialistsRun, specialistsTotal) | ⚠️ derivable | Count over verdicts_payload | — | Trivial rollup |
| `track.dimensionScores[]` (Loudness/Balance/Low end/Dynamics/Stereo/Arrangement with score+change+findings+sev) | 🔨 pipeline | Partial — sub-scores not currently broken out | M (days) | `phase3.total_score` is a single number; per-dimension scores aren't computed today. Verdict pipeline groups by `category` (low_end, frequency_balance, dynamics, stereo_phase, loudness, sections) which lines up. Compute per-category aggregate score from severity counts. `change` requires history (compare to previous version score — schema OK: `SongVersion.version_number` exists) |
| `track.analysisPipeline[]` (decode/loudness/spectrum/stereo/genre/arrange/specialists/stems/reference/als with status, detail, durationMs, cta, unlocks, progress, running) | ⚠️ derivable | Existing phase results + `UploadJob.stem_paths`, `.reference_path`, `.als_file_path` | S | Status: derive `done`/`partial`/`missing` from phase status + presence of optional file paths. `durationMs` — **not captured today**; `pipeline.py` logs elapsed but doesn't persist it. Add to PhaseResult schema. `unlocks` count is a static map. `running`/`progress` only relevant during processing |
| `track.verdicts[]` (specialist/sev/title/summary/fix) — short list version | ✅ exists | `verdicts_payload` (subset of top 3) | — | Already produced by verdict pipeline (post-rank) |
| `SPECIALIST_GROUPS` (9 groups × 2-4 items each with slug/label/status/findings) | ⚠️ derivable | Verdict pipeline triage routing plan + cached verdicts | S | `SpecialistRoutingPlan.specialists_to_run` + `verdicts_payload.verdicts[].specialist` give us status (running/cached/idle). `disabled` derived from missing prerequisites (no stems → stem_* disabled). Mock has 26 specialists; `aimusic_shared.verdicts.models.Category` lists 25 — close match |
| `track.tranceDNA.parts[]` | 🔨 pipeline | Not computed | S | Decorative; cut for v1 |
| `track.notes[]` (time-anchored user notes) | 🆕 schema | No table | S (hours) | Not rendered in any tab in `results.jsx` — appears unused. Mock only |
| Streaming platform targets (Spotify/Apple/YouTube/Tidal/SoundCloud/TikTok) | ⚠️ derivable | Frontend constant | — | Static table; pick canonical list |
| File header "uploaded today · 14:03" | ✅ exists | `UploadJob.completed_at` | — | Format in UI |
| Analysis history rows (14:03 AI specialists, 14:01 Pipeline started…) | 🆕 schema | No event log table | S–M | UploadJob timestamps give 3 points. Finer-grained needs `analysis_events` table or scrape from `verdicts_generated_at` + per-phase durations |

## Interactions

| Trigger | Action | Backend route | DB changes |
|---|---|---|---|
| **"← {song} · all versions" back link** (header, conditional) | Calls `onBackToSong()` — navigates back to the song's version list in Library. The button is rendered only when both `songContext` and `onBackToSong` props are present (i.e. user reached Results from SongDetail, not from a one-off upload). | none — pure client-side route change | — |
| Tab click (Coach/Analysis/Spectrum/Reference/Arrangement) | Client-side tab switch; data already loaded | none | — |
| Re-analyze button (header) | Re-dispatch worker on current version | `POST /versions/{version_id}/analyze` (exists) | new `upload_jobs` row |
| Export PDF (header) | Generate PDF of report | `GET /reports/{job_id}/export.pdf` (new) | none (or cache to disk) |
| Fix card expand/collapse | Local UI state | none | — |
| **"Apply preset" inside fix card** | **Navigate to `/listen/{versionId}` (Listen page) with the verdict's preset payload pre-loaded into the ToolsRail.** The ToolsRail is real Web Audio DSP (not a placeholder). Payload travels either as URL-encoded recipe (`?preset=<base64 fix.steps[]>` or `?verdict_id=<id>`) or via TanStack Router route state. Listen-side picks it up and instantiates the corresponding tools (limiter, sidechain, EQ shelf, mono utility) at the parameter targets in `fix.steps[]`. ✅ **buildable in v1** — both endpoints exist; needs an adapter layer to map `fix.steps[].kind` (plugin/automation/target/fx) onto ToolsRail's tool registry. | `GET /jobs/{id}/results` already returns the structured `fix.steps[]` per verdict (after the LOCKED EXTENDED SHAPE lands). No new backend route needed — Listen page reads same `verdicts_payload`. | — |
| "Mark fixed" on fix card | Set verdict applied flag | `POST /api/verdicts/{verdict_id}/feedback` (exists, accepts `applied`) | `verdict_user_state.applied` |
| "Snooze" on fix card | Soft-dismiss with timer | `POST /api/verdicts/{verdict_id}/dismiss` (exists) + new `snooze_until` column | 🆕 schema — add `verdict_user_state.snooze_until DateTime` |
| "Why this?" link on fix card | Modal with verdict.why_it_matters + sources | none (uses existing field) | — |
| "Run all remaining" specialists | Generate verdicts | `POST /api/reports/{job_id}/verdicts/generate` (exists) | `analysis_results.verdicts_payload` populated |
| Per-specialist "Run" button on `SpecialistTileFull` | Targeted single-specialist run | (new) `POST /api/reports/{job_id}/verdicts/generate?only=<slug>` | Same |
| Per-specialist "↺" re-run on cached tile | Force-refresh single specialist | (new) same endpoint with `force=true` | Same |
| `UnlockZone` file drop (stems / reference / als) | Add file to current version, trigger re-analysis | `POST /versions/{version_id}/stems/confirm` (exists, stems), `PATCH /versions/{version_id}` (reference/.als — need to verify) | `song_versions.stem_paths`, `.reference_path`, `.als_file_path` |
| `UnlockZone` click (no file) | Open file picker for that artifact type | client-side | — |
| "Re-run everything" (side rail) | Same as header Re-analyze | `POST /versions/{version_id}/analyze` | new job |
| Copy share link (header) | Copy `share_token` URL | `GET /jobs/{id}/results` already returns it | — |

## Real-time / streaming behavior
- **Pipeline-running case** (status: `partial/running` in mock): the page subscribes to `GET /jobs/{job_id}/stream` (exists, SSE) and live-updates `PhaseRow` progress + `PipelineDial`. The mock data shows a "specialists: 14/26, running: 1" partial state — that case needs the verdict SSE stream `GET /api/reports/{job_id}/verdicts/stream` (exists) too.
- **Verdict generation:** "Run all remaining" wires to the verdict SSE stream; each per-specialist completion updates one `SpecialistTileFull` from `running`→`cached`.
- **Static report mode** (all done): no live streams needed. The page can be SSR-style fetched once.
- **Apply preset → Listen handoff:** when the user clicks Apply preset, no streaming is involved. The preset payload is handed off via route state and Listen's ToolsRail instantiates Web Audio nodes on mount.
- **`tweaks-panel.jsx` and `spectrum.jsx`** — tweaks is a design-time dev panel only (postMessage protocol, edit-mode artifact); ship-zero relevance. `spectrum.jsx` is a **procedural canvas visualizer** that synthesizes a fake spectrum animation from sine sums + a beat envelope (no real audio). Cut or replace with WaveSurfer-driven real spectrum.

## Open product questions
- **Sub-grades (B+, A-, C+):** does the pipeline emit them, or do we generate +/- by score-mod-10 in UI? Affects how we display vs. tooltip.
- **Major/minor key detection:** mock shows "F# minor"; pipeline only has pitch class. Worth adding now or stub as just key?
- **Dimension scores (Loudness/Balance/Low end/Dynamics/Stereo/Arrangement):** is the source-of-truth the verdict pipeline aggregate (count + severity per category) or do we add an explicit per-dimension scoring pass? Affects whether `change` over versions is real or fabricated.
- **"Clarity" and "frequency.label" (Bass-heavy):** small derived scores — do we ship them in v1 or omit?
- **Streaming platforms list:** CLAUDE.md v1.2 says 7 platforms (incl Amazon, Beatport), mock has 6 (incl TikTok). Producer audience suggests TikTok stays; Beatport stays. Confirm canonical list.
- **Verdict shape extension:** the now-locked COACH_FINDINGS shape adds `impact`, `chart_type`, `preset_name`, structured `fix.steps[]` with a `kind` enum, and `body` separate from `summary`. Do we **(a)** extend the `Verdict` Pydantic model in `aimusic_shared.verdicts.models` and rewrite specialist prompts to emit the new fields, or **(b)** keep the model lean and write a BFF/frontend adapter that derives the extra fields? Option (a) is cleaner long-term but requires re-running cached prompts.
- **Apply preset → Listen handoff format:** URL-encoded recipe, route state, or a server-stored "session" record? Route state is simplest but breaks deep-linking; a server-stored `preset_sessions` table is overkill for v1 — recommend URL-encoded `?verdict_id=<id>` and let Listen fetch the verdict to read `fix.steps[]`.
- **Tools registry coverage:** does the Listen ToolsRail have implementations for every `fix.steps[].kind` value (plugin/automation/target/fx/check/arrangement/production)? `check`, `arrangement`, `production` are advisory-only — they shouldn't render as DSP nodes. Probably "instantiable kinds" is just {plugin, fx} and the rest become read-only "next steps" notes.
- **Time-anchored notes (`track.notes[]`):** unused in `results.jsx` source — drop or build separately?
- **Per-version `change` metric on `dimensionScores`:** wire in v1 or stub as 0?
- **Phase duration capture:** want to add `duration_ms` to PhaseResult schema?
- **Snooze:** do we want it, or is `dismiss` enough?
- **Per-specialist "Run" / "Re-run":** add `?only=<slug>` and `?force=true` query params on the existing endpoint?
- **Back-link target when `songContext` is present but the user reached Results via a deep link (not via Library):** the back-link still works (navigates to SongDetail) but the user may be confused that they're leaving a context they didn't enter. Acceptable — the link is well-labeled.

## Build verdict

**🟡 IMPLEMENT WITH PLACEHOLDERS**

Roughly 75% of what this page shows is already produced by the existing analysis + verdict pipelines — the data shapes align well with `final_json` (LUFS, peak, key, bands, stereo, danceability, structure, gaps, percentile, stem clashes, suggestions) and the verdict pipeline's `Verdict` model. The COACH_FINDINGS schema is now **locked** but extends the current `Verdict` model — pick adapter vs. model-extension before building the AI Coach tab. The Apply preset → Listen handoff is shippable in v1 because the ToolsRail is real Web Audio DSP (no longer a placeholder). The big rocks needing **🔨 pipeline** work are: short-term LUFS sparkline, clarity score, frequency tilt label, per-dimension scores, arrangement score, phase `duration_ms` capture, and (if extending Verdict) `impact` + `chart_type` + `preset_name`. The big rocks needing **🆕 schema** are: time-anchored notes (cuttable), event log for history rail (cuttable), and `verdict_user_state.snooze_until`. The BFF needs a small change to include `song_id`+`song_name` in the `/jobs/{id}/results` envelope when the job is bound to a SongVersion — this powers the new back-link.

## Recommended cuts / placeholders for v1
- **Cut** `track.tranceDNA.parts[]` — fabricated, no pipeline support, decorative only.
- **Cut** `track.notes[]` (time-anchored notes) — not rendered in any tab; design debris.
- **Cut** `OverviewTab`, `AITab`, `StreamingTab`, `VerdictHero` — defined but not routed; appear to be earlier design iterations. Confirm with designer, then delete.
- **Stub** `track.frequency.clarity` (use a fixed value or simple spectral-centroid-stability proxy).
- **Stub** `track.frequency.label` ("Bass-heavy") — one-line rule on band ratios.
- **Stub** `track.arrangement.score` — derive trivially from (#flagged-sections / total) until a real scorer exists.
- **Stub** `track.loudness.shortTermSeries` (sparkline) — show static "—" or a single bar.
- **Stub** per-version `change` deltas on `dimensionScores` — show "—" for v1 of a song or if previous version's score missing.
- **Stub** Analysis history rail to just 3 events from `UploadJob` timestamps; no event-log table.
- **Defer** Snooze (use Dismiss only); revisit after dogfooding.
- **Defer** Per-specialist "Run only this" button — ship "Run all remaining" only in v1.
- **Replace** `spectrum.jsx` procedural-canvas mini-spectrum with WaveSurfer.js reading the real audio file.
- **Reconcile** 7-band vs 8-band frequency display — keep the pipeline's 7 bands and update UI labels.
- **Reconcile** `key` to pitch-class only ("F#") for v1, or add a minor/major heuristic if a designer flags it as required.

## Notes
- **Apply preset is NOT cut.** Previous audit marked it as defer/stub; this is corrected. The Listen ToolsRail is real Web Audio DSP and the preset handoff is straightforward route state passing the verdict's `fix.steps[]`. Build it in v1.
- **Header back-link delta:** `ResultsHeader` now optionally renders a "← {song} · all versions" button (lines 27–37 of `results.jsx`). It appears only when both `songContext` (`{id, name}`) and `onBackToSong` are provided by the parent — `app.jsx` provides them unconditionally today but production wiring should branch: when the job has no `version_id` (ad-hoc upload not yet saved to library), pass `songContext={null}` so the link hides. The BFF change to add `song_id` + `song_name` to `/jobs/{id}/results` is one JOIN (`upload_jobs.version_id → song_versions.song_id → songs.name`) and is cheap.
- **COACH_FINDINGS shape is now locked** at `mock-data.jsx` lines 269–403. Confirmed fields: `id, rank, specialist, sev, impact, confidence, title, body, metricLine, chartType, fix.title, fix.steps[].{kind, where, what, from, to}, fix.why, presetName`. `chartType` enum observed: `lufs | sidechain | eq-curve | arrangement | frequency`. `fix.steps[].kind` enum observed: `plugin | automation | target | fx | check | arrangement | production`. `impact` enum: `high | med | low`. The `AICoachTab` component body itself is still missing from `results.jsx` line 18 but each finding maps 1:1 to a `CoachFindingCard` with these slots.
- `tweaks-panel.jsx` is purely a design-time edit-mode harness. Do not port to production.
- `spectrum.jsx` (`SpectrumBars`, `MiniSpectrum`) is procedural — not connected to real audio. Swap for WaveSurfer's analyzer plugin if real-time spectrum visualization is required.
- `SPECIALIST_PERSONAS` map is a UI-only authoring convenience — fine to keep as a frontend constant.
- Dependency on **Library/SongDetail page**: the back-link target depends on SongDetail being routable by `song_id`. SongDetail audit should confirm.
- Dependency on **Upload page**: `UnlockZone` file drops share the same XHR + magic-byte validation + chunk-read upload path as the main upload flow.
- Dependency on **Listen page**: Apply preset hands off to Listen — the Listen audit needs to document its tools registry and the preset-payload accept format so the contract holds across both pages.
- All the verdict-pipeline-driven blocks (Coach tab, AI summary card, top verdicts row) gate on the existing `USE_CLAUDE_CLI=true` config per CLAUDE.md gotcha.
