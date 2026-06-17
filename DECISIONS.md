# DECISIONS — .als instant preview (branch `feat/als-instant-preview`)

Log of non-trivial choices made while building the client-side .als preview +
the stem-identification assist.

## D1 — Client-side parse, no upload round-trip
Goal is an instant "we understand your file" trust moment between drag and
analysis. So the .als is parsed **in the browser** the moment it's dropped/picked,
before any network call. No backend change is required.
- Gunzip: browser-native `DecompressionStream('gzip')` (present in all evergreen
  browsers + Node 18+). Falls back to plain UTF-8 decode for older, non-gzipped
  `.als` files (Ableton ≤ Live 8 wrote raw XML; some users also hand-gunzip).
- XML: browser-native `DOMParser` in `'application/xml'` mode (case-sensitive —
  Ableton tags are PascalCase like `MidiTrack`, `EffectiveName`).
- _Alternative considered:_ a server fast-parse endpoint (`POST /als/preview`)
  reusing the existing Python `ALSParser`. Rejected for the instant-UX path — it
  adds a round-trip and a backend surface. Noted here as the fallback if we ever
  need to preview huge projects or share the exact Python extraction.

## D2 — Port the *minimal* subset of `als_parser.py`
Source of truth: `components/analysis/src/audio_analysis/als/als_parser.py`.
Ported only what the preview shows, mirroring its element names / XPaths and its
field names where reasonable (`tempo`, `timeSignature*`, audio/midi track names,
devices, plugins, abletonVersion). The heavy MIDI/chord/quantization analysis is
NOT ported — irrelevant to a drag-time preview.

## D3 — Testable core via dependency injection (no global-DOM tests)
`DOMParser` is a browser global and isn't present in the vitest `node`
environment. Rather than flip the whole test env, `parseAlsXml(xml, domParse?)`
takes an optional parse function (defaults to native `DOMParser`). Tests inject
`jsdom`'s parser. Production stays 100% native — `jsdom` is a **devDependency only**.
The gunzip path (`DecompressionStream`) needs no injection — it exists in Node 22.

## D4 — Synthetic fixtures, gzipped at test time
The repo's `**/*.als` files under `components/bff/tests/data` are zero-byte
placeholders, not real projects. Tests build a realistic Ableton-shaped XML string
and gzip it at runtime (`node:zlib.gzipSync`) to exercise the real gunzip→parse
path, plus a non-gzipped variant for the fallback. A real-file smoke check should
still be done in the running app (the product owner has real `.als` projects).

## D5 — Stem-identification assist = filename ↔ track-name matching only
Per scope split with the `research/stem-classification` window (which owns the
audio-content angle), this window owns the **.als-metadata assist**:
`matchStemsToTracks(filenames, trackNames)` proposes fuzzy filename→track-name
matches (normalize → token Dice coefficient + substring bonus, greedy best match
above a threshold). A light `guessRoleFromName(name)` keyword→`StemRole` guesser
is also exported. **Wiring these into the stem confirm flow is left as a
documented follow-up** so it can be reconciled with the research window's
recommendation — see "Follow-ups" below.

## Follow-ups (not wired here, intentionally)
- Feed `matchStemsToTracks` output into `StemRow.role` pre-selection in the
  unified-upload review step (pre-label stems from .als track names before the
  audio classifier returns). Needs reconciliation with `research/stem-classification`.
- Optional server `POST /als/preview` if we ever want the exact Python extraction
  or to preview very large projects off the main thread.

---

# DECISIONS — .als project awareness (branch `feat/als-project-awareness`)

Goal: (1) reframe the upload UX to ENCOURAGE .als + de-emphasize stems, and
(2) persist the parsed .als project structure as JSON so the app has saved
"project awareness" surfaced on the results page. Builds on the client-side
parser above (D1–D5).

