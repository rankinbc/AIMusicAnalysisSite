# Listen — Shared Audio Engine + Social Hooks

> **Living document.** `features/listen/` is the **shared real-time Web Audio
> engine** — the `useAudioGraph` handle, the modular `EffectUnit` graph (`audio/**`),
> and the stem deck (`StemDeck` / `useStemEngine` / `stemGains`) — **plus the
> social/sharing hook layer** (rooms, access, invites, comments, bookmarks; see §2)
> consumed by the listen-rack page and the public routes. The Listen PAGE itself
> lives in **`features/listen-rack/`** (route `/listen-rack/$versionId`). Keep this
> updated when you change the engine, the handle, the stem deck, or the hooks.
>
> Last updated: 2026-07-23. Status: audio **engine done + frozen**;
> `features/listen-rack/` is the only Listen page; the room hooks are being wired
> into its live UI by `PRPs/listen-rack-room-completion.md`.

---

## 1. What it is

The Listen page lets a music producer hear their uploaded track through a real-time
Web Audio **DSP "rack"** — a reorderable chain of 13 effect modules (EQ, compressor,
saturator, M/S width, DJ filter, delay, reverb, pan, tremolo, gate, bitcrusher,
limiter, output trim) plus a separate pitch lane — while watching live visualizers
(spectrum, scope/goniometer, LUFS/true-peak). It's primarily a **mastering / loudness
preview** of a finished stereo mix ("what would my track sound like with X").

## 2. Where it's used

The canonical Listen page is **`features/listen-rack/`** (route
`src/routes/_app/listen-rack.$versionId.tsx`). That page owns the `<audio>` element,
creates the graph (`const graph = useAudioGraph(audioRef)`), and composes the header,
visualizer stage (driven by `graph.readFrame()` in a rAF loop), transport, the rack
(`InlineRack` bound to the engine via `features/listen-rack/rackBindings.ts`), the
right rail, the stem deck (`StemDeck`), and the pitch lane. See
`features/listen-rack/PORTING_NOTES.md` for that page's current real-vs-mock map.
(The legacy `/listen/$versionId` route is gone.)

Beyond the engine, this folder also hosts the **social / sharing hook layer**,
consumed by the listen-rack page:

- **Room realtime**: `useRoomStream` (fetch-SSE reader for `GET /sessions/{id}/stream`),
  `useRoomActions` (the POST senders: react/chat/status/transport/visuals/rack/grant/revoke),
  `useRoomSession` (session history / start / end / recap) — composed by
  `features/listen-rack/useRoomOrchestration`.
- **Access / share / invites**: `useVersionAccess`, `useVersionShare`, `useInvites`,
  `VersionShareDialog`.
- **Feedback**: `useComments`, `useSuggestions`, `SuggestionCard`, `comment-tree`.
- **Bookmarks**: `useBookmarks`, `useBookmarkSignal`, `BookmarksRail`.
- **Playback resilience**: `media-retry` (shared `<audio>` retry helper for the
  authed and public players).
- **Chain currency**: `chainApply.ts` (`applyChainToGraph` / `snapshotChainFromGraph`).

## 3. Audio engine architecture (`features/listen/`)

The engine is a **modular, reorderable `EffectUnit` graph**. It is FROZEN for the UI
redesign — drive it through the handle (§4); don't reach into `audio/**`.

```
features/listen/
  useAudioGraph.ts      thin composer hook: boundary nodes + pitch lane + analysers + the public handle
  StemDeck.tsx          per-stem DJ deck UI (solo/mute/volume); + useStemEngine.ts / stemGains.ts
  audio/
    EffectUnit.ts       EffectUnit<S> contract + makeDryWet() per-unit dry/wet bypass + EffectId union (13)
    state.ts            per-module param types + neutral defaults + DEFAULT_ORDER (single source of truth)
    composer.ts         buildInsertChain: stable chainIn/chainOut + reorder()+duck + fires the worklet boot
    worklets.ts         registerWorklets() (?worker&url) + createWorkletEffect() placeholder-then-swap helper
    effects/            one file per unit (eq, comp, sat, width, djFilter, delay, reverb, pan, tremolo, trim, gate, bitcrusher, limiter)
    dsp/                PURE, unit-tested math (no AudioContext): curves, msMatrix, bpmSync, djMorph, irSynth,
                        tremoloMath, dbScale, gateMath, quantize, limiterMath, mix, chainLinks
    dsp/processors/     AudioWorkletProcessor source (gate/bitcrusher/limiter) + audioworklet.d.ts ambient types
```

