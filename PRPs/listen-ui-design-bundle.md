# Listen-page UI Design — Context Bundle

> **What this is.** A single-file bundle of the essential docs + code for designing
> and building the new Listen-page DSP rack UI, for a design session that can't read
> the repo directly. Each section below is one repo file, delimited by a
> "===== FILE: <path> =====" banner. The contents are verbatim — treat each as the
> real file at that path.
>
> **Also provide (separately — they're images, not in this bundle):** everything in
> `components/frontend-spectr-v2/ui-reference/` — `baseline-listen.png` (the current
> page = the visual-fidelity target), the 7 `reference-viz-*.png` (visualizer-stage
> effects), and the 5 `reference-dj-*.png` (DJ laser rig + fireworks). Those define the
> "listening-room" look the rack must coexist with.
>
> **Caveat.** A session without repo access also can't run the app, the screenshot
> loop, or the four gates (tsc -b / lint / vitest / build). Use this bundle for the
> DESIGN + mockup phase and to emit code; do the actual verified build in a session
> that has the repo checked out (branch listen-ui-overhaul).
>
> **Start here:** read PRPs/listen-ui-design-prompt.md (first section below) — it is
> the authoritative brief and indexes everything else.

---

## Files in this bundle

1. PRPs/listen-ui-design-prompt.md — the brief (incl. settled design direction)
2. features/listen/README.md — living system guide (architecture, signal graph, handle API)
3. PRPs/listen-dsp-rack-capabilities.md — module/param/range/default manifest + tiering
4. features/listen/rackManifest.ts — typed control descriptors to render from
5. features/listen/useAudioGraph.ts — the engine contract (handle interface + EffectParamMap)
6. features/listen/audio/state.ts — param ranges + neutral defaults (source of truth)
7. features/listen/audio/EffectUnit.ts — EffectId union (13) + EffectMeter
8. features/listen/meterHooks.ts — metering hooks (GR / levels)
9. styles/tokens.css — design tokens to match
10. styles/global.css — global utility primitives (.card/.pill/.btn/.label/.mono)
11. routes/_app/listen.$versionId.tsx — the page shell the rack plugs into
12. features/listen/PreviewTools.tsx — the CURRENT rack (idioms to reuse/replace)
13. features/listen/PreviewTools.module.css — current rack styles


================================================================================
===== FILE: PRPs/listen-ui-design-prompt.md =====
================================================================================

# Listen-page UI Design — Handoff Prompt

Give this (and the repo) to "Claude design" to design + build the new Listen-page rack UI.

---

You are designing AND implementing the new UI for the **Listen page** of SPECTR — a music-producer web app where users hear their track through a real-time Web Audio DSP "rack." The audio ENGINE is complete, reviewed, and merged; your job is the UI that drives it. Do NOT modify the engine — bind to its typed handle.

## Design direction (decided with the product owner — 2026-06-24, do NOT re-litigate)

These are settled. Treat them as constraints, not open questions:

- **Keep the current "cool" aesthetic.** Match the existing Listen page's dark, neon/glow, visualizer-rich look and `tokens.css` design language. This is an evolution of the current vibe, NOT a restyle. Do not introduce a new visual identity.
- **Read as a legitimate pro tool.** Within that aesthetic, the rack must feel like a serious, credible mastering/DSP tool a producer would trust (precise controls, real meters, clear signal flow) — not a toy. Legitimacy + the existing cool look together, not one at the expense of the other.
- **Coexist with "listening-room" features.** The Listen page already hosts experiential features (visualizer stage, laser show, DJ stem deck, notes) and MORE listening-room features are planned. The rack redesign must sit alongside these comfortably and not crowd them out — design the IA so the rack and the listening-room elements share the page.
- **No mockup image exists — design the look yourself from the aesthetic.** There is no `ui-reference/mockup.png` target. Propose the visual direction (matching the captured baselines) and the layout/IA, show the user 2–3 mockups, and get approval BEFORE building (see Process). The layout/IA choice (pedalboard chain vs channel strip vs tiered dashboard, etc.) is explicitly YOURS to propose — the product owner deferred it to you.
- **Capture baselines first.** The stack was NOT running when this brief was prepared, so `ui-reference/` has no baselines yet. Bringing the stack up and capturing them (see "Fidelity workflow" step 0) is your first concrete step.

## Read these first (authoritative, in order)

1. **`components/frontend-spectr-v2/src/features/listen/README.md`** — the living **system guide**: architecture, signal-graph diagram, the EffectUnit/bypass model, composer/reorder, worklet boot, pitch lane, the full handle API, state flow, modules, metering, gotchas, testing. Start here.
2. `components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts` — the engine contract: the `AudioGraphHandle` interface + `EffectParamMap`. Everything you build calls this handle.
3. `components/frontend-spectr-v2/src/features/listen/audio/state.ts` — the SOURCE OF TRUTH for every module's params, exact ranges, and neutral defaults. `audio/EffectUnit.ts` has the `EffectId` union (13) + `EffectMeter`.
4. `PRPs/listen-dsp-rack-capabilities.md` — human-readable manifest of every module/param/range/default/format, the handle-binding contract, and module tiering. If it disagrees with `state.ts`, **state.ts wins**.
5. `components/frontend-spectr-v2/src/routes/_app/listen.$versionId.tsx` + `features/listen/PreviewTools.tsx` + the rest of `features/listen/**` — the CURRENT Listen UI you are evolving/replacing. Reuse its transport, spectrum, scope, and pitch wiring.
6. `components/frontend-spectr-v2/src/styles/{tokens.css,global.css}` + a few existing `features/**` components — the design system + visual language to match.
7. The repo `CLAUDE.md` — stack rules + Listen-page gotchas.

## Prep artifacts (ready for you)

- **`features/listen/rackManifest.ts`** — typed, machine-readable per-module/param descriptors (control kind, range, step, unit, default, enum options, tier). Render controls by mapping over `RACK_MANIFEST`; use `MASTERING_IDS` / `CREATIVE_IDS` for the primary-vs-creative tiering.
- **`features/listen/meterHooks.ts`** — design-agnostic metering glue: `useEffectMeter(graph, id)` (live GR + gate-open for comp/gate/limiter) and `useAudioLevels(graph)` (RMS/short-LUFS/true-peak/correlation). rAF-throttled + change-gated. Use these for scalar meter/level readouts; draw the spectrum/scope canvases from `graph.readFrame()` imperatively in your own rAF (don't route the reused Float32Array buffers through React state).
- **`PRPs/listen-smoke-script.md`** — browser-console procedure to confirm the engine works (the handle is exposed in dev as `window.__spectrGraph`). Run it first.
- `PRPs/listen-dsp-rack-capabilities.md` "Engine binding" + "Module tiering" sections — canonical handle usage and the per-effect tiers.

## What exists vs what you build

- DONE (don't touch): `features/listen/useAudioGraph.ts` and everything under `features/listen/audio/**` — a 13-module, reorderable, real-time DSP rack with per-unit dry/wet bypass, async AudioWorklet boot, meters, and a pitch lane.
- YOUR JOB: the rack UI — controls, panels, meters, reorder, and information architecture — wired to the handle.

## The binding contract (drive everything through this)

- `ensureContext()` — MUST be called from the play-button click handler (browser autoplay policy) before `audio.play()`.
- `setEffectParams(id, patch)` — the generic, type-safe param setter. `id` ∈ the 13 `EffectId`s; `patch` is `Partial<EffectParamMap[id]>`. Examples:
  - `setEffectParams('comp', { enabled: true, thresholdDb: -18, ratio: 4, mix: 0.6 })`
  - `setEffectParams('reverb', { enabled: true, ir: 'plate', decaySec: 3, mix: 0.3 })`
  - `setEffectParams('eq', { enabled: true, bands: [...] })` — EQ takes a full `EqBand[]` (each band: `type/freq/gainDb/q/enabled`); `enabled:false` truly bypasses the unit like every other module. Own the band array in the UI.
  - Per-unit ON/OFF is the module's own `enabled` field.
- `reorder(order: EffectId[])` / `getOrder(): EffectId[]` — the rack is runtime-reorderable; reorder is click-free during playback. Build a drag-to-reorder chain that calls `reorder()`.
- `readEffectMeter(id): EffectMeter | null` — `comp` → `{reductionDb}`, `gate` → `{reductionDb, open}`, `limiter` → `{reductionDb}`; others null. (Prefer the `useEffectMeter` hook.)
- `readFrame(): AudioFrame` — spectrum / scope / RMS / short-LUFS / true-peak / correlation for visualizers.
- `setMasterBypass(b)`, `resetAll()`.
- Pitch lane (NOT an insert effect): `enterPitchMode`/`exitPitchMode`/`setPitchDetune`/`pitch*`. Pitch + tempo are coupled — surface it.
- At defaults every module is transparent (dry passthrough). The UI's per-module "enabled" toggle maps to its `enabled` param.

## The 13 modules — and how to tier them (IA matters; 13 is a lot)

Primary use is listening to a FULL mixed song (a mastering/loudness preview), not individual stems. Tier the UI accordingly:

- **Primary "mastering" rack (surface prominently):** EQ (8-band), Compressor (+GR meter), Saturator, M/S Width, **Limiter** (+GR meter — the core "-1 dBTP" loudness preview), Output Trim.
- **Secondary "creative / per-element" FX (tuck behind a disclosure, lower priority):** DJ Filter, Delay (BPM-sync + ping-pong), Reverb, Stereo Pan, Tremolo/Auto-pan, Gate (+GR meter), Bitcrusher. Less useful on a whole mix (reverb/delay/gate on a full kit muddies it) — keep them fully functional; they shine if a per-stem Listen view is added later.

Exact params/ranges/defaults per module: read `state.ts` / `rackManifest.ts`.

## Hard requirements

- Reorderable rack (drag) bound to `reorder()`/`getOrder()`, defaulting to `DEFAULT_ORDER`.
- Per-module: enable/bypass, full param surface (controls per `rackManifest.ts`), dry/wet where the module has a `mix`.
- Live GR meters for comp/gate/limiter (via `useEffectMeter`), plus the existing spectrum / scope / LUFS / true-peak readouts (`readFrame` / `useAudioLevels`).
- Keep + integrate the existing transport and pitch controls.
- Master A/B bypass + Reset.

## Stack constraints (match the v2 frontend exactly)

- React 19 + Vite 6 + TypeScript strict (`verbatimModuleSyntax` — `import type`).
- **CSS Modules + `src/styles/tokens.css` + the global utility classes** (`.card`, `.pill`, `.btn`, `.label`, `.mono`, …). NO Tailwind, NO shadcn/MUI/Chakra, NO styled-components.
- Radix UI primitives, Recharts (charts), WaveSurfer v7 (waveform), Sonner (toasts) — already in the stack.
- Feature-based folders under `src/features/listen/`. No inline styles unless dynamic (color-from-value).
- All four gates must pass (run from `components/frontend-spectr-v2`): `npx tsc -b`, `npm run lint` (--max-warnings 0), `npx vitest run`, `npm run build`. NOTE: the real typecheck is `tsc -b`, NOT `tsc --noEmit` (root tsconfig uses project references — `--noEmit` is a no-op).

## Engine boundary — do NOT edit

`useAudioGraph.ts` and `audio/**` are frozen. If you think you need an engine change, STOP and flag it — don't reach past the handle.

## Performance to design around

Native nodes are cheap, but the **reverb convolver** (long IR) and the **limiter** (lookahead) are the cost centers, and bypassed time-based effects still process. For low-end devices, prefer UX that doesn't leave many heavy effects enabled needlessly (clear per-effect on/off, sensible defaults off). Don't over-engineer this — just be aware.

## Process

1. Start with the superpowers **brainstorming** skill (or frontend-design): explore the current Listen UI, then PROPOSE 2–3 layout/IA approaches for a 13-module reorderable rack (tiered rack vs tabbed vs collapsible panels; where meters/transport/visualizers sit; reorder UX) with mockups. Get the user's approval on the design BEFORE implementing.
2. Then write a plan and implement against the handle, keeping each component focused and the four gates green.
3. At defaults the page must sound identical to today (the engine is behavior-preserving) — verify nothing regresses.

Deliverable: an approved design, then a working, gates-green Listen-page rack UI wired to the engine handle.

## Fidelity workflow — match the design, don't drift (READ THIS)

Handoffs drift when the implementer works from prose and never *sees* the target or its own rendered output. Do NOT one-shot this from text. Work **visually and iteratively**:

**Use the superpowers `frontend-design` skill** for this work — it is built around design + screenshot iteration. Invoke it.

**0. Capture a style baseline.** Before building, run the app and screenshot the CURRENT Listen page + 2–3 existing pages (login, library, a results page) into `components/frontend-spectr-v2/ui-reference/` (see its README). These define the app's visual language — spacing, tokens, card style, type scale — that the new rack must match. Use the Playwright browser tools (`browser_navigate` → `browser_take_screenshot`).

**1. An image is the source of truth, not this doc.** If a mockup image exists, save it as `ui-reference/mockup.png` and match IT pixel-close. Prose specs are a guide; the rendered result is the acceptance.

**2. The screenshot loop (per component — this is the core).** For each rack card / panel:
   1. Implement it in the real design system — CSS Modules + `tokens.css` + the global `.card`/`.pill`/`.btn`/`.label`/`.mono` primitives. NO Tailwind, NO generic markup.
   2. `npm run dev`, then with the Playwright tools `browser_navigate` to a real version's Listen URL.
   3. `browser_take_screenshot` of the component.
   4. Compare to the mockup / baseline aesthetic; list the concrete diffs (spacing, color, radius, type, alignment).
   5. Adjust CSS → re-screenshot → repeat until it matches.
   
   Build ONE card to a pixel-match first, lock the pattern, then apply it to the rest.

**3. Match the design SYSTEM, not vibes.** Exact `tokens.css` values (`--color-*`, radii, spacing), the existing component primitives, the existing type scale. "Make it modern" → drift.

**4. Verify against REAL data.** The Listen page needs a logged-in user + a version with audio. Test the layout with a real version (real module counts, meter values, long titles) — not placeholder content.

**5. Acceptance = a side-by-side screenshot match, per component, AND the four gates green** (`tsc -b` / `lint` / `vitest` / `build`). "Looks roughly like the mockup" is NOT done.

The screenshot loop requires the app running (BFF + worker + frontend + a logged-in user + a version with audio — see root `CLAUDE.md` run commands + `docker compose -f docker/docker-compose.yml up -d`). It is the single biggest fidelity lever — it stops the implementer working blind.


================================================================================
===== FILE: components/frontend-spectr-v2/src/features/listen/README.md =====
================================================================================

# Listen Page — System Guide

> **Living document.** This describes how the Listen page + its real-time audio
> engine work end-to-end, for anyone (incl. Claude design) building on it. Keep it
> updated as the feature changes — when you alter the engine, the handle, or the
> rack, update the relevant section here in the same change.
>
> Last updated: 2026-06-24 (engine Phases 1–5 complete; UI revamp pending). Status:
> the audio **engine is done + frozen**; the **rack UI** is the active redesign.

---

## 1. What it is

The Listen page lets a music producer hear their uploaded track through a real-time
Web Audio **DSP "rack"** — a reorderable chain of 13 effect modules (EQ, compressor,
saturator, M/S width, DJ filter, delay, reverb, pan, tremolo, gate, bitcrusher,
limiter, output trim) plus a separate pitch lane — while watching live visualizers
(spectrum, scope/goniometer, LUFS/true-peak). It's primarily a **mastering / loudness
preview** of a finished stereo mix ("what would my track sound like with X").

## 2. Page composition

Route: `src/routes/_app/listen.$versionId.tsx` (the page shell + data loading + state).
It loads the version's analysis results, owns the `<audio>` element, creates the audio
graph (`const graph = useAudioGraph(audioRef)`), and composes:
- **Header** — cover/title.
- **Visualizer stage** — spectrum / radial / spectrogram / laser (driven by `graph.readFrame()` in a rAF loop).
- **Transport** — play, scrubber (section coloring), volume, timecode, add-note.
- **The rack** — `features/listen/PreviewTools.tsx` today (the module cards). **This is what the UI redesign replaces.**
- **Right rail** — meters, issues, DJ stem deck, notes.
- **Pitch** panel — the separate pitch lane.

## 3. Audio engine architecture (`features/listen/`)

The engine is a **modular, reorderable `EffectUnit` graph**. It is FROZEN for the UI
redesign — drive it through the handle (§4); don't reach into `audio/**`.

```
features/listen/
  useAudioGraph.ts      thin composer hook: boundary nodes + pitch lane + analysers + the public handle
  rackManifest.ts       UI-handoff: typed per-module/param descriptors (control/range/unit/default/tier)
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
- `readFrame(): AudioFrame` — `{ fftBins, bandAverages, rmsDb, lufsShort, truePeakDb, correlation, scopeL, scopeR }` for visualizers.
- `setMasterBypass(b)`, `resetAll()`.
- Pitch: `enterPitchMode(audioUrl, fromSeconds)`, `exitPitchMode()`, `setPitchDetune(semitones, cents)`, `pitchPause/Resume/Seek/CurrentTime/Duration/Playing/Subscribe`.
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
- **`rackManifest.ts`** — machine-readable; map over `RACK_MANIFEST` to render controls. `MASTERING_IDS` / `CREATIVE_IDS` give the tiering.
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
- **Ready-made polling hooks** (`meterHooks.ts`, design-agnostic): `useEffectMeter(graph, id)` →
  live `EffectMeter` for comp/gate/limiter; `useAudioLevels(graph)` →
  `{ rmsDb, lufsShort, truePeakDb, correlation }`. Both rAF-throttled + change-gated (re-render only
  on change). For canvas visualizers (spectrum/scope) read `readFrame()` imperatively in your own
  rAF instead — don't route the reused Float32Array buffers through React state.

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

Web Audio / AudioWorklet do NOT run in jsdom. Only `audio/dsp/*` **pure math** is unit-tested
(vitest, 400+ tests). AudioNode wiring, the composer, the hook, processors, and the worklet boot are
verified by `npx tsc -b` + `npm run build` + a **manual browser smoke** (`PRPs/listen-smoke-script.md` —
the only real exercise of the runtime; run it before trusting the engine). Gates (from
`components/frontend-spectr-v2`): `npx tsc -b` (the real typecheck — `tsc --noEmit` is a no-op here),
`npm run lint`, `npx vitest run`, `npm run build`.

## 12. Related docs

- `PRPs/listen-dsp-rack-engine-design.md` — master architecture/roadmap (6 phases).
- `PRPs/listen-dsp-rack-engine-phase{1..5}.md` + `-design.md` — per-phase plans/specs.
- `PRPs/listen-dsp-rack-capabilities.md` — UI control-surface manifest + tiering + handle binding.
- `PRPs/listen-smoke-script.md` — browser smoke procedure.
- `rackManifest.ts` — typed param descriptors for the UI.

## Change log

- **2026-06-24** — Living doc created. Engine Phases 1–5 complete (13 modules, reorder, worklets,
  meters). EQ given a real unit bypass (now uniform with the other 12). UI-handoff prep added
  (rackManifest, smoke script, dev `window.__spectrGraph` harness). Remaining engine work: Phase 6
  (meter display). UI rack redesign pending.


================================================================================
===== FILE: PRPs/listen-dsp-rack-capabilities.md =====
================================================================================

# Listen Page — DSP Rack Capability Manifest (UI Design Handoff)

Date: 2026-06-23
Audience: UI designer (human or Claude design) laying out the revamped Listen-page effects rack.
Companion engineering docs: `PRPs/listen-dsp-rack-engine-design.md` (architecture), `PRPs/listen-dsp-rack-engine.md` (build plan).

## What this document is

It enumerates the **complete target control surface** of the Listen page's effects rack after the revamp: every module, every adjustable parameter, its range, default, value formatting, and the interaction model around it. Design the UI to accommodate this whole surface.

> **STATUS (2026-06-24): the ENGINE IS COMPLETE.** All five build phases (1–5) are merged. **Every "Planned-Pn" tag below is now LIVE** — all 13 insert modules, every param, reorder, the worklets (gate/bitcrusher/limiter), and the comp/gate/limiter meter *data* are shipped and gate-green (`tsc -b`/lint/`vitest`/build). The only remaining engine work is Phase 6 (wiring meter *display*), which does NOT block UI design. Treat the whole control surface below as buildable today. The one thing not yet done is a manual browser smoke (`PRPs/listen-smoke-script.md`).

Each module/param was tagged with **Availability** during the build-out (**Live** = shipped, **Planned-Pn** = was pending at authoring time). Per the status above, **all are now Live.**

## Engine binding (the contract the UI wires to)

The engine is done and frozen; the UI drives it through the typed `AudioGraphHandle` in `features/listen/useAudioGraph.ts`. Two companion artifacts:
- **`features/listen/rackManifest.ts`** — machine-readable per-module/param descriptors (control kind, range, step, unit, default, enum options, tier). Map over it to render controls instead of reverse-engineering `state.ts`.
- **`PRPs/listen-smoke-script.md`** — a browser-console procedure to verify the engine actually works before/while building the UI.

Canonical handle usage:
- `graph.setEffectParams(id, patch)` — the generic, type-safe driver for ALL 13 modules (`patch` = `Partial<EffectParamMap[id]>`). `setCompressor/setSaturation/setWidth` are exact aliases — prefer `setEffectParams`.
- `graph.reorder(order)` / `graph.getOrder()` — runtime reorder (click-free; defaults to `DEFAULT_ORDER`).
- `graph.readEffectMeter(id)` — live meter: `comp` → `{reductionDb}`, `gate` → `{reductionDb, open}`, `limiter` → `{reductionDb}`; all others `null`.
- `graph.readFrame()` — spectrum / scope / short-LUFS / true-peak / correlation for the visualizers.
- `graph.setMasterBypass(b)`, `graph.resetAll()`, `graph.ensureContext()` (call from the play-button gesture — browser autoplay policy).
- Pitch lane: `enterPitchMode/exitPitchMode/setPitchDetune/pitch*` — pitch is NOT an insert effect (not in `EffectId`, not reorderable).

**EQ takes a band array** (its one shape difference from the others). `EffectParamMap['eq']` is `{ bands: EqBand[]; enabled: boolean }`. Drive it uniformly: `setEffectParams('eq', { enabled, bands })` where each `EqBand` is `{ type, freq, gainDb, q, enabled }`. `enabled:false` truly bypasses the unit, exactly like every other module (this was fixed — EQ used to be always-on). It defaults `enabled:true` with flat bands (transparent), so the UI owns its band state and re-applies on changes. The legacy `setEqBand(i, gainDb)` / `setEqEnabled(bool)` helpers remain for back-compat but are redundant — prefer `setEffectParams`.

## Module tiering (primary use = a full mixed song)

The Listen page is mainly a **mastering / loudness preview** of a finished stereo mix, not a per-stem tool. Tier the UI accordingly — the engine keeps all modules; this is purely UI prominence:
- **Primary "mastering" rack (surface prominently):** EQ, Compressor, Saturator, M/S Width, **Limiter** (the core "-1 dBTP" loudness preview), Output Trim.
- **Secondary "creative / per-element" FX (tuck behind a disclosure):** DJ Filter, Delay, Reverb, Stereo Pan, Tremolo/Auto-pan, Gate, Bitcrusher. Less useful on a whole mix (reverb/delay/gate over a full kit muddies it) — keep them fully functional; they shine if a per-stem Listen view is ever added.

`rackManifest.ts` carries a `tier` per module (`MASTERING_IDS` / `CREATIVE_IDS`) so the layout can read it directly.

## Page context (fixed — not part of this revamp)

The rack lives on the Listen page below the player/visualizer. Surrounding elements already exist and are NOT changing: the cover/title header, the visualizer stage (spectrum/radial/spectrogram/laser), the transport (play, scrubber with section coloring, volume, timecode, add-note), and the right rail tabs (Meters, Issues, DJ stem deck, Notes). The rack is one card in the center column. Today it is an "Insert rack" with 8 module cards; the revamp expands it to ~14 effect modules plus rack-level reorder and metering.

---

## Interaction model (applies rack-wide)

These behaviors are uniform across modules — design them once, reuse everywhere.

| Concern | Behavior | Availability |
|---|---|---|
| **Per-module enable/bypass** | Every effect has an On/Off toggle. Off = true bypass (signal passes untouched). | Live |
| **Per-module focus/expand** | A module card shows a compact summary (1-3 key knobs). Selecting it reveals its full parameter set. Today only Pitch has an expanded panel; the revamp needs an expanded view for every module given the param counts below. | Live (pattern exists) |
| **Mix (dry/wet)** | Modules marked "has Mix" expose a 0-100% wet control (parallel blend). Others are full-wet when on. | mixed (see per-module) |
| **Reorder** | The insert chain is user-reorderable by drag. Any module can move to any position; nothing is locked. Reordering is live (brief ~10 ms audio dip masks it). Show the current signal order. | Planned-P2 |
| **Master bypass** | One rack-level toggle bypasses the entire chain (A/B the processed vs dry signal). | Live |
| **Reset** | Rack-level reset returns every module to defaults (transparent chain). | Live |
| **Active count** | Rack header shows how many modules are on + bypass state. | Live |
| **Metering** | Some modules emit live readouts (gain reduction, gate open/closed). Design meter affordances into those cards. See Metering section. | Planned-P6 (comp meter data Live) |
| **Worklet loading** | Gate, Bitcrusher, Limiter run on an AudioWorklet that registers asynchronously. Until ready (a few hundred ms after first audio), they should show a brief "loading/initializing" state, then become active. | Planned-P5 |

### Control-type + formatting conventions

Suggested widget per parameter kind (designer owns final aesthetics; these convey semantics):

- **Knob** — continuous bounded value (gain, frequency, time). Many are already rendered as rotary knobs with a value readout.
- **Bipolar knob** — value centered at 0 with a detent (pan, tilt, asymmetry, DJ-filter morph). Center = neutral.
- **Slider** — fine 1-D value where a knob is awkward (cents, mix).
- **Toggle** — boolean (enable, sync, ping-pong, mono).
- **Select / segmented** — enumerated choice (filter type, sat curve, reverb IR, LFO shape, oversample, delay division).
- **Meter** — read-only live display (GR, correlation, gate state).

Value formatting examples (keep consistent): `-3.0 dB`, `+6.0 dB`, `2.5:1`, `12 ms`, `250 ms`, `1.4 kHz` / `60 Hz`, `45 %`, `+3 st`, `-20 ¢`, `1/8`, `1.25×`, `-1.0 dBTP`.

---

## Signal chain (default order)

```
in → DJ Filter → EQ → Gate → Compressor → Saturator → Bitcrusher →
     Width → Pan → Tremolo → Delay → Reverb → Limiter → Output Trim → out
```

This is the **default** only — the user can reorder any module (P2). Pitch is NOT in this chain (see its note). The UI should render the chain order somewhere (the rack already shows a "Signal: …" readout) and let the user drag to reorder once P2 lands.

---

## Modules

Ranges are the engine's accepted range. Default = the neutral/transparent value. "Has Mix" = exposes a dry/wet blend.

### 1. EQ — 8-band parametric  ·  has Mix: no
Purpose: shape tone across 8 bands. Today the UI collapses to 3 macro knobs (Low/Mid/Hi); the revamp exposes all 8 bands + per-band controls, ideally with an interactive draggable curve.

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Per-band type (×8) | Select | peaking / low-shelf / high-shelf / low-pass / high-pass / band-pass / notch / all-pass | peaking | — | Planned-P3 |
| Per-band frequency (×8) | Knob (log) | 20 – 20000 Hz | 60/170/350/700/1400/3500/7000/14000 | `1.4 kHz` | Planned-P3 |
| Per-band gain (×8) | Knob | −24 – +24 dB | 0 | `+3.0 dB` | Live (as 3 macros) / per-band Planned-P3 |
| Per-band Q (×8) | Knob | 0.1 – 18 | 1.4 | `1.4` | Planned-P3 |
| Per-band enable (×8) | Toggle | — | on | — | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |

Design note: an interactive frequency-response curve (drag nodes to set freq/gain, scroll for Q) is the ideal primary control; the per-band table is the fallback/detailed view. A live spectrum behind the curve is a plus (spectrum data already exists).

### 2. Compressor  ·  has Mix: yes
Purpose: dynamic range control. Today exposes Threshold/Ratio/Attack; revamp adds the rest + a gain-reduction meter.

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Threshold | Knob | −60 – 0 dB | 0 | `-18 dB` | Live |
| Ratio | Knob | 1 – 20 | 1 | `4:1` | Live |
| Attack | Knob | 0 – 250 ms | 3 | `3 ms` | Live |
| Release | Knob | 0 – 1000 ms | 250 | `250 ms` | Planned-P3 (wired, hidden) |
| Knee | Knob | 0 – 40 dB | 30 | `30 dB` | Planned-P3 (wired, hidden) |
| Makeup | Knob | −12 – +24 dB | 0 | `+6.0 dB` | Planned-P3 (wired, hidden) |
| Mix | Slider | 0 – 100 % | 100 % | `100 %` | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |
| **Gain-reduction meter** | Meter | live dB (read-only) | — | `-4.2 dB GR` | Planned-P6 (data Live) |

Design note: a transfer curve (input→output with threshold/ratio/knee) + a moving GR meter are the signature compressor visuals.

### 3. Saturator  ·  has Mix: yes
Purpose: harmonic saturation / drive. Today exposes Drive/Mix; revamp adds curve selection, tone, asymmetry, oversample, trim.

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Drive | Knob | 0 – 100 % | 0 | `45 %` | Live |
| Mix | Knob/Slider | 0 – 100 % | 0 | `50 %` | Live |
| Curve / algorithm | Select | tanh / soft-clip / hard-clip / arctan / sine-fold / tube | tanh | — | Planned-P3 |
| Oversample | Segmented | none / 2× / 4× | 2× | `2×` | Planned-P3 |
| Asymmetry | Bipolar knob | −1 – +1 | 0 | `+0.3` | Planned-P3 |
| Tone (tilt) | Bipolar knob | −1 – +1 | 0 | `+0.2` | Planned-P3 |
| Output trim | Knob | −24 – +12 dB | 0 | `-3.0 dB` | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |

Design note: a waveshaper transfer-curve preview that updates with Drive/Curve/Asymmetry is the signature visual.

### 4. M/S Width  ·  has Mix: no
Purpose: stereo width via mid/side. Today one Width knob; revamp adds independent M/S gains + a bass-mono maker.

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Width | Knob (center=1) | 0 – 2 | 1 | `1.25×` (Mono ← → Wide) | Live |
| Mid gain | Knob | −12 – +12 dB | 0 | `+1.0 dB` | Planned-P3 |
| Side gain | Knob | −12 – +12 dB | 0 | `-2.0 dB` | Planned-P3 |
| Mono-maker | Knob | 0 – 400 Hz (0 = off) | 0 | `120 Hz` / `Off` | Planned-P3 |
| Mono | Toggle | — | off | — | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |

Design note: a correlation/width meter (goniometer) pairs naturally; the page already computes L/R correlation.

### 5. Pitch  ·  special (NOT in the insert chain, NOT reorderable)
Purpose: pitch shift. Has its own expanded panel today (large knob + interval buttons + cents slider).

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Semitones | Knob / buttons | −12 – +12 | 0 | `+5 st` (`Perfect 4th`) | Live |
| Cents | Slider | −50 – +50 | 0 | `-20 ¢` | Live |
| Tempo | Knob | 0.5 – 2.0× | 1.0 | `1.25×` | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |

Caveat the UI must convey: pitch and tempo are **coupled** (Web Audio detune scales playback rate). Moving semitones changes tempo; moving tempo changes pitch. Independent/formant-preserving pitch is a future worklet (not planned in these phases). The existing panel already states this — keep that messaging.

### 6. DJ Filter  ·  has Mix: no  ·  Availability: Planned-P4
Purpose: single-knob sweepable filter (DJ-style).

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Morph | Bipolar knob (center=bypass) | −1 (LP sweep) – +1 (HP sweep) | 0 | `LP 40 %` / `Off` / `HP 60 %` |
| Resonance | Knob | 0.1 – 20 | 0.7 | `0.7` |
| Module enable | Toggle | — | off | — |

### 7. Delay / Echo  ·  has Mix: yes  ·  Availability: Planned-P4
Purpose: echo with BPM sync + feedback filtering + ping-pong.

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Sync (to BPM) | Toggle | — | on | — |
| Division | Select | 1/4, 1/8, 1/8., 1/8T, 1/16 | 1/8 | `1/8` |
| Time (when unsynced) | Knob | 1 – 2000 ms | 250 | `250 ms` |
| Feedback | Knob | 0 – 95 % | 35 % | `35 %` |
| Tone (loop low-pass) | Knob | 200 – 18000 Hz | 8000 | `8.0 kHz` |
| Ping-pong | Toggle | — | off | — |
| Mix | Slider | 0 – 100 % | 0 | `30 %` |
| Module enable | Toggle | — | off | — |

Note: track BPM is known (from analysis), so synced divisions are real musical values.

### 8. Reverb  ·  has Mix: yes  ·  Availability: Planned-P4
Purpose: convolution reverb (synthesized impulse responses — no audio assets).

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Space / IR | Select | room / hall / plate / spring / ambience | hall | — |
| Decay | Knob | 0.2 – 8 s | 2.0 | `2.0 s` |
| Pre-delay | Knob | 0 – 200 ms | 20 | `20 ms` |
| Damping | Knob | 1000 – 18000 Hz | 8000 | `8.0 kHz` |
| Mix | Slider | 0 – 100 % | 0 | `25 %` |
| Module enable | Toggle | — | off | — |

### 9. Stereo Pan  ·  has Mix: no  ·  Availability: Planned-P4
| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Pan | Bipolar knob (center=0) | −1 (L) – +1 (R) | 0 | `L 20` / `C` / `R 35` |
| Module enable | Toggle | — | off | — |

### 10. Tremolo / Auto-pan  ·  has Mix: no  ·  Availability: Planned-P4
Purpose: LFO amplitude (tremolo) or pan (auto-pan) modulation.

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Mode | Segmented | tremolo / auto-pan | tremolo | — |
| Sync (to BPM) | Toggle | — | on | — |
| Division | Select | 1/4 … 1/16 | 1/8 | `1/8` |
| Rate (when unsynced) | Knob | 0.1 – 20 Hz | 5 | `5.0 Hz` |
| Depth | Knob | 0 – 100 % | 50 % | `50 %` |
| Shape | Select | sine / triangle / square | sine | — |
| Module enable | Toggle | — | off | — |

### 11. Gate  ·  has Mix: no  ·  Availability: Planned-P5 (worklet)
Purpose: noise gate / downward expansion.

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Threshold | Knob | −80 – 0 dB | −40 | `-40 dB` |
| Attack | Knob | 0 – 50 ms | 1 | `1 ms` |
| Hold | Knob | 0 – 500 ms | 10 | `10 ms` |
| Release | Knob | 0 – 1000 ms | 100 | `100 ms` |
| Floor (closed attenuation) | Knob | −80 – 0 dB | −80 | `-80 dB` |
| Module enable | Toggle | — | off | — |
| **Open/closed + GR meter** | Meter | live | — | `Open` / `-30 dB` |

Has a loading state (worklet init).

### 12. Bitcrusher  ·  has Mix: yes  ·  Availability: Planned-P5 (worklet)
| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Bit depth | Knob/stepped | 1 – 16 bits | 16 | `8 bits` |
| Downsample | Knob | 1 – 50× | 1 | `8×` |
| Mix | Slider | 0 – 100 % | 0 | `40 %` |
| Module enable | Toggle | — | off | — |

Has a loading state (worklet init).

### 13. Limiter  ·  has Mix: no  ·  Availability: Planned-P5 (worklet)
Purpose: true brickwall lookahead limiter (replaces today's stubbed "Limiter — Soon" card).

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Ceiling | Knob | −12 – 0 dBTP | −1.0 | `-1.0 dBTP` |
| Release | Knob | 1 – 500 ms | 50 | `50 ms` |
| Lookahead | Knob | 0 – 10 ms | 5 | `5 ms` |
| Module enable | Toggle | — | off | — |
| **Gain-reduction meter** | Meter | live dB | — | `-2.1 dB GR` |

Has a loading state (worklet init).

### 14. Output Trim  ·  Availability: Planned-P4
Purpose: chain-level make-up/trim (separate from the page's player volume).

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Gain | Knob | −24 – +12 dB | 0 | `+2.0 dB` |
| (always on; defaults to last in chain, reorderable) | — | — | — | — |

---

## Rack-level controls (header / chrome)

| Control | Behavior | Availability |
|---|---|---|
| Master bypass | A/B entire processed chain vs dry. | Live |
| Reset | All modules → defaults. | Live |
| Active count | "N on · bypass off". | Live |
| Signal order readout | Shows current chain order. | Live (static) / reflects reorder Planned-P2 |
| Reorder handles | Drag modules to reorder the chain. | Planned-P2 |
| Presets (optional, not yet planned) | Save/recall rack states. Flag as a possible future need so the layout can host it. | Future |

## Metering outputs the UI can display

These live values are produced by the engine for display (read-only):

- **Compressor gain reduction** (dB) — data available now; display Planned-P6.
- **Gate** open/closed + reduction (dB) — Planned-P5/P6.
- **Limiter gain reduction** (dB) — Planned-P5/P6.
- Existing page meters (already live, for context): spectrum, L/R correlation (goniometer), short-term LUFS, true-peak, RMS — these live in the visualizer/right-rail, not the rack, but width/comp/limiter cards may want to echo correlation/peak.

---

## Counts for layout planning

- **~14 effect modules** in the insert rack (5 expanded existing + 8 new + Output Trim), plus the non-effect rack tools that exist today (Loop section A/B, Scope/goniometer) which the current rack also hosts.
- Param counts per expanded module range from **1** (Pan) to **~5 per band ×8 = up to 40 conceptual** (EQ — best served by an interactive curve, not 40 knobs).
- Every module needs: a **compact card** (summary + 1-3 key knobs + on/off) and an **expanded view** (all params). Plan for both states.
- The rack must host **drag-reorder** and **per-module metering** without the layout breaking.

## Hard caveats to surface in the UI

1. **Pitch couples tempo** (and vice-versa) — label it; true independent pitch/tempo is not in scope.
2. **Reorder is live** but masks a tiny audio dip; modules are all series inserts (Reverb/Delay are insert-style with their own Mix, not aux sends).
3. **Gate / Bitcrusher / Limiter** have a short post-load init state before they're usable.
4. Today's **"Limiter — Soon"** stub becomes a real module (P5); design it as active, not disabled.


================================================================================
===== FILE: components/frontend-spectr-v2/src/features/listen/rackManifest.ts =====
================================================================================

// rackManifest.ts — UI-DESIGN HANDOFF ARTIFACT (prep, not wired into the engine).
//
// A machine-readable description of every Listen-page rack module + parameter:
// label, control kind, range, step, unit, default, enum options, tier, metering.
// The UI maps over this to render controls instead of reverse-engineering state.ts.
//
// SOURCE OF TRUTH: ranges come from `audio/state.ts` (the comments there), defaults
// are imported from the `*_DEFAULT` consts (so they can never drift). If you change
// a default in state.ts, this file follows automatically; if you change a RANGE in
// state.ts, update the matching min/max here.
//
// HOW TO DRIVE EACH MODULE (the engine contract — see useAudioGraph.ts):
//   graph.setEffectParams(id, patch)   // generic, type-safe, for ALL 13 ids
//   graph.reorder(order) / graph.getOrder()
//   graph.readEffectMeter(id)          // comp | gate | limiter return live data
//   graph.setMasterBypass(b) / graph.resetAll()
// EXCEPTIONS:
//   - 'eq' takes a full band array: setEffectParams('eq', { enabled, bands }) where
//     bands is EqBand[] (each band: type/freq/gainDb/q/enabled). It has a real unit
//     bypass like the other modules (enabled:false → bypassed). It defaults enabled
//     with flat bands (transparent). Own the band array in the UI; see EQ_BAND_PARAMS.
//   - 'pitch' is NOT an insert effect (not in EffectId / not reorderable). Drive it
//     via the pitch handle methods (enterPitchMode/setPitchDetune/...). It is listed
//     here only so the UI can lay out a pitch panel.
//   - setCompressor/setSaturation/setWidth are exact aliases of setEffectParams —
//     prefer setEffectParams everywhere.

import type { EffectId } from './audio/EffectUnit';
import {
  COMPRESSOR_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
  DJFILTER_DEFAULT,
  DELAY_DEFAULT,
  REVERB_DEFAULT,
  PAN_DEFAULT,
  TREMOLO_DEFAULT,
  TRIM_DEFAULT,
  GATE_DEFAULT,
  BITCRUSHER_DEFAULT,
  LIMITER_DEFAULT,
} from './audio/state';

export type ControlKind =
  | 'knob' // continuous bounded
  | 'knobBipolar' // centered at 0 with a detent
  | 'slider'
  | 'toggle'
  | 'select'
  | 'segmented'
  | 'meter';

export type ParamUnit =
  | 'dB'
  | 'dBTP'
  | 'Hz'
  | 'ms'
  | 's'
  | 'percent' // a 0..1 value the UI shows as 0..100 %
  | 'ratio'
  | 'x'
  | 'st'
  | 'cents'
  | 'division'
  | 'bits'
  | 'none';

// mastering = useful on a full mixed song (primary rack); creative = per-element
// effect, less useful on a whole mix (tuck behind a disclosure); transport = pitch.
export type RackTier = 'mastering' | 'creative' | 'transport';

export interface ParamDescriptor {
  /** state field name = the key you put in the setEffectParams patch */
  key: string;
  label: string;
  control: ControlKind;
  min?: number;
  max?: number;
  step?: number;
  unit?: ParamUnit;
  /** enum options for select/segmented (values match the state union exactly) */
  options?: readonly string[];
  default: number | string | boolean;
  hint?: string;
}

export interface ModuleDescriptor {
  id: EffectId | 'pitch';
  label: string;
  tier: RackTier;
  /** exposes a dry/wet `mix` blend */
  hasMix: boolean;
  /** emits live data via graph.readEffectMeter(id) */
  hasMeter: boolean;
  /** runs on an AudioWorklet — has a brief post-load init before usable */
  worklet?: boolean;
  summary: string;
  params: readonly ParamDescriptor[];
}

const DIVISIONS = ['1/4', '1/8', '1/8.', '1/8T', '1/16'] as const;

// One EqBand descriptor set, applied per band ×8. Drive via
// setEffectParams('eq', { bands: EqBand[] }). Default freqs: 60/170/350/700/1400/3500/7000/14000.
export const EQ_BAND_PARAMS: readonly ParamDescriptor[] = [
  {
    key: 'type',
    label: 'Type',
    control: 'select',
    options: ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch', 'allpass'],
    default: 'peaking',
  },
  { key: 'freq', label: 'Frequency', control: 'knob', min: 20, max: 20000, unit: 'Hz', default: 1000, hint: 'log scale; per-band default differs' },
  { key: 'gainDb', label: 'Gain', control: 'knob', min: -24, max: 24, step: 0.1, unit: 'dB', default: 0 },
  { key: 'q', label: 'Q', control: 'knob', min: 0.1, max: 18, step: 0.1, unit: 'none', default: 1.4 },
  { key: 'enabled', label: 'Band on', control: 'toggle', default: true },
];

export const RACK_MANIFEST: readonly ModuleDescriptor[] = [
  {
    id: 'djfilter',
    label: 'DJ Filter',
    tier: 'creative',
    hasMix: false,
    hasMeter: false,
    summary: 'Single bipolar sweep knob: left = lowpass down, right = highpass up, center = open.',
    params: [
      { key: 'morph', label: 'Morph', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: DJFILTER_DEFAULT.morph, hint: 'center = bypass/open' },
      { key: 'resonance', label: 'Resonance', control: 'knob', min: 0.1, max: 20, step: 0.1, unit: 'none', default: DJFILTER_DEFAULT.resonance },
      { key: 'enabled', label: 'On', control: 'toggle', default: DJFILTER_DEFAULT.enabled },
    ],
  },
  {
    id: 'eq',
    label: 'EQ (8-band)',
    tier: 'mastering',
    hasMix: false,
    hasMeter: false,
    summary: '8 fully-parametric bands. Drive via setEffectParams("eq",{enabled,bands}); each band is type/freq/gainDb/q/enabled. Has a unit bypass (defaults enabled, transparent via flat bands). See EQ_BAND_PARAMS.',
    params: EQ_BAND_PARAMS, // applied per band ×8
  },
  {
    id: 'gate',
    label: 'Gate',
    tier: 'creative',
    hasMix: false,
    hasMeter: true,
    worklet: true,
    summary: 'Noise gate / downward expander. Meter: { reductionDb, open }.',
    params: [
      { key: 'thresholdDb', label: 'Threshold', control: 'knob', min: -80, max: 0, step: 1, unit: 'dB', default: GATE_DEFAULT.thresholdDb },
      { key: 'attackMs', label: 'Attack', control: 'knob', min: 0, max: 50, step: 0.1, unit: 'ms', default: GATE_DEFAULT.attackMs },
      { key: 'holdMs', label: 'Hold', control: 'knob', min: 0, max: 500, step: 1, unit: 'ms', default: GATE_DEFAULT.holdMs },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 0, max: 1000, step: 1, unit: 'ms', default: GATE_DEFAULT.releaseMs },
      { key: 'floorDb', label: 'Floor', control: 'knob', min: -80, max: 0, step: 1, unit: 'dB', default: GATE_DEFAULT.floorDb, hint: 'closed-state attenuation' },
      { key: 'enabled', label: 'On', control: 'toggle', default: GATE_DEFAULT.enabled },
    ],
  },
  {
    id: 'comp',
    label: 'Compressor',
    tier: 'mastering',
    hasMix: true,
    hasMeter: true,
    summary: 'Dynamics + parallel (NY) mix + makeup. Meter: { reductionDb }.',
    params: [
      { key: 'thresholdDb', label: 'Threshold', control: 'knob', min: -60, max: 0, step: 0.5, unit: 'dB', default: COMPRESSOR_DEFAULT.thresholdDb },
      { key: 'ratio', label: 'Ratio', control: 'knob', min: 1, max: 20, step: 0.1, unit: 'ratio', default: COMPRESSOR_DEFAULT.ratio },
      { key: 'attackMs', label: 'Attack', control: 'knob', min: 0, max: 250, step: 1, unit: 'ms', default: COMPRESSOR_DEFAULT.attackMs },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 0, max: 1000, step: 1, unit: 'ms', default: COMPRESSOR_DEFAULT.releaseMs },
      { key: 'kneeDb', label: 'Knee', control: 'knob', min: 0, max: 40, step: 1, unit: 'dB', default: COMPRESSOR_DEFAULT.kneeDb },
      { key: 'makeupDb', label: 'Makeup', control: 'knob', min: -12, max: 24, step: 0.5, unit: 'dB', default: COMPRESSOR_DEFAULT.makeupDb },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: COMPRESSOR_DEFAULT.mix },
      { key: 'enabled', label: 'On', control: 'toggle', default: COMPRESSOR_DEFAULT.enabled },
    ],
  },
  {
    id: 'sat',
    label: 'Saturator',
    tier: 'mastering',
    hasMix: true,
    hasMeter: false,
    summary: 'Harmonic drive: 6 curves, oversample, asymmetry, tone tilt, output trim.',
    params: [
      { key: 'drive', label: 'Drive', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: SATURATION_DEFAULT.drive },
      { key: 'mix', label: 'Mix', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: SATURATION_DEFAULT.mix },
      { key: 'curve', label: 'Curve', control: 'select', options: ['tanh', 'softclip', 'hardclip', 'arctan', 'sinefold', 'tube'], default: SATURATION_DEFAULT.curve },
      { key: 'oversample', label: 'Oversample', control: 'segmented', options: ['none', '2x', '4x'], default: SATURATION_DEFAULT.oversample },
      { key: 'asymmetry', label: 'Asymmetry', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: SATURATION_DEFAULT.asymmetry },
      { key: 'tone', label: 'Tone', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: SATURATION_DEFAULT.tone, hint: 'tilt' },
      { key: 'outputTrimDb', label: 'Out trim', control: 'knob', min: -24, max: 12, step: 0.5, unit: 'dB', default: SATURATION_DEFAULT.outputTrimDb },
      { key: 'enabled', label: 'On', control: 'toggle', default: SATURATION_DEFAULT.enabled },
    ],
  },
  {
    id: 'bitcrusher',
    label: 'Bitcrusher',
    tier: 'creative',
    hasMix: true,
    hasMeter: false,
    worklet: true,
    summary: 'Bit-depth quantization + sample-rate decimation. mix is the dry/wet.',
    params: [
      { key: 'bitDepth', label: 'Bit depth', control: 'knob', min: 1, max: 16, step: 1, unit: 'bits', default: BITCRUSHER_DEFAULT.bitDepth },
      { key: 'downsample', label: 'Downsample', control: 'knob', min: 1, max: 50, step: 1, unit: 'x', default: BITCRUSHER_DEFAULT.downsample },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: BITCRUSHER_DEFAULT.mix },
      { key: 'enabled', label: 'On', control: 'toggle', default: BITCRUSHER_DEFAULT.enabled },
    ],
  },
  {
    id: 'ms',
    label: 'M/S Width',
    tier: 'mastering',
    hasMix: false,
    hasMeter: false,
    summary: 'Mid/side width + independent M/S gains + bass mono-maker. Pairs with a goniometer.',
    params: [
      { key: 'width', label: 'Width', control: 'knob', min: 0, max: 2, step: 0.01, unit: 'x', default: WIDTH_DEFAULT.width, hint: '1 = identity, 0 = mono, 2 = wide' },
      { key: 'midGainDb', label: 'Mid gain', control: 'knob', min: -12, max: 12, step: 0.5, unit: 'dB', default: WIDTH_DEFAULT.midGainDb },
      { key: 'sideGainDb', label: 'Side gain', control: 'knob', min: -12, max: 12, step: 0.5, unit: 'dB', default: WIDTH_DEFAULT.sideGainDb },
      { key: 'monoMakerHz', label: 'Mono-maker', control: 'knob', min: 0, max: 400, step: 5, unit: 'Hz', default: WIDTH_DEFAULT.monoMakerHz, hint: '0 = off' },
      { key: 'mono', label: 'Mono', control: 'toggle', default: WIDTH_DEFAULT.mono },
      { key: 'enabled', label: 'On', control: 'toggle', default: WIDTH_DEFAULT.enabled },
    ],
  },
  {
    id: 'pan',
    label: 'Stereo Pan',
    tier: 'creative',
    hasMix: false,
    hasMeter: false,
    summary: 'Stereo balance. Rarely useful on a finished stereo mix; more for stems.',
    params: [
      { key: 'pan', label: 'Pan', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: PAN_DEFAULT.pan, hint: 'L ← center → R' },
      { key: 'enabled', label: 'On', control: 'toggle', default: PAN_DEFAULT.enabled },
    ],
  },
  {
    id: 'tremolo',
    label: 'Tremolo / Auto-pan',
    tier: 'creative',
    hasMix: false,
    hasMeter: false,
    summary: 'LFO modulates amplitude (tremolo) or pan (auto-pan). BPM-syncable.',
    params: [
      { key: 'mode', label: 'Mode', control: 'segmented', options: ['tremolo', 'autopan'], default: TREMOLO_DEFAULT.mode },
      { key: 'sync', label: 'Sync', control: 'toggle', default: TREMOLO_DEFAULT.sync, hint: 'to BPM' },
      { key: 'division', label: 'Division', control: 'select', options: DIVISIONS, default: TREMOLO_DEFAULT.division },
      { key: 'rateHz', label: 'Rate', control: 'knob', min: 0.1, max: 20, step: 0.1, unit: 'Hz', default: TREMOLO_DEFAULT.rateHz, hint: 'used when sync is off' },
      { key: 'depth', label: 'Depth', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: TREMOLO_DEFAULT.depth },
      { key: 'shape', label: 'Shape', control: 'select', options: ['sine', 'triangle', 'square'], default: TREMOLO_DEFAULT.shape },
      { key: 'enabled', label: 'On', control: 'toggle', default: TREMOLO_DEFAULT.enabled },
    ],
  },
  {
    id: 'delay',
    label: 'Delay / Echo',
    tier: 'creative',
    hasMix: true,
    hasMeter: false,
    summary: 'BPM-synced echo + feedback tone filter + ping-pong.',
    params: [
      { key: 'sync', label: 'Sync', control: 'toggle', default: DELAY_DEFAULT.sync, hint: 'to BPM' },
      { key: 'division', label: 'Division', control: 'select', options: DIVISIONS, default: DELAY_DEFAULT.division },
      { key: 'timeMs', label: 'Time', control: 'knob', min: 1, max: 2000, step: 1, unit: 'ms', default: DELAY_DEFAULT.timeMs, hint: 'used when sync is off' },
      { key: 'feedback', label: 'Feedback', control: 'knob', min: 0, max: 0.95, step: 0.01, unit: 'percent', default: DELAY_DEFAULT.feedback },
      { key: 'toneHz', label: 'Tone', control: 'knob', min: 200, max: 18000, unit: 'Hz', default: DELAY_DEFAULT.toneHz, hint: 'feedback-loop lowpass' },
      { key: 'pingPong', label: 'Ping-pong', control: 'toggle', default: DELAY_DEFAULT.pingPong },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: DELAY_DEFAULT.mix },
      { key: 'bpm', label: 'BPM', control: 'knob', min: 40, max: 240, step: 1, unit: 'none', default: DELAY_DEFAULT.bpm, hint: 'usually set from track analysis, not a user control' },
      { key: 'enabled', label: 'On', control: 'toggle', default: DELAY_DEFAULT.enabled },
    ],
  },
  {
    id: 'reverb',
    label: 'Reverb',
    tier: 'creative',
    hasMix: true,
    hasMeter: false,
    summary: 'Convolution reverb with synthesized IRs (no assets). Heaviest native node.',
    params: [
      { key: 'ir', label: 'Space', control: 'select', options: ['room', 'hall', 'plate', 'spring', 'ambience'], default: REVERB_DEFAULT.ir },
      { key: 'decaySec', label: 'Decay', control: 'knob', min: 0.2, max: 8, step: 0.1, unit: 's', default: REVERB_DEFAULT.decaySec },
      { key: 'preDelayMs', label: 'Pre-delay', control: 'knob', min: 0, max: 200, step: 1, unit: 'ms', default: REVERB_DEFAULT.preDelayMs },
      { key: 'dampingHz', label: 'Damping', control: 'knob', min: 1000, max: 18000, unit: 'Hz', default: REVERB_DEFAULT.dampingHz },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: REVERB_DEFAULT.mix },
      { key: 'enabled', label: 'On', control: 'toggle', default: REVERB_DEFAULT.enabled },
    ],
  },
  {
    id: 'limiter',
    label: 'Limiter',
    tier: 'mastering',
    hasMix: false,
    hasMeter: true,
    worklet: true,
    summary: 'True brickwall lookahead limiter — the "-1 dBTP" loudness preview. Meter: { reductionDb }.',
    params: [
      { key: 'ceilingDb', label: 'Ceiling', control: 'knob', min: -12, max: 0, step: 0.1, unit: 'dBTP', default: LIMITER_DEFAULT.ceilingDb },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 1, max: 500, step: 1, unit: 'ms', default: LIMITER_DEFAULT.releaseMs },
      { key: 'lookaheadMs', label: 'Lookahead', control: 'knob', min: 0, max: 10, step: 0.5, unit: 'ms', default: LIMITER_DEFAULT.lookaheadMs },
      { key: 'enabled', label: 'On', control: 'toggle', default: LIMITER_DEFAULT.enabled },
    ],
  },
  {
    id: 'trim',
    label: 'Output Trim',
    tier: 'mastering',
    hasMix: false,
    hasMeter: false,
    summary: 'Chain-level make-up gain (separate from player volume). Defaults on; reorderable.',
    params: [
      { key: 'gainDb', label: 'Gain', control: 'knob', min: -24, max: 12, step: 0.5, unit: 'dB', default: TRIM_DEFAULT.gainDb },
      { key: 'enabled', label: 'On', control: 'toggle', default: TRIM_DEFAULT.enabled },
    ],
  },
  {
    id: 'pitch',
    label: 'Pitch',
    tier: 'transport',
    hasMix: false,
    hasMeter: false,
    summary: 'Separate BufferSource lane (NOT in the insert chain). Drive via the pitch handle methods. Pitch + tempo are coupled.',
    params: [
      { key: 'semitones', label: 'Semitones', control: 'knob', min: -12, max: 12, step: 1, unit: 'st', default: 0 },
      { key: 'cents', label: 'Cents', control: 'slider', min: -50, max: 50, step: 1, unit: 'cents', default: 0 },
      { key: 'tempo', label: 'Tempo', control: 'knob', min: 0.5, max: 2, step: 0.01, unit: 'x', default: 1, hint: 'coupled with pitch' },
      { key: 'enabled', label: 'On', control: 'toggle', default: false },
    ],
  },
];

