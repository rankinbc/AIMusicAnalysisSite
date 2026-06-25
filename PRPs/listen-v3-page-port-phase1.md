name: "Listen V3 · Page Port Phase 1 — make /listen-rack play a real song (audio + transport)"
description: |
  The redesigned Listen page (`features/listen-rack/`, route `/listen-rack`) is, today, a faithful VISUAL
  replica driven by a mock rAF transport clock over a `TRACK` fixture — it has no `<audio>` element and never
  touches the audio engine. This PRP wires the FIRST swap boundary from `PORTING_NOTES.md §1`: mount a real
  `<audio>` + `useAudioGraph`, add a `$versionId` route, and drive the transport off the real element so the
  new page plays an actual song. Audio-only — the rack knobs do NOT yet shape the sound (that is Phase 2). This
  is the prerequisite the rest of the V3 page work assumes; nothing here is new infra — it reuses the proven
  `/listen/$versionId` wiring verbatim.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md ·
6. Copy the proven `/listen/$versionId` audio wiring — do NOT reinvent the transport.

## Decision this implements
**`/listen-rack` is the canonical future Listen page** (decided 2026-06-25; memory `listen-rack-canonical-page`),
superseding the legacy `/listen/$versionId`. The engine (`features/listen/useAudioGraph.ts`) is page-agnostic and
reused as-is; only the page that hosts the UI changes. This PRP is **Phase 1** of that port.

---

## Goal
- A new route `src/routes/_app/listen-rack.$versionId.tsx` that renders `ListenRackPage` for a REAL version.
- `ListenRackPage` mounts a real `<audio crossOrigin="anonymous">` and calls `useAudioGraph(audioRef)` when given a
  real version; the transport (play/pause, scrubber, position, duration, section ribbon, notes) is driven by the
  audio element instead of the mock rAF clock.
- `graph.ensureContext()` fires on the play-button gesture BEFORE `audio.play()` (autoplay policy).
- The param-less `/listen-rack` demo route keeps the mock clock (so the design/demo surface is unchanged).
- Everything else stays mock for now: presence/reactions/coach/meters/visualizer-from-audio are untouched
  (their swap boundaries are `PORTING_NOTES.md §2/§4/§5` — later phases).

## Why
- **It is the prerequisite everything else assumes.** `room-sessions` (PRP-4) is written against this page and
  its audio model is "clients play the file locally at the synced position — no host audio stream," which
  presupposes local playback works here. It does not today. **Phase 1 must land before PRP-4.**