## D6 — Project-JSON data contract (`AlsProjectJson`)
The client parses the dropped `.als` into a clean, stable **track map** and
ships it with the upload. Shape (camelCase, frontend-authored; mirrors the
Python `Track` dataclass field-for-field where it overlaps):

```jsonc
{
  "schemaVersion": 1,         // bump on breaking shape changes
  "source": "client-als-preview",
  "tempo": 128.0,             // number | null
  "timeSignature": "4/4",
  "timeSignatureNumerator": 4,
  "timeSignatureDenominator": 4,
  "abletonVersion": "Ableton Live 11.3.13", // string | null
  "trackCount": 12,
  "tracks": [
    { "index": 0, "name": "Kick",  "type": "audio", "color": 13, "devices": ["EQ Eight","Glue Compressor"] },
    { "index": 1, "name": "Bass",  "type": "midi",  "color": 5,  "devices": ["Operator","Saturator"] }
  ],
  "devices": ["EQ Eight", ...],   // project-wide unique device list
  "plugins": ["Serum", ...]       // subset: 3rd-party VST/AU
}
```
- `tracks` is in **document order** (real Ableton track index), built by walking
  `<Tracks>` children so audio/MIDI interleave correctly — unlike the flat
  `audioTracks[]`/`midiTracks[]` the preview panel uses.
- Per-track devices come from that track's own `DeviceChain/.../Devices`
  (`getElementsByTagName('Devices')` within the track element; includes rack
  contents — good enough for "what's on this track"), deduped per track.
- `color` is the raw Ableton palette **index** (int) or null — same as the
  Python parser. No hex mapping (overkill for this surface).
- Arrangement summary is intentionally NOT in the client JSON: the authoritative
  worker phase8 already extracts locators/sections. The Project view reads
  arrangement from phase8's `final_json`, the track map from this column.
- Caps (DoS / payload guard): ≤ 250 tracks, ≤ 64 devices/track, and the BFF
  rejects a serialized `project_json` larger than 512 KB.

## D7 — Store on `song_versions.als_project_json` (jsonb)
New nullable `jsonb` column. Recommended path chosen as-is:
client parses on `.als` select → POSTs `project_json` (string form field) on the
existing `.als` upload paths (`POST /versions/{id}/als`, used by both the
standalone dialog and the unified-upload flow) → BFF stores it on the **tracked**
version row (the als path already uses the tracked `OwnedVersion` helper — heeds
the AsNoTracking write-path bug). It's plain client-supplied metadata, validated
only for size + that it parses as a JSON object; we don't trust it for analysis.

## D8 — Surface via the results API, not a re-parse
`GET /api/jobs/{id}/results` now also returns `alsProject` (the stored JSON, as a
`JsonElement?`) by joining `analyses.version_id → song_versions.als_project_json`.
The worker's phase8 stays the authoritative analysis-time parse (untouched) — we
do NOT remove or duplicate it. The results page renders a **Project** tab from
`alsProject`: header stats + a per-track list with device chips, so tracks are
visible and referenceable. The full verdict-layer track-attribution wiring
("track-specific advice") is a deliberately separate, larger follow-up.

## D9 — Single parse in the dialog, preview derived
To avoid gunzipping/parsing the `.als` twice, the dialog parses once via
`parseAlsProjectFile` → `AlsProjectJson`, then derives the panel's `AlsPreview`
via `alsPreviewFromProject(project)`. The existing `parseAlsXml`/`AlsPreview`
exports are unchanged (existing tests + the standalone dialog keep working).

## D10 — UX reframe (encourage .als, de-emphasize stems)
In `UnifiedUploadDialog`, the Ableton-project zone moves directly under the mix,
gets a "recommended" treatment (accent border + benefit copy: project-aware,
track/device-specific insights). Stems move below, collapsed behind an
"Advanced" disclosure with muted styling — present and fully functional, just no
longer the headline optional input. CSS Modules only; reuses existing classes
plus a few additive ones (`.zoneRecommended`, `.recommendedTag`, `.advancedToggle`).