/** Modules tiered for a full-song "mastering preview" (surface prominently). */
export const MASTERING_IDS = RACK_MANIFEST.filter((m) => m.tier === 'mastering').map((m) => m.id);
/** Per-element / creative modules (tuck behind a disclosure for full-song use). */
export const CREATIVE_IDS = RACK_MANIFEST.filter((m) => m.tier === 'creative').map((m) => m.id);


================================================================================
===== FILE: components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts =====
================================================================================

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { buildInsertChain, type InsertChain } from './audio/composer';
import type { EffectId, EffectMeter } from './audio/EffectUnit';
import {
  DEFAULT_ORDER,
  EQ_BANDS_DEFAULT,
  COMPRESSOR_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
  DJFILTER_DEFAULT,
  DELAY_DEFAULT,
  REVERB_DEFAULT,
  PAN_DEFAULT,
  TREMOLO_DEFAULT,
  TRIM_DEFAULT,
  GATE_DEFAULT,
  BITCRUSHER_DEFAULT,
  LIMITER_DEFAULT,
  type EqBand,
  type CompressorState,
  type SaturationState,
  type WidthState,
  type DjFilterState,
  type DelayState,
  type ReverbState,
  type PanState,
  type TremoloState,
  type TrimState,
  type GateState,
  type BitcrusherState,
  type LimiterState,
} from './audio/state';

