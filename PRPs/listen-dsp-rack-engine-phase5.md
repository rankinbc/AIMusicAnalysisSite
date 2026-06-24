# Listen DSP Rack — Phase 5: AudioWorklet Modules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three AudioWorklet effect modules (Gate, Bitcrusher, True Limiter) to the reorderable `EffectUnit` rack, with an async placeholder-then-swap boot, each transparent at its defaults.

**Architecture:** Per-sample DSP lives in pure, unit-tested modules under `audio/dsp/` and is imported by the worklet processors (Vite bundles each processor into a separate asset). A shared `createWorkletEffect` helper implements the placeholder-then-swap `EffectUnit` (stable `input`/`output`, a passthrough wet lane until `materialize()` builds the `AudioWorkletNode` and swaps it in). The composer fires `registerWorklets(ctx)` and materializes the three units when it resolves.

**Tech Stack:** React 19 + Vite 6 + TypeScript strict (`verbatimModuleSyntax`) + Vitest. Web Audio API + AudioWorklet.

**Spec:** `PRPs/listen-dsp-rack-engine-phase5-design.md` (this phase) · `PRPs/listen-dsp-rack-engine-design.md` (master §11–13, §108–126).

## Global Constraints

- **TYPECHECK GATE = `npx tsc -b`, NOT `npx tsc --noEmit`.** The root `tsconfig.json` uses project references with `"files": []`, so `tsc --noEmit` is a no-op that always passes. `npm run build` is `vite build && tsc -b` (vite strips types without checking).
- **Interim typecheck (Tasks 2–9):** widening `EffectId` (Task 1) makes `composer.ts`'s `units: Record<EffectId, …>` incomplete until the three worklet factories are registered (Task 10). So from Task 2 through Task 9, `npx tsc -b` reports exactly ONE expected residual error — `composer.ts` units-map missing keys (`gate`, `bitcrusher`, `limiter`). That error is expected and is cleared by Task 10. Each task's own new files must introduce NO `tsc -b` error. Do NOT edit `composer.ts` to silence it outside Task 10. (Task 1 also widens `EffectParamMap`, so the hook's `EffectParamMap[K]` indexing stays green — only the composer `Record` is allowed to be interim-broken.)
- **Behavior preservation:** the three worklet units default `enabled:false` → `setWet(0)` → dry passthrough, both as placeholders and once materialized. The default chain stays bit-equivalent to today.
- **Factory self-init:** `createWorkletEffect` calls `applyParams(defaultState)` as its last step, so a built unit is a dry passthrough without any sweep (there is no post-build `applyParams` sweep in `ensureContext`).
- **`materialize()` runs only after `registerWorklets` resolves** (the composer guarantees this). `new AudioWorkletNode(ctx, name, …)` throws if `name` isn't registered — never call `materialize()` before the boot promise resolves.
- **Bypass model:** `makeDryWet(ctx, wetIn, wetOut)`; `setWet(0)` = dry passthrough.
- **Processors run in worklet global scope:** they import ONLY pure math from `../dbScale` / `../gateMath` / `../quantize` / `../limiterMath`. No DOM/React/app-runtime imports. The ambient `audioworklet.d.ts` provides `AudioWorkletProcessor`, `registerProcessor`, `sampleRate`.
- **AudioParam name contract:** the keys returned by a unit's `config.params(state)` MUST exactly match the `name`s in the matching processor's `parameterDescriptors`.
- **Do NOT edit** `PreviewTools.tsx`, `PitchPanel.tsx`, the route, the pitch lane, master bypass, or analyser code. **No new PUBLIC handle method** (the three modules are driven only through generic `setEffectParams`).
- **Use DOM ambient types** (`AudioWorkletNode`, `MessageEvent`, `MessagePort`) — never redefine them. `import type` for type-only imports.
- **Web Audio / AudioWorklet do not run in jsdom.** Only `audio/dsp/*` pure math gets vitest tests. Processors, the worklet node wiring, the boot, and the swap are verified by `tsc -b` + `npm run build` (must emit the three worklet chunks) + a deferred manual browser smoke. Do NOT add jsdom tests for processor/node-wiring code, and do NOT treat their absence as a defect.
- **`exactOptionalPropertyTypes` is on** — do not assign `undefined` to an optional property; conditionally add it instead.
- **No file over ~500 lines.** All gates green at the branch tip before merge: `npx tsc -b` · `npm run lint` (`--max-warnings 0`) · `npx vitest run` · `npm run build`.

---

## File Structure

All paths under `components/frontend-spectr-v2/src/features/listen/`.

**Create:**
- `audio/dsp/dbScale.ts` (+ test) — `dbToLin`, `msToCoef` (shared unit conversions).
- `audio/dsp/gateMath.ts` (+ test) — `stepGate` envelope/gate state machine.
- `audio/dsp/quantize.ts` (+ test) — `quantizeSample` bit-depth staircase.
- `audio/dsp/limiterMath.ts` (+ test) — `stepLimiter` peak-limiter gain.
- `audio/worklets.ts` — `registerWorklets(ctx)` + `createWorkletEffect(ctx, config, default)` helper.
- `audio/dsp/processors/audioworklet.d.ts` — ambient worklet globals.
- `audio/dsp/processors/gate.processor.ts`, `bitcrusher.processor.ts`, `limiter.processor.ts`.
- `audio/effects/gate.ts`, `bitcrusher.ts`, `limiter.ts` — thin worklet-unit configs.

**Modify:**
- `audio/EffectUnit.ts` — widen `EffectId` by 3; add optional `materialize?(): void`.
- `audio/state.ts` — add 3 states + defaults; widen `DEFAULT_ORDER` 10→13.
- `audio/state.test.ts` — assert new defaults + `DEFAULT_ORDER`.
- `useAudioGraph.ts` — `EffectParamMap` +3 + 3 type imports (Task 1); 3 refs + helpers + cases + `resetAll` + value imports (Task 11).
- `audio/composer.ts` — register 3 worklet factories + fire the boot (Task 10).

---

## Task 1: State foundation + worklet scaffolding types

**Files:**
- Modify: `audio/EffectUnit.ts` (widen `EffectId`; add `materialize?`)
- Modify: `audio/state.ts` (3 states/defaults; widen `DEFAULT_ORDER`)
- Modify: `useAudioGraph.ts` (`EffectParamMap` +3; 3 type imports)
- Create: `audio/dsp/processors/audioworklet.d.ts`
- Test: `audio/state.test.ts`

**Interfaces:**
- Produces: `GateState`, `BitcrusherState`, `LimiterState` + `GATE_DEFAULT`, `BITCRUSHER_DEFAULT`, `LIMITER_DEFAULT`; widened `EffectId` (+`gate|bitcrusher|limiter`) and `DEFAULT_ORDER` (13 ids); `EffectUnit.materialize?`; the ambient worklet globals.

- [ ] **Step 1: Widen `EffectId` and add `materialize?` in `audio/EffectUnit.ts`**

Replace the `EffectId` union:

```ts
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
```

Add `materialize?` to the `EffectUnit<S>` interface (after `readMeter?`):

```ts
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
```

- [ ] **Step 2: Add the three worklet states + defaults in `audio/state.ts`**

Append after the existing `TRIM_DEFAULT` block (keep the existing `DEFAULT_ORDER` — it is REPLACED in Step 3):

```ts
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
```

- [ ] **Step 3: Widen `DEFAULT_ORDER` in `audio/state.ts`**

Replace the existing `DEFAULT_ORDER` (currently the 10-id Phase-4 array) with the 13-id chain (master §171 positions: gate after eq, bitcrusher after sat, limiter before trim):

```ts
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
```

- [ ] **Step 4: Widen `EffectParamMap` + add type imports in `useAudioGraph.ts`**

In the `from './audio/state'` import block, add the three state TYPE imports (alongside the existing ones):

```ts
  type GateState,
  type BitcrusherState,
  type LimiterState,
```

Extend the `EffectParamMap` interface to all 13 ids:

```ts
export interface EffectParamMap {
  eq: { bands: EqBand[] };
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
```

(Do NOT add the `*_DEFAULT` value imports yet — they are unused until Task 11's refs, and `noUnusedLocals` would error.)

- [ ] **Step 5: Create the ambient worklet declarations `audio/dsp/processors/audioworklet.d.ts`**

```ts
// Ambient declarations for the AudioWorklet global scope. Processors run there
// (not in the DOM), so these globals are not in the DOM lib. Minimal — only what
// the processors in this folder use.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

declare const sampleRate: number;
```

- [ ] **Step 6: Write the failing tests**

Append to `audio/state.test.ts` (add the new imports to the existing `'./state'` import):

```ts
import { GATE_DEFAULT, BITCRUSHER_DEFAULT, LIMITER_DEFAULT, DEFAULT_ORDER } from './state';

describe('phase-5 worklet defaults are transparent', () => {
  it('gate/bitcrusher/limiter default disabled', () => {
    expect(GATE_DEFAULT.enabled).toBe(false);
    expect(BITCRUSHER_DEFAULT.enabled).toBe(false);
    expect(LIMITER_DEFAULT.enabled).toBe(false);
  });

  it('identity-ish numeric defaults (bitcrusher transparent, limiter at -1 dBTP)', () => {
    expect(BITCRUSHER_DEFAULT.mix).toBe(0);
    expect(BITCRUSHER_DEFAULT.bitDepth).toBe(16);
    expect(BITCRUSHER_DEFAULT.downsample).toBe(1);
    expect(LIMITER_DEFAULT.ceilingDb).toBe(-1.0);
  });
});

describe('DEFAULT_ORDER (phase 5)', () => {
  it('is the 13-unit chain with worklets in their master-design slots', () => {
    expect(DEFAULT_ORDER).toEqual([
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
    ]);
  });
});
```

- [ ] **Step 7: Run the gates**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/state.test.ts
cd components/frontend-spectr-v2 && npx tsc -b 2>&1
```
Expected: vitest green (new + existing state tests). `tsc -b` shows exactly ONE error — `composer.ts` units-map missing `gate`/`bitcrusher`/`limiter` (expected; cleared in Task 10). No error in `state.ts`, `EffectUnit.ts`, `useAudioGraph.ts`, or `audioworklet.d.ts`.

- [ ] **Step 8: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/EffectUnit.ts components/frontend-spectr-v2/src/features/listen/audio/state.ts components/frontend-spectr-v2/src/features/listen/audio/state.test.ts components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/processors/audioworklet.d.ts
git commit -m "feat(listen): phase-5 worklet state, EffectId+3, DEFAULT_ORDER 13, materialize?, ambient worklet d.ts"
```

---

## Task 2: dbScale math (dbToLin, msToCoef)

**Files:**
- Create: `audio/dsp/dbScale.ts`
- Test: `audio/dsp/dbScale.test.ts`

**Interfaces:**
- Produces: `dbToLin(db: number): number`; `msToCoef(ms: number, sr: number): number`. Consumed by the gate + limiter processors (Tasks 7, 9).

- [ ] **Step 1: Write the failing test**

`audio/dsp/dbScale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dbToLin, msToCoef } from './dbScale';

describe('dbToLin', () => {
  it('0 dB is unity', () => {
    expect(dbToLin(0)).toBeCloseTo(1, 10);
  });
  it('-6 dB is ~0.501, -20 dB is 0.1', () => {
    expect(dbToLin(-6)).toBeCloseTo(0.50119, 4);
    expect(dbToLin(-20)).toBeCloseTo(0.1, 10);
  });
});

describe('msToCoef', () => {
  it('ms <= 0 is instantaneous (coef 1)', () => {
    expect(msToCoef(0, 48000)).toBe(1);
    expect(msToCoef(-5, 48000)).toBe(1);
  });
  it('is in (0,1) and smaller for longer time constants', () => {
    const fast = msToCoef(1, 48000);
    const slow = msToCoef(100, 48000);
    expect(fast).toBeGreaterThan(0);
    expect(fast).toBeLessThan(1);
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(fast); // longer ms => smaller coef => slower
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/dbScale.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `audio/dsp/dbScale.ts`**

```ts
export function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

// One-pole smoothing coefficient for a `ms` time constant at sample rate `sr`.
// Used as: value += (target - value) * coef.  ms <= 0 => 1 (instantaneous).
export function msToCoef(ms: number, sr: number): number {
  if (ms <= 0) return 1;
  return 1 - Math.exp(-1 / ((ms / 1000) * sr));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/dbScale.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/dbScale.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/dbScale.test.ts
git commit -m "feat(listen): dbToLin + msToCoef worklet math helpers"
```

---

## Task 3: gateMath (stepGate)

**Files:**
- Create: `audio/dsp/gateMath.ts`
- Test: `audio/dsp/gateMath.test.ts`

**Interfaces:**
- Produces: `GateRtState` (`{ env, gain, hold }`), `GateParams` (`{ thresholdLin, floorLin, attackCoef, releaseCoef, holdSamples }`), `stepGate(s, x, p): GateRtState`. Consumed by the gate processor (Task 7).

- [ ] **Step 1: Write the failing test**

`audio/dsp/gateMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stepGate, type GateParams, type GateRtState } from './gateMath';

// Instant attack/release so a single step reaches the target — keeps the
// state-machine assertions deterministic.
const P: GateParams = {
  thresholdLin: 0.1,
  floorLin: 0,
  attackCoef: 1,
  releaseCoef: 1,
  holdSamples: 3,
};
const start: GateRtState = { env: 0, gain: 0, hold: 0 };

describe('stepGate', () => {
  it('opens to unity when the signal is above threshold', () => {
    const s = stepGate(start, 1, P);
    expect(s.gain).toBeCloseTo(1, 6);
    expect(s.hold).toBe(3);
  });

  it('holds open for holdSamples after the signal drops, then closes to floor', () => {
    let s = stepGate(start, 1, P); // open, hold=3
    s = stepGate(s, 0, P); // below thr, hold 3->2, still open
    expect(s.gain).toBeCloseTo(1, 6);
    s = stepGate(s, 0, P); // hold 2->1
    s = stepGate(s, 0, P); // hold 1->0, still target 1 this step
    s = stepGate(s, 0, P); // hold exhausted -> target floor
    expect(s.gain).toBeCloseTo(0, 6);
  });

  it('keeps gain within [floor, 1]', () => {
    const floored: GateParams = { ...P, floorLin: 0.2 };
    let s: GateRtState = { env: 0, gain: 0.5, hold: 0 };
    for (let i = 0; i < 50; i += 1) s = stepGate(s, 0, floored);
    expect(s.gain).toBeGreaterThanOrEqual(0.2 - 1e-6);
    expect(s.gain).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('release is gradual when releaseCoef < 1', () => {
    const slow: GateParams = { ...P, releaseCoef: 0.1, holdSamples: 0 };
    let s: GateRtState = { env: 0, gain: 1, hold: 0 };
    s = stepGate(s, 0, slow); // one release step, should not snap to 0
    expect(s.gain).toBeGreaterThan(0.5);
    expect(s.gain).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/gateMath.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `audio/dsp/gateMath.ts`**

```ts
export interface GateRtState {
  env: number; // detector level follower
  gain: number; // current gate gain
  hold: number; // remaining hold samples
}

export interface GateParams {
  thresholdLin: number;
  floorLin: number;
  attackCoef: number; // rising gain smoothing (toward 1)
  releaseCoef: number; // falling gain smoothing (toward floor)
  holdSamples: number;
}

// Detector release per sample: the level follower rises instantly, falls slowly,
// so brief dips don't chatter the gate.
const ENV_DECAY = 0.999;

export function stepGate(s: GateRtState, x: number, p: GateParams): GateRtState {
  const a = Math.abs(x);
  const env = a > s.env ? a : a + (s.env - a) * ENV_DECAY;

  let hold = s.hold;
  let target: number;
  if (env >= p.thresholdLin) {
    hold = p.holdSamples;
    target = 1;
  } else if (hold > 0) {
    hold = hold - 1;
    target = 1;
  } else {
    target = p.floorLin;
  }

  const coef = target > s.gain ? p.attackCoef : p.releaseCoef;
  const gain = s.gain + (target - s.gain) * coef;
  return { env, gain, hold };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/gateMath.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/gateMath.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/gateMath.test.ts
git commit -m "feat(listen): gate envelope/state-machine math (stepGate)"
```

---

## Task 4: quantize (quantizeSample)

**Files:**
- Create: `audio/dsp/quantize.ts`
- Test: `audio/dsp/quantize.test.ts`

**Interfaces:**
- Produces: `quantizeSample(x: number, bitDepth: number): number`. Consumed by the bitcrusher processor (Task 8).

- [ ] **Step 1: Write the failing test**

`audio/dsp/quantize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { quantizeSample } from './quantize';

describe('quantizeSample', () => {
  it('is near-transparent at 16 bits', () => {
    for (const x of [-1, -0.3, 0, 0.42, 0.97, 1]) {
      expect(quantizeSample(x, 16)).toBeCloseTo(x, 3);
    }
  });

  it('1 bit collapses to round(x) in {-1, 0, 1}', () => {
    expect(quantizeSample(0.9, 1)).toBe(1);
    expect(quantizeSample(0.4, 1)).toBe(0);
    expect(quantizeSample(-0.9, 1)).toBe(-1);
  });

  it('stays within [-1, 1] for in-range input', () => {
    for (const bits of [1, 2, 4, 8, 16]) {
      for (const x of [-1, -0.5, 0, 0.5, 1]) {
        const y = quantizeSample(x, bits);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps bitDepth to [1, 16]', () => {
    expect(quantizeSample(0.42, 0)).toBe(quantizeSample(0.42, 1));
    expect(quantizeSample(0.42, 99)).toBe(quantizeSample(0.42, 16));
  });

  it('is non-decreasing in x (a staircase, never inverts)', () => {
    let prev = -Infinity;
    for (let x = -1; x <= 1; x += 0.01) {
      const y = quantizeSample(x, 4);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/quantize.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `audio/dsp/quantize.ts`**

```ts
// Mid-rise bit-depth quantizer over [-1, 1]. bitDepth 1..16; higher = finer steps.
export function quantizeSample(x: number, bitDepth: number): number {
  const bits = Math.max(1, Math.min(16, bitDepth));
  const q = Math.pow(2, bits - 1);
  return Math.round(x * q) / q;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/quantize.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/quantize.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/quantize.test.ts
git commit -m "feat(listen): bit-depth quantizer (quantizeSample)"
```

---

## Task 5: limiterMath (stepLimiter)

**Files:**
- Create: `audio/dsp/limiterMath.ts`
- Test: `audio/dsp/limiterMath.test.ts`

**Interfaces:**
- Produces: `LimiterRtState` (`{ gain }`), `LimiterParams` (`{ ceilingLin, releaseCoef }`), `stepLimiter(s, lookaheadPeak, p): LimiterRtState`. Consumed by the limiter processor (Task 9).

- [ ] **Step 1: Write the failing test**

`audio/dsp/limiterMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stepLimiter, type LimiterParams, type LimiterRtState } from './limiterMath';

const P: LimiterParams = { ceilingLin: 0.5, releaseCoef: 0.1 };
const start: LimiterRtState = { gain: 1 };

describe('stepLimiter', () => {
  it('reduces gain so peak * gain never exceeds the ceiling', () => {
    const s = stepLimiter(start, 1.0, P); // peak 1.0, ceiling 0.5
    expect(s.gain).toBeCloseTo(0.5, 6); // 0.5 / 1.0
    expect(1.0 * s.gain).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('snaps down instantly (attack is immediate)', () => {
    const s = stepLimiter({ gain: 1 }, 2.0, P); // 0.5/2.0 = 0.25
    expect(s.gain).toBeCloseTo(0.25, 6);
  });

  it('releases gradually back toward unity when the peak is under ceiling', () => {
    let s: LimiterRtState = { gain: 0.25 };
    s = stepLimiter(s, 0.1, P); // under ceiling -> release toward 1
    expect(s.gain).toBeGreaterThan(0.25);
    expect(s.gain).toBeLessThan(1);
  });

  it('handles a zero peak without dividing by zero', () => {
    const s = stepLimiter({ gain: 0.4 }, 0, P);
    expect(Number.isFinite(s.gain)).toBe(true);
    expect(s.gain).toBeGreaterThan(0.4); // releasing toward 1
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/limiterMath.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `audio/dsp/limiterMath.ts`**

```ts
export interface LimiterRtState {
  gain: number;
}

export interface LimiterParams {
  ceilingLin: number;
  releaseCoef: number; // release smoothing toward unity
}

// Peak limiter gain: if the lookahead peak would exceed the ceiling, drop gain
// immediately so peak*gain == ceiling; otherwise ease gain back toward 1.
export function stepLimiter(
  s: LimiterRtState,
  lookaheadPeak: number,
  p: LimiterParams,
): LimiterRtState {
  const target = lookaheadPeak > p.ceilingLin && lookaheadPeak > 0 ? p.ceilingLin / lookaheadPeak : 1;
  const gain = target < s.gain ? target : s.gain + (1 - s.gain) * p.releaseCoef;
  return { gain };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/limiterMath.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/limiterMath.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/limiterMath.test.ts
git commit -m "feat(listen): lookahead limiter gain math (stepLimiter)"
```

---

## Task 6: Worklet-effect helper (`createWorkletEffect`)

**Files:**
- Create: `audio/worklets.ts` (the helper; `registerWorklets` is added in Task 10)

**Interfaces:**
- Consumes: `makeDryWet`, `EffectId`, `EffectMeter`, `EffectUnit` from `./EffectUnit`.
- Produces: `WorkletEffectConfig<S>` and `createWorkletEffect<S>(ctx, config, defaultState): EffectUnit<S>`. Consumed by the three worklet units (Tasks 7–9).

This builds AudioNodes, so there is NO unit test — it is verified by `tsc -b` + the units that use it + the manual smoke (the established Web-Audio pattern).

- [ ] **Step 1: Write `audio/worklets.ts`**

```ts
import { makeDryWet, type EffectId, type EffectMeter, type EffectUnit } from './EffectUnit';

// Each side of the materialize duck (down, then up), in seconds.
const DUCK_SEC = 0.01;

export interface WorkletEffectConfig<S> {
  id: EffectId;
  processorName: string;
  // state -> AudioParam name:value pairs (names MUST match the processor's
  // parameterDescriptors).
  params: (state: S) => Record<string, number>;
  // wet amount for the dry/wet bypass: gate/limiter -> enabled?1:0;
  // bitcrusher -> enabled?mix:0.
  wet: (state: S) => number;
  // true if the processor posts a meter object over its port.
  meter: boolean;
}

// A worklet EffectUnit with a placeholder-then-swap boot. input/output are stable
// gains (the composer wires them); the wet lane is a passthrough until
// materialize() builds the AudioWorkletNode and swaps it in.
export function createWorkletEffect<S>(
  ctx: AudioContext,
  config: WorkletEffectConfig<S>,
  defaultState: S,
): EffectUnit<S> {
  const wetIn = ctx.createGain();
  const wetOut = ctx.createGain();
  wetIn.connect(wetOut); // placeholder passthrough
  const { input, output, setWet } = makeDryWet(ctx, wetIn, wetOut);

  let node: AudioWorkletNode | null = null;
  let lastState: S = defaultState;
  let lastMeter: EffectMeter = {};

  const pushParams = (state: S): void => {
    if (!node) return;
    const p = config.params(state);
    for (const name of Object.keys(p)) {
      const ap = node.parameters.get(name);
      if (ap) ap.value = p[name];
    }
  };

  const unit: EffectUnit<S> = {
    id: config.id,
    input,
    output,
    applyParams: (state: S) => {
      lastState = state;
      pushParams(state);
      setWet(config.wet(state));
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    materialize: () => {
      if (node) return;
      try {
        node = new AudioWorkletNode(ctx, config.processorName, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
      } catch {
        return; // registration failed -> stay a passthrough placeholder
      }
      if (config.meter) {
        node.port.onmessage = (e: MessageEvent) => {
          lastMeter = e.data as EffectMeter;
        };
      }
      const g = wetOut.gain;
      const t0 = ctx.currentTime;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(0, t0 + DUCK_SEC);
      const live = node;
      window.setTimeout(() => {
        try {
          wetIn.disconnect(wetOut);
        } catch {
          /* already disconnected */
        }
        wetIn.connect(live);
        live.connect(wetOut);
        pushParams(lastState); // re-apply buffered params to the live node
        const t1 = ctx.currentTime;
        g.cancelScheduledValues(t1);
        g.setValueAtTime(0, t1);
        g.linearRampToValueAtTime(1, t1 + DUCK_SEC);
      }, DUCK_SEC * 1000 + 2);
    },
    dispose: () => {
      try {
        node?.port.close();
      } catch {
        /* no-op */
      }
      try {
        node?.disconnect();
      } catch {
        /* no-op */
      }
      [wetIn, wetOut, input, output].forEach((n) => n.disconnect());
    },
  };

  if (config.meter) {
    unit.readMeter = () => lastMeter;
  }

  // Self-init: applyParams(default) -> disabled => setWet(0) => dry passthrough.
  unit.applyParams(defaultState);
  return unit;
}
```

- [ ] **Step 2: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc -b 2>&1
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: `tsc -b` shows ONLY the known `composer.ts` units-map error (no error in `worklets.ts`); vitest green (no new test — AudioNode code).

- [ ] **Step 3: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/worklets.ts
git commit -m "feat(listen): createWorkletEffect placeholder-then-swap helper"
```

---

## Task 7: Gate processor + unit

**Files:**
- Create: `audio/dsp/processors/gate.processor.ts`
- Create: `audio/effects/gate.ts`

**Interfaces:**
- Consumes: `dbToLin`, `msToCoef` from `../dbScale`; `stepGate`, `GateRtState` from `../gateMath`; `createWorkletEffect` from `../worklets`; `GATE_DEFAULT`, `GateState` from `../state`; `EffectUnit` from `../EffectUnit`.
- Produces: the registered processor `'gate'`; `createGateUnit(ctx): EffectUnit<GateState>`.

- [ ] **Step 1: Write the processor `audio/dsp/processors/gate.processor.ts`**

```ts
import { dbToLin, msToCoef } from '../dbScale';
import { stepGate, type GateRtState } from '../gateMath';

class GateProcessor extends AudioWorkletProcessor {
  private state: GateRtState = { env: 0, gain: 1, hold: 0 };
  private frame = 0;

  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 1, minValue: 0, maxValue: 50, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 10, minValue: 0, maxValue: 500, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 100, minValue: 0, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'floor', defaultValue: -80, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
    ];
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const p = {
      thresholdLin: dbToLin(parameters.threshold[0]),
      floorLin: dbToLin(parameters.floor[0]),
      attackCoef: msToCoef(parameters.attack[0], sampleRate),
      releaseCoef: msToCoef(parameters.release[0], sampleRate),
      holdSamples: (parameters.hold[0] / 1000) * sampleRate,
    };

    const frames = output[0].length;
    const detect = input[0];
    for (let i = 0; i < frames; i += 1) {
      this.state = stepGate(this.state, detect[i], p);
      const gain = this.state.gain;
      for (let ch = 0; ch < output.length; ch += 1) {
        const inCh = input[ch] ?? input[0];
        output[ch][i] = inCh[i] * gain;
      }
    }

    this.frame += frames;
    if (this.frame >= sampleRate / 30) {
      this.frame = 0;
      this.port.postMessage({
        reductionDb: 20 * Math.log10(Math.max(this.state.gain, 1e-6)),
        open: this.state.gain > 0.5,
      });
    }
    return true;
  }
}

registerProcessor('gate', GateProcessor);
```

- [ ] **Step 2: Write the unit `audio/effects/gate.ts`**

```ts
import { createWorkletEffect } from '../worklets';
import { GATE_DEFAULT, type GateState } from '../state';
import type { EffectUnit } from '../EffectUnit';

export function createGateUnit(ctx: AudioContext): EffectUnit<GateState> {
  return createWorkletEffect<GateState>(
    ctx,
    {
      id: 'gate',
      processorName: 'gate',
      params: (s) => ({
        threshold: s.thresholdDb,
        attack: s.attackMs,
        hold: s.holdMs,
        release: s.releaseMs,
        floor: s.floorDb,
      }),
      wet: (s) => (s.enabled ? 1 : 0),
      meter: true,
    },
    GATE_DEFAULT,
  );
}
```

- [ ] **Step 3: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc -b 2>&1
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: `tsc -b` shows ONLY the known `composer.ts` error (no error in `gate.processor.ts` or `gate.ts`); vitest green.

- [ ] **Step 4: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/processors/gate.processor.ts components/frontend-spectr-v2/src/features/listen/audio/effects/gate.ts
git commit -m "feat(listen): gate worklet processor + unit"
```

---

## Task 8: Bitcrusher processor + unit

**Files:**
- Create: `audio/dsp/processors/bitcrusher.processor.ts`
- Create: `audio/effects/bitcrusher.ts`

**Interfaces:**
- Consumes: `quantizeSample` from `../quantize`; `createWorkletEffect` from `../worklets`; `BITCRUSHER_DEFAULT`, `BitcrusherState` from `../state`; `EffectUnit` from `../EffectUnit`.
- Produces: the registered processor `'bitcrusher'`; `createBitcrusherUnit(ctx): EffectUnit<BitcrusherState>`.

- [ ] **Step 1: Write the processor `audio/dsp/processors/bitcrusher.processor.ts`**

```ts
import { quantizeSample } from '../quantize';

class BitcrusherProcessor extends AudioWorkletProcessor {
  private phase = 0;
  private held: number[] = [];

  static get parameterDescriptors() {
    return [
      { name: 'bitDepth', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 1, minValue: 1, maxValue: 50, automationRate: 'k-rate' },
    ];
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const bits = parameters.bitDepth[0];
    const ds = Math.max(1, Math.floor(parameters.downsample[0]));
    const frames = output[0].length;

    for (let i = 0; i < frames; i += 1) {
      const take = this.phase === 0;
      for (let ch = 0; ch < output.length; ch += 1) {
        const inCh = input[ch] ?? input[0];
        if (take) this.held[ch] = quantizeSample(inCh[i], bits);
        output[ch][i] = this.held[ch] ?? 0;
      }
      this.phase = (this.phase + 1) % ds;
    }
    return true;
  }
}

registerProcessor('bitcrusher', BitcrusherProcessor);
```

- [ ] **Step 2: Write the unit `audio/effects/bitcrusher.ts`**

```ts
import { createWorkletEffect } from '../worklets';
import { BITCRUSHER_DEFAULT, type BitcrusherState } from '../state';
import type { EffectUnit } from '../EffectUnit';

export function createBitcrusherUnit(ctx: AudioContext): EffectUnit<BitcrusherState> {
  return createWorkletEffect<BitcrusherState>(
    ctx,
    {
      id: 'bitcrusher',
      processorName: 'bitcrusher',
      params: (s) => ({ bitDepth: s.bitDepth, downsample: s.downsample }),
      wet: (s) => (s.enabled ? s.mix : 0),
      meter: false,
    },
    BITCRUSHER_DEFAULT,
  );
}
```

- [ ] **Step 3: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc -b 2>&1
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: `tsc -b` shows ONLY the known `composer.ts` error; vitest green.

- [ ] **Step 4: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/processors/bitcrusher.processor.ts components/frontend-spectr-v2/src/features/listen/audio/effects/bitcrusher.ts
git commit -m "feat(listen): bitcrusher worklet processor + unit"
```

---

## Task 9: Limiter processor + unit

**Files:**
- Create: `audio/dsp/processors/limiter.processor.ts`
- Create: `audio/effects/limiter.ts`

**Interfaces:**
- Consumes: `dbToLin`, `msToCoef` from `../dbScale`; `stepLimiter`, `LimiterRtState` from `../limiterMath`; `createWorkletEffect` from `../worklets`; `LIMITER_DEFAULT`, `LimiterState` from `../state`; `EffectUnit` from `../EffectUnit`.
- Produces: the registered processor `'limiter'`; `createLimiterUnit(ctx): EffectUnit<LimiterState>`.

- [ ] **Step 1: Write the processor `audio/dsp/processors/limiter.processor.ts`**

```ts
import { dbToLin, msToCoef } from '../dbScale';
import { stepLimiter, type LimiterRtState } from '../limiterMath';

const MAX_LOOKAHEAD_SEC = 0.01;

class LimiterProcessor extends AudioWorkletProcessor {
  private buf: Float32Array[] = [];
  private widx = 0;
  private size = 0;
  private state: LimiterRtState = { gain: 1 };
  private frame = 0;

  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: -1, minValue: -12, maxValue: 0, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 50, minValue: 1, maxValue: 500, automationRate: 'k-rate' },
      { name: 'lookahead', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
    ];
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const chs = output.length;
    if (this.size === 0) {
      this.size = Math.ceil(MAX_LOOKAHEAD_SEC * sampleRate) + 1;
      this.buf = Array.from({ length: chs }, () => new Float32Array(this.size));
    }

    const ceilingLin = dbToLin(parameters.ceiling[0]);
    const releaseCoef = msToCoef(parameters.release[0], sampleRate);
    const look = Math.min(
      this.size - 1,
      Math.max(0, Math.round((parameters.lookahead[0] / 1000) * sampleRate)),
    );
    const frames = output[0].length;

    for (let i = 0; i < frames; i += 1) {
      for (let ch = 0; ch < chs; ch += 1) {
        const inCh = input[ch] ?? input[0];
        this.buf[ch][this.widx] = inCh[i];
      }
      let peak = 0;
      for (let k = 0; k <= look; k += 1) {
        const idx = (this.widx - k + this.size) % this.size;
        for (let ch = 0; ch < chs; ch += 1) {
          const a = Math.abs(this.buf[ch][idx]);
          if (a > peak) peak = a;
        }
      }
      this.state = stepLimiter(this.state, peak, { ceilingLin, releaseCoef });
      const ridx = (this.widx - look + this.size) % this.size;
      for (let ch = 0; ch < chs; ch += 1) {
        output[ch][i] = this.buf[ch][ridx] * this.state.gain;
      }
      this.widx = (this.widx + 1) % this.size;
    }

    this.frame += frames;
    if (this.frame >= sampleRate / 30) {
      this.frame = 0;
      this.port.postMessage({ reductionDb: 20 * Math.log10(Math.max(this.state.gain, 1e-6)) });
    }
    return true;
  }
}

registerProcessor('limiter', LimiterProcessor);
```

- [ ] **Step 2: Write the unit `audio/effects/limiter.ts`**

```ts
import { createWorkletEffect } from '../worklets';
import { LIMITER_DEFAULT, type LimiterState } from '../state';
import type { EffectUnit } from '../EffectUnit';

export function createLimiterUnit(ctx: AudioContext): EffectUnit<LimiterState> {
  return createWorkletEffect<LimiterState>(
    ctx,
    {
      id: 'limiter',
      processorName: 'limiter',
      params: (s) => ({
        ceiling: s.ceilingDb,
        release: s.releaseMs,
        lookahead: s.lookaheadMs,
      }),
      wet: (s) => (s.enabled ? 1 : 0),
      meter: true,
    },
    LIMITER_DEFAULT,
  );
}
```

- [ ] **Step 3: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc -b 2>&1
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: `tsc -b` shows ONLY the known `composer.ts` error; vitest green.

- [ ] **Step 4: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/processors/limiter.processor.ts components/frontend-spectr-v2/src/features/listen/audio/effects/limiter.ts
git commit -m "feat(listen): limiter worklet processor + unit"
```

---

## Task 10: Register worklets in the composer + fire the boot

**Files:**
- Create: append `registerWorklets` to `audio/worklets.ts`
- Modify: `audio/composer.ts`

**Interfaces:**
- Consumes: the three `create*Unit` worklet factories (Tasks 7–9); `registerWorklets` (added here).
- Produces: a `units` record covering all 13 ids; the async boot that materializes the three worklet units. After this task `tsc -b` is fully clean.

- [ ] **Step 1: Add `registerWorklets` to `audio/worklets.ts`**

Add the three processor-URL imports at the TOP of `audio/worklets.ts` (with the other imports), and `registerWorklets` after them. Use `?worker&url` — a plain `new URL('./x.ts', import.meta.url)` emits raw untranspiled TS that `addModule` rejects at runtime; `?worker&url` transpiles + bundles the pure-math imports into a standalone JS chunk and yields its URL (`vite/client` types resolve the suffix to `string`):

```ts
import gateProcessorUrl from './dsp/processors/gate.processor.ts?worker&url';
import bitcrusherProcessorUrl from './dsp/processors/bitcrusher.processor.ts?worker&url';
import limiterProcessorUrl from './dsp/processors/limiter.processor.ts?worker&url';

// Register the three AudioWorklet processor modules (Vite-bundled standalone JS).
export function registerWorklets(ctx: AudioContext): Promise<void> {
  return Promise.all([
    ctx.audioWorklet.addModule(gateProcessorUrl),
    ctx.audioWorklet.addModule(bitcrusherProcessorUrl),
    ctx.audioWorklet.addModule(limiterProcessorUrl),
  ]).then(() => undefined);
}
```

- [ ] **Step 2: Import the factories + `registerWorklets` in `audio/composer.ts`**

Add to the import block (keep existing imports; order by path):

```ts
import { createBitcrusherUnit } from './effects/bitcrusher';
import { createGateUnit } from './effects/gate';
import { createLimiterUnit } from './effects/limiter';
import { registerWorklets } from './worklets';
```

- [ ] **Step 3: Register the three units in the `units` record**

Replace the `units` object literal in `buildInsertChain` so it has all 13 keys:

```ts
  const units: Record<EffectId, EffectUnit<unknown>> = {
    djfilter: createDjFilterUnit(ctx) as EffectUnit<unknown>,
    eq: createEqUnit(ctx) as EffectUnit<unknown>,
    gate: createGateUnit(ctx) as EffectUnit<unknown>,
    comp: createCompressorUnit(ctx) as EffectUnit<unknown>,
    sat: createSaturatorUnit(ctx) as EffectUnit<unknown>,
    bitcrusher: createBitcrusherUnit(ctx) as EffectUnit<unknown>,
    ms: createWidthUnit(ctx) as EffectUnit<unknown>,
    pan: createPanUnit(ctx) as EffectUnit<unknown>,
    tremolo: createTremoloUnit(ctx) as EffectUnit<unknown>,
    delay: createDelayUnit(ctx) as EffectUnit<unknown>,
    reverb: createReverbUnit(ctx) as EffectUnit<unknown>,
    limiter: createLimiterUnit(ctx) as EffectUnit<unknown>,
    trim: createTrimUnit(ctx) as EffectUnit<unknown>,
  };
```

- [ ] **Step 4: Fire the async boot after the initial wiring**

In `buildInsertChain`, immediately after the `wire(order); // initial connect in default order` line, add:

```ts
  // Worklet boot: register the processor modules, then swap each worklet unit's
  // placeholder for its real AudioWorkletNode. Fire-and-forget; on failure the
  // units stay passthrough placeholders (graceful degradation).
  void registerWorklets(ctx)
    .then(() => {
      (Object.keys(units) as EffectId[]).forEach((id) => units[id].materialize?.());
    })
    .catch(() => undefined);
```

- [ ] **Step 5: Run the gates — `tsc -b` must now be CLEAN**

```
cd components/frontend-spectr-v2 && npx tsc -b 2>&1
cd components/frontend-spectr-v2 && npx vitest run
cd components/frontend-spectr-v2 && npm run build
```
Expected: `tsc -b` exit 0 (the `composer.ts` units-map error is GONE). vitest green. `npm run build` succeeds AND emits worklet asset chunks for the three processors (look for `.processor` / worklet chunks in the build output).

- [ ] **Step 6: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/worklets.ts components/frontend-spectr-v2/src/features/listen/audio/composer.ts
git commit -m "feat(listen): register worklet units + fire async boot/materialize"
```

---

## Task 11: Route the three worklet units through the hook handle

**Files:**
- Modify: `useAudioGraph.ts` — value imports; 3 refs + helpers + switch cases + `resetAll`.

**Interfaces:**
- Consumes: `GATE_DEFAULT`, `BITCRUSHER_DEFAULT`, `LIMITER_DEFAULT` from `./audio/state` (value imports); `nodes.chain.units.{gate,bitcrusher,limiter}` (registered in Task 10). `EffectParamMap` + the three state TYPE imports were already widened in Task 1.

- [ ] **Step 1: Add the three `*_DEFAULT` value imports**

In the `from './audio/state'` import block in `useAudioGraph.ts`, add the value imports (the type imports are already present from Task 1):

```ts
  GATE_DEFAULT,
  BITCRUSHER_DEFAULT,
  LIMITER_DEFAULT,
```

- [ ] **Step 2: Add three state refs**

After the `trimStateRef` declaration, add:

```ts
  const gateStateRef = useRef<GateState>({ ...GATE_DEFAULT });
  const bitcrusherStateRef = useRef<BitcrusherState>({ ...BITCRUSHER_DEFAULT });
  const limiterStateRef = useRef<LimiterState>({ ...LIMITER_DEFAULT });
```

- [ ] **Step 3: Add three apply helpers**

After the `applyTrim` helper, add:

```ts
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
```

- [ ] **Step 4: Add three switch cases**

In `applyEffectParams`, after the `trim` case, add:

```ts
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
```

- [ ] **Step 5: Extend `resetAll`**

In `resetAll`, add the three ref resets (after `trimStateRef.current = { ...TRIM_DEFAULT };`):

```ts
      gateStateRef.current = { ...GATE_DEFAULT };
      bitcrusherStateRef.current = { ...BITCRUSHER_DEFAULT };
      limiterStateRef.current = { ...LIMITER_DEFAULT };
```

and the three apply calls (after `applyTrim();`, before `applyMasterBypass();`):

```ts
      applyGate();
      applyBitcrusher();
      applyLimiter();
```

- [ ] **Step 6: Run ALL four gates**

```
cd components/frontend-spectr-v2 && npx tsc -b
cd components/frontend-spectr-v2 && npm run lint
cd components/frontend-spectr-v2 && npx vitest run
cd components/frontend-spectr-v2 && npm run build
```
Expected: `tsc -b` clean (exit 0); lint clean (`--max-warnings 0`); vitest green (all dsp tests + existing suite); build succeeds and emits the three worklet chunks.

- [ ] **Step 7: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts
git commit -m "feat(listen): route gate/bitcrusher/limiter through the graph handle"
```

---

## Post-implementation

- **Manual browser smoke (deferred — needs the running app).** This is the most important smoke of the whole rack revamp because the worklet path can't be exercised in jsdom. With all tools at defaults, confirm playback is unchanged (behavior preservation). Then via the dev console on the audio-graph handle: `setEffectParams('gate', { enabled: true, thresholdDb: -20 })` (quiet passages cut), `setEffectParams('bitcrusher', { enabled: true, mix: 1, bitDepth: 4, downsample: 8 })` (audible crunch), `setEffectParams('limiter', { enabled: true, ceilingDb: -6 })` (loud peaks clamped). Confirm `readEffectMeter('gate')` / `readEffectMeter('limiter')` return live `reductionDb`, and that the boot is silent (no click as worklets materialize ~immediately after first play). Check the browser console for any `addModule` failure.
- **Final whole-branch review** (subagent-driven-development's final step) before merge.
- **Merge** via finishing-a-development-branch once gates + review are clean.

## Notes for the implementer

- **The single most important invariant:** `createWorkletEffect` ends with `unit.applyParams(defaultState)`, and every worklet unit defaults disabled → `setWet(0)` → dry passthrough. A worklet that isn't transparent at defaults changes everyone's playback.
- **`materialize()` is only ever called by the composer's `registerWorklets().then(...)`** — never call it directly elsewhere; the processor must be registered first or `new AudioWorkletNode` throws.
- **AudioParam name contract:** the keys in a unit's `config.params(state)` must equal the processor's `parameterDescriptors` `name`s. Gate: `threshold/attack/hold/release/floor`. Bitcrusher: `bitDepth/downsample`. Limiter: `ceiling/release/lookahead`.
- **Processors import only pure math** (`../dbScale`, `../gateMath`, `../quantize`, `../limiterMath`) — never anything that touches the DOM/React.
- **Do not add jsdom tests** for the processors, the helper, or the composer boot. The four `dsp/` modules are the only new tests.
- **`tsc --noEmit` is a no-op here** — always verify types with `npx tsc -b`.
