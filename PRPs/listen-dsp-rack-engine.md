# Listen DSP Rack Engine — Phase 1: Modular Refactor (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Listen page's monolithic `useAudioGraph.ts` into a modular `EffectUnit` architecture — extract the existing 5 processors (EQ, Compressor, Saturator, M/S Width, Pitch) into isolated units composed by a thin graph hook — with **zero change to sound or to the public handle API**.

**Architecture:** Each effect becomes an `EffectUnit` with stable `input`/`output` AudioNodes and a uniform dry/wet bypass. A `composer` wires units in series between the source and the analyser tail. `useAudioGraph` shrinks to: build boundary nodes (source, master-bypass lane, analysers, destination), build + wire the units, and keep the pitch BufferSource lane / `readFrame` verbatim. Shared param types + defaults move to a leaf `audio/state.ts` (no import cycles); `useAudioGraph` re-exports them so existing consumers are untouched. Pure DSP math (saturation curve, M/S matrix, dry/wet gains) is extracted to `audio/dsp/` and unit-tested; Web Audio node wiring is verified by `tsc` + build + a manual Listen-page check, since AudioContext does not run in jsdom.

**Tech Stack:** TypeScript 5 (strict, `verbatimModuleSyntax`), React 19, Vite 6, Vitest, Web Audio API.

**Scope note:** This is Phase 1 of 6 from `PRPs/listen-dsp-rack-engine-design.md`. It adds **no new parameters and no new modules** — a pure, behavior-preserving restructure. Phases 2-6 (reorder/bypass infra, unhide existing params, new native modules, worklet modules, metering) are separate plans authored after this ships.

## Global Constraints

- TypeScript strict + `verbatimModuleSyntax`: type-only imports MUST use `import type` (or inline `import { type X }`).
- No file over ~500 lines. Split when approaching.
- Four gates must all pass before every commit, run from `components/frontend-spectr-v2`:
  - `npx tsc --noEmit`
  - `npm run lint` (configured `--max-warnings 0`)
  - `npm run build`
  - `npx vitest run`
- Behavior-preserving: the `AudioGraphHandle` public surface (`ensureContext`, `context`, `setEqBand`, `setEqEnabled`, `setCompressor`, `setSaturation`, `setWidth`, `setMasterBypass`, `resetAll`, all `pitch*`, `enterPitchMode`, `exitPitchMode`, `setPitchDetune`, `readFrame`) MUST keep identical signatures and behavior. The re-exported names (`EqBand`, `CompressorState`, `SaturationState`, `WidthState`, `EQ_BANDS_DEFAULT`, `COMPRESSOR_DEFAULT`, `SATURATION_DEFAULT`, `WIDTH_DEFAULT`) MUST remain importable from `./useAudioGraph`. `PreviewTools.tsx`, `PitchPanel.tsx`, and `listen.$versionId.tsx` are NOT modified in Phase 1.
- Pure DSP math is unit-tested; AudioNode-wiring code is not (jsdom has no AudioContext) — verify those via `tsc`/build + manual.
- All work in `components/frontend-spectr-v2/src/features/listen/`.

---

## File Structure

Dependency direction (a clean DAG — no cycles):

```
dsp/{curves,msMatrix,mix}.ts      (leaves; pure; unit-tested)
EffectUnit.ts                     -> dsp/mix
state.ts                          -> EffectUnit (type only)   [owns shared types + defaults]
effects/{eq,compressor,saturator,width}.ts  -> EffectUnit, dsp/*, state (types)
composer.ts                       -> effects/*, state
useAudioGraph.ts                  -> composer, state          [re-exports state's types/defaults]
PreviewTools/route                -> useAudioGraph            (unchanged consumers)
```

**Created in Phase 1:**
- `audio/dsp/curves.ts` + `curves.test.ts` — `makeSatCurve(drive)`.
- `audio/dsp/msMatrix.ts` + `msMatrix.test.ts` — `msGains(width)`.
- `audio/dsp/mix.ts` + `mix.test.ts` — `wetDryGains(amount)`.
- `audio/EffectUnit.ts` — `EffectId`, `EffectUnit<S>`, `EffectMeter`, `makeDryWet()`.
- `audio/state.ts` — shared param types + defaults (moved from `useAudioGraph`), `EqState`, `default*State()`, `DEFAULT_ORDER`.
- `audio/effects/{eq,compressor,saturator,width}.ts` — `create*Unit(ctx)`.
- `audio/composer.ts` — `buildInsertChain(ctx)`.

