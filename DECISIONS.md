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
