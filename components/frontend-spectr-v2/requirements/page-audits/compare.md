# Compare Page Audit

## Overview
Amateur/intermediate producers compare one of their own tracks (left, "yours") against a saved commercial reference track (right, "reference") from their references library. The primary outcome is a metric/frequency/match-score side-by-side plus a short list of "to match this reference" suggestions. As designed, the page is exclusively track-vs-reference; nothing in `compare.jsx` supports version-vs-version of two user-owned tracks.

## Subpages / variants
None. Single layout with two pickable sides ("swap" buttons on each card). The only navigation in/out is the back button and the (future) entry from an AI Coach loudness finding.

## Data the page assumes

| Field | Status | Source today | Effort if not | Notes |
|---|---|---|---|---|
| Your track: id, name, BPM, key, genre | exists | `analysis_results.final_json.phase1.bpm`, `phase1.detected_key`; `Song.name`; `Song.genre_hint` | — | Track is the latest `SongVersion` of a `Song`. |
| Your track: integrated LUFS | exists | `phase1.lufs` (final_json) | — | |
| Your track: true peak (dBTP) | exists | `phase1.true_peak_db` | — | |
| Your track: dynamic range (LU) | derivable | computed from phase1 LUFS short-term series or `phase1.dynamic_range` if present | S(hours) | If a single DR LU value isn't already produced, derive from LUFS-S range or PLR; verify field name in worker output. |
| Your track: stereo width (%) | derivable | `phase1.mono_compatibility` / stereo metrics — UI shows 0–100% | S | If width-as-percentage isn't directly emitted, derive from M/S energy ratio or correlation. |
| Your track: stereo correlation | exists | `phase1.stereo_correlation` (per phase5 reference at line 74) | — | |
| Your track: 8-band frequency curve (SUB..AIR) | exists | `phase2`/spectrum band output (mirrors `FREQ_BANDS` shape in mock) | — | Already used by report pages; same source. |
| Your track: cover art hue | derivable | hash of `song.id` to hue; or persisted per-song | S | Cosmetic; pick a deterministic mapping. |
| Reference: id, title, artist, BPM, key, durationSec | schema | not in current schema | M | New `references` table (covered by profile page audit). |
| Reference: LUFS, truePeak, dynamicRange, width, correlation | schema | not in current schema | M | These come from running the existing pipeline against the reference WAV and persisting a summary; the analysis itself is exists/derivable but the storage row is new. |
| Reference: source (`youtube` / `spotify` / `soundcloud` / `file`), sourceUrl | schema | not in current schema | S | Per profile audit; URL ingestion may itself be deferred. |
| Reference: 8-band frequency curve | derivable | run existing pipeline on reference file | M | Hard-coded array in `compare.jsx` (`refCurve = [0.55, 0.78, ...]`). Once references are analyzed, this is the same `phase2` band output as your track. |
| Per-band delta (yours - reference, %) | derivable | client-side subtraction of the two 8-band arrays | — | No backend work. |
| Six-metric delta rows (LUFS / Peak / DR / Width / Corr / BPM) | derivable | client-side subtraction once both sides exist | — | UI already does this in `DeltaRow`. |
| `phase5.reference_track` deltas (existing pipeline output) | exists | `analysis_results.final_json.phase5.reference_track` (when upload included a reference) | — | Available only for jobs that were uploaded WITH a reference file. Not available for "compare against a reference I added later". |
| Match score (0–100, overall "fit") | pipeline | not currently computed | S(hours) | Mocked as `fitScore = 73`. Compute as weighted distance across LUFS / DR / 8-band L2 / width / correlation. Lives in BFF or analysis. |
| Match sub-scores (Loudness / Frequency / Stereo / Dynamics %) | pipeline | not currently computed | S | Same formula split per dimension. |
| Match-score narrative ("Close — but not there yet" + 1-line summary) | pipeline | not currently computed | S | Template string keyed off the worst dimension. |
| Suggestions list (LOUDNESS / FREQUENCY items with title + detail) | pipeline | partial — `coached_fixes` exists at pipeline root; verdicts exist; but neither is "to match this reference" framed | M(days) | Either re-prompt the existing verdict pipeline with reference context, or generate from delta magnitudes via a deterministic template ("Push +N LUFS"). The verdict pipeline path already accepts reference-aware specialists (`stem_reference`, `stem_reference_delta`). |
| Synced waveforms (peaks for both files) | derivable | WaveSurfer.js client-side from both audio files | S | Both files must be reachable by the browser (signed URL from BFF). |
| "Apply all 3 suggested adjustments" action | blocked | no DAW integration exists | L | Cosmetic CTA. No backend wiring is plausible in v1. |
| "Export delta as PDF" action | blocked | no PDF rendering exists | M | Cosmetic CTA. |
| "Save as match target" action | schema | not in current schema | S | Pin this reference as the default for the song; needs a column on `Song` (e.g. `default_reference_id`). |

## Interactions