// Re-export for existing consumers (PreviewTools, route) that import these from
// useAudioGraph. Single source of truth now lives in audio/state.ts.
export {
  EQ_BANDS_DEFAULT,
  COMPRESSOR_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
} from './audio/state';
export type { EqBand, CompressorState, SaturationState, WidthState } from './audio/state';

export interface EffectParamMap {
  eq: { bands: EqBand[]; enabled: boolean };
  comp: CompressorState;
  sat: SaturationState;
  ms: WidthState;
  djfilter: DjFilterState;
  delay: DelayState;
  reverb: ReverbState;
  pan: PanState;
  tremolo: TremoloState;
  trim: TrimState;
  gate: GateState;
  bitcrusher: BitcrusherState;
  limiter: LimiterState;
}

// Web Audio chain that wraps the page's single <audio> element. The processing
// graph is composed from modular EffectUnits (see audio/composer.ts):
//   source → masterIn → masterDry ───────────────────────────────→ masterOut   (bypass lane)
//                     → insert chain: EQ → Comp → Sat → M/S        → masterOut
//                       (buildInsertChain; each unit owns a dry/wet bypass)
//   masterOut → analyserMain (FFT) + analyserL/analyserR (scope) → destination
//
// Per-unit dry/wet bypass (audio/EffectUnit.ts makeDryWet) means a unit "off" is
// wet=0 (true dry passthrough), not identity param values. The pitch BufferSource
// lane and the master-bypass passthrough live OUTSIDE the insert chain.
//
// AudioContext is created LAZILY on first ensureContext() because browsers block
// context creation outside a user gesture (Chrome/Safari). Call ensureContext()
// from a click handler before doing anything else.

export interface AudioGraphHandle {
  ensureContext: () => AudioContext;
  context: AudioContext | null;

  // Tool param setters — mutate underlying AudioParam.value directly.
  setEqBand: (index: number, gainDb: number) => void;
  setEqEnabled: (enabled: boolean) => void;

  setCompressor: (state: Partial<CompressorState>) => void;

  setSaturation: (state: Partial<SaturationState>) => void;

  setWidth: (state: Partial<WidthState>) => void;

  setEffectParams: <K extends EffectId>(id: K, patch: Partial<EffectParamMap[K]>) => void;
  reorder: (order: EffectId[]) => void;
  getOrder: () => EffectId[];
  readEffectMeter: (id: EffectId) => EffectMeter | null;

  setMasterBypass: (bypassed: boolean) => void;
  resetAll: () => void;

  // Pitch mode — tempo-safe pitch shift via AudioBufferSourceNode.detune.
  // Streaming MediaElementSource can't detune, so the first time pitch is
  // enabled we fetch + decode the whole file into an AudioBuffer (cached).
  // The chain entry then swaps from MediaElementSource → AudioBufferSource.
  enterPitchMode: (audioUrl: string, fromSeconds: number) => Promise<void>;
  exitPitchMode: () => number; // returns current position so caller can resume MediaElement
  setPitchDetune: (semitones: number, cents: number) => void;
  pitchPause: () => void;
  pitchResume: () => void;
  pitchSeek: (positionSec: number) => void;
  pitchCurrentTime: () => number;
  pitchDuration: () => number;
  pitchPlaying: () => boolean;
  pitchSubscribe: (cb: PitchListener) => () => void;

  // Visualization snapshots (returned by readFrame()).
  // Caller drives the rAF loop; the hook only exposes data accessors.
  readFrame: () => AudioFrame;
}

export interface AudioFrame {
  /** Linear 0..1 normalized FFT amplitudes, one per band. */
  fftBins: Float32Array;
  /** Linear 0..1 normalized averages by perceptual band (8 bands). */
  bandAverages: Float32Array;
  /** RMS level over the last window, dBFS. */
  rmsDb: number;
  /** Approximated short-term LUFS (RMS + K-weighted offset). */
  lufsShort: number;
  /** Approximated true peak in dBTP (max sample over window). */
  truePeakDb: number;
  /** Pearson correlation of L vs R buffers, −1..1. */
  correlation: number;
  /** Time-domain buffers for the scope (Lissajous). */
  scopeL: Float32Array;
  scopeR: Float32Array;
}

export interface PitchState {
  semitones: number; // -12..12
  cents: number; // -50..50
  enabled: boolean;
}

export const PITCH_DEFAULT: PitchState = {
  semitones: 0,
  cents: 0,
  enabled: false,
};

// Listener types for transport events when a BufferSource is driving playback.
type PitchListener = (event: PitchEvent) => void;

export type PitchEvent =
  | { type: 'decode-start' }
  | { type: 'decode-progress'; bytesLoaded: number; bytesTotal: number }
  | { type: 'decode-complete'; durationSec: number }
  | { type: 'decode-error'; message: string }
  | { type: 'mode-enter'; positionSec: number }
  | { type: 'mode-exit'; positionSec: number }
  | { type: 'tick'; positionSec: number };

interface Nodes {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  chain: InsertChain;
  masterIn: GainNode;
  masterDry: GainNode;
  masterProcessed: GainNode;
  masterOut: GainNode;
  analyserMain: AnalyserNode;
  scopeSplitter: ChannelSplitterNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
}

const FFT_SIZE = 2048;
const BAND_COUNT = 8;
// Logarithmic-ish band edges that roughly match the mockup's 8-band display
// (sub / bass / lo-mid / mid / hi-mid / pres / bril / air).
const BAND_EDGES_HZ = [20, 80, 250, 500, 1500, 4000, 8000, 12000, 20000];

