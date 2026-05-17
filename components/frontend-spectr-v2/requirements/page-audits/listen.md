# Listen Page Audit

## Overview
Personal "now playing" / listening view for the producer who just finished an analysis. They use it to play back the track while watching live meters and an animated spectrum, jot timestamped private session notes, and optionally tweak the playback chain (EQ, comp, sat, width, etc.) without altering the source file. Primary outcome: form a perceptual judgment that complements the static analysis report, and capture notes that feed back into the next mix revision.

## Subpages / variants
- Default playback view (transport + spectrum hero + meter rail + notes column)
- Expanded tool placeholder panel (one of 8 PREVIEW_TOOLS expanded inline below tile grid)
- A/B mode switch — toggles between "A" (source) and "B" (with tool chain). UI is wired; underlying audio path is placeholder.
- Bypass-all state (greys out tool grid).
- No distinct routed subpage; everything is in-place state on a single React tree.

## Data the page assumes
| Field | Status | Source today | Effort if not | Notes |
|---|---|---|---|---|
| `track.name`, `track.format` | ✅ exists | `songs.name` + derived from `song_versions.file_path` extension/probe | — | Format string "WAV · 48 kHz · 24-bit" needs `sample_rate` + `bit_depth` probed at decode. Phase1 only stores `duration_seconds` today. |
| `track.durationSec` | ✅ exists | `final_json.phase1.duration_seconds` | — | |
| `track.bpm` | ✅ exists | `final_json.phase*` (analysis pipeline) | — | Already surfaced on Report. |
| `track.key` | ✅ exists | `final_json.phase1.detected_key` | — | Stored as pitch class string e.g. "A#"; mock shows "F# minor" with mode — mode detection is not currently produced. Treat mode as derivable / 🔨 S. |
| `track.genre.name` + `confidence` | ✅ exists | `final_json` genre phase | — | |
| `track.grade` / `track.score` | ✅ exists | computed from pipeline; surfaced on Report | — | |
| `track.loudness.integrated` (LUFS) | ✅ exists | `final_json.phase2` loudness | — | |
| `track.loudness.truePeak` | ✅ exists | `final_json.phase1.true_peak_db` | — | |
| Waveform peaks for scrubber | 🔨 pipeline | not pre-computed today; mock fabricates from arrangement | M | Need a peaks array (e.g. 1000–4000 min/max pairs) generated at decode time and stored as JSON sidecar or `analysis_results.waveform_peaks` JSONB. Without it, the page must compute peaks client-side from the audio file on first play (slow on 200 MB WAVs) or render a fake. |
| `track.arrangement.sections[]` with `t/l/bars` | ✅ exists | `final_json` arrangement phase (allin1 / structure) | — | Bars count exists; ensure schema aligns with mock's `t/l/bars` keys (currently different naming). |
| Current playback section (live) | ⚠️ derivable | computed client-side from `sections[]` + playhead | — | Pure presentation logic. |
| Section colors per type (intro/buildup/drop/breakdown/outro) | ⚠️ derivable | mapping in client | — | |
| Live LUFS-S, peak, correlation values during playback | 🔨 pipeline | not produced today (analysis is offline-only) | L | True live meters require client-side Web Audio AnalyserNode + custom LUFS-S impl. The mock animates fake values via `Math.sin`. v1 should compute these in-browser from the decoded audio (no backend round-trip). |
| Frequency tilt mini-spectrum | ⚠️ derivable | client AnalyserNode FFT | — | |
| Stereo width %, correlation, mono compat | ✅ exists (static) | `final_json.phase1.mono_compatibility`, stereo phase outputs | — | Static values exist; LIVE versions require Web Audio analysis on client. |
| Session notes (`track.notes[]` with `id/t/text/pinned`) | 🆕 schema | nothing today | S | New table `session_notes (id, version_id FK, user_id FK, t_seconds float, text, pinned bool, created_at, updated_at)`. Private to the owning user. |
| `track.tranceDNA.parts[]` (DNA tags) | ❌ blocked | not produced by pipeline | — | Mock-only descriptor list. Cut for v1. |
| Track DNA stat block (Mood, Energy 82/100, Drops "2 & 56 & 196", Vocals "Instrumental") | 🔨 pipeline | partial: drops count derivable from arrangement; "Mood" + "Energy 82/100" + "Vocals: Instrumental" are not produced | M | Mood/energy/vocal-presence classifiers would be net-new ML work. Drop count + drop timestamps are derivable from arrangement sections. |
| Similar tracks "From your library" | ⚠️ derivable | naive: same genre + similar BPM from `songs` | S | No similarity model today; substitute with rule-based filter (same genre ± 4 BPM) for v1 placeholder. |
| 8-band EQ curve, comp params, sat curve, width meter, scope (tool placeholders) | ⚠️ derivable | tool UI is mocked; no DSP wired | — | Placeholders accepted by design. Real DSP via Web Audio API is client-only. |
| `playing` / `position` / `volume` / `speed` | ⚠️ derivable | client state | — | Standard HTMLAudio / WaveSurfer state. |
| Audio file URL for playback | ✅ exists | `song_versions.file_path` (local disk via IFileStorage) | — | Need authenticated streaming endpoint that returns audio bytes with Range support; new BFF route. |

