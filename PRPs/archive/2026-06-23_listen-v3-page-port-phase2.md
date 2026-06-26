name: "Listen V3 · Page Port Phase 2 — the rack shapes the sound + real meters"
description: |
  Phase 1 made `/listen-rack/$versionId` PLAY a real song (real `<audio>` + `useAudioGraph`), but the rack knobs
  are still inert local state and every meter/spectrum is synthetic math. This PRP wires `PORTING_NOTES.md §3–§4`:
  bind the rack UI to the live audio graph so turning a knob (or recalling/coach-applying a preset) actually
  changes the sound the listener hears, and replace the three synthetic sources (`useLiveMeters`, `useFakeGR`,
  the `VizStage` spectrum) with real `AudioGraphHandle.readFrame()` / `readEffectMeter()` data. Client-only —
  no backend. Every binding already exists in code; this PRP connects the two ends that Phase 1 left apart.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md ·
6. Copy the proven `/listen/$versionId` meter/spectrum loop — do NOT reinvent the rAF draw loop.

## Decision this implements
**`/listen-rack` is the canonical Listen page** (memory `listen-rack-canonical-page`). Phase 1 (`298a7a8`) landed real
audio + transport. This is **Phase 2**: the rack→sound binding and real metering. It is the slice that makes the
north star physically true on a single client (the broadcast that makes it true for *every* watcher is PRP-4).

---

## North star (unchanged from Phase 1 — this PRP delivers the per-client half)
In a Room, when the DJ turns a rack knob or recalls a preset, **the change propagates to everyone watching AND
changes the sound each of them hears.** There is no host audio stream: each client applies the controller's param
changes to its OWN local playback. That is three things composed:
- **Phase 1 (done):** every client plays the file locally.
- **Phase 2 (this PRP):** the rack actually shapes that local sound — `setEffectParams` makes a knob audible.
- **PRP-4:** a controller's chain change is broadcast; every client runs the SAME `setEffectParams` on its graph.
The engine call `graph.setEffectParams(id, patch)` is the shared primitive used by BOTH a local knob turn (this
PRP) and a room `rack` delta (PRP-4) — wire it once here, drive it from the room channel there.

## Goal
- Turning any insert-effect knob/fader/switch on `/listen-rack/$versionId` is **audible** — `useRackState` mutations
  push to `graph.setEffectParams(id, patch)` (EQ via `{ enabled, bands }`; enable/bypass via `{ enabled }`).
- On entering real mode the **full current rack state is pushed to the graph once** (so defaults + persisted values
  apply before the first knob turn), and `recallPreset` / `applyCoach` / `reset` / chain-reorder / master-bypass all
  re-push.
- The **meter rail shows real levels** (`readFrame()` → `lufsShort` / `truePeakDb` / `rmsDb` / `correlation`),
  replacing `useLiveMeters`'s sinusoid.
- The **GR meters show real gain reduction** (`readEffectMeter('comp'|'gate'|'limiter').reductionDb`), replacing
  `useFakeGR`.
- The **VizStage spectrum is fed by the real FFT** (`readFrame().fftBins`, log-downsampled), replacing the synthetic
  tilt/wobble — and any real-audio-driven full-field flash routes through the shared ≤3 Hz limiter + respects
  `prefers-reduced-motion` (photosensitivity guardrail).
- The mock demo route (`/listen-rack`, no version) is **unchanged** — synthetic meters/spectrum stay there.

## Why
- **It is the half of the north star that makes the rack mean anything.** Right now a Room DJ could turn a knob and
  nobody — not even the DJ — would hear it. PRP-4 broadcasts params, but params only matter once `setEffectParams`
  is audible. This PRP is the prerequisite that makes PRP-4's "everyone hears the same processing" real.
- **Lowest-risk path.** The engine (`useAudioGraph`), every module's `bind` string (`data.ts`), and the proven
  meter/spectrum rAF loop (`/listen/$versionId`) already exist. This PRP connects existing ends; no new DSP, no
  backend, no new dependency.

## What
Thread the Phase-1 `graph` handle into `useRackState` (and a page rAF loop), so rack mutations apply to the graph
and meters/spectrum read from it. Insert chain only — the **pitch lane is explicitly deferred** (it is a separate
tempo-coupled `enterPitchMode`/`setPitchDetune` buffer lane, not an insert; out of scope here).

### Success Criteria
- [ ] On `/listen-rack/{versionId}`, with audio playing, turning the **EQ**, **comp**, **sat**, and **M/S width**
      controls produces an **audible** change; toggling a module's enable bypasses it audibly.
- [ ] Entering the page applies the **initial rack state** to the graph (a non-default persisted preset is audible
      immediately on play, before any knob is touched).
- [ ] **Recall preset**, **coach-apply**, **reset**, **chain reorder**, and **master bypass** each re-apply to the
      graph (audible / correctly ordered).