export function useAudioGraph(
  // Accept a RefObject (not the resolved element) so the hook can read
  // audioElRef.current lazily at ensureContext time. Ref identity is stable
  // across renders even though .current updates when the <audio> mounts.
  // Taking the element directly would close over `null` on first render and
  // never recover (the returned handle is memoized with empty deps).
  audioElRef: RefObject<HTMLAudioElement | null>,
): AudioGraphHandle {
  const nodesRef = useRef<Nodes | null>(null);
  const eqStateRef = useRef<EqBand[]>(EQ_BANDS_DEFAULT.map((b) => ({ ...b })));
  const eqEnabledRef = useRef(true);
  const compStateRef = useRef<CompressorState>({ ...COMPRESSOR_DEFAULT });
  const satStateRef = useRef<SaturationState>({ ...SATURATION_DEFAULT });
  const widthStateRef = useRef<WidthState>({ ...WIDTH_DEFAULT });
  const djFilterStateRef = useRef<DjFilterState>({ ...DJFILTER_DEFAULT });
  const delayStateRef = useRef<DelayState>({ ...DELAY_DEFAULT });
  const reverbStateRef = useRef<ReverbState>({ ...REVERB_DEFAULT });
  const panStateRef = useRef<PanState>({ ...PAN_DEFAULT });
  const tremoloStateRef = useRef<TremoloState>({ ...TREMOLO_DEFAULT });
  const trimStateRef = useRef<TrimState>({ ...TRIM_DEFAULT });
  const gateStateRef = useRef<GateState>({ ...GATE_DEFAULT });
  const bitcrusherStateRef = useRef<BitcrusherState>({ ...BITCRUSHER_DEFAULT });
  const limiterStateRef = useRef<LimiterState>({ ...LIMITER_DEFAULT });
  const masterBypassRef = useRef(false);
  // ── Pitch (BufferSource) lane ──
  const pitchStateRef = useRef<PitchState>({ ...PITCH_DEFAULT });
  const pitchBufferRef = useRef<AudioBuffer | null>(null);
  const pitchSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const pitchListenersRef = useRef<Set<PitchListener>>(new Set());
  const pitchStartedAtRef = useRef(0); // ctx.currentTime when start()
  const pitchOffsetRef = useRef(0); // buffer offset when start()
  const pitchPlayingRef = useRef(false);
  const pitchPausedAtRef = useRef(-1); // -1 = playing or never started
  // Scratch buffers reused per frame — never reallocate.
  const fftBytesRef = useRef<Uint8Array>(new Uint8Array(FFT_SIZE / 2));
  const fftFloatsRef = useRef<Float32Array>(new Float32Array(FFT_SIZE / 2));
  const bandAvgRef = useRef<Float32Array>(new Float32Array(BAND_COUNT));
  const scopeLRef = useRef<Float32Array>(new Float32Array(FFT_SIZE));
  const scopeRRef = useRef<Float32Array>(new Float32Array(FFT_SIZE));

  // Force re-render when context is created so consumers can re-evaluate.
  const [, setContextTick] = useState(0);

  const buildGraph = (el: HTMLAudioElement): Nodes => {
    const AC: typeof AudioContext =
      (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new AC();

    const source = ctx.createMediaElementSource(el);

    const chain = buildInsertChain(ctx);

    // ── Master bypass: dry passthrough lane vs processed lane ──
    const masterIn = ctx.createGain();
    const masterDry = ctx.createGain();
    const masterProcessed = ctx.createGain();
    const masterOut = ctx.createGain();
    masterDry.gain.value = 0;
    masterProcessed.gain.value = 1;

    // ── Analysis ──
    const analyserMain = ctx.createAnalyser();
    analyserMain.fftSize = FFT_SIZE;
    analyserMain.smoothingTimeConstant = 0.6;
    const scopeSplitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = FFT_SIZE;
    analyserR.fftSize = FFT_SIZE;
    analyserL.smoothingTimeConstant = 0;
    analyserR.smoothingTimeConstant = 0;

    // ── Wire everything ──
    source.connect(masterIn);

    // Dry passthrough lane (master bypass) — unchanged.
    masterIn.connect(masterDry).connect(masterOut);
    // Processed lane now runs through the composed insert chain.
    masterIn.connect(chain.chainIn);
    chain.chainOut.connect(masterProcessed).connect(masterOut);

    masterOut.connect(analyserMain);
    analyserMain.connect(scopeSplitter);
    scopeSplitter.connect(analyserL, 0);
    scopeSplitter.connect(analyserR, 1);
    masterOut.connect(ctx.destination);

    return {
      ctx,
      source,
      chain,
      masterIn,
      masterDry,
      masterProcessed,
      masterOut,
      analyserMain,
      scopeSplitter,
      analyserL,
      analyserR,
    };
  };

  // Helper to apply current ref state to running node params.
  const applyWidth = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.ms.applyParams(widthStateRef.current);
  };

  const applyCompressor = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.comp.applyParams(compStateRef.current);
  };

  const applySaturation = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.sat.applyParams(satStateRef.current);
  };

  const applyEq = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.eq.applyParams({ bands: eqStateRef.current, enabled: eqEnabledRef.current });
  };

  const applyDjFilter = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.djfilter.applyParams(djFilterStateRef.current);
  };

  const applyDelay = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.delay.applyParams(delayStateRef.current);
  };

  const applyReverb = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.reverb.applyParams(reverbStateRef.current);
  };

  const applyPan = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.pan.applyParams(panStateRef.current);
  };

  const applyTremolo = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.tremolo.applyParams(tremoloStateRef.current);
  };

  const applyTrim = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.trim.applyParams(trimStateRef.current);
  };

  const applyGate = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.gate.applyParams(gateStateRef.current);
  };

  const applyBitcrusher = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.bitcrusher.applyParams(bitcrusherStateRef.current);
  };

  const applyLimiter = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.chain.units.limiter.applyParams(limiterStateRef.current);
  };

  const applyMasterBypass = () => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.masterDry.gain.value = masterBypassRef.current ? 1 : 0;
    nodes.masterProcessed.gain.value = masterBypassRef.current ? 0 : 1;
  };

  const applyEffectParams = <K extends EffectId>(
    id: K,
    patch: Partial<EffectParamMap[K]>,
  ): void => {
    switch (id) {
      case 'eq': {
        const p = patch as Partial<EffectParamMap['eq']>;
        if (p.bands) eqStateRef.current = p.bands;
        if (p.enabled !== undefined) eqEnabledRef.current = p.enabled;
        applyEq();
        break;
      }
      case 'comp':
        Object.assign(compStateRef.current, patch);
        applyCompressor();
        break;
      case 'sat':
        Object.assign(satStateRef.current, patch);
        applySaturation();
        break;
      case 'ms':
        Object.assign(widthStateRef.current, patch);
        applyWidth();
        break;
      case 'djfilter':
        Object.assign(djFilterStateRef.current, patch);
        applyDjFilter();
        break;
      case 'delay':
        Object.assign(delayStateRef.current, patch);
        applyDelay();
        break;
      case 'reverb':
        Object.assign(reverbStateRef.current, patch);
        applyReverb();
        break;
      case 'pan':
        Object.assign(panStateRef.current, patch);
        applyPan();
        break;
      case 'tremolo':
        Object.assign(tremoloStateRef.current, patch);
        applyTremolo();
        break;
      case 'trim':
        Object.assign(trimStateRef.current, patch);
        applyTrim();
        break;
      case 'gate':
        Object.assign(gateStateRef.current, patch);
        applyGate();
        break;
      case 'bitcrusher':
        Object.assign(bitcrusherStateRef.current, patch);
        applyBitcrusher();
        break;
      case 'limiter':
        Object.assign(limiterStateRef.current, patch);
        applyLimiter();
        break;
    }
  };

  // Tear down on unmount so AudioContext is released (browsers cap to ~6).
  // Refs are captured eagerly so the cleanup uses the values that existed
  // when the effect ran, not whatever they've become at cleanup time.
  const cleanupRef = useRef<() => void>(() => undefined);
  cleanupRef.current = () => {
    const nodes = nodesRef.current;
    const pitchSrc = pitchSourceRef.current;
    const listeners = pitchListenersRef.current;
    if (pitchSrc) {
      try {
        pitchSrc.onended = null;
        pitchSrc.stop();
      } catch {
        /* already stopped */
      }
      try {
        pitchSrc.disconnect();
      } catch {
        /* already disconnected */
      }
      pitchSourceRef.current = null;
    }
    pitchBufferRef.current = null;
    listeners.clear();
    if (nodes) {
      try {
        nodes.source.disconnect();
      } catch {
        /* already disconnected */
      }
      nodes.chain.dispose();
      void nodes.ctx.close();
      nodesRef.current = null;
    }
  };
  useEffect(() => () => cleanupRef.current(), []);

  const ensureContext = (): AudioContext => {
    if (nodesRef.current) {
      // If suspended (autoplay policy), resume on caller's behalf.
      if (nodesRef.current.ctx.state === 'suspended') {
        void nodesRef.current.ctx.resume();
      }
      return nodesRef.current.ctx;
    }
    const el = audioElRef.current;
    if (!el) {
      throw new Error('ensureContext called before <audio> element mounted');
    }
    const nodes = buildGraph(el);
    nodesRef.current = nodes;
    setContextTick((t) => t + 1);
    return nodes.ctx;
  };

  // Frame reader — owns the FFT byte/float scratch buffers, computes
  // band averages + correlation + RMS in one pass for the rAF loop.
  const readFrame = (): AudioFrame => {
    const nodes = nodesRef.current;
    if (!nodes) {
      return EMPTY_FRAME;
    }
    const fftBytes = fftBytesRef.current;
    const fftFloats = fftFloatsRef.current;
    const bandAvg = bandAvgRef.current;
    const scopeL = scopeLRef.current;
    const scopeR = scopeRRef.current;

    nodes.analyserMain.getByteFrequencyData(fftBytes);
    for (let i = 0; i < fftBytes.length; i += 1) {
      fftFloats[i] = fftBytes[i] / 255;
    }
    nodes.analyserL.getFloatTimeDomainData(scopeL);
    nodes.analyserR.getFloatTimeDomainData(scopeR);

    // Band averages
    const sr = nodes.ctx.sampleRate;
    const binHz = sr / FFT_SIZE;
    for (let b = 0; b < BAND_COUNT; b += 1) {
      const lo = Math.max(1, Math.floor(BAND_EDGES_HZ[b] / binHz));
      const hi = Math.min(fftFloats.length - 1, Math.ceil(BAND_EDGES_HZ[b + 1] / binHz));
      let sum = 0;
      let n = 0;
      for (let i = lo; i <= hi; i += 1) {
        sum += fftFloats[i];
        n += 1;
      }
      bandAvg[b] = n > 0 ? sum / n : 0;
    }

    // RMS + true peak from L channel (cheaper; mono approximation OK for v1).
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < scopeL.length; i += 1) {
      const v = scopeL[i];
      sumSq += v * v;
      const av = Math.abs(v);
      if (av > peak) peak = av;
    }
    const rmsLinear = Math.sqrt(sumSq / scopeL.length);
    const rmsDb = rmsLinear > 0 ? 20 * Math.log10(rmsLinear) : -120;
    const truePeakDb = peak > 0 ? 20 * Math.log10(peak) : -120;
    // K-weighted LUFS approximation — flat RMS minus a fixed ~0.691 dB
    // offset for the reference 1kHz sine. Not BS.1770-compliant but tracks
    // perceived loudness movements over time well enough for a meter UI.
    const lufsShort = rmsDb - 0.691;

    // Pearson correlation L vs R over the time-domain window
    let meanL = 0;
    let meanR = 0;
    for (let i = 0; i < scopeL.length; i += 1) {
      meanL += scopeL[i];
      meanR += scopeR[i];
    }
    meanL /= scopeL.length;
    meanR /= scopeR.length;
    let num = 0;
    let denL = 0;
    let denR = 0;
    for (let i = 0; i < scopeL.length; i += 1) {
      const dl = scopeL[i] - meanL;
      const dr = scopeR[i] - meanR;
      num += dl * dr;
      denL += dl * dl;
      denR += dr * dr;
    }
    const denom = Math.sqrt(denL * denR);
    const correlation = denom > 1e-9 ? num / denom : 0;

    return {
      fftBins: fftFloats,
      bandAverages: bandAvg,
      rmsDb,
      lufsShort,
      truePeakDb,
      correlation,
      scopeL,
      scopeR,
    };
  };

  // ── Pitch lane: tempo-safe pitch shift via AudioBufferSource.detune ──
  // Note: in vanilla Web Audio, detune scales playbackRate (computedRate =
  // playbackRate * pow(2, detune/1200)). So pitch up → tempo up too. True
  // tempo-safe pitch shift requires an AudioWorklet phase vocoder; that's a
  // future upgrade. For now the UX matches the v1 implementation.

  const emitPitch = (event: PitchEvent) => {
    for (const cb of pitchListenersRef.current) cb(event);
  };

  const decodePitchBuffer = async (audioUrl: string): Promise<AudioBuffer> => {
    if (pitchBufferRef.current) return pitchBufferRef.current;
    const nodes = nodesRef.current;
    if (!nodes) throw new Error('AudioContext not initialized — call ensureContext first');
    emitPitch({ type: 'decode-start' });
    try {
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      const decoded = await nodes.ctx.decodeAudioData(ab);
      pitchBufferRef.current = decoded;
      emitPitch({ type: 'decode-complete', durationSec: decoded.duration });
      return decoded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitPitch({ type: 'decode-error', message });
      throw err;
    }
  };

  const createPitchSource = (buffer: AudioBuffer, offsetSec: number) => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    const src = nodes.ctx.createBufferSource();
    src.buffer = buffer;
    src.detune.value =
      pitchStateRef.current.semitones * 100 + pitchStateRef.current.cents;
    src.connect(nodes.masterIn);
    src.onended = () => {
      // Web Audio also fires onended when we explicitly stop(); guard so
      // an explicit stop doesn't reset our paused-position bookkeeping.
      if (pitchSourceRef.current === src) {
        pitchSourceRef.current = null;
        pitchPlayingRef.current = false;
        if (pitchPausedAtRef.current < 0) {
          pitchPausedAtRef.current = buffer.duration;
        }
      }
    };
    src.start(0, Math.max(0, Math.min(buffer.duration, offsetSec)));
    pitchSourceRef.current = src;
    pitchStartedAtRef.current = nodes.ctx.currentTime;
    pitchOffsetRef.current = offsetSec;
    pitchPlayingRef.current = true;
    pitchPausedAtRef.current = -1;
  };

  const stopCurrentPitchSource = (): number => {
    const nodes = nodesRef.current;
    if (!nodes) return 0;
    if (!pitchSourceRef.current) {
      return pitchPausedAtRef.current >= 0
        ? pitchPausedAtRef.current
        : pitchOffsetRef.current;
    }
    const pos =
      nodes.ctx.currentTime - pitchStartedAtRef.current + pitchOffsetRef.current;
    try {
      pitchSourceRef.current.onended = null;
      pitchSourceRef.current.stop();
    } catch {
      /* already stopped */
    }
    try {
      pitchSourceRef.current.disconnect();
    } catch {
      /* already disconnected */
    }
    pitchSourceRef.current = null;
    pitchPlayingRef.current = false;
    return pos;
  };

  // Stable handle — all methods close over refs only, so identity can be
  // frozen at first render. Without this, every parent re-render produces a
  // fresh handle and any `[graph]`-dep effect re-fires (notably the pitch
  // mode entry effect, which would kick off duplicate enterPitchMode calls
  // mid-decode).
  return useMemo<AudioGraphHandle>(() => ({
    get context() {
      return nodesRef.current?.ctx ?? null;
    },
    ensureContext,
    setEqBand: (index, gainDb) => {
      const bands = eqStateRef.current;
      if (bands[index]) bands[index].gainDb = gainDb;
      applyEq();
    },
    setEqEnabled: (enabled) => {
      eqEnabledRef.current = enabled;
      applyEq();
    },
    setCompressor: (patch) => applyEffectParams('comp', patch),
    setSaturation: (patch) => applyEffectParams('sat', patch),
    setWidth: (patch) => applyEffectParams('ms', patch),
    setEffectParams: (id, patch) => applyEffectParams(id, patch),
    reorder: (order) => nodesRef.current?.chain.reorder(order),
    getOrder: () => nodesRef.current?.chain.getOrder() ?? [...DEFAULT_ORDER],
    readEffectMeter: (id) => nodesRef.current?.chain.units[id]?.readMeter?.() ?? null,
    setMasterBypass: (bypassed) => {
      masterBypassRef.current = bypassed;
      applyMasterBypass();
    },
    resetAll: () => {
      eqStateRef.current = EQ_BANDS_DEFAULT.map((b) => ({ ...b }));
      eqEnabledRef.current = true;
      compStateRef.current = { ...COMPRESSOR_DEFAULT };
      satStateRef.current = { ...SATURATION_DEFAULT };
      widthStateRef.current = { ...WIDTH_DEFAULT };
      djFilterStateRef.current = { ...DJFILTER_DEFAULT };
      delayStateRef.current = { ...DELAY_DEFAULT };
      reverbStateRef.current = { ...REVERB_DEFAULT };
      panStateRef.current = { ...PAN_DEFAULT };
      tremoloStateRef.current = { ...TREMOLO_DEFAULT };
      trimStateRef.current = { ...TRIM_DEFAULT };
      gateStateRef.current = { ...GATE_DEFAULT };
      bitcrusherStateRef.current = { ...BITCRUSHER_DEFAULT };
      limiterStateRef.current = { ...LIMITER_DEFAULT };
      masterBypassRef.current = false;
      applyEq();
      applyCompressor();
      applySaturation();
      applyWidth();
      applyDjFilter();
      applyDelay();
      applyReverb();
      applyPan();
      applyTremolo();
      applyTrim();
      applyGate();
      applyBitcrusher();
      applyLimiter();
      applyMasterBypass();
      nodesRef.current?.chain.reorder([...DEFAULT_ORDER]);
    },
    enterPitchMode: async (audioUrl, fromSeconds) => {
      ensureContext();
      // decodePitchBuffer caches the result on pitchBufferRef; we just await
      // it for the side effect + completion timing.
      await decodePitchBuffer(audioUrl);
      const nodes = nodesRef.current;
      if (!nodes) return;
      // Disconnect MediaElementSource so the audio element stops feeding the
      // chain. The <audio> tag itself is paused by the caller before we
      // enter pitch mode.
      try {
        nodes.source.disconnect(nodes.masterIn);
      } catch {
        /* already disconnected */
      }
      pitchStateRef.current.enabled = true;
      pitchPausedAtRef.current = fromSeconds;
      pitchOffsetRef.current = fromSeconds;
      emitPitch({ type: 'mode-enter', positionSec: fromSeconds });
    },
    exitPitchMode: () => {
      const pos = stopCurrentPitchSource();
      const nodes = nodesRef.current;
      if (nodes) {
        try {
          nodes.source.connect(nodes.masterIn);
        } catch {
          /* already connected */
        }
      }
      pitchStateRef.current.enabled = false;
      pitchPausedAtRef.current = -1;
      pitchOffsetRef.current = 0;
      emitPitch({ type: 'mode-exit', positionSec: pos });
      return pos;
    },
    setPitchDetune: (semitones, cents) => {
      pitchStateRef.current.semitones = semitones;
      pitchStateRef.current.cents = cents;
      if (pitchSourceRef.current) {
        pitchSourceRef.current.detune.value = semitones * 100 + cents;
      }
    },
    pitchPause: () => {
      const pos = stopCurrentPitchSource();
      pitchPausedAtRef.current = pos;
    },
    pitchResume: () => {
      if (!pitchBufferRef.current) return;
      if (pitchSourceRef.current) return; // already playing
      const at =
        pitchPausedAtRef.current >= 0
          ? pitchPausedAtRef.current
          : pitchOffsetRef.current;
      createPitchSource(pitchBufferRef.current, at);
    },
    pitchSeek: (positionSec) => {
      if (!pitchBufferRef.current) return;
      const wasPlaying = pitchPlayingRef.current;
      stopCurrentPitchSource();
      const target = Math.max(
        0,
        Math.min(pitchBufferRef.current.duration, positionSec),
      );
      if (wasPlaying) {
        createPitchSource(pitchBufferRef.current, target);
      } else {
        pitchPausedAtRef.current = target;
        pitchOffsetRef.current = target;
      }
    },
    pitchCurrentTime: () => {
      const nodes = nodesRef.current;
      if (!nodes) return 0;
      if (pitchSourceRef.current && pitchPlayingRef.current) {
        return (
          nodes.ctx.currentTime - pitchStartedAtRef.current + pitchOffsetRef.current
        );
      }
      return pitchPausedAtRef.current >= 0
        ? pitchPausedAtRef.current
        : pitchOffsetRef.current;
    },
    pitchDuration: () => pitchBufferRef.current?.duration ?? 0,
    pitchPlaying: () => pitchPlayingRef.current,
    pitchSubscribe: (cb) => {
      pitchListenersRef.current.add(cb);
      return () => {
        pitchListenersRef.current.delete(cb);
      };
    },
    readFrame,
    // The closures captured here only read from refs, never from React state,
    // so re-evaluating them on every render would be wasted work and (worse)
    // would invalidate any consumer's `[graph]`-dep effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
}

const EMPTY_FRAME: AudioFrame = {
  fftBins: new Float32Array(0),
  bandAverages: new Float32Array(8),
  rmsDb: -120,
  lufsShort: -120,
  truePeakDb: -120,
  correlation: 0,
  scopeL: new Float32Array(0),
  scopeR: new Float32Array(0),
};


================================================================================
===== FILE: components/frontend-spectr-v2/src/features/listen/audio/state.ts =====
================================================================================

// state.ts — single source of truth for effect param types + neutral defaults.
import type { EffectId } from './EffectUnit';

export type BiquadType =
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'notch'
  | 'allpass';

export type SatCurve = 'tanh' | 'softclip' | 'hardclip' | 'arctan' | 'sinefold' | 'tube';

export interface EqBand {
  type: BiquadType;
  freq: number;
  gainDb: number;
  q: number;
  enabled: boolean;
}

export interface CompressorState {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
  mix: number; // 0..1 parallel (NY) dry/wet; 1 = full compressed
  enabled: boolean;
}

export interface SaturationState {
  drive: number; // 0..1
  mix: number; // 0..1 dry->wet
  curve: SatCurve;
  oversample: OverSampleType; // 'none' | '2x' | '4x'
  asymmetry: number; // -1..1, even-harmonic bias
  tone: number; // -1..1 tilt
  outputTrimDb: number; // -24..+12
  enabled: boolean;
}

export interface WidthState {
  width: number; // 0..2 (1 = identity, 0 = mono, 2 = exaggerated)
  midGainDb: number; // -12..+12
  sideGainDb: number; // -12..+12
  monoMakerHz: number; // 0..400, 0 = off
  mono: boolean; // force width -> 0
  enabled: boolean;
}

export interface EqState {
  bands: EqBand[];
  enabled: boolean;
}

const EQ_FREQS = [60, 170, 350, 700, 1400, 3500, 7000, 14000];

export const EQ_BANDS_DEFAULT: ReadonlyArray<EqBand> = EQ_FREQS.map(
  (freq): EqBand => ({ type: 'peaking', freq, gainDb: 0, q: 1.4, enabled: true }),
);

export const COMPRESSOR_DEFAULT: CompressorState = {
  thresholdDb: 0,
  ratio: 1,
  attackMs: 3,
  releaseMs: 250,
  kneeDb: 30,
  makeupDb: 0,
  mix: 1,
  enabled: false,
};

export const SATURATION_DEFAULT: SaturationState = {
  drive: 0,
  mix: 0,
  curve: 'tanh',
  oversample: '2x',
  asymmetry: 0,
  tone: 0,
  outputTrimDb: 0,
  enabled: false,
};

export const WIDTH_DEFAULT: WidthState = {
  width: 1,
  midGainDb: 0,
  sideGainDb: 0,
  monoMakerHz: 0,
  mono: false,
  enabled: false,
};

export type Division = '1/4' | '1/8' | '1/8.' | '1/8T' | '1/16';
export type IrType = 'room' | 'hall' | 'plate' | 'spring' | 'ambience';

export interface DjFilterState {
  morph: number; // -1..1, 0 = open
  resonance: number; // 0.1..20
  enabled: boolean;
}

export interface DelayState {
  sync: boolean;
  division: Division;
  timeMs: number; // 1..2000
  feedback: number; // 0..0.95
  toneHz: number; // 200..18000
  pingPong: boolean;
  mix: number; // 0..1
  bpm: number; // 40..240
  enabled: boolean;
}

export interface ReverbState {
  ir: IrType;
  decaySec: number; // 0.2..8
  preDelayMs: number; // 0..200
  dampingHz: number; // 1000..18000
  mix: number; // 0..1
  enabled: boolean;
}

export interface PanState {
  pan: number; // -1..1
  enabled: boolean;
}

export interface TremoloState {
  mode: 'tremolo' | 'autopan';
  sync: boolean;
  division: Division;
  rateHz: number; // 0.1..20
  depth: number; // 0..1
  shape: 'sine' | 'triangle' | 'square';
  bpm: number; // 40..240
  enabled: boolean;
}

export interface TrimState {
  gainDb: number; // -24..+12
  enabled: boolean;
}

export const DJFILTER_DEFAULT: DjFilterState = { morph: 0, resonance: 0.7, enabled: false };

export const DELAY_DEFAULT: DelayState = {
  sync: true,
  division: '1/8',
  timeMs: 250,
  feedback: 0.35,
  toneHz: 8000,
  pingPong: false,
  mix: 0,
  bpm: 120,
  enabled: false,
};

export const REVERB_DEFAULT: ReverbState = {
  ir: 'hall',
  decaySec: 2.0,
  preDelayMs: 20,
  dampingHz: 8000,
  mix: 0,
  enabled: false,
};

export const PAN_DEFAULT: PanState = { pan: 0, enabled: false };

export const TREMOLO_DEFAULT: TremoloState = {
  mode: 'tremolo',
  sync: true,
  division: '1/8',
  rateHz: 5,
  depth: 0.5,
  shape: 'sine',
  bpm: 120,
  enabled: false,
};

export const TRIM_DEFAULT: TrimState = { gainDb: 0, enabled: true };

export interface GateState {
  thresholdDb: number; // -80..0
  attackMs: number; // 0..50
  holdMs: number; // 0..500
  releaseMs: number; // 0..1000
  floorDb: number; // -80..0
  enabled: boolean;
}

export interface BitcrusherState {
  bitDepth: number; // 1..16
  downsample: number; // 1..50
  mix: number; // 0..1
  enabled: boolean;
}

export interface LimiterState {
  ceilingDb: number; // -12..0
  releaseMs: number; // 1..500
  lookaheadMs: number; // 0..10
  enabled: boolean;
}

export const GATE_DEFAULT: GateState = {
  thresholdDb: -40,
  attackMs: 1,
  holdMs: 10,
  releaseMs: 100,
  floorDb: -80,
  enabled: false,
};

export const BITCRUSHER_DEFAULT: BitcrusherState = {
  bitDepth: 16,
  downsample: 1,
  mix: 0,
  enabled: false,
};

export const LIMITER_DEFAULT: LimiterState = {
  ceilingDb: -1.0,
  releaseMs: 50,
  lookaheadMs: 5,
  enabled: false,
};

// Phase-5 default insert order: 13-unit chain with worklets in their
// master-design slots (gate after eq, bitcrusher after sat, limiter before trim).
export const DEFAULT_ORDER: ReadonlyArray<EffectId> = [
  'djfilter',
  'eq',
  'gate',
  'comp',
  'sat',
  'bitcrusher',
  'ms',
  'pan',
  'tremolo',
  'delay',
  'reverb',
  'limiter',
  'trim',
];

export function defaultEqState(): EqState {
  return { bands: EQ_BANDS_DEFAULT.map((b) => ({ ...b })), enabled: false };
}
export function defaultCompState(): CompressorState {
  return { ...COMPRESSOR_DEFAULT };
}
export function defaultSatState(): SaturationState {
  return { ...SATURATION_DEFAULT };
}
export function defaultWidthState(): WidthState {
  return { ...WIDTH_DEFAULT };
}


================================================================================
===== FILE: components/frontend-spectr-v2/src/features/listen/audio/EffectUnit.ts =====
================================================================================

import { wetDryGains } from './dsp/mix';

export type EffectId =
  | 'eq'
  | 'comp'
  | 'sat'
  | 'ms'
  | 'djfilter'
  | 'delay'
  | 'reverb'
  | 'pan'
  | 'tremolo'
  | 'trim'
  | 'gate'
  | 'bitcrusher'
  | 'limiter';

export interface EffectMeter {
  reductionDb?: number;
  open?: boolean;
}

export interface EffectUnit<S> {
  readonly id: EffectId;
  readonly input: AudioNode;
  readonly output: AudioNode;
  applyParams(state: S): void;
  setBypass(bypassed: boolean): void;
  readMeter?(): EffectMeter;
  // Worklet units only: build the AudioWorkletNode and swap it in once the
  // processor module has registered. No-op (absent) on native units.
  materialize?(): void;
  dispose(): void;
}

// Wraps an effect's internal (wetIn -> wetOut) sub-graph in a dry/wet bypass:
//
//   input ── dry ───────────────► output
//        └── wetIn … wetOut ─ wet ─► output
//
// setWet(0) = true bypass (dry passthrough); setWet(1) = full effect;
// fractional = parallel mix. The single bypass mechanism for all units.
export function makeDryWet(
  ctx: AudioContext,
  wetIn: AudioNode,
  wetOut: AudioNode,
): { input: GainNode; output: GainNode; setWet: (amount: number) => void } {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const output = ctx.createGain();

  input.connect(dry).connect(output);
  input.connect(wetIn);
  wetOut.connect(wet).connect(output);

  dry.gain.value = 0;
  wet.gain.value = 1;

  return {
    input,
    output,
    setWet: (amount: number) => {
      const g = wetDryGains(amount);
      dry.gain.value = g.dry;
      wet.gain.value = g.wet;
    },
  };
}


================================================================================
===== FILE: components/frontend-spectr-v2/src/features/listen/meterHooks.ts =====
================================================================================

// meterHooks.ts — design-agnostic metering glue for the Listen rack UI.
//
// These hooks do the rAF-throttled polling + change-gating so a meter component
// just consumes a number/object and re-renders only when it actually changes.
// They hold NO visual opinion — the UI draws whatever it wants from the values.
//
// IMPORTANT: use these for SCALAR readouts (GR dB, LUFS, true-peak, correlation).
// For canvas visualizers (spectrum bars, scope/goniometer) do NOT route the
// Float32Array buffers through React state — read `graph.readFrame()` imperatively
// in your own rAF and draw to canvas (the buffers are reused/mutated in place).

import { useEffect, useState } from 'react';

import type { EffectId, EffectMeter } from './audio/EffectUnit';
import type { AudioFrame, AudioGraphHandle } from './useAudioGraph';

/**
 * Live gain-reduction (and gate open-state) for a metering module.
 * Only `comp`, `gate`, and `limiter` emit data; everything else stays null.
 *
 *   const gr = useEffectMeter(graph, 'comp');     // { reductionDb } | null
 *   const gate = useEffectMeter(graph, 'gate');   // { reductionDb, open } | null
 */
export function useEffectMeter(
  graph: AudioGraphHandle,
  id: EffectId,
  fps = 30,
): EffectMeter | null {
  const [meter, setMeter] = useState<EffectMeter | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    const interval = 1000 / fps;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < interval) return;
      last = t;
      const next = graph.readEffectMeter(id);
      setMeter((prev) => (meterEquals(prev, next) ? prev : next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph, id, fps]);
  return meter;
}

function meterEquals(a: EffectMeter | null, b: EffectMeter | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.reductionDb === b.reductionDb && a.open === b.open;
}

export type AudioLevels = Pick<AudioFrame, 'rmsDb' | 'lufsShort' | 'truePeakDb' | 'correlation'>;

/**
 * Live scalar level readouts from `readFrame()` (RMS, short-LUFS, true-peak,
 * L/R correlation) — safe to hold in React state (plain numbers, not buffers).
 *
 *   const levels = useAudioLevels(graph);  // { rmsDb, lufsShort, truePeakDb, correlation } | null
 */
export function useAudioLevels(graph: AudioGraphHandle, fps = 20): AudioLevels | null {
  const [levels, setLevels] = useState<AudioLevels | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    const interval = 1000 / fps;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < interval) return;
      last = t;
      const f = graph.readFrame();
      const next: AudioLevels = {
        rmsDb: f.rmsDb,
        lufsShort: f.lufsShort,
        truePeakDb: f.truePeakDb,
        correlation: f.correlation,
      };
      setLevels((prev) => (levelsEqual(prev, next) ? prev : next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph, fps]);
  return levels;
}