## Interactions
| Trigger | Action | Backend route | DB changes |
|---|---|---|---|
| Page mount | Load track + version + analysis JSON | `GET /api/songs/{songId}/versions/{versionId}` (new) + `GET /api/jobs/{jobId}/results` (exists, returns `final_json`) | — |
| Play / pause / seek / vol / speed | Client-only Web Audio + transport | none | — |
| Request audio bytes | Stream WAV/FLAC/MP3 with Range | `GET /api/versions/{versionId}/audio` (new, supports `Range`) | — |
| Click "+ Note" / Save in input | Create timestamped session note | `POST /api/versions/{versionId}/notes` body `{t, text, pinned}` (new) | INSERT session_notes |
| Click existing note marker on scrubber | Seek + select note | none (client) | — |
| Edit / delete a note | Update or remove | `PATCH /api/notes/{noteId}` + `DELETE /api/notes/{noteId}` (new) | UPDATE/DELETE session_notes |
| Toggle pinned on note | Persist pin flag | `PATCH /api/notes/{noteId}` (new) | UPDATE session_notes.pinned |
| Toggle a tool in ToolsRail (EQ/comp/sat/ms/loop/scope) | Insert/remove WebAudio node in client chain | none | — |
| Toggle Bypass-all | Bypass full chain | none | — |
| Toggle Loudness-match | Apply gain compensation in client chain | none | — |
| A/B switch | Route monitor between dry tap and processed tap | none | — |
| "Save chain as preset" | Persist preset for user | `POST /api/users/me/audio-presets` (new) | INSERT new `audio_presets` table |
| Open tool placeholder panel | Client-only expand/collapse | none | — |
| "View Report →" | Navigate to Report page for this version | client route | — |
| Click similar track card | Navigate / start playing | client route + `GET /api/versions/{id}/audio` | — |
| Reset chain | Clear all tool toggles | none | — |
| Limiter (v2 tile) | Disabled in v1 | — | — |
| Pitch/tempo (v2 tile) | Disabled in v1 | — | — |

## Real-time / streaming behavior
- HTTP **Range requests** on the audio bytes endpoint for seeking and progressive playback. No SSE / websocket on this page.
- All "live" meters (LUFS-S, peak, correlation, frequency tilt, scope) must be computed **client-side via Web Audio API AnalyserNode** at ~30–60 Hz. No backend streaming.
- `requestAnimationFrame` drives playhead position locally.
- Optional: WaveSurfer.js peaks loaded from a backend-generated peaks JSON; if not pre-computed, WaveSurfer can derive them on the client (slow first-load on long files).

## Open product questions
- Are session notes truly private to the owner, or shared across collaborators on the same Song? (mock says private — stick with that.)
- Should notes survive when a SongVersion is deleted? (Cascade is safest.)
- Limit on notes per version? (Soft cap at 100 to keep marker rail readable.)
- Should the live meters use Web Audio (browser-native, free, real-time) or play back pre-computed time-series? Decision affects whether we need to store `loudness.shortTermSeries`.
- For "Save chain as preset" — is this an MVP feature or v2? (Recommend v2; tool chain is itself placeholder.)
- Should playback speed change pitch (HTMLAudio default) or preserve pitch (requires WASM stretch)? Mock implies speed-only.
- Are similar-track recommendations needed in v1, or can the right rail end at the frequency tilt card?
- Should "+ Note" auto-pause playback while typing? UX call.