- [ ] The meter rail's **LUFS-S / True-Peak / RMS / Correlation move with the actual audio** (silence → −∞/low;
      loud section → higher), not a fixed sinusoid; they read `graph.readFrame()`.
- [ ] The **comp/gate/limiter GR meters show real reduction** from `readEffectMeter`, ~0 dB when the module is
      disabled or below threshold.
- [ ] The **EQ/spectrogram stage spectrum reacts to the real mix** (bass-heavy section lights the low bars); fed by
      `readFrame().fftBins`.
- [ ] No real-audio-driven **full-field flash** exceeds ~3 Hz, and all flashing freezes under
      `prefers-reduced-motion` (reuse the shipping `flashLimiter` + `useReducedMotion`).
- [ ] The mock demo route `/listen-rack` is **unchanged**; the legacy `/listen/$versionId` is **unchanged**. All
      four frontend gates pass (`npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run`).

## All Needed Context

### Documentation & References
```yaml
- file: components/frontend-spectr-v2/src/features/listen-rack/PORTING_NOTES.md
  why: §3 (rack→engine binding table: setParam→setEffectParams, etc.) and §4 (viz/meters→AnalyserNode) are the
       authoritative scope. §0 = re-verify the manifest against the live engine source before wiring.
- file: components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts
  why: AudioGraphHandle. setEffectParams<K extends EffectId>(id, patch: Partial<EffectParamMap[K]>);
       readEffectMeter(id) -> { reductionDb?, open? } | null; readFrame() -> AudioFrame
       { fftBins, bandAverages, rmsDb, lufsShort, truePeakDb, correlation, scopeL, scopeR };
       reorder(order), setMasterBypass(b), resetAll(). EffectId = eq|comp|sat|ms|djfilter|delay|reverb|pan|
       tremolo|trim|gate|bitcrusher|limiter.
- file: components/frontend-spectr-v2/src/features/listen-rack/data.ts
  why: MANIFEST_BY_ID[id].bind is the EXACT call per module (e.g. comp → "setEffectParams('comp', patch) ·
       readEffectMeter('comp')"). RACK_MANIFEST param descriptors carry the `key` names setParam uses — verify
       they equal the engine EffectParamMap field names (PORTING_NOTES §0).
- file: components/frontend-spectr-v2/src/features/listen-rack/rackState.ts
  why: useRackState() — setParam(id,key,val) / setEnabled(id,on) / setEqBands(bands) / applyCoach(patch) /
       reset() / recallPreset(pr) / setOrder / setMasterBypass currently mutate LOCAL `mod` only. This is the
       primary binding point. Also exports useFakeGR(enabled,playing,depth) — the synthetic GR to replace.
- file: components/frontend-spectr-v2/src/features/listen-rack/rail.tsx
  why: useLiveMeters(track,playing) (~L52–73) is the synthetic level source feeding VisualMeters; replace its
       body with a real readFrame()-derived frame passed down from the page.
- file: components/frontend-spectr-v2/src/features/listen-rack/viz.tsx
  why: VizStage synthetic spectrum (~L391–426: tilt/wobble). Plug real fftBins (log-downsampled to the bar count)
       in at the frame-update site. Reuse freqToX/EqCurveOverlay (already Hz→x).
- file: components/frontend-spectr-v2/src/routes/_app/listen.$versionId.tsx
  why: THE proven template — the rAF draw loop (~L524–641) that calls graph.readFrame(), throttles the meter
       frame to ~80ms, log-downsamples fftBins to bars, and drives beat/drop/flash via beatDetector/dropDetector/
       flashLimiter + useReducedMotion. Copy this pattern; do not re-derive it.
- file: components/frontend-spectr-v2/src/features/listen/meters.ts
  why: buildMeterCells shape (lufs/crest/rms/true_peak/corr/gr) — reference for which frame fields map to which
       readout. (The rack page uses its own VisualMeters UI, NOT MeterModule — feed values, don't import the cells.)
```