function levelsEqual(a: AudioLevels | null, b: AudioLevels): boolean {
  if (!a) return false;
  return (
    a.rmsDb === b.rmsDb &&
    a.lufsShort === b.lufsShort &&
    a.truePeakDb === b.truePeakDb &&
    a.correlation === b.correlation
  );
}


================================================================================
===== FILE: components/frontend-spectr-v2/src/styles/tokens.css =====
================================================================================

/* SPECTR design tokens.
   Mirrors the dark-mode palette from frontend-spectr-v2/requirements/claude-design-ui-files/styles.css.
   Light mode deferred. */

:root {
  /* Surfaces */
  --bg:         #070a12;
  --bg-2:       #0a0f1c;
  --surface:    #0d1525;
  --card:       #0f1828;
  --card-2:     #11192a;
  --card-hover: #141f34;
  --border:     rgba(255, 255, 255, 0.07);
  --border-2:   rgba(255, 255, 255, 0.12);

  /* Accents */
  --cyan:       #00e5b0;
  --cyan-dim:   rgba(0, 229, 176, 0.10);
  --cyan-glow:  rgba(0, 229, 176, 0.25);
  --violet:     #a78bfa;
  --violet-dim: rgba(167, 139, 250, 0.10);
  --orange:     #fb923c;
  --orange-dim: rgba(251, 146, 60, 0.10);
  --red:        #f43f5e;
  --red-dim:    rgba(244, 63, 94, 0.10);
  --green:      #34d399;
  --yellow:     #fbbf24;
  --blue:       #60a5fa;

  /* Text */
  --text:       #e2e8f4;
  --text-2:     #c0cad8;
  --muted:      #64748b;
  --dim:        #1e293b;

  /* Radii */
  --radius:     12px;
  --radius-sm:  8px;
  --radius-lg:  16px;

  /* Spacing scale (use in modules: var(--space-3) etc.) */
  --space-1:    4px;
  --space-2:    8px;
  --space-3:    12px;
  --space-4:    16px;
  --space-4-5:  18px;  /* story 1.7 / UX-DR3 — bridges 16→20 (.card-body.tight uses this slot) */
  --space-5:    20px;
  --space-6:    24px;

  /* Severity (for verdict cards) */
  --sev-critical: var(--red);
  --sev-severe:   var(--orange);
  --sev-moderate: var(--yellow);
  --sev-minor:    var(--cyan);
  --sev-win:      var(--green);

  /* Story 1.7 / UX-DR3 — severity aliases. The verdict pipeline emits the
     canonical severity vocabulary (severe/minor/win); other surfaces (audit
     log, billing dunning, coach refusals) sometimes use the alias names
     (warning/info/fixed). Both resolve to the same color so a future
     rename is purely lexical. */
  --sev-warning: var(--sev-severe);
  --sev-info:    var(--sev-minor);
  --sev-fixed:   var(--sev-win);

  /* Streaming readiness verdicts (used by Results page).
     NOTE: `--sev-warn` (yellow, streaming-readiness "warn" state) is
     distinct from the alias `--sev-warning` above (orange, maps to
     critical severity). Keep both — the near-identical names are
     intentional but easy to misuse; reach for `--sev-warning` only when
     you mean the orange severity-alias namespace. */
  --sev-ok:       var(--green);
  --sev-warn:     var(--yellow);
  --sev-fail:     var(--red);
  --sev-unknown:  var(--muted);

  /* Grade letter colors (A green → F red) */
  --grade-a:      #34d399;
  --grade-b:      #84cc16;
  --grade-c:      #fbbf24;
  --grade-d:      #fb923c;
  --grade-f:      #f43f5e;
  --grade-na:     var(--muted);

  /* Panel surfaces — sit slightly above --surface for elevation. */
  --panel-bg:     #0e1727;
  --panel-border: rgba(255, 255, 255, 0.06);
  --panel-radius: var(--radius);

  /* Bridge tokens (story 1.2): exact values lifted from raw hex that lived
     in *.module.css files, moved here to satisfy the no-raw-hex lint.
     Story 1.7 decision (UX-DR3): KEEP as-is. Six *.module.css consumers
     reference these (library, listen, profile, _appLayout, auth, forms) —
     above the ≤3 consolidate-now threshold. Phase B (Epic 5 story 1)
     will revisit when it sweeps the app shell. Values stay byte-identical. */
  --accent-bright:   #00f3bd;
  --accent-bright-2: #1eedba;
  --ink-on-accent:   #06151a;
  --ink-on-accent-2: #04221b;

  /* Story 1.7 / UX-DR3 — commerce surface tokens (consumed by Epic 2 BillingCard,
     PlanCard, TierChip, UpgradeSheet, UsageMeter). Declared here in advance so
     Epic 2 surfaces consume them from day one — no parallel styling system. */
  --tier-free:    var(--muted);
  --tier-pro:     var(--cyan);
  --tier-credits: var(--violet);

  /* Story 1.7 / UX-DR3 — paywall overlay (consumed by Epic 2 BlurLock).
     Dark scrim sitting over --bg; opacity tuned so blurred content underneath
     remains shape-recognisable but unreadable. */
  --paywall-overlay: rgba(7, 10, 18, 0.72);
}


================================================================================
===== FILE: components/frontend-spectr-v2/src/styles/global.css =====
================================================================================

/* Story 1.7 / UX-DR1 — self-hosted Syne + JetBrains Mono variable fonts.
   Source: Fontsource Latin subset (OFL licensed), copied to public/fonts/
   at story 1.7 dev time; npm packages then uninstalled (download-only).
   Served from the app origin — no Google CDN. Enforced by
   scripts/check-no-google-fonts.mjs.
   Syne stylistic sets ss01 + ss02 light up via font-feature-settings on
   html/body below. JetBrains Mono tnum lights up via the .mono class. */
@font-face {
  font-family: 'Syne';
  font-style: normal;
  font-display: swap;
  font-weight: 400 800;
  /* Forward-compat (CSS Fonts L4) + legacy hint fallback for older engines
     that only recognise the 'woff2-variations' alias. */
  src:
    url('/fonts/syne-variable-latin.woff2') format('woff2') tech('variations'),
    url('/fonts/syne-variable-latin.woff2') format('woff2-variations');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
    U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-display: swap;
  font-weight: 100 800;
  src:
    url('/fonts/jetbrains-mono-variable-latin.woff2') format('woff2') tech('variations'),
    url('/fonts/jetbrains-mono-variable-latin.woff2') format('woff2-variations');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
    U+2212, U+2215, U+FEFF, U+FFFD;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#root {
  min-height: 100vh;
  font-family: 'Syne', system-ui, sans-serif;
  color: var(--text);
  background: var(--bg);
  font-feature-settings: 'ss01' on, 'ss02' on;
  -webkit-font-smoothing: antialiased;
}

body {
  background-image:
    radial-gradient(ellipse 90% 45% at 50% -10%, rgba(0, 229, 176, 0.06) 0%, transparent 65%),
    radial-gradient(ellipse 60% 40% at 100% 100%, rgba(167, 139, 250, 0.04) 0%, transparent 60%),
    linear-gradient(rgba(255, 255, 255, 0.013) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.013) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 48px 48px, 48px 48px;
  background-attachment: fixed;
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-feature-settings: 'tnum' on;
}

/* Story 1.7 / UX-DR4 — visually-hidden text for screen readers. WCAG-recommended
   pattern; reused by GradePill (announces "Grade: A" instead of bare "A"). */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  /* `clip` is deprecated but kept for legacy engines; `clip-path` is the
     CSS Masking L1 replacement and is what modern browsers honour. */
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

button {
  font-family: inherit;
  cursor: pointer;
  border: none;
  background: none;
  color: inherit;
}

button:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.16);
}

/* ── Reusable global primitives — opt-in via className from any component ── */

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.card-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.card-body {
  padding: 18px;
}
.card-body.tight {
  padding: 14px 16px;
}