## Build verdict

- **🟡 IMPLEMENT WITH PLACEHOLDERS** — works as a useful page, but the entire ToolsRail (EQ/comp/sat/width/limiter/pitch/loop/scope) is placeholder DSP, Track DNA stats are partly fabricated, similar-tracks is rule-based at best, and waveform peaks aren't pre-computed today.

The core experience (play audio, see static analysis values, watch client-computed live meters, write timestamped notes) is buildable on existing pipeline output plus a new notes table and a streaming audio route. The tool chain, DNA panel, and "similar tracks" can ship as visually polished placeholders and become a v2 expansion without changing the page's information architecture.

## Recommended cuts / placeholders for v1
- **Cut Track DNA card** ("Mood: Driving, hopeful", "Energy 82/100", "Vocals: Instrumental", `tranceDNA.parts[]`). Pipeline doesn't produce these; faking them undermines trust. Replace with a compact "Key facts" card driven by real BPM/key/LUFS/duration only.
- **Cut Similar Tracks card** in v1 (or stub with same-genre filter and label "more from your library"). No similarity model exists.
- **Stub all ToolsRail tools as visual-only** with explicit "Preview only — not yet wired" labels, OR ship only Loop + Phase Scope (both feasible with WaveSurfer regions + AnalyserNode), and mark EQ/Comp/Sat/Width as "v1.5". Hide Limiter and Pitch tiles entirely (already marked v2).
- **Defer "Save chain as preset"** until tools actually process audio.
- **Defer Loudness-match toggle and A/B switch** UI until at least one tool is real; otherwise A and B sound identical and the control is confusing.
- **Defer pre-computed waveform peaks** — let WaveSurfer derive client-side for v1 with a loading state. Add backend pre-compute when the dataset grows.
- **Cut FreqGridOverlay frequency labels** unless we ship a real spectrum analyzer; static "50 Hz / 120 / 250 ..." labels over an animated bar mock will read as fake to producers.
- **Replace mock SpectrumBars** with a real Web Audio AnalyserNode FFT visualization or remove the hero and lean on the waveform scrubber.
- **+ Note button in transport row** should be the primary affordance; keep it, drop the duplicate in the header.

## Notes
- Mock uses inline `style={{}}` extensively — must be rewritten as CSS Modules per locked stack.
- Visual primitives shared with other pages (CoverArt, GradePill, SectionTitle, pill classes, MiniSpectrum, SpectrumBars) — confirm a shared `components/ui` and `components/viz` directory pattern across the audit; this page leans on `SpectrumBars` (also used on Library) and CoverArt (used in similar-tracks card + header).
- Playback audio source needs a streaming route that respects auth (JWT) and supports HTTP Range; current API `GET /jobs/{id}/results` returns JSON, not audio. Add `GET /api/versions/{versionId}/audio`.
- Note markers on the scrubber overlap visually if many notes exist within seconds — design assumes sparse notes; add collision/clustering rule for >5 notes within 2% of duration.
- Mock's `track.notes[]` schema (id, t, text, pinned) is clean — adopt as-is for the new `session_notes` table.
- The page's "live" feel depends on Web Audio working in all target browsers; Safari < 14.1 has AudioWorklet limitations — confirm browser support floor before committing to AudioWorklet-based meters or limiter.
- WaveSurfer.js is locked in the stack — use its built-in regions + peaks for the scrubber rather than the hand-rolled flex-of-divs in the mock.
- `track.loudness.shortTermSeries` exists in mock and is currently not produced by pipeline; if we want true LUFS-S replay (not just live), store it as `analysis_results.final_json.phase2.short_term_series` (cheap addition, ~hundreds of floats per track).
- Tool-chain audio graph would be coupled to the audio element — design Zustand store for chain state, restorable across page nav (already isomorphic to "Save preset" feature).
- Header shows `track.format` as "WAV · 48 kHz · 24-bit" — needs sample rate + bit depth probe added to phase1 metadata (cheap with `soundfile.info()`).