### Signal graph

```
<audio> ─► MediaElementSource ─► masterIn ─┬─► masterDry ───────────────────────────────┐ (master-bypass lane)
                                           └─► chainIn ─► [insert chain: 13 reorderable units] ─► chainOut ─► masterProcessed ─┤
                                                                                                                              ▼
                                                                       masterOut ─► analyserMain (FFT) + scopeSplitter ─► analyserL/R ─► destination
  (pitch lane: an AudioBufferSourceNode feeds chainIn instead of MediaElementSource when pitch mode is active)
```

### The `EffectUnit` contract (`audio/EffectUnit.ts`)

Every module implements:
```ts
interface EffectUnit<S> {
  readonly id: EffectId;
  readonly input: AudioNode;   // composer wires the previous unit's output here
  readonly output: AudioNode;  // composer reads processed signal here
  applyParams(state: S): void;
  setBypass(bypassed: boolean): void;
  readMeter?(): EffectMeter;   // comp/gate/limiter only
  materialize?(): void;        // worklet units only (build the AudioWorkletNode + swap it in)
  dispose(): void;
}
```
**Bypass = a per-unit dry/wet crossfade**, not a topology change. `makeDryWet(ctx, wetIn,
wetOut)` wraps a unit's internal `wetIn→wetOut` sub-graph: `setWet(0)` = bit-exact dry
passthrough, `setWet(1)` = full effect, fractional = parallel mix. Disabled units call
`setWet(0)`. This is why **every module is transparent at its defaults** — the whole
chain at rest is bit-equivalent to the raw track.

### Composer + reorder (`audio/composer.ts`)

`buildInsertChain(ctx)` builds all 13 units between stable `chainIn`/`chainOut` gains and
wires them in `DEFAULT_ORDER`. `reorder(order)` permutes + rewires via `chainLinks`, hiding
the reconnection click inside a ~10 ms duck on `chainOut`. The wiring is order-generic — any
unit can move anywhere. It also fires the async worklet boot (below).

### Worklet boot (placeholder-then-swap)

Gate, Bitcrusher, and Limiter are `AudioWorkletProcessor`s, which need
`await ctx.audioWorklet.addModule(url)` before their nodes exist — but `ensureContext()` is
synchronous. Resolution: those three units start as **passthrough placeholders**; the composer
fires `registerWorklets(ctx)` (which loads the processors), and when it resolves, each worklet
unit's `materialize()` builds its real `AudioWorkletNode` and swaps it in (brief duck). On
failure (old browser) they stay passthrough (graceful degradation).
**Vite loading gotcha:** processors are imported with `?worker&url` (`import url from
'./dsp/processors/x.processor.ts?worker&url'`) — a plain `new URL('./x.ts', import.meta.url)`
emits raw, untranspiled TS that `addModule` rejects. The build must emit compiled
`*.processor-*.js` chunks.

### Pitch lane

Pitch is NOT an insert effect — it's a separate `AudioBufferSourceNode` lane (the file is
decoded to an AudioBuffer on first enable, cached). It feeds `chainIn` in place of the
MediaElementSource. **Pitch and tempo are coupled** (Web Audio `detune` scales playbackRate) —
surface this in the UI. Driven via the pitch handle methods, not `setEffectParams`.

## 4. The handle API (`AudioGraphHandle` in `useAudioGraph.ts`)