**Modified in Phase 1:**
- `useAudioGraph.ts` — twice: (Task 4) source the 4 shared types + defaults from `state.ts` and re-export them; (Task 10) replace inline EQ/comp/sat/width nodes with the composer.

**Unchanged consumers:** `PreviewTools.tsx`, `PitchPanel.tsx`, `listen.$versionId.tsx`.

---

### Task 1: Saturation curve — pure math extraction

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/dsp/curves.ts`
- Test: `components/frontend-spectr-v2/src/features/listen/audio/dsp/curves.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `makeSatCurve(drive: number): Float32Array` — identical to the current private `makeSatCurve` in `useAudioGraph.ts:189-199`. `k = 1 + drive*4`, normalized by `tanh(k)`.

- [ ] **Step 1: Write the failing test**

```ts
// curves.test.ts
import { describe, expect, it } from 'vitest';
import { makeSatCurve } from './curves';

describe('makeSatCurve', () => {
  it('returns a 1024-sample curve spanning -1..1 at the ends', () => {
    const c = makeSatCurve(0);
    expect(c).toHaveLength(1024);
    expect(c[0]).toBeCloseTo(-1, 5);
    expect(c[1023]).toBeCloseTo(1, 5);
  });

  it('is near-linear at drive 0 (midpoint ~= 0)', () => {
    const c = makeSatCurve(0);
    expect(c[512]).toBeCloseTo(0, 2);
  });

  it('compresses toward the rails as drive rises', () => {
    const low = makeSatCurve(0);
    const high = makeSatCurve(1);
    const idx = 700; // x > 0
    expect(high[idx]).toBeGreaterThan(low[idx]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen/audio/dsp/curves.test.ts`
Expected: FAIL — `Failed to resolve import "./curves"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// curves.ts
// Tanh saturation curve. drive 0 -> linear y=x. drive 1 -> strong tanh(5x)
// compression. 1024 samples between -1..1. Moved verbatim from useAudioGraph.
export function makeSatCurve(drive: number): Float32Array {
  const n = 1024;
  const out = new Float32Array(n);
  const k = 1 + drive * 4;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    out[i] = Math.tanh(k * x) / norm;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen/audio/dsp/curves.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/listen/audio/dsp/curves.ts src/features/listen/audio/dsp/curves.test.ts
git commit -m "refactor(listen): extract makeSatCurve to audio/dsp/curves"
```

---

### Task 2: M/S width matrix — pure math extraction

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/dsp/msMatrix.ts`
- Test: `components/frontend-spectr-v2/src/features/listen/audio/dsp/msMatrix.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `msGains(width: number): { midL: number; midR: number; sideL: number; sideR: number }` — the four matrix gains from `applyWidth` (`useAudioGraph.ts:397-405`).

- [ ] **Step 1: Write the failing test**

```ts
// msMatrix.test.ts
import { describe, expect, it } from 'vitest';
import { msGains } from './msMatrix';

describe('msGains', () => {
  it('is identity at width 1 (passthrough)', () => {
    expect(msGains(1)).toEqual({ midL: 1, midR: 0, sideL: 0, sideR: 1 });
  });
  it('collapses to mono at width 0 (all 0.5)', () => {
    expect(msGains(0)).toEqual({ midL: 0.5, midR: 0.5, sideL: 0.5, sideR: 0.5 });
  });
  it('exaggerates at width 2', () => {
    expect(msGains(2)).toEqual({ midL: 1.5, midR: -0.5, sideL: -0.5, sideR: 1.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen/audio/dsp/msMatrix.test.ts`
Expected: FAIL — cannot resolve `./msMatrix`.

- [ ] **Step 3: Write minimal implementation**

```ts
// msMatrix.ts
// Channel-matrix gains for the M/S width control. width=1 identity, width=0
// mono, width=2 exaggerated. Wired as:
//   L_out = L_in*midL + R_in*sideL ; R_out = L_in*midR + R_in*sideR
export function msGains(width: number): {
  midL: number;
  midR: number;
  sideL: number;
  sideR: number;
} {
  return {
    midL: 0.5 + 0.5 * width,
    midR: 0.5 - 0.5 * width,
    sideL: 0.5 - 0.5 * width,
    sideR: 0.5 + 0.5 * width,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen/audio/dsp/msMatrix.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/listen/audio/dsp/msMatrix.ts src/features/listen/audio/dsp/msMatrix.test.ts
git commit -m "refactor(listen): extract M/S matrix gains to audio/dsp/msMatrix"
```