.label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-2);
  white-space: nowrap;
}
.pill.cyan {
  color: var(--cyan);
  border-color: rgba(0, 229, 176, 0.32);
  background: rgba(0, 229, 176, 0.06);
}
.pill.violet {
  color: var(--violet);
  border-color: rgba(167, 139, 250, 0.32);
  background: rgba(167, 139, 250, 0.06);
}
.pill.orange {
  color: var(--orange);
  border-color: rgba(251, 146, 60, 0.32);
  background: rgba(251, 146, 60, 0.06);
}
.pill.red {
  color: var(--red);
  border-color: rgba(244, 63, 94, 0.32);
  background: rgba(244, 63, 94, 0.06);
}
.pill.green {
  color: var(--green);
  border-color: rgba(52, 211, 153, 0.32);
  background: rgba(52, 211, 153, 0.06);
}
.pill.yellow {
  color: var(--yellow);
  border-color: rgba(251, 191, 36, 0.32);
  background: rgba(251, 191, 36, 0.06);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 8px var(--cyan);
}
.dot.violet {
  background: var(--violet);
  box-shadow: 0 0 8px var(--violet);
}
.dot.orange {
  background: var(--orange);
  box-shadow: 0 0 8px var(--orange);
}
.dot.red {
  background: var(--red);
  box-shadow: 0 0 8px var(--red);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-2);
  transition: all 0.15s ease;
}
.btn:hover {
  background: var(--card-hover);
  color: var(--text);
  border-color: var(--border-2);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn.primary {
  background: var(--cyan);
  color: #06151a;
  border-color: transparent;
  font-weight: 700;
  box-shadow: 0 0 0 1px rgba(0, 229, 176, 0.4), 0 8px 24px -8px rgba(0, 229, 176, 0.5);
}
.btn.primary:hover {
  background: #00f3bd;
  color: #06151a;
}
.btn.ghost {
  background: transparent;
}
.btn.sm {
  font-size: 11px;
  padding: 5px 10px;
}
.btn.violet {
  background: rgba(167, 139, 250, 0.1);
  color: var(--violet);
  border-color: rgba(167, 139, 250, 0.32);
}
.btn.violet:hover {
  background: rgba(167, 139, 250, 0.18);
  color: var(--violet);
}

/* ── Animations ───────────────────────────────────────────────────────── */

@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes fillW {
  from {
    width: 0;
  }
}
@keyframes fillH {
  from {
    height: 0;
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
@keyframes pulseGlow {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(0, 229, 176, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(0, 229, 176, 0);
  }
}
/* `eqBars` is a Spectr extension (not in mockup styles.css). Consumer:
   src/features/results/SpecialistTile.module.css `.eqDots > span`. Keep
   the keyframe name in sync if either side is renamed — CSS Modules do
   not scope @keyframes globals, so a silent break is possible. */
@keyframes eqBars {
  0%,
  100% {
    transform: scaleY(0.4);
  }
  50% {
    transform: scaleY(1);
  }
}

.fade-up {
  animation: fadeUp 0.45s ease both;
}
.fade-in {
  animation: fadeIn 0.3s ease both;
}
.fill-w {
  animation: fillW 0.75s cubic-bezier(0.4, 0, 0.2, 1) both;
}
.fill-h {
  animation: fillH 0.75s cubic-bezier(0.4, 0, 0.2, 1) both;
}
.pulse-glow {
  animation: pulseGlow 2.2s ease-in-out infinite;
}
.pulse-soft {
  animation: pulse 2s ease-in-out infinite;
}

/* Story 1.8 / Task 5 — EvidenceChips scroll-target highlight. Programmatically
   added to a verdict panel or tab body for ~1.4 s on EvidenceChip click. Sits
   in global.css so it's available everywhere without CSS Modules leakage. */
.sr-target-highlight {
  outline: 2px solid var(--cyan);
  outline-offset: 4px;
  transition: outline-color 0.3s ease;
}

/* Story 1.7 / UX-DR44 / AC6 — honor prefers-reduced-motion.
   Blanket pattern (WCAG recommended): collapse every animation + transition
   to imperceptible duration. We don't fully disable because some CSS
   transitions are load-bearing for layout (Radix dropdowns etc.); 0.001ms
   completes them synchronously without visible motion. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
}


================================================================================
===== FILE: components/frontend-spectr-v2/src/routes/_app/listen.$versionId.tsx =====
================================================================================

import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { getAccessToken } from '../../api/fetcher';
import {
  useCreateNote,
  useDeleteNote,
  useJobResults,
  useNotes,
  usePatchNote,
  useSong,
  useStemProposals,
  useVersion,
} from '../../api/hooks';
import {
  isFinalJson,
  type FinalJson,
  type Phase1Data,
  type Phase2Data,
  type Phase7Data,
} from '../../api/types';
import {
  LOOP_DEFAULT,
  PITCH_PANEL_DEFAULT,
  type LoopState,
  type PitchPanelState,
} from '../../features/listen/loop';
import { IssuesPanel } from '../../features/listen/IssuesPanel';
import { buildMeterCells } from '../../features/listen/meters';
import { MeterModule } from '../../features/listen/MeterModule';
import { NotesPanel, type UiNote } from '../../features/listen/NotesPanel';
import { PreviewTools } from '../../features/listen/PreviewTools';
import { RightRail } from '../../features/listen/RightRail';
import { StageDisplay, type VizState } from '../../features/listen/StageDisplay';
import { Fireworks, type FireworksHandle } from '../../features/listen/Fireworks';
import { RadialPulse, type RadialPulseHandle } from '../../features/listen/RadialPulse';
import { Spectrogram, type SpectrogramHandle } from '../../features/listen/Spectrogram';
import { LaserShow, type LaserShowHandle } from '../../features/listen/LaserShow';
import { DEFAULT_VIZ_STATE, VizControls } from '../../features/listen/VizControls';
import { PresetBar } from '../../features/listen/PresetBar';
import {
  loadPresets,
  removePreset,
  savePresets,
  upsertPreset,
  type VizPreset,
} from '../../features/listen/vizPresets';
import type { StageId } from '../../features/listen/stageRegistry';
import { buildRailTabs } from '../../features/listen/tabRegistry';
import { useAudioGraph, type AudioFrame } from '../../features/listen/useAudioGraph';
import { createBeatDetector } from '../../features/listen/beatDetector';
import { createFlashLimiter } from '../../features/listen/flashLimiter';
import { createDropDetector } from '../../features/listen/dropDetector';
import {
  barColorForHue,
  bgColorForHue,
  hueFromCentroid,
  spectralCentroidNorm,
} from '../../features/listen/autoColor';
import { StemDeck, type DeckStem } from '../../features/listen/StemDeck';
import { useStemEngine } from '../../features/listen/useStemEngine';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { fmtBpm, fmtGenre, fmtNumber } from '../../features/results/helpers/format';
import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { Pill } from '../../ui/Pill';
import s from './listen.module.css';

const search = z.object({
  verdict_id: z.string().optional(),
});

export const Route = createFileRoute('/_app/listen/$versionId')({
  validateSearch: search,
  component: ListenPage,
});

const SPECTRUM_BARS = 56;
const WAVEFORM_BARS = 240;

interface Section {
  name: string;
  /** Lower-cased section-type key. Falls through to the neutral color when
   *  not in SECTION_COLORS (e.g. unknown phase 7 labels). */
  type: string;
  startPct: number;
  endPct: number;
}

// Fallback used when phase 7 didn't produce sections — e.g. ambient mixes
// or skipped/failed phase. Keeps the scrubber visually meaningful instead
// of showing one flat empty bar.
const FALLBACK_SECTIONS: Section[] = [
  { name: 'Intro', type: 'intro', startPct: 0, endPct: 0.12 },
  { name: 'Buildup', type: 'buildup', startPct: 0.12, endPct: 0.36 },
  { name: 'Drop', type: 'drop', startPct: 0.36, endPct: 0.62 },
  { name: 'Breakdown', type: 'breakdown', startPct: 0.62, endPct: 0.84 },
  { name: 'Outro', type: 'outro', startPct: 0.84, endPct: 1 },
];

function sectionsFromPhase7(
  phase7: Phase7Data | undefined,
  fallbackDuration: number,
): Section[] {
  const scores = phase7?.section_scores;
  if (!scores || scores.length === 0) return FALLBACK_SECTIONS;
  const total =
    phase7?.total_duration && phase7.total_duration > 0
      ? phase7.total_duration
      : fallbackDuration > 0
        ? fallbackDuration
        : scores[scores.length - 1]?.end_time ?? 0;
  if (!total || total <= 0) return FALLBACK_SECTIONS;
  return scores.map((sec) => ({
    name: sec.section_type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    type: sec.section_type.toLowerCase(),
    startPct: Math.max(0, Math.min(1, sec.start_time / total)),
    endPct: Math.max(0, Math.min(1, sec.end_time / total)),
  }));
}


// Neutral frame fed to buildMeterCells before the first rAF frame lands (or
// while paused). Mirrors the AudioFrame shape from useAudioGraph.
const ZERO_FRAME: AudioFrame = {
  fftBins: new Float32Array(0),
  bandAverages: new Float32Array(0),
  rmsDb: -Infinity,
  lufsShort: -Infinity,
  truePeakDb: -Infinity,
  correlation: 0,
  scopeL: new Float32Array(0),
  scopeR: new Float32Array(0),
};

function ListenPage() {
  const { versionId } = Route.useParams();
  const { verdict_id } = Route.useSearch();
  const { data: version, isLoading: versionLoading, error: versionError } = useVersion(versionId);
  const { data: song } = useSong(version?.songId ?? '');
  const latestJobId = song?.latestResult?.jobId;
  const { data: results } = useJobResults(latestJobId ?? '', Boolean(latestJobId));

  const fj: FinalJson = isFinalJson(results?.finalJson) ? results.finalJson : {};
  const phase1 = pickPhase<Phase1Data>(fj, 1);
  const phase2 = pickPhase<Phase2Data>(fj, 2);
  const phase7 = pickPhase<Phase7Data>(fj, 7);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graph = useAudioGraph(audioRef);

  // DEV-ONLY smoke harness: expose the audio-graph handle on window so the engine
  // can be exercised from the browser console without the full UI. Open the Listen
  // page for a version with audio, then drive every module per PRPs/listen-smoke-script.md
  // (e.g. __spectrGraph.ensureContext(); __spectrGraph.setEffectParams('gate',{enabled:true})).
  // `import.meta.env.DEV` is false in production builds, so this is dead-code-eliminated.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __spectrGraph?: typeof graph }).__spectrGraph = graph;
  }, [graph]);

  // ── Visualizer (StageDisplay) state ──
  const [stage, setStage] = useState<StageId>('eq');
  const [viz, setViz] = useState<VizState>(DEFAULT_VIZ_STATE);
  const fireworksRef = useRef<FireworksHandle | null>(null);
  const patchViz = useCallback((p: Partial<VizState>) => setViz((v) => ({ ...v, ...p })), []);

  // ── Snapshot presets (persisted to localStorage) ──
  const [presets, setPresets] = useState<VizPreset[]>(() => loadPresets());

  // ── Audio-reactive laser wiring ──
  // The visualizer root receives reactive CSS vars (--laser-pulse / --beat-flash)
  // written imperatively from the rAF loop — no per-frame React state. Beat
  // onsets come from the band-energy detector; every FLASH routes through one
  // shared ≤3 Hz limiter (photosensitivity safety). reduced-motion freezes it.
  const stageRootRef = useRef<HTMLDivElement | null>(null);
  const radialRef = useRef<RadialPulseHandle | null>(null);
  const spectroRef = useRef<SpectrogramHandle | null>(null);
  const laserShowRef = useRef<LaserShowHandle | null>(null);
  const laserClearedRef = useRef(true);
  const beatDetectorRef = useRef(createBeatDetector());
  const dropDetectorRef = useRef(createDropDetector());
  const flashLimiterRef = useRef(createFlashLimiter());
  const pulseEnvRef = useRef(0); // smooth beam pulse envelope 0..1 (motion)
  const flashEnvRef = useRef(0); // capped flash envelope 0..1 (photosensitive)
  // Auto-color state: throttled hue, smoothed, plus the live color string the
  // radial canvas reads (so auto-color also tints the radial visualizer).
  const autoHueRef = useRef(140);
  const autoColorValRef = useRef(viz.barColor);
  const lastHueTsRef = useRef(0);
  const reduceMotion = useReducedMotion();
  // Mirror reactive-relevant state into refs so the rAF loop (deps [playing,
  // graph]) reads the latest without re-subscribing every render.
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const laserOnRef = useRef(viz.laserOn);
  laserOnRef.current = viz.laserOn;
  const laserEffectRef = useRef(viz.laserEffect);
  laserEffectRef.current = viz.laserEffect;
  const laserIntensityRef = useRef(viz.laserIntensity);
  laserIntensityRef.current = viz.laserIntensity;
  const laserMonoRef = useRef(viz.laserMono);
  laserMonoRef.current = viz.laserMono;
  const laserColorRef = useRef(viz.laserColor);
  laserColorRef.current = viz.laserColor;
  const barColorRef = useRef(viz.barColor);
  barColorRef.current = viz.barColor;
  const autoColorRef = useRef(viz.autoColor);
  autoColorRef.current = viz.autoColor;
  const dropFxRef = useRef(viz.dropFx);
  dropFxRef.current = viz.dropFx;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const vizRef = useRef(viz);
  vizRef.current = viz;

  // Preset save/recall/delete. Recall crossfades the visualizer (dim → swap →
  // restore) unless reduced-motion is on, in which case it swaps instantly.
  const savePreset = useCallback((name: string) => {
    setPresets((prev) => {
      const next = upsertPreset(prev, { name, viz: vizRef.current, stage: stageRef.current });
      savePresets(next);
      return next;
    });
  }, []);
  const deletePreset = useCallback((name: string) => {
    setPresets((prev) => {
      const next = removePreset(prev, name);
      savePresets(next);
      return next;
    });
  }, []);
  const recallPreset = useCallback((p: VizPreset) => {
    // Merge over defaults so presets saved before a field existed still apply.
    const apply = () => {
      setViz({ ...DEFAULT_VIZ_STATE, ...p.viz });
      setStage(p.stage);
    };
    const root = stageRootRef.current;
    if (!root || reduceMotionRef.current) {
      apply();
      return;
    }
    root.style.transition = 'opacity 0.2s ease';
    root.style.opacity = '0.2';
    window.setTimeout(() => {
      apply();
      root.style.opacity = '1';
      window.setTimeout(() => {
        root.style.transition = '';
      }, 220);
    }, 190);
  }, []);
  // Energy macro as a 0..2 multiplier (50% = ×1), mirrored for the loop.
  const energyMulRef = useRef(1);
  energyMulRef.current = Math.max(0, Math.min(2, viz.energy / 50));

  // Half-beat pulse drives the visualizer's --beat CSS var (~0.484s @124 BPM).
  const bpm = Math.max(1, phase2?.bpm ?? phase1?.bpm ?? 124);
  const beatSeconds = 60 / bpm / 2;

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number>(phase1?.duration_seconds ?? 0);
  const [volume, setVolume] = useState(0.8);
  const [loop, setLoop] = useState<LoopState>(LOOP_DEFAULT);
  const [pitch, setPitch] = useState<PitchPanelState>(PITCH_PANEL_DEFAULT);
  // True while the audio buffer source (pitch lane) is driving playback
  // instead of the MediaElement. Owned by the page so transport ops know
  // which lane to operate on.
  const pitchModeRef = useRef(false);

  // ── Stem deck (DJ tab) ── real per-stem audio, mutually exclusive with the
  // single-track graph. Backed by the existing stems pipeline (GetStems +
  // /stems/{stemId}/audio); stems are id-keyed (per-stem mode allows multiple
  // stems per role).
  const { data: stemProposals, isLoading: stemsLoading } = useStemProposals(
    versionId,
    Boolean(versionId),
  );
  const deckStems = useMemo<DeckStem[]>(
    () =>
      (stemProposals?.stems ?? []).map((st) => ({
        id: st.id,
        role: st.confirmedRole ?? st.detectedRole ?? null,
        filename: st.originalFilename,
      })),
    [stemProposals],
  );
  const stemEngine = useStemEngine(() => graph.ensureContext());
  const [stemPlaying, setStemPlaying] = useState(false);
  const stemUrl = useCallback(
    (stemId: string) =>
      `/api/versions/${versionId}/stems/${stemId}/audio?t=${encodeURIComponent(getAccessToken() ?? '')}`,
    [versionId],
  );
  // Entering stem mode pauses the single-track lanes (MediaElement + pitch).
  const activateStemMode = useCallback(() => {
    if (pitchModeRef.current && graph.pitchPlaying()) graph.pitchPause();
    const a = audioRef.current;
    if (a && !a.paused) a.pause();
    setPlaying(false);
  }, [graph]);
  // Reverse exclusivity: starting the single-track audio stops the stem deck.
  const stopStems = () => {
    setStemPlaying((prev) => {
      if (prev) stemEngine.pause();
      return false;
    });
  };

  // Throttle gate for the rail's meter frame so the rail subtree doesn't
  // reconcile at the 60fps spectrum cadence. Updated to ~12 Hz in the draw loop.
  const lastMeterTsRef = useRef(0);

  const audioUrl = useMemo(() => {
    if (!versionId) return null;
    const token = getAccessToken();
    if (!token) return null;
    return `/api/versions/${versionId}/audio?t=${encodeURIComponent(token)}`;
  }, [versionId]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPosition(a.currentTime);
    const onDuration = () => {
      if (Number.isFinite(a.duration)) setDuration(a.duration);
    };
    const onEnd = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      toast.error('Could not load audio. Try refreshing.');
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onDuration);
    a.addEventListener('durationchange', onDuration);
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onDuration);
      a.removeEventListener('durationchange', onDuration);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('error', onError);
    };
  }, [audioUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = volume;
  }, [volume]);

  // ── Pitch lane wiring ──
  // The audio graph owns a BufferSource lane; when pitch is enabled the page
  // pauses the MediaElement and drives playback via the graph instead. The
  // <audio> tag continues to own duration + the visible URL.

  const handlePitchChange = (next: PitchPanelState) => {
    setPitch(next);
  };

  // Apply detune to the live BufferSource whenever semitones/cents change.
  useEffect(() => {
    if (pitch.enabled) graph.setPitchDetune(pitch.semitones, pitch.cents);
  }, [pitch.semitones, pitch.cents, pitch.enabled, graph]);

  // Enter/exit pitch mode in response to the toggle. Decoding can take a few
  // seconds on long FLACs — we surface a "DECODING…" state on the toggle.
  useEffect(() => {
    let cancelled = false;
    const a = audioRef.current;
    if (!a || !audioUrl) return undefined;

    if (pitch.enabled && !pitchModeRef.current) {
      const wasPlaying = !a.paused;
      const startedAt = a.currentTime;
      a.pause();
      setPlaying(false);
      try {
        graph.ensureContext();
      } catch (err) {
        toast.error(`Audio engine failed: ${err instanceof Error ? err.message : err}`);
        setPitch({ ...pitch, enabled: false });
        return undefined;
      }
      setPitch((p) => ({ ...p, decoding: true, decodeError: null }));
      graph
        .enterPitchMode(audioUrl, startedAt)
        .then(() => {
          if (cancelled) return;
          pitchModeRef.current = true;
          setPitch((p) => ({ ...p, decoding: false }));
          // Once decode is done, switch the page's duration display over to
          // the BufferSource duration (sample-accurate, doesn't get reset
          // by token rotations).
          const bufDur = graph.pitchDuration();
          if (bufDur > 0) setDuration(bufDur);
          setPosition(startedAt);
          graph.setPitchDetune(pitch.semitones, pitch.cents);
          if (wasPlaying) {
            graph.pitchResume();
            setPlaying(true);
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setPitch((p) => ({ ...p, decoding: false, enabled: false, decodeError: message }));
          toast.error(`Pitch decode failed: ${message}`);
        });
    } else if (!pitch.enabled && pitchModeRef.current) {
      const wasPlaying = graph.pitchPlaying();
      const pos = graph.exitPitchMode();
      pitchModeRef.current = false;
      a.currentTime = pos;
      setPosition(pos);
      if (wasPlaying) {
        a.play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false));
      }
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch.enabled, audioUrl, graph]);

  // Drive position updates while pitch mode is playing — BufferSource has no
  // timeupdate event, so we tick on rAF using graph.pitchCurrentTime().
  useEffect(() => {
    if (!pitch.enabled || !pitchModeRef.current) return undefined;
    let raf = 0;
    const tick = () => {
      // Always read the current playhead — even paused — so the timecode
      // doesn't get stuck showing 0:00 when the MediaElement timeupdate
      // handler stops firing.
      setPosition(graph.pitchCurrentTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pitch.enabled, graph]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    // Pitch-mode path uses the BufferSource lane.
    if (pitch.enabled && pitchModeRef.current) {
      if (graph.pitchPlaying()) {
        graph.pitchPause();
        setPlaying(false);
      } else {
        try {
          graph.ensureContext();
        } catch (err) {
          toast.error(`Audio engine failed: ${err instanceof Error ? err.message : err}`);
          return;
        }
        stopStems();
        graph.pitchResume();
        setPlaying(true);
      }
      return;
    }
    // Default path: MediaElement.
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    stopStems();
    try {
      graph.ensureContext();
    } catch (err) {
      toast.error(`Audio engine failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    a.play()
      .then(() => setPlaying(true))
      .catch((err) => {
        toast.error(`Playback failed: ${err.message ?? err}`);
        setPlaying(false);
      });
  };

  const seek = useCallback(
    (pct: number) => {
      // Drop the rolling beat/drop averages so the detectors don't fire a
      // phantom event from the energy discontinuity right after a jump.
      beatDetectorRef.current.reset();
      dropDetectorRef.current.reset();
      const dur = pitch.enabled && pitchModeRef.current
        ? graph.pitchDuration()
        : Number.isFinite(audioRef.current?.duration ?? NaN)
          ? audioRef.current!.duration
          : duration;
      const t = Math.max(0, Math.min(1, pct)) * dur;
      if (pitch.enabled && pitchModeRef.current) {
        graph.pitchSeek(t);
        setPosition(t);
        return;
      }
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = t;
      setPosition(t);
    },
    [pitch.enabled, graph, duration],
  );

  // ── Real-audio reactive state (rAF loop reads from AudioGraph) ──
  const [spectrumValues, setSpectrumValues] = useState<number[]>(
    () => Array.from({ length: SPECTRUM_BARS }, () => 0),
  );
  // Full live frame captured for the rail's Meters tab (buildMeterCells).
  const [meterFrame, setMeterFrame] = useState<AudioFrame | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const draw = () => {
      const frame = graph.readFrame();
      const nowMs = performance.now();
      if (nowMs - lastMeterTsRef.current >= 80) {
        lastMeterTsRef.current = nowMs;
        setMeterFrame(frame);
      }

      // ── Beat detection (shared by the laser + radial visualizers) ──
      // Run once per frame whenever there's motion to drive. Reduced-motion
      // freezes everything, so we skip detection (and animation) entirely.
      const reduced = reduceMotionRef.current;
      let beatNow = false;
      if (!reduced && frame.bandAverages.length > 0) {
        const b = beatDetectorRef.current.push(frame.bandAverages, nowMs);
        beatNow = b.beat;

        // ── Drop detection → one-shot "moment" (fireworks + max laser) ──
        if (dropFxRef.current && dropDetectorRef.current.push(b.energy, nowMs).drop) {
          fireworksRef.current?.launch();
          pulseEnvRef.current = 1;
          if (flashLimiterRef.current.allow(nowMs)) flashEnvRef.current = 1;
        }
      }

      // ── Auto-color: hue from spectral centroid, throttled to ~11 Hz ──
      const stageRoot = stageRootRef.current;
      if (autoColorRef.current && !reduced && frame.fftBins.length > 0 && nowMs - lastHueTsRef.current >= 90) {
        lastHueTsRef.current = nowMs;
        const targetHue = hueFromCentroid(spectralCentroidNorm(frame.fftBins));
        // Smooth so the color glides instead of jumping frame-to-frame.
        autoHueRef.current += (targetHue - autoHueRef.current) * 0.2;
        const hue = autoHueRef.current;
        autoColorValRef.current = barColorForHue(hue);
        if (stageRoot) {
          stageRoot.style.setProperty('--viz-bar', autoColorValRef.current);
          stageRoot.style.setProperty('--viz-bg', bgColorForHue(hue));
        }
      }

      // ── Beat pulse envelope (shared by the laser show + radial visualizer) ──
      if (beatNow) pulseEnvRef.current = 1;
      pulseEnvRef.current *= 0.86; // ~exp decay (~160ms tail @60fps)

      // ── Laser show (Canvas beam-fan engine) ──
      if (laserOnRef.current && !reduced) {
        // Full-field white flash is the photosensitivity-sensitive channel, so
        // it stays capped at ≤3 Hz; only flash/beat effects use it.
        const fx = laserEffectRef.current;
        if (beatNow && (fx === 'flash' || fx === 'beat') && flashLimiterRef.current.allow(nowMs)) {
          flashEnvRef.current = 1;
        }
        flashEnvRef.current *= 0.8;
        laserShowRef.current?.draw({
          t: nowMs,
          beat: beatNow,
          pulse: pulseEnvRef.current,
          flash: flashEnvRef.current,
          intensity: laserIntensityRef.current / 100,
          mono: laserMonoRef.current,
          color: laserColorRef.current,
          effect: fx,
          energyMul: energyMulRef.current,
        });
        laserClearedRef.current = false;
      } else if (!laserClearedRef.current) {
        // Laser off / reduced-motion: blank the canvas once (frozen frame).
        flashEnvRef.current = 0;
        laserShowRef.current?.clear();
        laserClearedRef.current = true;
      }

      if (frame.fftBins.length > 0) {
        const bins = frame.fftBins;
        // Down-sample the FFT to SPECTRUM_BARS bars using log-spaced bins so
        // bass doesn't dominate visually.
        const next = new Array<number>(SPECTRUM_BARS);
        const minLog = Math.log10(1);
        const maxLog = Math.log10(bins.length);
        for (let i = 0; i < SPECTRUM_BARS; i += 1) {
          const lo = Math.floor(10 ** (minLog + (i / SPECTRUM_BARS) * (maxLog - minLog)));
          const hi = Math.max(
            lo + 1,
            Math.floor(10 ** (minLog + ((i + 1) / SPECTRUM_BARS) * (maxLog - minLog))),
          );
          let sum = 0;
          for (let j = lo; j < hi && j < bins.length; j += 1) sum += bins[j];
          next[i] = Math.min(1, (sum / Math.max(1, hi - lo)) * 1.4);
        }
        setSpectrumValues(next);

        // Drive the radial-pulse canvas from the SAME spectrum array — one
        // shared loop, no second readFrame. Reduced-motion leaves the canvas
        // frozen on its last frame (the loop simply stops feeding it).
        if (stageRef.current === 'radial' && !reduced) {
          const radialColor = autoColorRef.current
            ? autoColorValRef.current
            : barColorRef.current;
          radialRef.current?.draw(
            next,
            pulseEnvRef.current,
            beatNow,
            radialColor,
            energyMulRef.current,
          );
        } else if (stageRef.current === 'spectro' && !reduced) {
          // Spectrogram reads the full-resolution FFT, not the downsampled bars.
          spectroRef.current?.draw(frame.fftBins, energyMulRef.current);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, graph]);

  // Idle laser: when the laser is on but nothing is playing, keep the fan
  // gently sweeping (no beats) so it doesn't sit blank. During playback the
  // main loop above drives it reactively instead.
  useEffect(() => {
    if (!viz.laserOn || playing || reduceMotion) return undefined;
    let raf = 0;
    const tick = () => {
      laserShowRef.current?.draw({
        t: performance.now(),
        beat: false,
        pulse: 0,
        flash: 0,
        intensity: viz.laserIntensity / 100,
        mono: viz.laserMono,
        color: viz.laserColor,
        effect: viz.laserEffect,
        energyMul: viz.energy / 50,
      });
      laserClearedRef.current = false;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    viz.laserOn,
    playing,
    reduceMotion,
    viz.laserIntensity,
    viz.laserMono,
    viz.laserColor,
    viz.laserEffect,
    viz.energy,
  ]);

  // Real section layout from phase 7 (or fallback when phase 7 is missing).
  const sections = useMemo(
    () => sectionsFromPhase7(phase7, duration),
    [phase7, duration],
  );

  // Procedural waveform for the scrubber — visual scaffolding, NOT the real
  // audio buffer. Real peaks require a server-side peaks file or client-side
  // OfflineAudioContext decode (handled in a separate slice). We bias the
  // amplitude by section type so drops/choruses read louder than intros.
  const waveform = useMemo(() => {
    return Array.from({ length: WAVEFORM_BARS }, (_, i) => {
      const pct = i / WAVEFORM_BARS;
      const sec = sections.find((s) => pct >= s.startPct && pct < s.endPct);
      const amp =
        sec?.type === 'drop' || sec?.type === 'chorus'
          ? 0.95
          : sec?.type === 'buildup'
            ? 0.7
            : sec?.type === 'breakdown'
              ? 0.55
              : 0.4;
      const noise = Math.sin(i * 0.7) * 0.3 + Math.sin(i * 2.3) * 0.18 + 0.5;
      return amp * (0.4 + noise * 0.6);
    });
  }, [sections]);

  const { data: serverNotes } = useNotes(versionId);
  const createNote = useCreateNote(versionId);
  const patchNote = usePatchNote(versionId);
  const deleteNote = useDeleteNote(versionId);
  const [activeNote, setActiveNote] = useState<string | null>(null);

  // Project the server's absolute-time notes into the scrubber's pct-of-duration
  // shape. Falls back to 0% when duration is still loading so newly created
  // notes don't jump position once metadata resolves.
  const notes: UiNote[] = useMemo(() => {
    const d = duration > 0 ? duration : 1;
    return (serverNotes ?? []).map((n) => ({
      id: n.id,
      timePct: Math.max(0, Math.min(1, n.tSeconds / d)),
      body: n.text,
      pinned: n.pinned,
    }));
  }, [serverNotes, duration]);

  const handleAddNote = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      createNote.mutate(
        { tSeconds: Math.max(0, position), text: t, pinned: false },
        {
          onSuccess: () => {
            toast.success('Note saved');
          },
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : 'Could not save note'),
        },
      );
    },
    [createNote, position],
  );

  const handleTogglePin = useCallback(
    (id: string, currentlyPinned: boolean) => {
      patchNote.mutate({ noteId: id, body: { pinned: !currentlyPinned } });
    },
    [patchNote],
  );

  const handleDeleteNote = useCallback(
    (id: string) => {
      deleteNote.mutate(id, {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not delete note'),
      });
    },
    [deleteNote],
  );

  // Seek to a note via the same `seek(pct)` path the scrubber uses (handles
  // both the MediaElement and pitch-lane cases).
  const handleSeekToNote = useCallback(
    (id: string) => {
      const n = notes.find((x) => x.id === id);
      if (!n) return;
      setActiveNote(id);
      seek(n.timePct);
    },
    [notes, seek],
  );

  const [activeTool, setActiveTool] = useState<string | null>(null);
  useEffect(() => {
    if (verdict_id) toast.info('Preset handoff from Coach not yet wired.');
  }, [verdict_id]);

  // ── Right rail (Meters · Issues · DJ · Notes) ──
  // Each panel node + the tab set is memoized so the 60fps spectrum re-renders
  // don't rebuild the rail subtree. meterFrame is throttled to ~12 Hz, so the
  // meters panel reconciles at that lower cadence. GR is null until a later
  // plan wires live compressor reduction.
  const meterCells = useMemo(
    () => buildMeterCells({ frame: meterFrame ?? ZERO_FRAME, phase1: phase1 ?? {}, grReductionDb: null }),
    [meterFrame, phase1],
  );
  // NotesPanel only uses position for the "@time" label on its add-row, so we
  // pass whole-second precision to avoid rebuilding it on every position tick
  // (position updates at 60fps while pitch mode is active).
  const notePosition = Math.floor(position);
  const metersNode = useMemo(() => <MeterModule cells={meterCells} variant="panel" />, [meterCells]);
  const issuesNode = useMemo(() => <IssuesPanel jobId={latestJobId} />, [latestJobId]);
  const djNode = useMemo(
    () => (
      <>
        <StemDeck
          stems={deckStems}
          isLoading={stemsLoading}
          stemUrl={stemUrl}
          engine={stemEngine}
          playing={stemPlaying}
          onActivate={activateStemMode}
          onPlayPause={setStemPlaying}
        />
        <VizControls
          viz={viz}
          onChange={patchViz}
          onLaunchFireworks={() => fireworksRef.current?.launch()}
        />
        <PresetBar
          presets={presets}
          onSave={savePreset}
          onRecall={recallPreset}
          onDelete={deletePreset}
        />
      </>
    ),
    [deckStems, stemsLoading, stemUrl, stemEngine, stemPlaying, activateStemMode, viz, patchViz,
      presets, savePreset, recallPreset, deletePreset],
  );
  const notesNode = useMemo(
    () => (
      <NotesPanel
        notes={notes}
        duration={duration}
        position={notePosition}
        activeNote={activeNote}
        pending={createNote.isPending}
        onSeekToNote={handleSeekToNote}
        onAdd={handleAddNote}
        onTogglePin={handleTogglePin}
        onDelete={handleDeleteNote}
      />
    ),
    [notes, duration, notePosition, activeNote, createNote.isPending, handleSeekToNote, handleAddNote, handleTogglePin, handleDeleteNote],
  );
  const railTabs = useMemo(
    () => buildRailTabs({ meters: metersNode, issues: issuesNode, dj: djNode, notes: notesNode }),
    [metersNode, issuesNode, djNode, notesNode],
  );

  // ── StageDisplay slot nodes ──
  // Memoized so the 60fps spectrum re-renders (spectrumValues state) don't
  // rebuild the meter overlay, the fireworks canvas, or the info content.
  const meterOverlayNode = useMemo(
    () => <MeterModule cells={meterCells} variant="overlay" defaultCollapsed />,
    [meterCells],
  );
  const fireworksNode = useMemo(() => <Fireworks ref={fireworksRef} />, []);
  const radialNode = useMemo(() => <RadialPulse ref={radialRef} />, []);
  const spectroNode = useMemo(() => <Spectrogram ref={spectroRef} />, []);
  const laserNode = useMemo(() => <LaserShow ref={laserShowRef} />, []);
  const infoContentNode = useMemo(
    () => (
      <>
        <h2>{song?.name ?? 'Untitled'}</h2>
        <p>{version?.label ?? (version ? `v${version.versionNumber}` : '')}</p>
      </>
    ),
    [song?.name, version],
  );

  if (versionLoading) {
    return (
      <div className={s.page}>
        <p className={`mono ${s.status}`}>Loading…</p>
      </div>
    );
  }
  if (versionError || !version) {
    return (
      <div className={s.page}>
        <Link to="/library" className={s.backLink}>← Library</Link>
        <p className={s.error}>Version not found.</p>
      </div>
    );
  }

  const trackName = song?.name ?? `Version ${version.versionNumber}`;
  const hue = song?.id ? hueFromId(song.id) : 168;
  const positionPct = duration > 0 ? position / duration : 0;
  return (
    <div className={s.page}>
      <section className={s.trackHeader}>
        <CoverArt hue={hue} size="md" />
        <div className={s.titleBlock}>
          <div className={s.trackName}>{trackName}</div>
          <div className={s.nowPlayingRow}>
            <span className="dot pulse-soft" />
            <span className={s.nowPlaying}>Now playing</span>
            {version.label && <span className={s.subLabel}>· {version.label}</span>}
          </div>
        </div>
        <div className={s.pillRow}>
          {phase2?.genre && <Pill tone="cyan">{fmtGenre(phase2.genre)}</Pill>}
          {phase1?.bpm != null && <Pill><span className="mono">{fmtBpm(phase1.bpm)}</span> BPM</Pill>}
          {phase1?.detected_key && <Pill><span className="mono">{phase1.detected_key}</span></Pill>}
          {phase1?.lufs != null && <Pill><span className="mono">{fmtNumber(phase1.lufs, 1)}</span> LUFS</Pill>}
          <Pill><span className="mono">v{version.versionNumber}</span></Pill>
        </div>
        <div className={s.stripSpacer} />
        <div className={s.headerRight}>
          {song && latestJobId && (
            <Link
              to="/songs/$songId/results/$jobId"
              params={{ songId: song.id, jobId: latestJobId }}
              className="btn sm"
            >
              View Report →
            </Link>
          )}
        </div>
      </section>

      <div className={s.mainGrid}>
        <div className={s.centerCol}>
          <section className={s.hero}>
            <StageDisplay
              stage={stage}
              onStageChange={setStage}
              spectrumValues={spectrumValues}
              beatSeconds={beatSeconds}
              viz={viz}
              meterOverlay={meterOverlayNode}
              fireworks={fireworksNode}
              radial={radialNode}
              spectro={spectroNode}
              laser={laserNode}
              infoContent={infoContentNode}
              rootRef={stageRootRef}
            />

            <div className={s.heroTransport}>
              <Scrubber
                waveform={waveform}
                positionPct={positionPct}
                duration={duration}
                notes={notes}
                loop={loop}
                onSeek={seek}
                onNoteClick={(id) => setActiveNote(id)}
                activeNote={activeNote}
              />
              <div className={s.transportRow}>
                <div className={s.transportGroup}>
                  <button type="button" className={s.transportBtn} onClick={() => seek(Math.max(0, positionPct - 0.05))} aria-label="Back 5%">⏮</button>
                  <button
                    type="button"
                    className={s.playBig}
                    data-playing={playing}
                    onClick={togglePlay}
                    disabled={!audioUrl}
                    aria-label={playing ? 'Pause' : 'Play'}
                  >
                    {playing ? '⏸' : '▶'}
                  </button>
                  <button type="button" className={s.transportBtn} onClick={() => seek(Math.min(1, positionPct + 0.05))} aria-label="Forward 5%">⏭</button>
                </div>
                <div className={s.timecodeBlock}>
                  <span className={s.tcNow}>{formatTime(position)}</span>
                  <span className={s.tcSep}>/</span>
                  <span className={s.tcTotal}>{formatTime(duration)}</span>
                </div>
                <div className={s.volumeWrap}>
                  <span className={s.volumeIcon}>VOL</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className={s.volumeSlider}
                    aria-label="Volume"
                  />
                  <span className={`${s.volumeIcon} mono`}>{Math.round(volume * 100)}</span>
                </div>
                <div className={s.transportSpacer} />
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => handleAddNote(`Note @ ${formatTime(position)}`)}
                  disabled={!duration || createNote.isPending}
                >
                  + Note @ time
                </button>
              </div>
            </div>
          </section>

          <div className={s.toolStrip}>
            <PreviewTools
              graph={graph}
              activeTool={activeTool}
              onActiveToolChange={setActiveTool}
              loop={loop}
              onLoopChange={setLoop}
              audioRef={audioRef}
              currentTime={position}
              duration={duration}
              pitch={pitch}
              onPitchChange={handlePitchChange}
            />
          </div>
        </div>

        <aside className={s.railCol}>
          <RightRail tabs={railTabs} defaultTab="meters" />
        </aside>
      </div>

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" crossOrigin="anonymous" />
      )}
    </div>
  );
}

interface ScrubberProps {
  waveform: number[];
  positionPct: number;
  duration: number;
  notes: UiNote[];
  loop: LoopState;
  onSeek: (pct: number) => void;
  onNoteClick: (id: string) => void;
  activeNote: string | null;
}

function Scrubber({
  waveform,
  positionPct,
  duration,
  notes,
  loop,
  onSeek,
  onNoteClick,
  activeNote,
}: ScrubberProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek((e.clientX - rect.left) / rect.width);
  };
  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverPct((e.clientX - rect.left) / rect.width);
  };

  const loopInPct = loop.inSec != null && duration > 0 ? loop.inSec / duration : null;
  const loopOutPct = loop.outSec != null && duration > 0 ? loop.outSec / duration : null;

  return (
    <div className={s.scrubber}>
      <div
        ref={ref}
        className={s.waveform}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverPct(null)}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(positionPct * 100)}
        tabIndex={0}
      >
        {waveform.map((v, i) => (
          <div
            key={i}
            className={s.waveBar}
            data-played={i / waveform.length <= positionPct}
            style={{ height: `${v * 100}%` }}
          />
        ))}
        {loopInPct != null && loopOutPct != null && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${loopInPct * 100}%`,
              width: `${(loopOutPct - loopInPct) * 100}%`,
              background: 'rgba(167, 139, 250, 0.18)',
              border: '1px solid var(--violet)',
              borderRadius: 4,
              pointerEvents: 'none',
            }}
          />
        )}
        {hoverPct != null && duration > 0 && (
          <div className={s.waveTooltip} style={{ left: `${hoverPct * 100}%` }}>
            {formatTime(hoverPct * duration)}
          </div>
        )}
      </div>
      <div className={s.notesRow}>
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={s.noteMarker}
            data-pinned={n.pinned}
            style={{ left: `${n.timePct * 100}%`, opacity: activeNote === n.id ? 1 : 0.7 }}
            onClick={() => onNoteClick(n.id)}
            title={n.body}
          >
            {n.pinned ? '★' : '·'}
          </button>
        ))}
      </div>
    </div>
  );
}