## Follow-ups (project awareness)
- Add device names per track to the worker phase8 output so the Project view can
  fall back to the authoritative parse for analyses uploaded before this column
  existed (currently the Project tab is empty for those — phase8 has track names
  + device_count but no device names). — DONE in D11 below.
- Track-attribution in the verdict layer (map specialist findings onto specific
  tracks/devices) — the larger follow-up this feature unblocks. — DONE in D12–D16.

---

# DECISIONS — .als → track/device advice moat (branch `feat/als-device-advice`)

Activating the dormant moat: make verdict fixes project-specific ("on your TRITON
Pad track, reduce the Auto Filter resonance ~250 Hz") instead of role-level ("cut
the bass"), grounded ONLY on the authoritative phase-8 .als project map.
Closes the two follow-ups above. Scope: `analysis/phase8_als.py` +
`worker/app/verdict_lib/` + prompts. No frontend/BFF changes.

## D11 — phase8 carries per-track device names (authoritative map)
`als_parser` already extracts `Track.devices: List[str]`, but `phase8_als` dropped
them. Added `devices: List[str]` to `health_scorer.TrackSummary` (populated from
`track.devices`) and surfaced it in each phase8 `tracks[]` entry as `"devices"`.
`score_health` already iterates `project.tracks`, so no second/divergent walk.
This also fixes the logged "older/empty Project view" follow-up. Everything else
in the track summary is byte-identical.

## D12 — `.als` presence detection mirrors the stem gate
Added `als_state(analysis)` → `"ok"` (phase8 present, status ok, ≥1 track) |
`"absent"`, and `als_project_map(analysis)` → `{track_name: [device_names]}` to
`input_grounding.py`. Analogous to the existing `_stems_state` / `phase4.stems.status
== "ok"` gate.

## D13 — `input_provenance` left UNCHANGED; ALS grounding is a separate block
`input_provenance` feeds the coach bundle and is pinned by an exact-equality test.
Adding an `"als"` key would break it and isn't needed for grounding. Instead
`als_grounding_block(analysis)` renders an authoritative track→device listing and
is appended to the specialist/triage user message ONLY when `.als` is present. With
no `.als` it returns `""`, so the user message is byte-identical to today (guarded
by `test_no_als_user_message_byte_identical`).

## D14 — Grounding = authoritative map block (primary) + validator track-name check
- The block lists EXACT track names + their existing devices and tells the model to
  cite only those names — same preamble-instruction mechanism used for stems/reference.
- `ableton_hint.device` is NOT validated against the map: DeviceChainAnalysis
  legitimately recommends *adding* a device the track lacks, so requiring the cited
  device to pre-exist would defeat the specialist.
- The validator DOES reject a hallucinated **track**: when a `.als` map is present and
  a fix uses `target.type == "track"`, `target.name` must be a real track in the map.
  Gated strictly on `.als` presence → no-`.als` validation is byte-identical.

## D15 — Triage code-level als gate
`gate_als_specialists(plan, analysis)` in `triage.py`: when `.als` is absent it strips
`_ALS_ONLY_SPECIALISTS = {"device_chain"}` from the plan (mirrors "don't route stem
specialists when stems absent"). Only `device_chain` is treated as als-only (the one
specialist that strictly needs the track/device map); other MIDI-aware specialists are
left untouched so existing routing is unchanged. When `.als` is present the plan is
untouched (the prompt routes `device_chain`).

## D16 — Prompts
`Triage.md` gains an "ALS-aware specialists (route ONLY when an .als is present)"
section. `DeviceChainAnalysis.md` is instructed to set
`fix.target = {"type": "track", "name": <exact project track name>}`, fill
`ableton_hint.device`/`band`, and cite ONLY names from the authoritative project map
in the user message.

## Graceful degradation (AC c)
No `.als` → `als_state == "absent"` → no als block in the user message, triage gate is
a no-op, validator als branch skipped. Role-level output byte-identical to today.
Guarded by tests.