---

### Task 3: Dry/wet gain math + `EffectUnit` contract

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/dsp/mix.ts`
- Test: `components/frontend-spectr-v2/src/features/listen/audio/dsp/mix.test.ts`
- Create: `components/frontend-spectr-v2/src/features/listen/audio/EffectUnit.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `wetDryGains(amount: number): { dry: number; wet: number }` — clamps to 0..1, returns `{ dry: 1-a, wet: a }`.
  - `type EffectId = 'eq' | 'comp' | 'sat' | 'ms'` (extended in later phases).
  - `interface EffectMeter { reductionDb?: number; open?: boolean }`.
  - `interface EffectUnit<S> { readonly id: EffectId; readonly input: AudioNode; readonly output: AudioNode; applyParams(state: S): void; setBypass(bypassed: boolean): void; readMeter?(): EffectMeter; dispose(): void }`.
  - `makeDryWet(ctx, wetIn, wetOut): { input: GainNode; output: GainNode; setWet(amount: number): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// mix.test.ts
import { describe, expect, it } from 'vitest';
import { wetDryGains } from './mix';

describe('wetDryGains', () => {
  it('full wet at 1', () => expect(wetDryGains(1)).toEqual({ dry: 0, wet: 1 }));
  it('full dry (bypass) at 0', () => expect(wetDryGains(0)).toEqual({ dry: 1, wet: 0 }));
  it('50/50 at 0.5', () => expect(wetDryGains(0.5)).toEqual({ dry: 0.5, wet: 0.5 }));
  it('clamps out-of-range input', () => {
    expect(wetDryGains(2)).toEqual({ dry: 0, wet: 1 });
    expect(wetDryGains(-1)).toEqual({ dry: 1, wet: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen/audio/dsp/mix.test.ts`
Expected: FAIL — cannot resolve `./mix`.

- [ ] **Step 3: Write `mix.ts`**

```ts
// mix.ts
// Equal-gain dry/wet split. amount is the wet fraction (0 = bypass, 1 = full
// effect). Used by every EffectUnit's bypass + mix control.
export function wetDryGains(amount: number): { dry: number; wet: number } {
  const a = Math.max(0, Math.min(1, amount));
  return { dry: 1 - a, wet: a };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen/audio/dsp/mix.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `EffectUnit.ts`** (contract + AudioNode helper — verified by `tsc`)

```ts
// EffectUnit.ts
import { wetDryGains } from './dsp/mix';

export type EffectId = 'eq' | 'comp' | 'sat' | 'ms';

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
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/listen/audio/dsp/mix.ts src/features/listen/audio/dsp/mix.test.ts src/features/listen/audio/EffectUnit.ts
git commit -m "feat(listen): add EffectUnit contract + dry/wet bypass helper"
```

---

### Task 4: Leaf `state.ts` (own the shared types + defaults) + re-export from `useAudioGraph`

This breaks the would-be import cycle: the param types and defaults move OUT of `useAudioGraph` into a leaf, and `useAudioGraph` re-exports them so consumers (`PreviewTools`, route) keep importing from `./useAudioGraph` unchanged.

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/state.ts`
- Modify: `components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts`

**Interfaces:**
- Consumes: `EffectId` from `./EffectUnit` (type only).
- Produces (from `state.ts`):
  - Types: `EqBand`, `CompressorState`, `SaturationState`, `WidthState`, `EqState` (`{ bands: EqBand[]; enabled: boolean }`).
  - Defaults: `EQ_BANDS_DEFAULT`, `COMPRESSOR_DEFAULT`, `SATURATION_DEFAULT`, `WIDTH_DEFAULT`.
  - Factories: `defaultEqState()`, `defaultCompState()`, `defaultSatState()`, `defaultWidthState()`.
  - `DEFAULT_ORDER: EffectId[] = ['eq','comp','sat','ms']`.
- `useAudioGraph` re-exports all five types + four default consts.