function pickPhase<T>(fj: FinalJson, phaseNumber: number): T | undefined {
  return fj.phases?.find((p) => p.phase === phaseNumber)?.data as T | undefined;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}


================================================================================
===== FILE: components/frontend-spectr-v2/src/features/listen/PreviewTools.tsx =====
================================================================================

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import type {
  AudioGraphHandle,
  CompressorState,
  EqBand,
  SaturationState,
  WidthState,
} from './useAudioGraph';
import {
  COMPRESSOR_DEFAULT,
  EQ_BANDS_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
} from './useAudioGraph';
import { LOOP_DEFAULT, type LoopState, type PitchPanelState } from './loop';
import s from './PreviewTools.module.css';

interface PreviewToolsProps {
  graph: AudioGraphHandle;
  activeTool: string | null;
  onActiveToolChange: (id: string | null) => void;
  loop: LoopState;
  onLoopChange: (next: LoopState) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  duration: number;
  pitch: PitchPanelState;
  onPitchChange: (next: PitchPanelState) => void;
}

interface PreviewTool {
  id: 'eq' | 'comp' | 'sat' | 'ms' | 'lim' | 'pitch' | 'loop' | 'scope';
  label: string;
  glyph: string;
  sub: string;
  tier: 'v1' | 'v2';
  accent: string;
}

const TOOLS: PreviewTool[] = [
  { id: 'eq', label: 'EQ', glyph: 'EQ', sub: '8-band parametric', tier: 'v1', accent: '#00e5b0' },
  { id: 'comp', label: 'Compressor', glyph: '◐', sub: 'Threshold · ratio', tier: 'v1', accent: '#fbbf24' },
  { id: 'sat', label: 'Saturation', glyph: '~', sub: 'Tanh drive', tier: 'v1', accent: '#fb923c' },
  { id: 'ms', label: 'M/S Width', glyph: '◭', sub: 'Mid / side balance', tier: 'v1', accent: '#60a5fa' },
  { id: 'lim', label: 'Limiter', glyph: '|', sub: 'Brickwall', tier: 'v2', accent: '#f43f5e' },
  { id: 'pitch', label: 'Pitch', glyph: '#', sub: 'Cents · semitones', tier: 'v1', accent: '#a78bfa' },
  { id: 'loop', label: 'Loop', glyph: '⟲', sub: 'Section loop', tier: 'v1', accent: '#a78bfa' },
  { id: 'scope', label: 'Scope', glyph: '◎', sub: 'Goniometer · phase', tier: 'v1', accent: '#34d399' },
];