The UI's entire contact with the engine:
- `ensureContext(): AudioContext` — **call from the play-button click handler** (browser autoplay policy) before `audio.play()`.
- `setEffectParams(id, patch)` — generic, type-safe driver for ALL 13 modules. `patch` is `Partial<EffectParamMap[id]>`.
- `reorder(order: EffectId[])` / `getOrder(): EffectId[]` — runtime reorder (click-free).
- `readEffectMeter(id): EffectMeter | null` — `comp` → `{reductionDb}`, `gate` → `{reductionDb, open}`, `limiter` → `{reductionDb}`; others null.
- `tapDeviceIo(id | null)` / `readDeviceIo(): {inDb, outDb} | null` — roaming analyser taps on ONE unit's input/output (RMS dBFS) for the device bay's IN/OUT meters. Parallel taps, never in the audio path; survive `reorder()` (the composer re-applies them after rewiring).
- `readFrame(): AudioFrame` — `{ fftBins, bandAverages, rmsDb, lufsShort, truePeakDb, correlation, scopeL, scopeR }` for visualizers.
- `setMasterBypass(b)`, `resetAll()`.
- Pitch (CURRENT): `setPitchShift(semitones, cents, playbackRate)` + `setPitchShiftEnabled(on)` — a constant-tempo shifter (`pitch-shift` AudioWorklet, two-tap crossfading delay line) in a dry/wet lane at the END of the master path (`masterOut → lane → destination`, after the analysers). Pitch and tempo are INDEPENDENT: the page sets `audio.playbackRate` for tempo and passes it here, and the lane divides it back out of its ratio.
- Pitch (LEGACY, unused by the rack): `enterPitchMode(audioUrl, fromSeconds)`, `exitPitchMode()`, `setPitchDetune()`, `setPitchRate()`, `pitchPause/Resume/Seek/CurrentTime/Duration/Playing/Subscribe` — the AudioBufferSourceNode.detune lane, which couples pitch to speed. Slated for removal.
- Legacy (back-compat, prefer `setEffectParams`): `setEqBand`, `setEqEnabled`, `setCompressor`, `setSaturation`, `setWidth` — the last three are exact aliases of `setEffectParams`.

## 5. State + param flow

The hook holds one `useRef` of state per unit (e.g. `compStateRef`) plus `eqEnabledRef`. A
`setEffectParams(id, patch)` call `Object.assign`s the patch into that ref and calls the unit's
`applyParams(ref)`. State lives in the hook (module-scoped refs), NOT React state. `EffectParamMap`
(in `useAudioGraph.ts`) types each id's patch shape — keep it in lockstep with `audio/state.ts`.

**EQ** takes a band array: `setEffectParams('eq', { enabled, bands })` where each `EqBand` is
`{ type, freq, gainDb, q, enabled }`. It has a real unit bypass (`enabled:false` → bypassed) and
defaults `enabled:true` with flat bands (transparent). Own the band array in the UI.

## 6. The 13 modules + pitch

Full per-param detail (control kind, range, step, unit, default, enum options, tier):
- **`features/listen-rack/data.ts`** — `RACK_MANIFEST` / `MANIFEST_BY_ID` (typed per-param descriptors) + `MASTERING_IDS` / `CREATIVE_IDS` tiering. (Was `features/listen/rackManifest.ts`; retired into the page feature.)
- **`PRPs/listen-dsp-rack-capabilities.md`** — human-readable manifest + design notes.
- **`audio/state.ts`** — the authoritative ranges (comments) + defaults.

Tiering (primary use = full-song mastering preview): **mastering** (surface prominently) = EQ,
Compressor, Saturator, M/S Width, Limiter, Output Trim. **creative / per-element** (tuck behind a
disclosure) = DJ Filter, Delay, Reverb, Pan, Tremolo, Gate, Bitcrusher.

## 7. Metering

- `readEffectMeter('comp'|'gate'|'limiter')` — live gain-reduction (+ gate open state). Worklet
  meters (gate/limiter) post over a `port` ~30 Hz; the unit caches the latest for synchronous reads.
- `readFrame()` — the visualizer/page-level meters (spectrum, scope, RMS, short-LUFS, true-peak,
  L/R correlation). Poll both in the page's rAF loop.
- **Consumption pattern** (see `features/listen-rack/`): the page runs one rAF loop reading
  `graph.readFrame()` (throttled ~80 ms) → meter rail; `useGainReduction(graph, id, …)` in
  `features/listen-rack/rackState.ts` reads `readEffectMeter` per metered module. For canvas
  visualizers read `readFrame()` imperatively in your own rAF — don't route the reused
  Float32Array buffers through React state. (The old design-agnostic `meterHooks.ts` was retired
  with the legacy page.)