- [ ] **Step 1: Write `state.ts`** (verbatim copies of the current type bodies + defaults from `useAudioGraph.ts:19-43, 100-130`)

```ts
// state.ts — single source of truth for effect param types + neutral defaults.
import type { EffectId } from './EffectUnit';

export interface EqBand {
  freq: number;
  gainDb: number;
}

export interface CompressorState {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
  enabled: boolean;
}

export interface SaturationState {
  drive: number; // 0..1
  mix: number; // 0..1 dry->wet
  enabled: boolean;
}

export interface WidthState {
  width: number; // 0..2 (1 = identity, 0 = mono, 2 = exaggerated)
  enabled: boolean;
}

export interface EqState {
  bands: EqBand[];
  enabled: boolean;
}

export const EQ_BANDS_DEFAULT: ReadonlyArray<EqBand> = [
  { freq: 60, gainDb: 0 },
  { freq: 170, gainDb: 0 },
  { freq: 350, gainDb: 0 },
  { freq: 700, gainDb: 0 },
  { freq: 1400, gainDb: 0 },
  { freq: 3500, gainDb: 0 },
  { freq: 7000, gainDb: 0 },
  { freq: 14000, gainDb: 0 },
];

export const COMPRESSOR_DEFAULT: CompressorState = {
  thresholdDb: 0,
  ratio: 1,
  attackMs: 3,
  releaseMs: 250,
  kneeDb: 30,
  makeupDb: 0,
  enabled: false,
};

export const SATURATION_DEFAULT: SaturationState = {
  drive: 0,
  mix: 0,
  enabled: false,
};

export const WIDTH_DEFAULT: WidthState = {
  width: 1,
  enabled: false,
};

// Phase-1 default insert order. Matches the legacy chain EQ -> Comp -> Sat -> M/S.
export const DEFAULT_ORDER: EffectId[] = ['eq', 'comp', 'sat', 'ms'];

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
```

- [ ] **Step 2: Edit `useAudioGraph.ts` — delete the moved definitions, import from `state.ts`, re-export**

Remove from `useAudioGraph.ts`: the `EqBand` (19-22), `CompressorState` (24-32), `SaturationState` (34-38), `WidthState` (40-43) interface declarations and the `EQ_BANDS_DEFAULT` (100-109), `COMPRESSOR_DEFAULT` (111-119), `SATURATION_DEFAULT` (121-125), `WIDTH_DEFAULT` (127-130) consts. Add near the top of the file:

```ts
import {
  EQ_BANDS_DEFAULT,
  COMPRESSOR_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
  type EqBand,
  type CompressorState,
  type SaturationState,
  type WidthState,
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
```

`PitchState`, `PITCH_DEFAULT`, `AudioFrame`, `AudioGraphHandle`, `EMPTY_FRAME`, `makeSatCurve` usage etc. stay in `useAudioGraph` for now (the inline nodes are still present until Task 10).

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS. (If `tsc` reports a duplicate identifier, a moved declaration was not fully deleted from `useAudioGraph`.)

- [ ] **Step 4: Lint + tests + build (consumers must still resolve the re-exports)**

Run: `npm run lint && npx vitest run && npm run build`
Expected: PASS. `PreviewTools.tsx` / route still import `COMPRESSOR_DEFAULT` etc. from `./useAudioGraph` successfully.

- [ ] **Step 5: Commit**

```bash
git add src/features/listen/audio/state.ts src/features/listen/useAudioGraph.ts
git commit -m "refactor(listen): move effect param types + defaults to leaf audio/state"
```

---

### Task 5: EQ unit

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/effects/eq.ts`

**Interfaces:**
- Consumes: `EqBand`, `EqState` from `../state` (types); `makeDryWet`, `EffectUnit` from `../EffectUnit`.
- Produces: `createEqUnit(ctx: AudioContext): EffectUnit<EqState>`. 8 series `BiquadFilterNode`s (`type='peaking'`, `Q=1.4`, freqs `[60,170,350,700,1400,3500,7000,14000]`). `applyParams` sets each `filter.gain` from `state.bands` when `enabled`, else 0; wet 1 enabled / 0 bypassed.

Creates AudioNodes → verified by `tsc` + build, not unit test.

- [ ] **Step 1: Write `eq.ts`**

```ts
// eq.ts
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { EqState } from '../state';