export function PreviewTools({
  graph,
  activeTool,
  onActiveToolChange,
  loop,
  onLoopChange,
  audioRef,
  currentTime,
  pitch,
  onPitchChange,
}: PreviewToolsProps) {
  const [eqBands, setEqBands] = useState<EqBand[]>(() =>
    EQ_BANDS_DEFAULT.map((b) => ({ ...b })),
  );
  const [eqEnabled, setEqEnabled] = useState(false);
  const [comp, setComp] = useState<CompressorState>({ ...COMPRESSOR_DEFAULT });
  const [sat, setSat] = useState<SaturationState>({ ...SATURATION_DEFAULT });
  const [width, setWidth] = useState<WidthState>({ ...WIDTH_DEFAULT });
  const [bypass, setBypass] = useState(false);

  // Mirror state into the audio graph whenever it changes.
  useEffect(() => {
    eqBands.forEach((b, i) => graph.setEqBand(i, eqEnabled ? b.gainDb : 0));
  }, [eqBands, eqEnabled, graph]);

  useEffect(() => {
    graph.setCompressor(comp);
  }, [comp, graph]);

  useEffect(() => {
    graph.setSaturation(sat);
  }, [sat, graph]);

  useEffect(() => {
    graph.setWidth(width);
  }, [width, graph]);

  useEffect(() => {
    graph.setMasterBypass(bypass);
  }, [bypass, graph]);

  // Loop control — checks each animation frame whether currentTime crossed
  // the loopEnd, and seeks back to loopStart.
  useEffect(() => {
    if (!loop.enabled || loop.inSec == null || loop.outSec == null) return;
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (loop.outSec != null && loop.inSec != null && a.currentTime >= loop.outSec) {
        a.currentTime = loop.inSec;
      }
    };
    a.addEventListener('timeupdate', onTime);
    return () => a.removeEventListener('timeupdate', onTime);
  }, [loop, audioRef]);

  const activeCount =
    Number(eqEnabled) +
    Number(comp.enabled) +
    Number(sat.enabled) +
    Number(width.enabled) +
    Number(loop.enabled) +
    Number(pitch.enabled);

  const handleResetAll = () => {
    setEqBands(EQ_BANDS_DEFAULT.map((b) => ({ ...b })));
    setEqEnabled(false);
    setComp({ ...COMPRESSOR_DEFAULT });
    setSat({ ...SATURATION_DEFAULT });
    setWidth({ ...WIDTH_DEFAULT });
    onLoopChange(LOOP_DEFAULT);
    onPitchChange({ ...pitch, semitones: 0, cents: 0, enabled: false });
    setBypass(false);
    graph.resetAll();
  };

  // Per-module summary (live values from the real DSP state) for the rack cards.
  const moduleView = (id: PreviewTool['id']): ModuleView => {
    switch (id) {
      case 'eq': {
        const band = (lo: number, hi: number) =>
          eqBands.slice(lo, hi).reduce((a, b) => a + b.gainDb, 0) / Math.max(1, hi - lo);
        const setGroup = (lo: number, hi: number) => (pct: number) => {
          const g = Math.round((pct * 24 - 12) * 2) / 2;
          setEqEnabled(true);
          setEqBands((bs) => bs.map((b, i) => (i >= lo && i < hi ? { ...b, gainDb: g } : b)));
        };
        const knobs: KnobSpec[] = [
          { label: 'Low', ...fmtDb(band(0, 3)), set: setGroup(0, 3) },
          { label: 'Mid', ...fmtDb(band(3, 6)), set: setGroup(3, 6) },
          { label: 'Hi', ...fmtDb(band(6, 8)), set: setGroup(6, 8) },
        ];
        return { on: eqEnabled, viz: <EqMiniViz bands={eqBands} acc="#00e5b0" />, knobs, footer: 'Q 1.4', toggle: () => setEqEnabled((v) => !v) };
      }
      case 'comp':
        return {
          on: comp.enabled,
          viz: <CompMiniViz />,
          knobs: [
            { label: 'Thr', value: comp.thresholdDb.toFixed(0), pct: (comp.thresholdDb + 60) / 60, set: (p) => setComp((c) => ({ ...c, thresholdDb: Math.round(p * 60 - 60) })) },
            { label: 'Ratio', value: `${comp.ratio.toFixed(0)}:1`, pct: (comp.ratio - 1) / 19, set: (p) => setComp((c) => ({ ...c, ratio: Math.round((1 + p * 19) * 10) / 10 })) },
            { label: 'Atk', value: comp.attackMs.toFixed(0), pct: comp.attackMs / 250, set: (p) => setComp((c) => ({ ...c, attackMs: Math.round(p * 250) })) },
          ],
          footer: 'Threshold · Ratio',
          toggle: () => setComp((c) => ({ ...c, enabled: !c.enabled })),
        };
      case 'sat':
        return {
          on: sat.enabled,
          viz: <SatMiniViz />,
          knobs: [
            { label: 'Drive', value: sat.drive.toFixed(2), pct: sat.drive, set: (p) => setSat((c) => ({ ...c, drive: Math.round(p * 100) / 100 })) },
            { label: 'Mix', value: sat.mix.toFixed(2), pct: sat.mix, set: (p) => setSat((c) => ({ ...c, mix: Math.round(p * 100) / 100 })) },
          ],
          footer: '2× OS',
          toggle: () => setSat((c) => ({ ...c, enabled: !c.enabled })),
        };
      case 'ms':
        return {
          on: width.enabled,
          viz: <MsMiniViz />,
          knobs: [{ label: 'Width', value: `${width.width.toFixed(2)}×`, pct: width.width / 2, set: (p) => setWidth((c) => ({ ...c, width: Math.round(p * 2 * 100) / 100 })) }],
          footer: `Mono ← ${width.width.toFixed(2)} → Wide`,
          toggle: () => setWidth((c) => ({ ...c, enabled: !c.enabled })),
        };
      case 'lim':
        return {
          on: false,
          disabled: true,
          viz: <LimMiniViz />,
          knobs: [
            { label: 'Ceiling', value: '-1.0', pct: 0.3 },
            { label: 'Release', value: '--', pct: 0 },
          ],
          footer: 'v2.0',
        };
      case 'pitch':
        return {
          on: pitch.enabled,
          viz: <PitchMiniViz semitones={pitch.semitones} />,
          knobs: [
            { label: 'Semi', value: `${pitch.semitones >= 0 ? '+' : ''}${pitch.semitones}`, pct: (pitch.semitones + 12) / 24, set: (p) => onPitchChange({ ...pitch, semitones: Math.round(p * 24 - 12) }) },
            { label: 'Cents', value: `${pitch.cents >= 0 ? '+' : ''}${pitch.cents}`, pct: (pitch.cents + 50) / 100, set: (p) => onPitchChange({ ...pitch, cents: Math.round(p * 100 - 50) }) },
          ],
          footer: pitch.decoding ? 'Decoding…' : 'Decoded ✓',
          toggle: () => onPitchChange({ ...pitch, enabled: !pitch.enabled }),
        };
      case 'loop': {
        const loopOn = loop.enabled && loop.inSec != null && loop.outSec != null;
        return {
          on: loopOn,
          viz: <LoopMiniViz />,
          loopButtons: true,
          footer: `IN ${loop.inSec != null ? formatTime(loop.inSec) : '—'} OUT ${loop.outSec != null ? formatTime(loop.outSec) : '—'}`,
          toggle: () => onLoopChange({ ...loop, enabled: !loop.enabled && loop.inSec != null && loop.outSec != null }),
        };
      }
      case 'scope':
        return { on: false, viz: <ScopeMiniViz />, scopeFader: true, footer: 'Goniometer · Phase' };
      default:
        return { on: false, viz: null, knobs: [], footer: '' };
    }
  };

  return (
    <section className={`card ${s.rail}`}>
      <header className={s.rackHd}>
        <div className={s.rackTitle}>
          <span className={s.led} />
          Insert rack
        </div>
        <span className={s.activeCountChip}>
          {activeCount} on · bypass {bypass ? 'on' : 'off'}
        </span>
        <div className={s.rackSpacer} />
        <span className={s.rackMeta}>Signal: EQ → Comp → Sat → M/S → Lim → Σ</span>
        <button type="button" className={s.rackToggle} data-on={bypass} onClick={() => setBypass((b) => !b)}>
          Bypass
        </button>
        <button type="button" className={s.rackToggle} onClick={handleResetAll}>
          Reset
        </button>
      </header>

      <div className={s.rackGrid}>
        {TOOLS.map((t) => {
          const v = moduleView(t.id);
          const focused = activeTool === t.id;
          const cls = [s.module, v.on && s.on, focused && s.focused, v.disabled && s.disabled]
            .filter(Boolean)
            .join(' ');
          const openTool = () => {
            if (!v.disabled) onActiveToolChange(focused ? null : t.id);
          };
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={v.disabled ? -1 : 0}
              className={cls}
              style={{ ['--acc' as string]: t.accent } as CSSProperties}
              onClick={openTool}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openTool();
                }
              }}
            >
              <div className={s.moduleHd}>
                <span className={s.moduleIcon}>{MODULE_ICON[t.id]}</span>
                <span className={s.moduleName}>{t.label}</span>
                {t.tier === 'v2' ? (
                  <span className={s.moduleSoon}>Soon</span>
                ) : (
                  <span className={s.moduleLed} />
                )}
              </div>
              <div className={s.moduleSub}>{t.sub}</div>
              {v.viz}
              {v.knobs && (
                <div className={s.knobRowMini}>
                  {v.knobs.map((k) => (
                    <MiniKnob key={k.label} spec={k} acc={t.accent} />
                  ))}
                </div>
              )}
              {v.loopButtons && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    className={s.rackToggle}
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoopChange({ ...loop, inSec: currentTime });
                    }}
                  >
                    SET IN
                  </button>
                  <button
                    type="button"
                    className={s.rackToggle}
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoopChange({ ...loop, outSec: currentTime });
                    }}
                  >
                    SET OUT
                  </button>
                </div>
              )}
              {v.scopeFader && <ScopeMiniFader graph={graph} />}
              <div className={s.moduleFooter}>
                <span className={s.moduleSub}>{v.footer}</span>
                <span
                  className={s.modulePower}
                  role={v.toggle ? 'button' : undefined}
                  tabIndex={v.toggle ? 0 : -1}
                  onClick={(e) => {
                    e.stopPropagation();
                    v.toggle?.();
                  }}
                  onKeyDown={(e) => {
                    if (v.toggle && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      e.stopPropagation();
                      v.toggle();
                    }
                  }}
                >
                  {v.on ? 'On' : 'OFF'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── EQ ──────────────────────────────────────────────────────────────


function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Insert-rack module cards (design handoff) ────────────────────────────────

interface KnobSpec {
  label: string;
  value: string;
  pct: number;
  /** Apply a new 0..1 position back to the underlying DSP param. Omit = read-only. */
  set?: (pct: number) => void;
}
interface ModuleView {
  on: boolean;
  disabled?: boolean;
  viz: React.ReactNode;
  knobs?: KnobSpec[];
  loopButtons?: boolean;
  scopeFader?: boolean;
  footer: string;
  toggle?: () => void;
}

function fmtDb(g: number): { value: string; pct: number } {
  return { value: `${g > 0 ? '+' : ''}${g.toFixed(1)}`, pct: (g + 12) / 24 };
}

function KnobArc({ pct, acc }: { pct: number; acc: string }) {
  const p = Math.max(0, Math.min(1, pct));
  const cx = 15;
  const cy = 15;
  const r = 11;
  const polar = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const startAng = (-135 * Math.PI) / 180;
  const endAng = ((-135 + 270 * p) * Math.PI) / 180;
  const fullEndAng = (135 * Math.PI) / 180;
  const [sx, sy] = polar(startAng);
  const [ex, ey] = polar(endAng);
  const [fx, fy] = polar(fullEndAng);
  const largeFg = 270 * p > 180 ? 1 : 0;
  const tx1 = cx + 6 * Math.cos(endAng);
  const ty1 = cy + 6 * Math.sin(endAng);
  const tx2 = cx + 10 * Math.cos(endAng);
  const ty2 = cy + 10 * Math.sin(endAng);
  return (
    <svg viewBox="0 0 30 30">
      <path
        d={`M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 1 1 ${fx.toFixed(2)} ${fy.toFixed(2)}`}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {p > 0 && (
        <path
          d={`M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${largeFg} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`}
          fill="none"
          stroke={acc}
          strokeWidth="2"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${acc}80)` }}
        />
      )}
      <circle cx={cx} cy={cy} r="5.5" fill="#0a1020" stroke="rgba(255,255,255,0.14)" strokeWidth="0.6" />
      <line
        x1={tx1.toFixed(2)}
        y1={ty1.toFixed(2)}
        x2={tx2.toFixed(2)}
        y2={ty2.toFixed(2)}
        stroke={acc}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MiniKnob({ spec, acc }: { spec: KnobSpec; acc: string }) {
  const draggable = Boolean(spec.set);

  // Vertical drag: up = increase. Full 0..1 sweep over ~150px. Tracked on window
  // so the drag survives the pointer leaving the small knob hit-area.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!spec.set) return;
    e.stopPropagation();
    e.preventDefault();
    const set = spec.set;
    const startY = e.clientY;
    const startPct = spec.pct;
    const move = (ev: PointerEvent) => {
      const next = Math.max(0, Math.min(1, startPct + (startY - ev.clientY) / 150));
      set(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!spec.set) return;
    const step = e.shiftKey ? 0.1 : 1 / 50;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      spec.set(Math.min(1, spec.pct + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      spec.set(Math.max(0, spec.pct - step));
    }
  };

  return (
    <div className={s.miniKnob}>
      <span className={s.miniKnobValue}>{spec.value}</span>
      <div
        className={`${s.knobVisual}${draggable ? ` ${s.knobDraggable}` : ''}`}
        onPointerDown={onPointerDown}
        onClick={draggable ? (e) => e.stopPropagation() : undefined}
        onKeyDown={onKeyDown}
        role={draggable ? 'slider' : undefined}
        tabIndex={draggable ? 0 : undefined}
        aria-label={draggable ? spec.label : undefined}
        aria-valuemin={draggable ? 0 : undefined}
        aria-valuemax={draggable ? 100 : undefined}
        aria-valuenow={draggable ? Math.round(spec.pct * 100) : undefined}
      >
        <KnobArc pct={spec.pct} acc={acc} />
      </div>
      <span className={s.miniKnobLabel}>{spec.label}</span>
    </div>
  );
}

// Module header icons (inline SVG, accent-tinted by the card).
const MODULE_ICON: Record<PreviewTool['id'], React.ReactNode> = {
  eq: (
    <svg width="14" height="14" viewBox="0 0 24 16" fill="none">
      <path d="M1 8 C3 8 4 5 7 4.5 C10 4 12 4 14 6 C16 8 18 5 21 5.5 C22 5.7 23 7 23 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="4.5" r="1.1" fill="currentColor" />
      <circle cx="14" cy="6" r="1.1" fill="currentColor" />
      <circle cx="21" cy="5.5" r="1.1" fill="currentColor" />
    </svg>
  ),
  comp: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" opacity="0.3" strokeWidth="1.2" strokeDasharray="2 2" />
      <path d="M3 21 L11 13 L21 9" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  ),
  sat: (
    <svg width="14" height="14" viewBox="0 0 24 12" fill="none">
      <path d="M1 6 C3 1, 5 1, 6 6 C7 11, 11 11, 12 6 C13 1, 17 1, 18 6 C19 11, 21 11, 23 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  ),
  ms: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 12 L8 8 M4 12 L8 16 M4 12 L12 12 M20 12 L16 8 M20 12 L16 16 M20 12 L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  lim: (
    <svg width="14" height="14" viewBox="0 0 24 16" fill="none">
      <line x1="1" y1="3" x2="23" y2="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M1 14 L3 8 L5 3 L7 11 L9 5 L11 3 L13 9 L15 4 L17 3 L19 7 L21 3 L23 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  pitch: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M6 2 V14 M10 2 V14 M3 5.5 H13 M3 10.5 H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  loop: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M5 12 A7 7 0 1 1 12 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M12 19 L9 16 M12 19 L9 22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="3" y1="4" x2="3" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="21" y1="4" x2="21" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  scope: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 4 L20 20 M4 20 L20 4" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
    </svg>
  ),
};

function EqMiniViz({ bands, acc }: { bands: EqBand[]; acc: string }) {
  const n = bands.length;
  const yFor = (g: number) => 15 - Math.max(-1, Math.min(1, g / 12)) * 10;
  const pts = bands.map((b, i) => [(i / (n - 1)) * 100, yFor(b.gainDb)] as const);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(0)},${p[1].toFixed(1)}`).join(' ');
  const fill = `${line} L100,30 L0,30 Z`;
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="15" y2="15" stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" strokeDasharray="2 2" />
      <path d={fill} fill={acc} opacity="0.16" />
      <path d={line} fill="none" stroke={acc} strokeWidth="1.4" />
    </svg>
  );
}
function CompMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="15" y2="15" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
      <line x1="50" x2="50" y1="0" y2="30" stroke="rgba(251,191,36,0.4)" strokeWidth="0.8" strokeDasharray="1 2" />
      <path d="M0,28 L50,15 L100,9" fill="none" stroke="#fbbf24" strokeWidth="1.4" />
      <path d="M0,28 L100,1" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" strokeDasharray="2 2" />
    </svg>
  );
}
function SatMiniViz() {
  const bars = [
    [6, 6, 22, 0.85], [20, 14, 14, 0.7], [34, 10, 18, 0.8], [48, 20, 8, 0.55],
    [62, 17, 11, 0.6], [76, 22, 6, 0.45], [90, 24, 4, 0.35],
  ];
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="28" y2="28" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
      {bars.map(([x, y, h, o], i) => (
        <rect key={i} x={x} y={y} width="6" height={h} fill="#fb923c" opacity={o} />
      ))}
    </svg>
  );
}
function MsMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="50" x2="50" y1="2" y2="28" stroke="rgba(96,165,250,0.4)" strokeWidth="0.8" strokeDasharray="1 2" />
      <ellipse cx="50" cy="15" rx="36" ry="11" fill="rgba(96,165,250,0.12)" stroke="#60a5fa" strokeWidth="1.2" />
      <circle cx="20" cy="15" r="1.5" fill="#60a5fa" />
      <circle cx="80" cy="15" r="1.5" fill="#60a5fa" />
    </svg>
  );
}
function LimMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="6" y2="6" stroke="#f43f5e" strokeWidth="1.2" />
      <path d="M0,26 L8,14 L16,6 L24,18 L32,8 L40,6 L48,15 L56,6 L64,11 L72,6 L80,17 L88,6 L100,22" fill="none" stroke="rgba(244,63,94,0.5)" strokeWidth="1.2" />
    </svg>
  );
}
function PitchMiniViz({ semitones }: { semitones: number }) {
  const x = 50 + Math.max(-12, Math.min(12, semitones)) * (44 / 12);
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <rect x="0" y="6" width="100" height="18" fill="rgba(255,255,255,0.04)" />
      <g fill="rgba(167,139,250,0.6)">
        <rect x="8" y="6" width="6" height="11" />
        <rect x="20" y="6" width="6" height="11" />
        <rect x="40" y="6" width="6" height="11" />
        <rect x="52" y="6" width="6" height="11" />
        <rect x="64" y="6" width="6" height="11" />
        <rect x="84" y="6" width="6" height="11" />
      </g>
      <line x1={x} x2={x} y1="2" y2="28" stroke="#00f3bd" strokeWidth="1.2" />
    </svg>
  );
}
function LoopMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1="15" y2="15" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <rect x="38" y="6" width="24" height="18" fill="rgba(167,139,250,0.18)" stroke="#a78bfa" strokeWidth="1" />
      <text x="50" y="20" fontFamily="JetBrains Mono" fontSize="6.5" fill="#a78bfa" textAnchor="middle" fontWeight="700">
        A → B
      </text>
    </svg>
  );
}
function ScopeMiniViz() {
  return (
    <svg className={s.miniViz} viewBox="0 0 100 30" preserveAspectRatio="xMidYMid meet">
      <line x1="0" x2="100" y1="15" y2="15" stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" />
      <line x1="50" x2="50" y1="0" y2="30" stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" />
      <ellipse cx="50" cy="15" rx="6" ry="10" fill="none" stroke="#34d399" strokeWidth="1.1" opacity="0.7" />
      <ellipse cx="50" cy="15" rx="3" ry="13" fill="none" stroke="#34d399" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}
function ScopeMiniFader({ graph }: { graph: AudioGraphHandle }) {
  const [corr, setCorr] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const next = graph.readFrame().correlation;
      // Skip the state update when the value is effectively unchanged (paused or
      // steady) so React bails the re-render instead of churning at 60fps forever.
      setCorr((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph]);
  const pct = ((corr + 1) / 2) * 100;
  return (
    <div className={s.miniKnob} style={{ flex: 2 }}>
      <span className={s.miniKnobValue}>{corr.toFixed(2)}</span>
      <div className={s.miniFader}>
        <div className={s.miniFaderFill} style={{ width: `${pct}%`, background: '#34d399' }} />
        <div className={s.miniFaderThumb} style={{ left: `${pct}%`, background: '#34d399' }} />
      </div>
      <span className={s.miniKnobLabel}>Correlation L/R</span>
    </div>
  );
}


================================================================================
===== FILE: components/frontend-spectr-v2/src/features/listen/PreviewTools.module.css =====
================================================================================

.rail {
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Insert rack (design handoff) ─────────────────────────────────────── */
.rackHd {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.015);
  flex-wrap: wrap;
}
.rackTitle {
  font-size: 12px;
  color: var(--text-2);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  letter-spacing: -0.005em;
}
.rackTitle .led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 6px var(--cyan);
}
.activeCountChip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: var(--cyan);
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(0, 229, 176, 0.3);
  background: rgba(0, 229, 176, 0.08);
}
.rackSpacer {
  flex: 1;
}
.rackMeta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--muted);
  font-weight: 500;
}
.rackToggle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--muted);
  padding: 5px 10px;
  border-radius: 5px;
  border: 1px solid var(--border-2);
  background: rgba(255, 255, 255, 0.03);
  font-weight: 500;
  cursor: pointer;
}
.rackToggle:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}
.rackToggle[data-on='true'] {
  color: var(--orange);
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.07);
}

.rackGrid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 0;
  border-bottom: 1px solid var(--border);
}
.module {
  --acc: var(--cyan);
  position: relative;
  padding: 9px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.012), transparent);
  min-height: 170px;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
  text-align: left;
  width: 100%;
  font-family: inherit;
  color: inherit;
}
.module:last-child {
  border-right: none;
}
.module:hover {
  background: linear-gradient(180deg, color-mix(in srgb, var(--acc) 3%, transparent), transparent 70%);
}
.module.on {
  background: linear-gradient(180deg, color-mix(in srgb, var(--acc) 6%, transparent), transparent 70%);
}
.module.focused {
  background: linear-gradient(180deg, color-mix(in srgb, var(--acc) 11%, transparent), transparent 70%);
  box-shadow:
    inset 0 2px 0 0 var(--acc),
    inset 0 0 0 1px color-mix(in srgb, var(--acc) 30%, transparent);
}
.module.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.moduleHd {
  display: flex;
  align-items: center;
  gap: 6px;
}
.moduleIcon {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--acc) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--acc) 35%, transparent);
  color: var(--acc);
  flex-shrink: 0;
}
.moduleName {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  min-width: 0;
  letter-spacing: -0.005em;
}
.moduleLed {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-2);
  border: 1px solid var(--border-2);
  flex-shrink: 0;
}
.module.on .moduleLed {
  background: var(--acc);
  border-color: transparent;
  box-shadow: 0 0 6px var(--acc);
}
.moduleSub {
  font-size: 10.5px;
  color: var(--muted);
  font-weight: 500;
}
.moduleFooter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: -2px;
}
.modulePower {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid var(--border-2);
  color: var(--muted);
  background: rgba(255, 255, 255, 0.03);
  font-weight: 500;
  cursor: pointer;
}
.module.on .modulePower {
  color: var(--acc);
  border-color: color-mix(in srgb, var(--acc) 45%, transparent);
  background: color-mix(in srgb, var(--acc) 10%, transparent);
}
.moduleSoon {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  color: var(--muted);
  padding: 1px 5px;
  border: 1px solid var(--border-2);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.03);
}

.miniViz {
  width: 100%;
  height: 30px;
  display: block;
}
.knobRowMini {
  display: flex;
  gap: 4px;
  flex: 1;
  align-items: flex-end;
}
.miniKnob {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 0;
}
.miniKnobLabel {
  font-size: 9.5px;
  color: var(--muted);
  font-weight: 500;
}
.miniKnobValue {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.knobVisual {
  width: 30px;
  height: 30px;
}
.knobVisual svg {
  width: 100%;
  height: 100%;
  display: block;
}
.knobDraggable {
  cursor: ns-resize;
  touch-action: none;
  border-radius: 50%;
}
.knobDraggable:focus-visible {
  outline: 1px solid var(--cyan);
  outline-offset: 2px;
}
.miniFader {
  width: 100%;
  height: 6px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border);
  border-radius: 3px;
  position: relative;
}
.miniFaderFill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
}
.miniFaderThumb {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.panelWrap {
  padding: 14px;
}

.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-2);
  font-weight: 700;
}

.activeCount {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: var(--cyan);
  margin-left: 6px;
}

.hdActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bypassToggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--muted);
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  user-select: none;
}
.bypassToggle[data-on='true'] {
  color: var(--orange);
  border-color: rgba(251, 146, 60, 0.4);
  background: rgba(251, 146, 60, 0.06);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.tile {
  position: relative;
  text-align: left;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  font-family: inherit;
  color: var(--text);
  transition: background 0.15s, border-color 0.15s;
}
.tile:hover {
  background: var(--card-hover);
  border-color: var(--border-2);
}
.tile[data-active='true'] {
  border-color: var(--tile-color, var(--cyan));
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(0, 229, 176, 0.04));
}
.tile[data-tier='v2'] {
  opacity: 0.6;
}
.tile[data-on='true'] {
  box-shadow: 0 0 0 1px var(--tile-color, var(--cyan)) inset, 0 0 10px -2px var(--tile-color, var(--cyan));
}

.tileTop {
  display: flex;
  align-items: center;
  gap: 8px;
}

.glyph {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--tile-bg, rgba(0, 229, 176, 0.08));
  border: 1px solid var(--tile-border, rgba(0, 229, 176, 0.32));
  color: var(--tile-color, var(--cyan));
  font-size: 12px;
  font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -0.005em;
  flex: 1;
  min-width: 0;
}

.tierBadge {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.12em;
  padding: 2px 5px;
  border-radius: 3px;
  background: rgba(167, 139, 250, 0.1);
  color: var(--violet);
  border: 1px solid rgba(167, 139, 250, 0.3);
}

.onDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tile-color, var(--cyan));
  box-shadow: 0 0 6px var(--tile-color, var(--cyan));
}

.sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 0.04em;
}

.panel {
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.018);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--panel-accent, var(--cyan));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panelHd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panelTitle {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.panelSub {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.55;
}

.panelEmpty {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
}

.knobRow {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 10px;
}

.knob {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.knobLabel {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.knobValue {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

.knobInput {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--dim);
  outline: none;
  cursor: pointer;
  margin-top: 4px;
}
.knobInput::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--panel-accent, var(--cyan));
  cursor: pointer;
  box-shadow: 0 0 6px color-mix(in srgb, var(--panel-accent, var(--cyan)) 50%, transparent);
}

/* EQ curve viz */
.eqWrap {
  position: relative;
  width: 100%;
  height: 110px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: visible;
}

.eqBandsRow {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 6px;
}

.eqBand {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.eqBandLabel {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  color: var(--muted);
  letter-spacing: 0.04em;
}

.eqBandGain {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--text);
}

.eqSlider {
  -webkit-appearance: slider-vertical;
  appearance: slider-vertical;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 4px;
  height: 80px;
  background: var(--dim);
  outline: none;
  cursor: pointer;
}

/* Goniometer canvas */
.scope {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 16px;
  align-items: center;
}

.scopeCanvas {
  width: 130px;
  height: 130px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 50%;
  border: 1px solid var(--border-2);
}

.corrColumn {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.corrBar {
  position: relative;
  height: 14px;
  background: linear-gradient(90deg,
    rgba(244, 63, 94, 0.4) 0%,
    rgba(244, 63, 94, 0.2) 40%,
    rgba(251, 191, 36, 0.2) 45%,
    rgba(251, 191, 36, 0.2) 55%,
    rgba(0, 229, 176, 0.2) 60%,
    rgba(0, 229, 176, 0.4) 100%);
  border-radius: 4px;
  border: 1px solid var(--border);
}

.corrDot {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  margin-top: -6px;
  border-radius: 50%;
  background: var(--text);
  box-shadow: 0 0 6px var(--text);
}

/* Loop region overlay */
.loopRegion {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(167, 139, 250, 0.15);
  border-left: 2px solid var(--violet);
  border-right: 2px solid var(--violet);
  pointer-events: none;
}

.smallBtn {
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-2);
  cursor: pointer;
}
.smallBtn:hover {
  border-color: var(--border-2);
  color: var(--text);
}
.smallBtn[data-on='true'] {
  border-color: var(--violet);
  color: var(--violet);
  background: rgba(167, 139, 250, 0.08);
}