- **Lowest-risk path.** The shipping `/listen/$versionId` page already does exactly this (real `<audio>` +
  `useAudioGraph` + token'd audio URL + position tracking). This PRP copies that wiring onto the new page — no
  new transport tech, no backend change.

## What
Add a versioned route, mount real audio + the existing audio graph in `ListenRackPage`, and replace the mock
transport clock with element-driven `playing`/`position`/`duration`. Audio-only; rack→sound is Phase 2.

### Success Criteria
- [ ] `GET` `/listen-rack/{versionId}` renders the page and, on pressing play, **streams and plays the real
      uploaded audio** for that version (BFF `GET /api/versions/{id}/audio?t=<jwt>`, Range-enabled).
- [ ] The scrubber reflects real `currentTime`/`duration`; seeking sets `audio.currentTime`; play/pause toggles
      the element; the section ribbon + note markers track the real position.
- [ ] `<audio>` carries `crossOrigin="anonymous"` and `graph.ensureContext()` is called from the play handler
      BEFORE `audio.play()` (no AudioContext-on-load; no autoplay-policy console warning).
- [ ] A silent access-token refresh that re-points `audioUrl` does NOT visibly reset playback position (position
      is tracked off the element's `timeupdate`, mirroring `/listen/$versionId`).
- [ ] The param-less `/listen-rack` route still renders the mock-clock demo unchanged.
- [ ] No regression to the legacy `/listen/$versionId` page. All four frontend gates pass
      (`npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run`).

## All Needed Context

### Documentation & References
```yaml
- file: components/frontend-spectr-v2/src/features/listen-rack/PORTING_NOTES.md
  why: §1 "Transport clock" is the exact wiring spec; §0 lists what stays mock. THE source of truth for scope.
- file: components/frontend-spectr-v2/src/routes/_app/listen.$versionId.tsx
  why: the PROVEN pattern to copy — how the legacy page builds the token'd audioUrl, mounts <audio crossOrigin>,
       calls useAudioGraph(audioRef), wires play/seek, and tracks position across token-refresh re-mounts.
- file: components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts
  why: the page-agnostic engine + AudioGraphHandle (ensureContext, play/seek surface, pitch lane). Reused as-is.
- file: components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx
  why: the page to modify — replace the mock rAF clock (the `playing`/`position` useState + the transport
       useEffect ~L162-175) and the mock `TRACK.durationSec`-driven values with element-driven state.
- file: components/frontend-spectr-v2/src/features/listen-rack/transport.tsx
  why: the Transport component — keep its UI; feed it real position/duration/onSeek/onTogglePlay.
- file: components/frontend-spectr-v2/CLAUDE.md  (frontend gotchas section)
  why: token-in-URL re-mount, crossOrigin, ensureContext-on-gesture, position-off-element are documented gotchas.
```

### Known Gotchas (from CLAUDE.md + the legacy page)
```
# GOTCHA: AudioContext must be created on a user gesture (Chrome/Safari). Call graph.ensureContext() in the play
#   button's onClick BEFORE audio.play() — never on mount.
# GOTCHA: <audio> needs crossOrigin="anonymous" to feed MediaElementSource; BFF already sets permissive CORS for :5174.
# GOTCHA: audioUrl embeds the access token (?t=<jwt>); a silent refresh changes it and RE-MOUNTS <audio>, resetting
#   currentTime. Track position off the element's timeupdate (and pitch lane's pitchCurrentTime in pitch mode) — do
#   NOT trust React state to follow the live element. Mirror listen.$versionId.tsx exactly.
# GOTCHA: useAudioGraph returns a useMemo(()=>({...}),[]) handle; methods close over refs, not React state. Pass
#   audioRef in once; don't recreate the handle.
# GOTCHA: duration comes from the element's durationchange event, not phase1 fixtures, once a real version is mounted.
```

## Implementation Tasks (high level — expand into a step plan at execute time)
- **Task 1 — Route.** Create `routes/_app/listen-rack.$versionId.tsx`: load the version (TanStack Query, same hook
  the legacy page uses), build the token'd `audioUrl`, render `ListenRackPage` in "real" mode with the versionId +
  audioUrl. Leave the existing param-less `listen-rack.tsx` (mock) in place.
- **Task 2 — Audio mount.** In `ListenRackPage`, accept an optional real-audio context (versionId + audioUrl). When
  present: render `<audio ref={audioRef} src={audioUrl} crossOrigin="anonymous" />` and `const graph = useAudioGraph(audioRef)`.
- **Task 3 — Transport rewire.** Replace the mock `playing`/`position` state + the rAF clock effect with
  element-driven values: `playing` from play/pause events, `position` from `timeupdate`, `duration` from
  `durationchange`. `onTogglePlay` → `ensureContext()` then `audio.play()`/`pause()`; `onSeek(t)` → set `currentTime`.
  Keep the mock path intact when no real version is supplied.
- **Task 4 — Position robustness.** Track position off the element (and pitch lane when in pitch mode) so a token
  refresh re-mount doesn't jump the playhead — copy the legacy page's approach.
- **Task 5 — Verify.** Manual: open `/listen-rack/{a real versionId}`, press play, hear audio, scrub, pause. Confirm
  the legacy page + the mock demo route are unchanged. All four gates green.

## Out of scope (later phases — separate PRPs)
- **Phase 2 — rack → sound + real meters (`PORTING_NOTES §3–§4`):** bind each rack module to the graph via
  `setEffectParams` (the `bind` strings already in `data.ts`); feed the spectrum + meter rail from a real
  `AnalyserNode` (`readFrame`/`getByteFrequencyData`), replacing the synthetic meters and `useFakeGR`.
- **Phase 3 — cutover:** redirect the legacy `/listen/$versionId` → `/listen-rack/$versionId`, point all "Listen"
  entry points (library, song detail, mini-player) at the new route, and retire the legacy Listen UI **after**
  verifying feature parity (auth/token, stems, pitch, presets).

## North star (the end-state these phases build toward)
In a Room, when the controller (DJ) turns a rack knob or recalls a preset, **that change propagates to everyone
watching AND changes the sound each of them hears** — not just the DJ. There is no host audio stream: the chain
change is broadcast as params, and every client applies it to its OWN local playback (so all the knobs move on
all screens and all listeners hear the same processing). That requires three things composed:
- **Phase 1 (this PRP):** every client's page plays the file locally (real `<audio>` + `useAudioGraph`).
- **Phase 2:** the rack actually shapes that local sound (`applyChainToGraph` / `setEffectParams` → audible).
- **PRP-4:** a controller's rack/chain change is broadcast on the room channel; every client runs the SAME
  `applyChainToGraph` on its local graph (PRP-4 §"ONE shared rack chain per session — everyone hears the same processing").
The apply-loop (`chainApply.ts`) is the shared primitive used by BOTH local preset recall (Phase 2) and room
chain-sync (PRP-4) — build it once, drive it from both.

## Cross-PRP reconciliations forced by the canonical-page decision
- **Sequence:** Phase 1 (this PRP) lands **before** `listen-v3-room-sessions.md` (PRP-4); Phase 2 is what makes
  PRP-4's "everyone hears it" real (PRP-4 broadcasts params; Phase 2 is what turns params into sound per client).
- **Re-point `listen-v3-rack-preset-foundation.md` (PRP-1):** its Save/Recall UI-wiring targets the LEGACY page
  (`listen.$versionId.tsx`/`PresetBar.tsx`). Re-aim that UI onto `ListenRackPage`'s bottom rack module. ("Only the
  UI host moves" = only which PAGE hosts the preset buttons changes — NOT the effect's reach.) The apply effect
  itself must reach **every watcher and their sound**, per the north star: `applyChainToGraph` is page-agnostic and
  is the same call a Room `rack`/chain event runs on every client.