const EQ_FREQS = [60, 170, 350, 700, 1400, 3500, 7000, 14000];

export function createEqUnit(ctx: AudioContext): EffectUnit<EqState> {
  const filters = EQ_FREQS.map((freq) => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1.4;
    f.gain.value = 0;
    return f;
  });
  for (let i = 0; i < filters.length - 1; i += 1) {
    filters[i].connect(filters[i + 1]);
  }
  const { input, output, setWet } = makeDryWet(ctx, filters[0], filters[filters.length - 1]);

  return {
    id: 'eq',
    input,
    output,
    applyParams: (state: EqState) => {
      for (let i = 0; i < filters.length; i += 1) {
        filters[i].gain.value = state.enabled ? state.bands[i]?.gainDb ?? 0 : 0;
      }
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      filters.forEach((f) => f.disconnect());
      input.disconnect();
      output.disconnect();
    },
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/eq.ts
git commit -m "feat(listen): add EQ effect unit"
```

---

### Task 6: Compressor unit

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/effects/compressor.ts`

**Interfaces:**
- Consumes: `CompressorState` from `../state`; `makeDryWet`, `EffectMeter`, `EffectUnit` from `../EffectUnit`.
- Produces: `createCompressorUnit(ctx): EffectUnit<CompressorState>`. `DynamicsCompressorNode → makeup GainNode` wet sub-graph. Maps threshold/ratio/attack(÷1000)/release(÷1000)/knee + `makeup.gain = 10^(makeupDb/20)`; wet 1 enabled / 0 bypassed. `readMeter()` → `{ reductionDb: compressor.reduction }`.

- [ ] **Step 1: Write `compressor.ts`**

```ts
// compressor.ts
import { makeDryWet, type EffectMeter, type EffectUnit } from '../EffectUnit';
import type { CompressorState } from '../state';

export function createCompressorUnit(ctx: AudioContext): EffectUnit<CompressorState> {
  const compressor = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  compressor.connect(makeup);

  const { input, output, setWet } = makeDryWet(ctx, compressor, makeup);

  return {
    id: 'comp',
    input,
    output,
    applyParams: (state: CompressorState) => {
      compressor.threshold.value = state.thresholdDb;
      compressor.ratio.value = state.ratio;
      compressor.attack.value = state.attackMs / 1000;
      compressor.release.value = state.releaseMs / 1000;
      compressor.knee.value = state.kneeDb;
      makeup.gain.value = Math.pow(10, state.makeupDb / 20);
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    readMeter: (): EffectMeter => ({ reductionDb: compressor.reduction }),
    dispose: () => {
      compressor.disconnect();
      makeup.disconnect();
      input.disconnect();
      output.disconnect();
    },
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS. (If `compressor.reduction` is typed as `AudioParam` rather than `number` in this TS lib, read `compressor.reduction` — current `lib.dom` types it as `number`; adjust only if `tsc` complains.)

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/compressor.ts
git commit -m "feat(listen): add compressor effect unit with GR meter read"
```

---

### Task 7: Saturator unit

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/effects/saturator.ts`

**Interfaces:**
- Consumes: `SaturationState` from `../state`; `makeSatCurve` from `../dsp/curves`; `makeDryWet`, `EffectUnit` from `../EffectUnit`.
- Produces: `createSaturatorUnit(ctx): EffectUnit<SaturationState>`. `WaveShaperNode` (`oversample='2x'`) as the wet node. `applyParams` rebuilds `shaper.curve = makeSatCurve(enabled ? drive : 0)` and sets wet to `enabled ? mix : 0` — reproducing today's `satDry=1-wet`, `satWet=wet`.

- [ ] **Step 1: Write `saturator.ts`**

```ts
// saturator.ts
import { makeSatCurve } from '../dsp/curves';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { SaturationState } from '../state';

export function createSaturatorUnit(ctx: AudioContext): EffectUnit<SaturationState> {
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSatCurve(0);
  shaper.oversample = '2x';

  const { input, output, setWet } = makeDryWet(ctx, shaper, shaper);

  return {
    id: 'sat',
    input,
    output,
    applyParams: (state: SaturationState) => {
      shaper.curve = makeSatCurve(state.enabled ? state.drive : 0);
      setWet(state.enabled ? state.mix : 0);
    },
    // A saturator has no "full wet" identity — its wet level IS the mix param,
    // re-applied by the next applyParams. Bypass forces dry.
    setBypass: () => setWet(0),
    dispose: () => {
      shaper.disconnect();
      input.disconnect();
      output.disconnect();
    },
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/saturator.ts
git commit -m "feat(listen): add saturator effect unit"
```

---

### Task 8: M/S Width unit

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/effects/width.ts`

**Interfaces:**
- Consumes: `WidthState` from `../state`; `msGains` from `../dsp/msMatrix`; `makeDryWet`, `EffectUnit` from `../EffectUnit`.
- Produces: `createWidthUnit(ctx): EffectUnit<WidthState>`. ChannelSplitter → 4 gains → ChannelMerger wet sub-graph. `applyParams` sets the four gains from `msGains(enabled ? width : 1)`. width=1 is identity, so bypass forces the identity matrix (wet stays 1).

- [ ] **Step 1: Write `width.ts`**

```ts
// width.ts
import { msGains } from '../dsp/msMatrix';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { WidthState } from '../state';

export function createWidthUnit(ctx: AudioContext): EffectUnit<WidthState> {
  const splitter = ctx.createChannelSplitter(2);
  const midL = ctx.createGain();
  const midR = ctx.createGain();
  const sideL = ctx.createGain();
  const sideR = ctx.createGain();
  const merger = ctx.createChannelMerger(2);

  // L_in -> midL -> merger.0 ; R_in -> sideL -> merger.0
  // L_in -> midR -> merger.1 ; R_in -> sideR -> merger.1
  splitter.connect(midL, 0);
  splitter.connect(sideL, 1);
  splitter.connect(midR, 0);
  splitter.connect(sideR, 1);
  midL.connect(merger, 0, 0);
  sideL.connect(merger, 0, 0);
  midR.connect(merger, 0, 1);
  sideR.connect(merger, 0, 1);

  const setMatrix = (width: number) => {
    const g = msGains(width);
    midL.gain.value = g.midL;
    midR.gain.value = g.midR;
    sideL.gain.value = g.sideL;
    sideR.gain.value = g.sideR;
  };
  setMatrix(1); // identity default

  const { input, output, setWet } = makeDryWet(ctx, splitter, merger);

  return {
    id: 'ms',
    input,
    output,
    applyParams: (state: WidthState) => setMatrix(state.enabled ? state.width : 1),
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [splitter, midL, midR, sideL, sideR, merger, input, output].forEach((n) =>
        n.disconnect(),
      );
    },
  };
}
```

> Bypass uses the dry/wet lane (uniform with EQ/comp): wet=0 routes the original stereo through untouched. width=1 is also identity, so `applyParams` with `enabled=false` is transparent too. (A later phase that adds independent mid/side gains will revisit the matrix.)

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/width.ts
git commit -m "feat(listen): add M/S width effect unit"
```

---

### Task 9: Composer — build + wire the insert chain

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/composer.ts`

**Interfaces:**
- Consumes: the four `create*Unit` factories; `DEFAULT_ORDER` from `./state`; `EffectId`, `EffectUnit` from `./EffectUnit`.
- Produces: `buildInsertChain(ctx): InsertChain` where
  ```ts
  interface InsertChain {
    input: AudioNode;
    output: AudioNode;
    units: Record<EffectId, EffectUnit<unknown>>;
    dispose: () => void;
  }
  ```
  Builds all four units, wires `units[a].output → units[b].input` in `DEFAULT_ORDER`, exposes first input + last output. (Reorder is Phase 2; wiring here is static.)

- [ ] **Step 1: Write `composer.ts`**

```ts
// composer.ts
import { createCompressorUnit } from './effects/compressor';
import { createEqUnit } from './effects/eq';
import { createSaturatorUnit } from './effects/saturator';
import { createWidthUnit } from './effects/width';
import { DEFAULT_ORDER } from './state';
import type { EffectId, EffectUnit } from './EffectUnit';

export interface InsertChain {
  input: AudioNode;
  output: AudioNode;
  units: Record<EffectId, EffectUnit<unknown>>;
  dispose: () => void;
}

export function buildInsertChain(ctx: AudioContext): InsertChain {
  const units: Record<EffectId, EffectUnit<unknown>> = {
    eq: createEqUnit(ctx) as EffectUnit<unknown>,
    comp: createCompressorUnit(ctx) as EffectUnit<unknown>,
    sat: createSaturatorUnit(ctx) as EffectUnit<unknown>,
    ms: createWidthUnit(ctx) as EffectUnit<unknown>,
  };

  const ordered = DEFAULT_ORDER.map((id) => units[id]);
  for (let i = 0; i < ordered.length - 1; i += 1) {
    ordered[i].output.connect(ordered[i + 1].input);
  }

  return {
    input: ordered[0].input,
    output: ordered[ordered.length - 1].output,
    units,
    dispose: () => Object.values(units).forEach((u) => u.dispose()),
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/composer.ts
git commit -m "feat(listen): add insert-chain composer (static wiring)"
```

---

### Task 10: Integrate composer into `useAudioGraph` (behavior-preserving)

**Files:**
- Modify: `components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts`

**Interfaces:**
- Consumes: `buildInsertChain`, `InsertChain` from `./audio/composer`.
- Produces: unchanged public `AudioGraphHandle`. Internals delegate to `nodes.chain.units.*`.

Verified by the **full gate suite + a manual Listen-page smoke test** (graph wiring can't run in jsdom).

**Changes inside `buildGraph` (lines ~240-394):**
- Delete the inline EQ filter array, the compressor + makeup nodes, the saturation nodes (`satIn/satDry/satWet/satShaper/satMix`), and the width matrix nodes — and the verbose comment block describing them.
- Add `const chain = buildInsertChain(ctx);`.
- Keep `source`, the master-bypass lane (`masterIn/masterDry/masterProcessed/masterOut`), and the analyser tail.
- Replace the processed-lane wiring with the snippet below.
- Replace the per-node fields on the returned `Nodes` object with `chain`.

**Changes to the `apply*` helpers (lines 396-447):**
- `applyEq()` → `nodes.chain.units.eq.applyParams({ bands: eqStateRef.current, enabled: true })`. **Pass `enabled: true` unconditionally.** The EQ unit's `enabled` flag gates the whole EQ (zeroes gains + wet 0), but the ONLY consumer (`PreviewTools.tsx:75`) drives EQ by pre-gating each band gain itself (`graph.setEqBand(i, eqEnabled ? b.gainDb : 0)`) and never calls the graph's `setEqEnabled`. So the gating already lives in `eqStateRef`'s gain values; the unit must apply them as-is and stay in series (wet 1). Routing enable through the unit flag would leave it `false` forever and silently kill EQ.
- `applyCompressor()` → `nodes.chain.units.comp.applyParams(compStateRef.current)`. (Comp/Sat/Width DO carry `enabled` from the consumer's mirrored state, so their unit-level gating is correct.)
- `applySaturation()` → `nodes.chain.units.sat.applyParams(satStateRef.current)`.
- `applyWidth()` → `nodes.chain.units.ms.applyParams(widthStateRef.current)`.
- `applyMasterBypass()` unchanged.
- **Do NOT add an `eqEnabledRef`.** Keep `setEqEnabled`'s existing handle behavior verbatim (when `enabled=false` it zeroes the band gains in `eqStateRef`, then calls `applyEq()`); keep `setEqBand` verbatim (mutates `eqStateRef[index].gainDb`, then `applyEq()`). This preserves the exact current external behavior.
- `resetAll()` resets `eqStateRef` to `EQ_BANDS_DEFAULT` as today (no `eqEnabledRef` to reset).

**Stays byte-for-byte:** the pitch BufferSource lane, `readFrame`, `ensureContext`, cleanup, the memoized handle shape, and `makeSatCurve` is now imported (or removed if only the unit uses it — the inline `makeSatCurve` definition in `useAudioGraph` can be deleted since the saturator unit owns it via `dsp/curves`).

- [ ] **Step 1: Apply the `buildGraph` + `apply*` + `eqEnabledRef` edits**

New processed-lane wiring inside `buildGraph`:

```ts
const chain = buildInsertChain(ctx);

// Dry passthrough lane (master bypass) — unchanged.
masterIn.connect(masterDry).connect(masterOut);
// Processed lane now runs through the composed insert chain.
masterIn.connect(chain.input);
chain.output.connect(masterProcessed).connect(masterOut);

masterOut.connect(analyserMain);
analyserMain.connect(scopeSplitter);
scopeSplitter.connect(analyserL, 0);
scopeSplitter.connect(analyserR, 1);
masterOut.connect(ctx.destination);
```

New `Nodes` interface (boundary + chain only):

```ts
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
```

Delete the now-unused `makeSatCurve` function from `useAudioGraph` (the `FFT_SIZE`/`BAND_*` constants and the pitch helpers remain). The `return { ... }` at the end of `buildGraph` now lists `ctx, source, chain, masterIn, masterDry, masterProcessed, masterOut, analyserMain, scopeSplitter, analyserL, analyserR`. Add `import { buildInsertChain, type InsertChain } from './audio/composer';`.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS. Fix any lingering reference to a deleted node field (`nodes.eqFilters`, `nodes.compressor`, `nodes.makeup`, `nodes.satShaper`, `nodes.widthMidL`, etc.) — all processed-lane access now goes through `nodes.chain`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS, 0 warnings.

- [ ] **Step 4: Full test suite**

Run: `npx vitest run`
Expected: PASS — existing listen tests + the 3 new dsp test files (curves, msMatrix, mix) green.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Manual smoke test (behavior preservation)**

`npm run dev` with the BFF up; open a version's Listen page and confirm vs pre-refactor:
- Audio plays; spectrum + meters move (analyser tail intact).
- EQ Low/Mid/Hi change tone; EQ OFF returns to flat.
- Compressor toggle + Thr/Ratio/Atk audibly compress.
- Saturation Drive/Mix add harmonics; OFF is clean.
- M/S Width narrows↔widens; OFF is identity.
- Rack header Bypass drops all processing; Reset restores defaults.
- Pitch toggle still decodes + detunes; Loop + Scope still work.

Expected: identical to pre-refactor.

- [ ] **Step 7: Commit**

```bash
git add src/features/listen/useAudioGraph.ts
git commit -m "refactor(listen): compose useAudioGraph from modular effect units"
```

---

## Self-Review

**1. Spec coverage (Phase 1 scope only):**
- EffectUnit interface + per-unit dry/wet bypass → Tasks 3, 5-8. ✓
- Thin composer; `useAudioGraph` reduced → Tasks 9-10. ✓
- Pure-math extraction + tests (curve, M/S, dry/wet) → Tasks 1-3. ✓
- Leaf state module (no import cycle) + handle/name back-compat → Task 4. ✓
- Behavior preservation, pitch lane / master bypass / analysers verbatim → Task 10. ✓
- New params / modules / reorder / worklets → correctly DEFERRED to Phases 2-6. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step has complete code. The two prose-described edits (Tasks 4 Step 2, 10 Step 1) give exact line ranges + the full new `Nodes`/import/wiring snippets, deliberately not reproducing the 800-line file verbatim (transcription-risk tradeoff, called out).

**3. Type consistency:** `EffectUnit<S>`, `EffectId`, `EffectMeter`, `makeDryWet`, `wetDryGains`, `msGains`, `makeSatCurve`, `buildInsertChain`, `InsertChain`, `EqState`, `EqBand`, `CompressorState`, `SaturationState`, `WidthState`, `DEFAULT_ORDER` — names used identically across producing/consuming tasks. The four effect state types + four defaults are defined once in `audio/state.ts` (Task 4) and re-exported by `useAudioGraph`; effects import them from `../state`; consumers keep importing from `./useAudioGraph`. No symbol is defined in two places. Import graph is acyclic (see File Structure).

**Gaps found:** none within Phase 1 scope.

---

## Next phases (separate plans, authored after Phase 1 ships)

- **Phase 2** — `reorder()` + duck; generalized bypass surface; `setEffectParams`/`getOrder` handle API.
- **Phase 3** — unhide existing params (EQ per-band freq/Q/type; comp release/knee/makeup + parallel mix + GR meter; sat curves/oversample/tone/asym/trim; M/S mid/side + mono-maker).
- **Phase 4** — new native modules (DJ Filter, Delay+bpmSync, Reverb+irSynth, Pan, Tremolo, Output Trim).
- **Phase 5** — worklet infra + Gate, Bitcrusher, Limiter.
- **Phase 6** — metering wiring (`readFrame`/`readMeter` → `buildMeterCells`).
