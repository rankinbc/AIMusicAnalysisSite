# Listen DSP Rack — Phase 5: AudioWorklet Modules (Design)

Date: 2026-06-24
Status: Design — pending implementation plan
Component: `components/frontend-spectr-v2` (`src/features/listen`)
Parent design: `PRPs/listen-dsp-rack-engine-design.md` (master roadmap §11–13, §108–126, §149–151, §396–406)
Builds on: Phases 1–4 (modular `EffectUnit` engine, reorder, unhidden params, six native modules) — merged at `master@9cda88c`.

## Summary

Phase 5 adds the three **AudioWorklet** effect modules from the master design —
Gate, Bitcrusher, True Limiter — plus the worklet boot infrastructure that lets
them coexist with the synchronous native rack. Worklets require
`await ctx.audioWorklet.addModule(url)` before their nodes can be built, while
`ensureContext()` is synchronous; the resolution is a **placeholder-then-swap**
boot: native units build immediately, the three worklet units start as
passthrough placeholders, and each swaps in its real `AudioWorkletNode` when
registration resolves.

This is **engine-only**. No UI. The three units are reachable only through the
existing generic handle. At their defaults all three are dry passthroughs (both as
placeholders and once materialized), so the chain stays bit-equivalent to today.

## Resolved decisions (this phase)

1. **Batching** — all three worklets + the boot infra ship on one
   `listen-dsp-rack-phase5` branch.
2. **Worklet DSP location** — the per-sample math lives in pure modules under
   `audio/dsp/` (`gateMath`, `quantize`, `limiterMath`), unit-tested in vitest,
   and is **imported by the processor shells** (Vite bundles each processor with
   its imports into a separate worklet asset). This resolves the master design's
   internal contradiction (§126 "processors have no app imports" vs §160
   "processors import the pure math") in favor of testability. The imported math
   must be worklet-safe: pure functions, no DOM/React/globals.
3. **Meter readback** — gate and limiter post gain-reduction (and gate
   open-state) over the worklet `port` (~30 Hz, throttled); each unit caches the
   latest value for synchronous `readMeter()`. This phase wires
   `readEffectMeter(id)`; the UI **display** of those meters remains Phase 6.
4. **Param transport** — numeric params are k-rate `AudioParam`s declared via
   `parameterDescriptors`; `applyParams` sets `node.parameters.get(name).value`.
   The `port` carries meter readback only (processor → main), never params.

## Non-goals

- No UI. `PreviewTools.tsx`, `PitchPanel.tsx`, and the route are untouched.
- No meter **display** wiring (`buildMeterCells`) — Phase 6.
- No new per-module wrapper setters; the three modules are driven only through the
  generic `setEffectParams(id, patch)`.
