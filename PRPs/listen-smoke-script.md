# Listen-page Engine Smoke Script (manual browser test)

The Listen DSP rack (Phases 1–5) has never been exercised in a real browser — Web
Audio / AudioWorklet can't run in jsdom, so the AudioNode wiring, worklet loading,
reorder click-freeness, and "does a param actually take" are all unverified by the
432 unit tests. This is the 10-minute check that catches those runtime bugs **before**
the UI is designed on top of the engine.

A DEV-only harness exposes the audio-graph handle on `window.__spectrRackGraph`
(`features/listen-rack/ListenRackPage.tsx`, stripped from production builds).

## Setup

1. Start the stack per `docs/STARTUP.md` (`./scripts/start-spectr.ps1`) — needs the BFF + a logged-in user + a version that has uploaded audio.
2. Navigate to a version's Listen page: **`/listen-rack/{versionId}`** (one with real audio).
3. **Press play** — this is the user gesture that creates the AudioContext (`ensureContext`). Confirm you hear the track. Leave it playing.
4. Open DevTools console and grab the handle:
   ```js
   const g = window.__spectrRackGraph;
   ```

## 0. Worklet boot (the #1 risk)

The gate/bitcrusher/limiter run on an AudioWorklet that registers asynchronously a
few hundred ms after the first audio. **Watch the console during step 3** — there
must be NO `addModule` / worklet registration error. If those three effects do
nothing in their steps below, the worklet failed to load (the bug we fixed with
`?worker&url` — re-verify the build emitted real `*.processor-*.js` chunks).

## 1. Behavior preservation (baseline)

With nothing touched, playback must sound exactly like before the rack revamp — all
13 modules default to transparent (dry passthrough). If the raw track sounds colored
at rest, a default isn't transparent. (`g.resetAll()` returns to this state any time.)

## 2. Per-module check — drive each, hear it, reset it

Each line should AUDIBLY change the sound; the reset line should restore it.

```js
// DJ Filter — sweep
g.setEffectParams('djfilter', { enabled: true, morph: -0.7 });  // muffled (lowpass down)
g.setEffectParams('djfilter', { morph: 0.7 });                  // thin (highpass up)
g.setEffectParams('djfilter', { enabled: false, morph: 0 });

// EQ — bands array (no unit bypass; "off" = flat). Boost the 60 Hz band:
g.setEqBand(0, 12);    // bass up
g.setEqEnabled(false); // flatten all bands (transparent)

// Gate (WORKLET) — cut quiet passages
g.setEffectParams('gate', { enabled: true, thresholdDb: -15 });
g.readEffectMeter('gate');   // -> { reductionDb, open }  (live)
g.setEffectParams('gate', { enabled: false });

// Compressor — squash + meter
g.setEffectParams('comp', { enabled: true, thresholdDb: -30, ratio: 8 });
g.readEffectMeter('comp');   // -> { reductionDb }  (live, negative when compressing)
g.setEffectParams('comp', { enabled: false });

// Saturator — distortion
g.setEffectParams('sat', { enabled: true, drive: 0.8, mix: 1, curve: 'hardclip' });
g.setEffectParams('sat', { enabled: false });

// Bitcrusher (WORKLET) — lo-fi crunch
g.setEffectParams('bitcrusher', { enabled: true, mix: 1, bitDepth: 4, downsample: 8 });
g.setEffectParams('bitcrusher', { enabled: false });

// M/S Width — collapse to mono, then widen
g.setEffectParams('ms', { enabled: true, width: 0 });  // mono
g.setEffectParams('ms', { width: 2 });                 // wide
g.setEffectParams('ms', { enabled: false });

// Stereo Pan — hard left
g.setEffectParams('pan', { enabled: true, pan: -1 });
g.setEffectParams('pan', { enabled: false });

// Tremolo — amplitude wobble
g.setEffectParams('tremolo', { enabled: true, depth: 1, rateHz: 6, sync: false });
g.setEffectParams('tremolo', { enabled: false });

// Delay — echoes, then ping-pong
g.setEffectParams('delay', { enabled: true, mix: 0.5, feedback: 0.5, sync: false, timeMs: 350 });
g.setEffectParams('delay', { pingPong: true });   // bounces L/R
g.setEffectParams('delay', { enabled: false });

// Reverb — tail
g.setEffectParams('reverb', { enabled: true, mix: 0.6, ir: 'hall', decaySec: 4 });
g.setEffectParams('reverb', { enabled: false });

// Limiter (WORKLET) — clamp loud peaks + meter
g.setEffectParams('limiter', { enabled: true, ceilingDb: -12 });  // audibly ducks loud peaks
g.readEffectMeter('limiter');  // -> { reductionDb }  (live)
g.setEffectParams('limiter', { enabled: false });

// Output Trim — level
g.setEffectParams('trim', { gainDb: -12 });  // quieter
g.setEffectParams('trim', { gainDb: 0 });
```

## 3. Reorder (must be click-free during playback)

```js
g.getOrder();                              // current 13-id chain
g.reorder([...g.getOrder()].reverse());    // reverse — should be click-free
g.reorder(g.getOrder());                   // no-op (same order; no duck)
```
Listen for a click/pop on the reverse — a brief dip is expected, an audible click is a bug.

## 4. Master bypass + reset

```js
g.setMasterBypass(true);   // dry (whole chain bypassed)
g.setMasterBypass(false);  // processed
g.resetAll();              // every module -> default (transparent)
```

## 5. Pitch (separate lane — exercise via the page's Pitch panel)

Pitch is not an insert effect; use the on-page Pitch controls (it decodes the file
to a buffer on first enable). Confirm semitone shift works and that the page notes
pitch+tempo coupling.

## 6. Room (live two-client smoke)

The live room (ROOM mode on the same `/listen-rack/{versionId}` page — roster,
chat, host transport sync, ended/reconnect states) has its own two-client
verification script: **`PRPs/listen-rack-room-completion.md` → "Level 3 —
two-client live verification"**. Run it whenever the room protocol or its UI
wiring changes. Prereq: enable the `room_hosting_enabled` feature flag in dev
(the Level 3 script's step 0; 60 s flag cache).

## What to report

- Any module that produces NO audible change when enabled (esp. gate/bitcrusher/limiter → worklet didn't load).
- Any `readEffectMeter('comp'|'gate'|'limiter')` returning `null`/`{}` while the effect is active.
- Any audible click on `reorder` during playback.
- Any console error (especially `addModule` / worklet registration).
- Any default-state coloration (behavior-preservation break).