### Known Gotchas (from the research + CLAUDE.md)
```
# GOTCHA: useRackState is also instantiated by the MOCK demo route (no graph). Thread the graph as an OPTIONAL
#   arg — useRackState(graph?) — and push to the engine only when present. Mirrors Phase 1's optional `versionId`.
# GOTCHA: setParam's `key` must equal the engine EffectParamMap field name. PORTING_NOTES §0 — re-verify the
#   manifest param descriptors against useAudioGraph's EffectParamMap before wiring; the engine wins on any drift.
# GOTCHA: EQ is special — it binds as setEffectParams('eq', { enabled, bands }) with the FULL EqBand[] array, via
#   setEqBands, not a single scalar key. comp/gate/limiter additionally expose readEffectMeter for GR.
# GOTCHA: PITCH IS NOT AN INSERT. PITCH_MODULE uses enterPitchMode()/setPitchDetune() in a separate buffer lane.
#   Do NOT route it through setEffectParams and do NOT add 'pitch' to the chain order. Deferred entirely here.
# GOTCHA: real GR EXISTS now — readEffectMeter('comp'|'gate'|'limiter').reductionDb. Poll it in the SAME rAF loop
#   that reads meters; don't add a second loop. (Legacy passes grReductionDb:null only because it predates this.)
# GOTCHA: real audio means real drops → real flashes. Route every full-field flash through the shipping ≤3 Hz
#   flashLimiter and freeze under prefers-reduced-motion (the ported LaserFan/bgFlash do NOT yet — PORTING_NOTES §4).
# GOTCHA: one rAF loop only, gated on (realAudio && playing). readFrame() is cheap but the rail must reconcile at
#   ~12 Hz, not 60 — throttle the meter-frame setState like the legacy page (lastMeterTsRef >= 80ms).
```

## Implementation Tasks (high level — expand into a step plan at execute time; executed inline)
- **Task 0 — Verify the manifest (PORTING_NOTES §0).** Diff `data.ts` RACK_MANIFEST param `key`s against
  `useAudioGraph`'s `EffectParamMap` field names. Record any mismatch; the engine field name wins. Pure desk check.
- **Task 1 — Rack → engine binding (highest value).** Give `useRackState` an optional `graph` handle. When present:
  `setParam(id,key,val)` → `graph.setEffectParams(id, { [key]: val })`; `setEnabled` → `{ enabled }`;
  `setEqBands` → `setEffectParams('eq', { bands })`; `applyCoach(patch)` → one `setEffectParams` per id;
  `reset()` → `graph.resetAll()`; `setOrder` → `graph.reorder`; `setMasterBypass` → `graph.setMasterBypass`;
  `recallPreset` → re-push the snapshot. On first real-mode mount, push the full current `mod`/`order`/bypass once.
  Extract a PURE `rackParamToGraph(id, key, val)`-style mapper (or `engineCallsFor(patch)`) so it's unit-testable
  with a call-recording fake graph. Pitch lane untouched.
- **Task 2 — Real meter rail + GR (PORTING_NOTES §4a).** Add the page rAF loop (gated on realAudio && playing,
  copied from `/listen/$versionId`): read `graph.readFrame()` (throttled ~80ms) and `readEffectMeter` for
  comp/gate/limiter; pass a real frame + GR map down so `VisualMeters` and the module GR meters render real values.
  Replace `useLiveMeters` and `useFakeGR` consumption in real mode (keep them for the mock route).
- **Task 3 — Real spectrum + flash safety (PORTING_NOTES §4b).** Feed `readFrame().fftBins` (log-downsampled to the
  VizStage bar count) into the visualizer in real mode, replacing the synthetic spectrum; drive energy/beat/drop
  from the shipping `beatDetector`/`dropDetector`. Route full-field flashes through `flashLimiter` + `useReducedMotion`.
- **Task 4 — Verify.** Gates green. Live smoke on `/listen-rack/{versionId}`: knob → audible; preset/coach/reset →
  audible; meters + GR + spectrum track the audio; flash ≤3 Hz; reduced-motion freezes it. Confirm the mock demo
  route and legacy page are unchanged.

## Out of scope (later phases — separate PRPs)
- **Pitch lane** (tempo-coupled `enterPitchMode`/`setPitchDetune`) — a separate buffer-lane slice.
- **Real track/analysis metadata** in the header/notes/sections (PORTING_NOTES §2) — still the `TRACK` fixture.
- **Preset persistence to a version** (PORTING_NOTES §6 / PRP-1) — `savePreset`/`recallPreset` stay local here.
- **Room broadcast of chain changes** (PRP-4) — this PRP makes one client's rack audible; PRP-4 makes it every
  client's. They compose via the shared `setEffectParams` primitive.
- **Phase 3 — cutover:** redirect legacy `/listen/$versionId` → `/listen-rack/$versionId` and retire the old UI
  after parity (auth/token, stems, pitch, presets).

## Cross-PRP reconciliation
- **PRP-4 reuses Task 1's binding verbatim.** A room `rack` delta handler calls the SAME `graph.setEffectParams(
  effectId, params)` this PRP wires for local knobs — so PRP-4's consumer is "apply the delta through the existing
  rack-binding path," not new code. Keep the mapper pure and graph-driven so the room handler can call it directly.
- **PRP-1 (rack-preset-foundation) apply loop** (`chainApply.ts → applyChainToGraph`) is the persistence-era form of
  Task 1's initial-state push: when PRP-1 lands, the one-shot "push full rack state to graph on mount" becomes
  `applyChainToGraph(graph, chain)`. Structure Task 1's initial push so it can be swapped for that call.