## 8. Behavior preservation (invariant)

At defaults the chain is **bit-equivalent to the raw track** — every unit is a dry passthrough
(`setWet(0)`, or trim at unity). Any new module/param must default to identity. This is the bar
every engine change is held to.

## 9. Performance

Native nodes are cheap (optimized C++ on the audio thread). Cost centers: the **reverb convolver**
(long IR; processes even when bypassed) and the **limiter** (per-sample O(lookahead) peak scan). Three
always-on worklet `process()` loops. Fine on desktop; on low-end mobile, many heavy effects enabled at
once could strain. Possible future "perf hardening": lazy-connect heavy effects only when enabled,
O(1) running-max limiter.

## 10. Gotchas

- **AudioContext on a user gesture** — call `ensureContext()` from the play button's click handler before `audio.play()` (Chrome/Safari autoplay policy).
- **Audio URL carries the access token** (`?t=<jwt>`) — a silent token refresh changes `audioUrl`, which re-mounts `<audio>` and resets `currentTime`; the page tracks position off the audio element / pitch lane accordingly.
- **`<audio>` needs `crossOrigin="anonymous"`** to feed `MediaElementSource`; the BFF sets permissive CORS on the audio response.
- **Pitch couples tempo** — document in the UI; true decoupling is a future phase-vocoder worklet.
- **Worklets** load asynchronously; gate/bitcrusher/limiter only work a few hundred ms after first audio, and only if `addModule` succeeded (watch the console).
- **Reorder** masks a tiny audio dip; a same-order reorder is a no-op (no duck).
- **The handle is memoized** (`useMemo(..., [])`) — methods close over refs, not React state.

## 11. Testing

Web Audio / AudioWorklet do NOT run in jsdom. Only the **pure math** (`audio/dsp/*`, `audio/state`,
`stemGains`) is unit-tested (vitest). AudioNode wiring, the composer, the hook, processors, and the worklet boot are
verified by `npx tsc -b` + `npm run build` + a **manual browser smoke** (`PRPs/listen-smoke-script.md` —
the only real exercise of the runtime; run it before trusting the engine). Gates (from
`components/frontend-spectr-v2`): `npx tsc -b` (the real typecheck — `tsc --noEmit` is a no-op here),
`npm run lint`, `npx vitest run`, `npm run build`.

## 12. Related docs

- `PRPs/listen-dsp-rack-engine-design.md` — master architecture/roadmap (6 phases).
- `PRPs/listen-dsp-rack-engine-phase{1..5}.md` + `-design.md` — per-phase plans/specs.
- `PRPs/listen-dsp-rack-capabilities.md` — UI control-surface manifest + tiering + handle binding.
- `PRPs/listen-smoke-script.md` — browser smoke procedure.
- `features/listen-rack/data.ts` — typed param descriptors (`RACK_MANIFEST`) for the page UI.

## Change log

- **2026-07-23** — Doc refreshed: the folder is the shared engine **+ social hook
  layer** (room stream/actions/session, access/share/invites, comments/suggestions,
  bookmarks, media-retry) consumed by `features/listen-rack/` and the public/invite
  routes. Legacy-page prose removed (the `/listen/$versionId` redirect is gone).
- **2026-06-25** — Listen V3 page port complete; `features/listen-rack/` is the only Listen page
  and the legacy page was retired. This folder is now the **shared engine** (`useAudioGraph`,
  `StemDeck`/`useStemEngine`/`stemGains`, `audio/**`) consumed by the page. Deleted the legacy-only
  UI + helpers, `rackManifest.ts`, and `meterHooks.ts`. Dev console harness on the new page is
  `window.__spectrRackGraph`.
- **2026-06-24** — Living doc created. Engine Phases 1–5 complete (13 modules, reorder, worklets,
  meters). EQ given a real unit bypass (now uniform with the other 12). UI-handoff prep added
  (rackManifest, smoke script, dev `window.__spectrGraph` harness). Remaining engine work: Phase 6
  (meter display). UI rack redesign pending.