- No tempo-independent pitch / phase vocoder (out of the whole roadmap's scope).

---

## Architecture

### Worklet boot path

A new module `audio/worklets.ts`:

```ts
import gateProcessorUrl from './dsp/processors/gate.processor.ts?worker&url';
import bitcrusherProcessorUrl from './dsp/processors/bitcrusher.processor.ts?worker&url';
import limiterProcessorUrl from './dsp/processors/limiter.processor.ts?worker&url';

export function registerWorklets(ctx: AudioContext): Promise<void> {
  return Promise.all([
    ctx.audioWorklet.addModule(gateProcessorUrl),
    ctx.audioWorklet.addModule(bitcrusherProcessorUrl),
    ctx.audioWorklet.addModule(limiterProcessorUrl),
  ]).then(() => undefined);
}
```

- **Use Vite's `?worker&url` suffix, NOT `new URL('./x.ts', import.meta.url)`.**
  A plain `new URL` emits the processor as a RAW, untranspiled `.ts` asset
  (`data:video/mp2t` / raw TypeScript) that `addModule` rejects at runtime →
  the boot's `.catch` silently leaves the units as passthrough. `?worker&url`
  triggers a real transpile + bundle (pure-math imports inlined) and yields the
  compiled chunk's URL. `vite/client` types resolve the suffix to `string`.
  `npm run build` emits three separate `*.processor-<hash>.js` chunks — verify by
  decoding/reading one (it must be compiled JS with `registerProcessor` + inlined
  math, NOT TS).

### `ensureContext` stays synchronous

`buildInsertChain(ctx)` builds all thirteen units immediately. The three worklet
units (`gate`, `bitcrusher`, `limiter`) start as **placeholder passthroughs**.
The composer then fires the async boot, fire-and-forget:

```ts
registerWorklets(ctx)
  .then(() => Object.values(units).forEach((u) => u.materialize?.()))
  .catch(() => { /* leave placeholders; units report ready:false */ });
```

If registration fails (older browser, no worklet support), the units stay
passthrough placeholders forever and report `ready:false`. The chain still works —
acceptable degradation (master risk #1).

### `EffectUnit` gains an optional `materialize`

```ts
export interface EffectUnit<S> {
  // ...existing...
  materialize?(): void;   // worklet units: build the AudioWorkletNode + swap it in
}
```

`materialize?.()` is a no-op (absent) on the ten native units. The composer calls
it on every unit after registration resolves; only the three worklet units
implement it.

### Worklet unit structure (placeholder-then-swap)

Each worklet unit factory:

- Builds stable `wetIn`/`wetOut` gains and wraps them in
  `makeDryWet(ctx, wetIn, wetOut)` → stable `input`/`output` (composer wires
  these). At construction `wetIn.connect(wetOut)` — a passthrough placeholder
  inside the wet lane.
- Holds `lastState` (most recent `applyParams` argument), `node: AudioWorkletNode
  | null = null`, `ready = false`.
- `applyParams(state)`: store `lastState`; if `node` exists, push each param to
  `node.parameters.get(name).value` and `setWet(...)`; if not yet materialized,
  just store (the placeholder passes through) and `setWet(state.enabled ? ... :
  0)` so a disabled unit is dry-passthrough even pre-ready.
- `materialize()`: brief duck on `wetOut.gain` (~10 ms); `wetIn.disconnect(wetOut)`;
  `node = new AudioWorkletNode(ctx, '<processor>', { numberOfInputs: 1,
  numberOfOutputs: 1, outputChannelCount: [2] })`; `wetIn.connect(node);
  node.connect(wetOut)`; wire `node.port.onmessage` → cache the latest meter;
  re-apply `lastState` to the node's AudioParams; `ready = true`; ramp `wetOut`
  back. At default (`setWet(0)`) the swap is silent regardless of the duck.
- `setBypass(b)` → `setWet(b ? 0 : 1)` (the required `EffectUnit` member).
- `readMeter()` returns the cached `{ reductionDb, open? }` (gate/limiter) or the
  `ready` flag mapped appropriately.
- `dispose()`: disconnect every node (`wetIn`, `wetOut`, `node` if built,
  `input`/`output`); `node?.port.close()`.

The swap is internal to the unit — the composer's `wire`/`reorder`/duck logic is
untouched, and `input`/`output` identities never change, so reorder still works.

### Processors (`audio/dsp/processors/*.processor.ts`, worklet global scope)

```ts
import { quantizeSample } from '../quantize';

class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bitDepth', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 1, minValue: 1, maxValue: 50, automationRate: 'k-rate' },
    ];
  }
  process(inputs, outputs, parameters) { /* per-sample via quantizeSample + S&H */ return true; }
}
registerProcessor('bitcrusher', BitcrusherProcessor);
```

- Import the pure math from `../<name>Math` / `../quantize`; Vite bundles it into
  the worklet asset. No DOM/React/app-runtime imports.
- Numeric params read from `parameters.<name>` (length-1 for k-rate, or full block
  for a-rate — k-rate is used).
- Gate and limiter post `this.port.postMessage({ reductionDb, open })` on a
  throttle (~ every `sampleRate/30` frames) to avoid main-thread churn.
- `process()` returns `true` (keep processor alive).

### Worklet ambient types

`audio/dsp/processors/audioworklet.d.ts` — minimal ambient declarations so
`tsc -b` typechecks the worklet scope (no new dependency):

```ts
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  ctor: new (options?: unknown) => AudioWorkletProcessor,
): void;
declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;
```

### File layout

```
audio/
  worklets.ts                       # registerWorklets(ctx)
  EffectUnit.ts                     # + optional materialize?()
  state.ts                          # + 3 states/defaults; EffectId +3; DEFAULT_ORDER 10->13
  composer.ts                       # register 3 worklet factories + fire boot/materialize
  effects/
    gate.ts  bitcrusher.ts  limiter.ts        # worklet EffectUnits (main-thread wrappers)
  dsp/
    gateMath.ts (+test)  quantize.ts (+test)  limiterMath.ts (+test)   # pure, tested
    processors/
      audioworklet.d.ts             # ambient worklet globals
      gate.processor.ts  bitcrusher.processor.ts  limiter.processor.ts
useAudioGraph.ts                    # + 3 refs/helpers/cases/resetAll + EffectParamMap +3
```

---

## Module specifications

All three default `enabled:false` → dry passthrough.

### Gate — `gate` (AudioWorklet)

State: `{ thresholdDb, attackMs, holdMs, releaseMs, floorDb, enabled }`
Default: `{ thresholdDb:-40, attackMs:1, holdMs:10, releaseMs:100, floorDb:-80, enabled:false }`

| Param | Range | Default | AudioParam |
|---|---|---|---|
| `thresholdDb` | −80…0 dB | −40 | `threshold` |
| `attackMs` | 0–50 ms | 1 | `attack` |
| `holdMs` | 0–500 ms | 10 | `hold` |
| `releaseMs` | 0–1000 ms | 100 | `release` |
| `floorDb` | −80…0 dB | −80 | `floor` |
| `enabled` | bool | false | unit bypass |
| `meter` (read) | `{reductionDb, open}` | — | `port` |

Processor: per-sample envelope follower + gate state machine (closed → attacking →
open → holding → releasing). Pure math in `dsp/gateMath.ts`:
`stepGate(state, inputAbs, params, sampleRate) → { state, gain }`.

### Bitcrusher — `bitcrusher` (AudioWorklet)

State: `{ bitDepth, downsample, mix, enabled }`
Default: `{ bitDepth:16, downsample:1, mix:0, enabled:false }`

| Param | Range | Default | Maps to |
|---|---|---|---|
| `bitDepth` | 1–16 | 16 | `bitDepth` AudioParam (quantize) |
| `downsample` | 1–50× | 1 | `downsample` AudioParam (sample-and-hold) |
| `mix` | 0–1 | 0 | dry/wet (`setWet`) |
| `enabled` | bool | false | unit bypass |

Processor: bit-depth quantization (`quantizeSample`) + sample-rate decimation
(sample-and-hold counter). Pure math in `dsp/quantize.ts`. `mix` is the unit's
dry/wet (`setWet(enabled ? mix : 0)`), not an AudioParam.

### True Limiter — `limiter` (AudioWorklet)

State: `{ ceilingDb, releaseMs, lookaheadMs, enabled }`
Default: `{ ceilingDb:-1.0, releaseMs:50, lookaheadMs:5, enabled:false }`

| Param | Range | Default | AudioParam |
|---|---|---|---|
| `ceilingDb` | −12…0 dBTP | −1.0 | `ceiling` |
| `releaseMs` | 1–500 ms | 50 | `release` |
| `lookaheadMs` | 0–10 ms | 5 | `lookahead` |
| `enabled` | bool | false | unit bypass |
| `meter` (read) | `{reductionDb}` | — | `port` |

Processor allocates a fixed max-10 ms lookahead ring buffer; `lookaheadMs` (a
live AudioParam) selects the active window. Per-sample: delay the signal by the
window, compute gain reduction from the peak inside the window, apply + release.
Pure gain math in `dsp/limiterMath.ts`:
`stepLimiter(state, lookaheadPeak, params, sampleRate) → { state, gain }`. The ring
buffer + peak tracking live in the processor.

---

## Integration

- **`state.ts`**: add `GateState`, `BitcrusherState`, `LimiterState` + `*_DEFAULT`.
  Widen `EffectId` (in `EffectUnit.ts`) by `gate | bitcrusher | limiter`. Widen
  `DEFAULT_ORDER` 10→13 to
  `['djfilter','eq','gate','comp','sat','bitcrusher','ms','pan','tremolo','delay','reverb','limiter','trim']`.
- **`EffectUnit.ts`**: add optional `materialize?(): void`. `EffectMeter` already
  has `{ reductionDb?, open? }` — no change needed.
- **`composer.ts`**: import + register the 3 worklet factories in `units`; after
  building, fire `registerWorklets(ctx).then(materialize all).catch(noop)`.
- **`useAudioGraph.ts`**: `EffectParamMap` +3 and the three worklet state TYPE
  imports are widened **in Task 1** (so the hook's `EffectParamMap[K]` indexing
  keeps `tsc -b` green the moment `EffectId` grows — the Phase-4 lesson: widening
  `EffectId` otherwise breaks hook indexing AND the composer `Record`; only the
  composer `Record` is allowed to stay interim-broken, until its task). The runtime
  wiring — 3 state refs + 3 apply helpers + 3 `applyEffectParams` cases +
  `resetAll` + the 3 `*_DEFAULT` value imports — lands in Task 10.
  `readEffectMeter(id)` already routes to `units[id].readMeter?.()`, so gate/limiter
  return live data once materialized.

> **Interim typecheck (Phase-4 lesson):** widening `EffectId` in Task 1 makes the
> composer's `units: Record<EffectId, …>` incomplete until the composer task. So
> the interim tasks report exactly one expected residual `npx tsc -b` error —
> `composer.ts` units-map missing keys — which the composer task clears. Each
> task's own new files must add no error. Do not edit `composer.ts` to silence it
> outside the composer task. (`npx tsc --noEmit` is a no-op here; the real gate is
> `npx tsc -b`. The plan's task numbering is authoritative.)

---

## Behavior preservation

- The three worklet units default `enabled:false` → `setWet(0)` → dry passthrough,
  both as placeholders and once materialized. Inserting three transparent units
  into the chain keeps output bit-equivalent to Phase 4's ten-unit default chain.
- The boot is asynchronous and non-blocking; a registration failure leaves
  passthrough placeholders. No native unit, the pitch lane, master bypass, or
  analyser taps are touched.
- `DEFAULT_ORDER` grows by three transparent units; `reorder` math is unchanged
  (already order-generic).

## Testability

- Pure math — `stepGate`, `quantizeSample` (+ S&H helper), `stepLimiter` — is
  unit-tested with vitest (state transitions, quantization levels, ceiling never
  exceeded, release ramps, bounds).
- Processors, the `AudioWorkletNode` wiring, the boot/registration, and the
  placeholder swap are AudioNode/worklet code: verified by `tsc -b` (the ambient
  d.ts makes worklet scope typecheck) + `npm run build` (must emit the three
  worklet assets) + a deferred manual browser smoke. Web Audio / AudioWorklet do
  not run in jsdom — no jsdom tests for processor or node-wiring code.

## Validation gates (run from `components/frontend-spectr-v2`)

`npx tsc -b` (the real typecheck — `tsc --noEmit` is a no-op under project
references) · `npm run lint` (`--max-warnings 0`) · `npx vitest run` ·
`npm run build` (must succeed AND emit the three worklet chunks). All green at the
branch tip before merge.

## Task outline (for the plan, ~11 TDD tasks)

1. `state.ts` — 3 states/defaults; widen `EffectId` + `DEFAULT_ORDER`;
   `EffectParamMap` +3; `EffectUnit.materialize?`; `audioworklet.d.ts`.
2. `dsp/gateMath.ts` (+ tests).
3. `dsp/quantize.ts` (+ tests).
4. `dsp/limiterMath.ts` (+ tests).
5. `audio/worklets.ts` `registerWorklets` + the placeholder-swap unit helper /
   contract (shared `materialize` scaffolding).
6. `gate.processor.ts` + `effects/gate.ts` unit.
7. `bitcrusher.processor.ts` + `effects/bitcrusher.ts` unit.
8. `limiter.processor.ts` + `effects/limiter.ts` unit.
9. `composer.ts` — register the 3 + fire boot/materialize.
10. `useAudioGraph.ts` — refs/helpers/cases/resetAll (+ `EffectParamMap` if not in T1).

## Risks

- **Vite worklet bundling (RESOLVED during impl)** — the plain
  `new URL('./x.processor.ts', import.meta.url)` form does NOT transpile in this
  setup; it emits raw TS that `addModule` rejects (caught + decoded during Task
  10). The working form is `import url from './x.processor.ts?worker&url'`, which
  transpiles + bundles the pure-math imports into a standalone JS chunk. A
  processor that still fails to register at runtime degrades to passthrough
  (caught). The manual smoke still matters most this phase (jsdom can't load
  worklets), but the decode-of-emitted-chunk check gives high build-time
  confidence.
- **Worklet ambient types** — `audioworklet.d.ts` must cover exactly what the
  processors use, or `tsc -b` fails; over-declaring risks masking a real type
  error. Keep it minimal and matched to usage.
- **`exactOptionalPropertyTypes`** (tsconfig) — optional fields (`ready`, meter
  shape, `materialize?`) must be handled without assigning `undefined` to a
  non-optional slot.
- **Async timing** — `applyParams` before `materialize()` buffers state and must
  reapply it on materialize, or an early param set is lost. The `lastState` cache
  covers this.
- **Worklet idle cost** — three always-instantiated processors run `process()`
  every quantum even when bypassed. Negligible for three nodes; consistent with
  the existing always-on time-based effects.