| Trigger | Action | Backend route | DB changes |
|---|---|---|---|
| Page mount | Fetch the user's track summary | `GET /api/songs/{id}/versions/{version_id}` (new BFF route over existing data) | — |
| Page mount | Fetch the reference summary | `GET /api/references/{id}` (new — see profile audit) | — |
| Page mount | Fetch / compute compare payload (deltas + match score + suggestions) | `POST /api/compare` or `GET /api/compare?track_version_id=…&reference_id=…` (new) | reads two analyses; writes nothing in v1 (compute on demand, optionally cache) |
| Click "↓ swap" on yours | Open a picker over user's library; navigate to `/compare?track=<new>&ref=<existing>` | uses existing `GET /api/songs` | — |
| Click "↓ swap" on reference | Open a picker over references; navigate with new `ref` | uses new `GET /api/references` | — |
| Click "Export delta as PDF" | Hidden / disabled in v1 | — | — |
| Click "Save as match target" | Persist default reference for the song | `PATCH /api/songs/{id}` (new field) | `songs.default_reference_id` (new nullable FK) |
| Click "Apply all 3 suggested adjustments" | Hidden / disabled in v1 | — | — |
| Play button on waveform card | Synced playback of both files in the browser | signed URL fetch (new BFF route to serve audio) | — |

## Real-time / streaming behavior
None for the comparison itself — it is a one-shot computation over two already-analyzed tracks. If the reference is still being analyzed when the user opens compare (mock shows `analyzing: true` on `r5`), the page must either disable itself or subscribe to the existing job-progress SSE for that reference's analysis. Once both sides are `analyzed`, no further streaming is needed.

## Open product questions
- Does compare ever support version-vs-version (two of the user's own SongVersions)? The current UI says no, but the data shape is symmetric — trivial to extend if desired.
- Is the match score computed client-side from two final_jsons (zero backend work) or server-side as a canonical, cacheable number? Recommend server-side so the same number can appear elsewhere (e.g. profile activity feed).
- Where do "suggestions to match this reference" come from? Options: (a) deterministic templates from delta magnitudes (cheap, ships in v1), (b) the existing verdict-pipeline LLM with reference context (more interesting, more cost, slower). Mocks read template-y, not LLM-y.
- Do we surface phase5 reference-track deltas when the job was originally uploaded *with* a reference, separately from "compare against a saved reference"? They are two different code paths with the same display.
- Stem-level reference deltas (`stem_reference_delta` specialist) — show on compare or only on report? Mocks don't show them on compare.
- What's the canonical "current version" of a song for comparison? The version flagged `current` in the library mock has no schema equivalent on `SongVersion` today.
- Sync-playback: does WaveSurfer need pre-computed peaks JSON, or is decoding both files client-side acceptable for the audience (up to 200 MB uploads)?
- Reference URLs (`youtube.com/...`) — can the BFF actually ingest from these sources in v1, or is references = uploaded files only?

## Build verdict

**IMPLEMENT WITH PLACEHOLDERS** — works but the references library, match-score formula, "save as match target" persistence, and "to match this reference" suggestions are all new work; "Export PDF" and "Apply all adjustments" stay as disabled cosmetic buttons.

The shape of the comparison is fully expressible from existing analyses (both sides produce the same `final_json` after going through the pipeline), so once the references library lands (per the profile audit), this page is mostly delta arithmetic plus a small new compare endpoint. The unknowns are scope choices, not capability gaps.

## Recommended cuts / placeholders for v1
- Cut "Export delta as PDF" button (or render as disabled with a "coming soon" tooltip).
- Cut "Apply all 3 suggested adjustments" — no DAW integration exists; show only the human-readable suggestions.
- Cut "↓ swap" pickers in the first pass — drive the page entirely via URL params (`?track=…&ref=…`) launched from ReferenceCard. Add pickers in a follow-up.
- Ship suggestions as deterministic delta-driven templates ("Push +{deltaLU} LUFS", "Cut bass −{pct}% to match shape") rather than LLM-generated. Revisit once the verdict pipeline has a reference-aware prompt.
- Compute match score in the BFF as a one-page formula (weighted L2 distance across LUFS / DR / 8-band / width / correlation), not via a new specialist.
- Defer version-vs-version comparison entirely; only support track-vs-reference in v1.
- Synced playback: implement single-track playback first; "synced" toggle is a v1.1 win.

## Notes
- The existing pipeline already produces reference deltas in `phase5_reference.py` when a reference WAV is supplied at upload time (see `analysis_results.final_json.phase5.reference_track`). That path is invoked **during** analysis and writes to the result row. The Compare page is a different flow: both sides are already-analyzed, and we diff their summary metrics on demand. The two paths overlap in math but not in plumbing — don't try to reuse phase5 at request time.
- The references library does not exist in the schema yet — it's introduced by the profile audit (a new `references` table with one row per saved commercial track and a pointer to its own `AnalysisResult`). Compare depends on that landing first; until then, the page is buildable against a fixture.
- Stem-level reference comparison already has specialist slots (`stem_reference`, `stem_reference_delta`) that are gated on both sides having stems. The mock's `SPECIALIST_GROUPS` confirms these stay disabled unless both stems and a reference are present — compare should not surface them in v1.
- `share_token` exists per analysis result; a future "share this compare view" feature can reuse the pattern but would need its own token (compare = pair of analyses, not one).
- The compare endpoint should be cacheable by `(track_version_id, reference_id)` since both sides are immutable analyses; a 1-line JSONB cache on a new `compare_cache` row would let "Save as match target" remain instant on re-open.
