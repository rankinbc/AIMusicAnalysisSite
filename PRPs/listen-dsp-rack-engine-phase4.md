# Listen DSP Rack — Phase 4: New Native Modules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six native Web Audio effect modules (DJ Filter, Delay, Reverb, Stereo Pan, Tremolo/Auto-pan, Output Trim) to the existing reorderable `EffectUnit` rack, each transparent at its defaults.

**Architecture:** Each module implements the existing `EffectUnit<S>` contract (`audio/EffectUnit.ts`), wrapped in the standard `makeDryWet` per-unit dry/wet bypass. Pure DSP math (`bpmSync`, `djMorph`, `irEnvelope`, `tremoloOffsets`) lives in `audio/dsp/` and is unit-tested; the AudioNode unit files are verified by `tsc` + `build` + the existing suite. `composer.ts` registers the new factories and `useAudioGraph.ts` routes them through the already-generic handle. No UI work.

**Tech Stack:** React 19 + Vite 6 + TypeScript strict (`verbatimModuleSyntax`) + Vitest. Web Audio API. CSS Modules (untouched here).

**Spec:** `PRPs/listen-dsp-rack-engine-phase4-design.md` (this phase) · `PRPs/listen-dsp-rack-engine-design.md` (master, §6–10, §14).

## Global Constraints

- **Behavior preservation is the bar.** At defaults the whole chain stays bit-equivalent to today. Every new unit is a dry passthrough at its default state.
- **Factories self-init to transparent.** `ensureContext()` runs **no** post-build `applyParams` sweep, and a fresh `BiquadFilter` (lowpass@350), fresh feedback `GainNode`s (gain 1), and a null-buffer `ConvolverNode` (silence) are NOT transparent. Therefore every new factory MUST call `unit.applyParams(<DEFAULT>)` as its last step before `return`, so a freshly built unit is dry passthrough without depending on the hook.
- **Bypass model:** `makeDryWet(ctx, wetIn, wetOut)` from `audio/EffectUnit.ts` is the only bypass mechanism. `setWet(0)` = dry passthrough, `setWet(1)` = full effect, fractional = parallel mix. Disabled units call `setWet(0)`.
- **`dispose()` disconnects every node the factory created**, plus the `input`/`output` gains returned by `makeDryWet`.
- **Do NOT edit** `PreviewTools.tsx`, `PitchPanel.tsx`, the route file (`routes/.../listen.$versionId.tsx`), the pitch BufferSource lane, the master-bypass lane, or the analyser taps.
- **No new per-module handle wrappers** (no `setDelay`, etc.). New modules are driven only through the generic `setEffectParams(id, patch)`.
- **Use DOM ambient types** (`BiquadFilterType`, `OverSampleType`, `OscillatorType`) — never redefine them (Phase-3 regression: a redefined `OverSampleType` shadowed the built-in).
- **`import type` is mandatory** for type-only imports (`verbatimModuleSyntax`). Import order follows the existing files: by source path, case-insensitive (`../dsp/x`, then `../EffectUnit`, then `../state`).
- **Web Audio does not run in jsdom.** Only `audio/dsp/*` pure math gets vitest tests. Unit files (AudioNode wiring) are verified by the typecheck + the existing vitest suite staying green + a deferred manual browser smoke. Do NOT write jsdom tests for AudioNode code, and do NOT treat the absence of a unit-file test as a defect.
- **No file over ~500 lines.** Each unit is its own file under `audio/effects/`.
- **TYPECHECK GATE = `npx tsc -b`, NOT `npx tsc --noEmit`.** The root `tsconfig.json` uses project references with `"files": []`, so `tsc --noEmit` checks nothing (no-op that always passes — do not rely on it). The real typecheck is `npx tsc -b`. `npm run build` is `vite build && tsc -b` (vite strips types without checking, so a passing `vite build` proves nothing about types).
- **Interim typecheck reality (Tasks 2–8):** widening `EffectId` (Task 1) makes `composer.ts`'s `units: Record<EffectId, …>` incomplete until all six factories are registered (Task 9). So from Task 2 through Task 8, `npx tsc -b` reports exactly ONE expected residual error — `composer.ts:23 TS2740` (units map missing keys). That error is fine and is cleared by Task 9. Each task's own new file must introduce NO `tsc -b` error. Do NOT edit `composer.ts` to silence it outside Task 9.
- **All gates green at the branch tip before merge** (run from `components/frontend-spectr-v2`): `npx tsc -b` · `npm run lint` (`--max-warnings 0`) · `npx vitest run` · `npm run build`.

---

## File Structure

All paths under `components/frontend-spectr-v2/src/features/listen/`.

**Create:**
- `audio/effects/pan.ts` — Stereo Pan unit (`StereoPannerNode`).
- `audio/effects/trim.ts` — Output Trim unit (`GainNode`).
- `audio/effects/djFilter.ts` — DJ Filter unit (`BiquadFilterNode` + `djMorph`).
- `audio/effects/tremolo.ts` — Tremolo/Auto-pan unit (LFO + depth gains + `StereoPannerNode`).
- `audio/effects/delay.ts` — Delay/Echo unit (stereo cross-feedback + tone + ping-pong).
- `audio/effects/reverb.ts` — Reverb unit (`ConvolverNode` + synthesized IR).
- `audio/dsp/bpmSync.ts` (+ `bpmSync.test.ts`) — division→seconds/Hz.
- `audio/dsp/djMorph.ts` (+ `djMorph.test.ts`) — bipolar morph → filter type+freq.
- `audio/dsp/tremoloMath.ts` (+ `tremoloMath.test.ts`) — mode/depth → offset + depths.
- `audio/dsp/irSynth.ts` (+ `irSynth.test.ts`) — per-type IR decay envelope.

**Modify:**
- `audio/EffectUnit.ts` — widen `EffectId` union by six ids.
- `audio/state.ts` — add `Division`, `IrType`, six state interfaces + `*_DEFAULT` consts; widen `DEFAULT_ORDER` to ten ids.
- `audio/state.test.ts` — assert new defaults transparent + `DEFAULT_ORDER` value.
- `audio/composer.ts` — import + register the six factories in the `units` record.
- `useAudioGraph.ts` — extend `EffectParamMap`; add six state refs + six apply helpers + six `applyEffectParams` switch cases; extend `resetAll`.

---

## Task 1: State foundation — types, defaults, widened order

**Files:**
- Modify: `audio/EffectUnit.ts:3` (the `EffectId` union)
- Modify: `audio/state.ts` (add types/defaults/factories; widen `DEFAULT_ORDER`)
- Test: `audio/state.test.ts`

**Interfaces:**
- Produces: `Division`, `IrType`, `DjFilterState`, `DelayState`, `ReverbState`, `PanState`, `TremoloState`, `TrimState`; `DJFILTER_DEFAULT`, `DELAY_DEFAULT`, `REVERB_DEFAULT`, `PAN_DEFAULT`, `TREMOLO_DEFAULT`, `TRIM_DEFAULT`; widened `EffectId` and `DEFAULT_ORDER`. Every later task consumes these.

- [ ] **Step 1: Widen the `EffectId` union**

In `audio/EffectUnit.ts`, replace line 3:

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
  | 'trim';
```

- [ ] **Step 2: Add the new state types, defaults, factories, and order to `audio/state.ts`**

Append after the existing `WIDTH_DEFAULT` / factory block (keep the existing `DEFAULT_ORDER` line — it is REPLACED in Step 3):

```ts
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
```

(No `default*State()` factories — the hook consumes the `*_DEFAULT` consts directly via `{ ...X_DEFAULT }`. YAGNI: the existing `defaultEqState`/etc. are already unused; do not add more.)

- [ ] **Step 3: Widen `DEFAULT_ORDER`**

In `audio/state.ts`, replace the existing `DEFAULT_ORDER` constant (currently `['eq', 'comp', 'sat', 'ms']`) with the ten-unit native chain (master design order, worklet slots omitted):

```ts
// Phase-4 default insert order: master design chain minus the three Phase-5
// worklet slots (gate after eq, bitcrusher after sat, limiter before trim).
export const DEFAULT_ORDER: ReadonlyArray<EffectId> = [
  'djfilter',
  'eq',
  'comp',
  'sat',
  'ms',
  'pan',
  'tremolo',
  'delay',
  'reverb',
  'trim',
];
```

- [ ] **Step 4: Write the failing tests**

Append to `audio/state.test.ts` (add the new imports to the existing import line from `'./state'`):

```ts
import {
  DJFILTER_DEFAULT,
  DELAY_DEFAULT,
  REVERB_DEFAULT,
  PAN_DEFAULT,
  TREMOLO_DEFAULT,
  TRIM_DEFAULT,
  DEFAULT_ORDER,
} from './state';

describe('phase-4 module defaults are transparent', () => {
  it('djfilter/delay/reverb/pan/tremolo default disabled', () => {
    expect(DJFILTER_DEFAULT.enabled).toBe(false);
    expect(DELAY_DEFAULT.enabled).toBe(false);
    expect(REVERB_DEFAULT.enabled).toBe(false);
    expect(PAN_DEFAULT.enabled).toBe(false);
    expect(TREMOLO_DEFAULT.enabled).toBe(false);
  });

  it('trim defaults enabled at unity (0 dB)', () => {
    expect(TRIM_DEFAULT.enabled).toBe(true);
    expect(TRIM_DEFAULT.gainDb).toBe(0);
  });

  it('identity numeric defaults (mix/pan/morph all neutral)', () => {
    expect(DJFILTER_DEFAULT.morph).toBe(0);
    expect(PAN_DEFAULT.pan).toBe(0);
    expect(DELAY_DEFAULT.mix).toBe(0);
    expect(REVERB_DEFAULT.mix).toBe(0);
  });
});

describe('DEFAULT_ORDER (phase 4)', () => {
  it('is the 10-unit native chain with worklet slots omitted', () => {
    expect(DEFAULT_ORDER).toEqual([
      'djfilter',
      'eq',
      'comp',
      'sat',
      'ms',
      'pan',
      'tremolo',
      'delay',
      'reverb',
      'trim',
    ]);
  });
});
```

- [ ] **Step 5: Run the gates**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/state.test.ts
cd components/frontend-spectr-v2 && npx tsc --noEmit
```
Expected: vitest green (new + existing state tests pass); tsc clean (the widened `EffectId` makes `DEFAULT_ORDER`'s new entries type-check).

- [ ] **Step 6: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/EffectUnit.ts components/frontend-spectr-v2/src/features/listen/audio/state.ts components/frontend-spectr-v2/src/features/listen/audio/state.test.ts
git commit -m "feat(listen): phase-4 state types, defaults, widened EffectId + DEFAULT_ORDER"
```

---

## Task 2: Pan unit

**Files:**
- Create: `audio/effects/pan.ts`

**Interfaces:**
- Consumes: `makeDryWet`, `EffectUnit` from `../EffectUnit`; `PAN_DEFAULT`, `PanState` from `../state`.
- Produces: `createPanUnit(ctx: AudioContext): EffectUnit<PanState>`.

- [ ] **Step 1: Write the unit**

```ts
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { PAN_DEFAULT, type PanState } from '../state';

export function createPanUnit(ctx: AudioContext): EffectUnit<PanState> {
  const panner = ctx.createStereoPanner();
  const { input, output, setWet } = makeDryWet(ctx, panner, panner);

  const unit: EffectUnit<PanState> = {
    id: 'pan',
    input,
    output,
    applyParams: (state: PanState) => {
      panner.pan.value = state.enabled ? state.pan : 0;
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [panner, input, output].forEach((n) => n.disconnect());
    },
  };
  // Self-init to transparent (dry passthrough) — no post-build sweep exists.
  unit.applyParams(PAN_DEFAULT);
  return unit;
}
```

- [ ] **Step 2: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: tsc clean; build succeeds; vitest green (no new tests — AudioNode code is not jsdom-testable; the existing suite must stay green).

- [ ] **Step 3: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/effects/pan.ts
git commit -m "feat(listen): stereo pan unit"
```

---

## Task 3: Output Trim unit

**Files:**
- Create: `audio/effects/trim.ts`

**Interfaces:**
- Consumes: `makeDryWet`, `EffectUnit` from `../EffectUnit`; `TRIM_DEFAULT`, `TrimState` from `../state`.
- Produces: `createTrimUnit(ctx: AudioContext): EffectUnit<TrimState>`.

- [ ] **Step 1: Write the unit**

```ts
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { TRIM_DEFAULT, type TrimState } from '../state';

export function createTrimUnit(ctx: AudioContext): EffectUnit<TrimState> {
  const trimGain = ctx.createGain();
  const { input, output, setWet } = makeDryWet(ctx, trimGain, trimGain);

  const unit: EffectUnit<TrimState> = {
    id: 'trim',
    input,
    output,
    applyParams: (state: TrimState) => {
      trimGain.gain.value = Math.pow(10, state.gainDb / 20);
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [trimGain, input, output].forEach((n) => n.disconnect());
    },
  };
  // Default is enabled at unity (0 dB) => transparent.
  unit.applyParams(TRIM_DEFAULT);
  return unit;
}
```

- [ ] **Step 2: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: tsc clean; build succeeds; vitest green.

- [ ] **Step 3: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/effects/trim.ts
git commit -m "feat(listen): output trim unit"
```

---

## Task 4: DJ Filter (djMorph math + unit)

**Files:**
- Create: `audio/dsp/djMorph.ts`
- Test: `audio/dsp/djMorph.test.ts`
- Create: `audio/effects/djFilter.ts`

**Interfaces:**
- Consumes: `DJFILTER_DEFAULT`, `DjFilterState` from `../state`; `makeDryWet`, `EffectUnit` from `../EffectUnit`.
- Produces: `djMorph(morph: number): { type: BiquadFilterType; freq: number }`; `createDjFilterUnit(ctx: AudioContext): EffectUnit<DjFilterState>`.

- [ ] **Step 1: Write the failing djMorph test**

`audio/dsp/djMorph.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { djMorph } from './djMorph';

describe('djMorph', () => {
  it('is fully open at center (lowpass @ 20000 Hz)', () => {
    expect(djMorph(0)).toEqual({ type: 'lowpass', freq: 20000 });
  });

  it('sweeps a lowpass down as morph goes negative', () => {
    expect(djMorph(-1)).toEqual({ type: 'lowpass', freq: 30 });
    const half = djMorph(-0.5);
    expect(half.type).toBe('lowpass');
    expect(half.freq).toBeGreaterThan(30);
    expect(half.freq).toBeLessThan(20000);
  });

  it('sweeps a highpass up as morph goes positive', () => {
    expect(djMorph(1)).toEqual({ type: 'highpass', freq: 18000 });
    const half = djMorph(0.5);
    expect(half.type).toBe('highpass');
    expect(half.freq).toBeCloseTo(600, 0); // 20 * (18000/20)^0.5 = 600
  });

  it('clamps morph to [-1, 1]', () => {
    expect(djMorph(-5)).toEqual(djMorph(-1));
    expect(djMorph(5)).toEqual(djMorph(1));
  });

  it('lowpass cutoff is monotonic in morph (more negative = lower)', () => {
    expect(djMorph(-0.8).freq).toBeLessThan(djMorph(-0.2).freq);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/djMorph.test.ts
```
Expected: FAIL — `djMorph` is not defined / module not found.

- [ ] **Step 3: Implement djMorph**

`audio/dsp/djMorph.ts`:

```ts
// Bipolar DJ-filter morph knob. morph 0 = fully open (transparent lowpass at the
// top of the audband); morph<0 sweeps a lowpass down; morph>0 sweeps a highpass
// up. Cutoff is log-mapped so the sweep feels even by ear.
function logMap(a: number, b: number, t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return a * Math.pow(b / a, u);
}

export function djMorph(morph: number): { type: BiquadFilterType; freq: number } {
  const m = Math.min(1, Math.max(-1, morph));
  if (m <= 0) {
    // -m in 0..1: 0 -> 20000 (open), 1 -> 30 (closed-ish lowpass)
    return { type: 'lowpass', freq: logMap(20000, 30, -m) };
  }
  // m in 0..1: 0 -> 20 (open), 1 -> 18000 (closed-ish highpass)
  return { type: 'highpass', freq: logMap(20, 18000, m) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/djMorph.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Write the DJ Filter unit**

`audio/effects/djFilter.ts`:

```ts
import { djMorph } from '../dsp/djMorph';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { DJFILTER_DEFAULT, type DjFilterState } from '../state';

export function createDjFilterUnit(ctx: AudioContext): EffectUnit<DjFilterState> {
  const filter = ctx.createBiquadFilter();
  const { input, output, setWet } = makeDryWet(ctx, filter, filter);

  const unit: EffectUnit<DjFilterState> = {
    id: 'djfilter',
    input,
    output,
    applyParams: (state: DjFilterState) => {
      const { type, freq } = djMorph(state.morph);
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = state.resonance;
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [filter, input, output].forEach((n) => n.disconnect());
    },
  };
  // A fresh BiquadFilter is lowpass @ 350 Hz — NOT transparent at wet=1. Self-init
  // to the default (disabled => setWet(0)) so the built unit is dry passthrough.
  unit.applyParams(DJFILTER_DEFAULT);
  return unit;
}
```

- [ ] **Step 6: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: tsc clean; build succeeds; vitest green (djMorph tests + existing suite).

- [ ] **Step 7: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/djMorph.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/djMorph.test.ts components/frontend-spectr-v2/src/features/listen/audio/effects/djFilter.ts
git commit -m "feat(listen): DJ filter unit + djMorph math"
```

---

## Task 5: bpmSync math

**Files:**
- Create: `audio/dsp/bpmSync.ts`
- Test: `audio/dsp/bpmSync.test.ts`

**Interfaces:**
- Consumes: `Division` from `../state`.
- Produces: `bpmSyncSeconds(division: Division, bpm: number): number`; `bpmSyncHz(division: Division, bpm: number): number`. Consumed by Tasks 6 (tremolo) and 7 (delay).

- [ ] **Step 1: Write the failing test**

`audio/dsp/bpmSync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bpmSyncHz, bpmSyncSeconds } from './bpmSync';

describe('bpmSyncSeconds', () => {
  it('maps note divisions to seconds at 120 BPM (0.5 s per beat)', () => {
    expect(bpmSyncSeconds('1/4', 120)).toBeCloseTo(0.5, 6);
    expect(bpmSyncSeconds('1/8', 120)).toBeCloseTo(0.25, 6);
    expect(bpmSyncSeconds('1/8.', 120)).toBeCloseTo(0.375, 6); // dotted = 1.5x eighth
    expect(bpmSyncSeconds('1/8T', 120)).toBeCloseTo(1 / 6, 6); // triplet = 2/3 eighth
    expect(bpmSyncSeconds('1/16', 120)).toBeCloseTo(0.125, 6);
  });

  it('scales inversely with BPM', () => {
    expect(bpmSyncSeconds('1/4', 60)).toBeCloseTo(1.0, 6);
    expect(bpmSyncSeconds('1/4', 240)).toBeCloseTo(0.25, 6);
  });
});

describe('bpmSyncHz', () => {
  it('is the reciprocal of the synced period', () => {
    expect(bpmSyncHz('1/8', 120)).toBeCloseTo(4, 6); // 1 / 0.25 s
    expect(bpmSyncHz('1/4', 120)).toBeCloseTo(2, 6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/bpmSync.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bpmSync**

`audio/dsp/bpmSync.ts`:

```ts
import type { Division } from '../state';

// Length of each division in quarter-note beats.
const BEATS: Record<Division, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/8.': 0.75, // dotted eighth = 1.5 x eighth
  '1/8T': 1 / 3, // eighth triplet = 2/3 x eighth
  '1/16': 0.25,
};

export function bpmSyncSeconds(division: Division, bpm: number): number {
  const secondsPerBeat = 60 / Math.max(1, bpm);
  return secondsPerBeat * BEATS[division];
}

export function bpmSyncHz(division: Division, bpm: number): number {
  const s = bpmSyncSeconds(division, bpm);
  return s > 0 ? 1 / s : 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/bpmSync.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/bpmSync.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/bpmSync.test.ts
git commit -m "feat(listen): bpmSync division->seconds/Hz math"
```

---

## Task 6: Tremolo (tremoloMath + unit)

**Files:**
- Create: `audio/dsp/tremoloMath.ts`
- Test: `audio/dsp/tremoloMath.test.ts`
- Create: `audio/effects/tremolo.ts`

**Interfaces:**
- Consumes: `bpmSyncHz` from `../dsp/bpmSync` (Task 5); `TREMOLO_DEFAULT`, `TremoloState` from `../state`; `makeDryWet`, `EffectUnit` from `../EffectUnit`.
- Produces: `tremoloOffsets(mode, depth): { offset: number; depthTrem: number; depthPan: number }`; `createTremoloUnit(ctx): EffectUnit<TremoloState>`.

- [ ] **Step 1: Write the failing tremoloMath test**

`audio/dsp/tremoloMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tremoloOffsets } from './tremoloMath';

describe('tremoloOffsets', () => {
  it('tremolo at depth 0 is transparent (unity gain, no modulation)', () => {
    expect(tremoloOffsets('tremolo', 0)).toEqual({ offset: 1, depthTrem: 0, depthPan: 0 });
  });

  it('tremolo gain swings within [1-depth, 1]', () => {
    // offset = 1 - depth/2, AC amplitude = depth/2 => range [1-depth, 1]
    expect(tremoloOffsets('tremolo', 1)).toEqual({ offset: 0.5, depthTrem: 0.5, depthPan: 0 });
  });

  it('autopan modulates pan only (gain held unity)', () => {
    expect(tremoloOffsets('autopan', 1)).toEqual({ offset: 1, depthTrem: 0, depthPan: 1 });
    expect(tremoloOffsets('autopan', 0)).toEqual({ offset: 1, depthTrem: 0, depthPan: 0 });
  });

  it('clamps depth to [0, 1]', () => {
    expect(tremoloOffsets('tremolo', 5)).toEqual(tremoloOffsets('tremolo', 1));
    expect(tremoloOffsets('autopan', -1)).toEqual(tremoloOffsets('autopan', 0));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/tremoloMath.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement tremoloMath**

`audio/dsp/tremoloMath.ts`:

```ts
import type { TremoloState } from '../state';

// Resolve the DC offset and the two modulation-depth gains for the tremolo unit.
// tremolo: gain = offset +/- depthTrem*LFO => swings in [1-depth, 1].
// autopan: pan  = 0     +/- depthPan*LFO   => swings in [-depth, +depth], gain unity.
export function tremoloOffsets(
  mode: TremoloState['mode'],
  depth: number,
): { offset: number; depthTrem: number; depthPan: number } {
  const d = Math.min(1, Math.max(0, depth));
  if (mode === 'autopan') {
    return { offset: 1, depthTrem: 0, depthPan: d };
  }
  return { offset: 1 - d / 2, depthTrem: d / 2, depthPan: 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/tremoloMath.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Write the Tremolo unit**

`audio/effects/tremolo.ts`:

```ts
import { bpmSyncHz } from '../dsp/bpmSync';
import { tremoloOffsets } from '../dsp/tremoloMath';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { TREMOLO_DEFAULT, type TremoloState } from '../state';

export function createTremoloUnit(ctx: AudioContext): EffectUnit<TremoloState> {
  // Signal path: wetIn -> tremGain -> panner -> wetOut.
  const tremGain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  tremGain.connect(panner);

  // LFO modulation: osc -> depthTrem -> tremGain.gain ; osc -> depthPan -> panner.pan.
  // constTrem provides the DC offset that centers the tremolo gain.
  const osc = ctx.createOscillator();
  const depthTrem = ctx.createGain();
  const depthPan = ctx.createGain();
  const constTrem = ctx.createConstantSource();
  osc.connect(depthTrem).connect(tremGain.gain);
  osc.connect(depthPan).connect(panner.pan);
  constTrem.connect(tremGain.gain);
  osc.start();
  constTrem.start();

  const { input, output, setWet } = makeDryWet(ctx, tremGain, panner);

  const unit: EffectUnit<TremoloState> = {
    id: 'tremolo',
    input,
    output,
    applyParams: (state: TremoloState) => {
      if (!state.enabled) {
        // Neutralize modulation AND dry-pass: gain unity, pan centered.
        depthTrem.gain.value = 0;
        depthPan.gain.value = 0;
        constTrem.offset.value = 1;
        setWet(0);
        return;
      }
      const { offset, depthTrem: dt, depthPan: dp } = tremoloOffsets(state.mode, state.depth);
      constTrem.offset.value = offset;
      depthTrem.gain.value = dt;
      depthPan.gain.value = dp;
      osc.frequency.value = state.sync ? bpmSyncHz(state.division, state.bpm) : state.rateHz;
      osc.type = state.shape;
      setWet(1);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      try {
        constTrem.stop();
      } catch {
        /* already stopped */
      }
      [tremGain, panner, osc, depthTrem, depthPan, constTrem, input, output].forEach((n) =>
        n.disconnect(),
      );
    },
  };
  unit.applyParams(TREMOLO_DEFAULT);
  return unit;
}
```

- [ ] **Step 6: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: tsc clean; build succeeds; vitest green.

- [ ] **Step 7: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/tremoloMath.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/tremoloMath.test.ts components/frontend-spectr-v2/src/features/listen/audio/effects/tremolo.ts
git commit -m "feat(listen): tremolo/auto-pan unit + tremoloMath"
```

---

## Task 7: Delay unit (with ping-pong)

**Files:**
- Create: `audio/effects/delay.ts`

**Interfaces:**
- Consumes: `bpmSyncSeconds` from `../dsp/bpmSync` (Task 5); `DELAY_DEFAULT`, `DelayState` from `../state`; `makeDryWet`, `EffectUnit` from `../EffectUnit`.
- Produces: `createDelayUnit(ctx: AudioContext): EffectUnit<DelayState>`.

- [ ] **Step 1: Write the unit**

`audio/effects/delay.ts`:

```ts
import { bpmSyncSeconds } from '../dsp/bpmSync';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { DELAY_DEFAULT, type DelayState } from '../state';

const MAX_DELAY_SEC = 3;

export function createDelayUnit(ctx: AudioContext): EffectUnit<DelayState> {
  // Stereo cross-feedback topology. Straight vs ping-pong is selected by which
  // feedback gains are live (no runtime reconnect).
  const splitter = ctx.createChannelSplitter(2);
  const dL = ctx.createDelay(MAX_DELAY_SEC);
  const dR = ctx.createDelay(MAX_DELAY_SEC);
  const toneL = ctx.createBiquadFilter();
  const toneR = ctx.createBiquadFilter();
  toneL.type = 'lowpass';
  toneR.type = 'lowpass';
  const fbStraightL = ctx.createGain();
  const fbStraightR = ctx.createGain();
  const fbCrossL = ctx.createGain();
  const fbCrossR = ctx.createGain();
  const merger = ctx.createChannelMerger(2);

  splitter.connect(dL, 0);
  splitter.connect(dR, 1);
  dL.connect(toneL);
  dR.connect(toneR);
  // Straight feedback: each side loops back into itself.
  toneL.connect(fbStraightL).connect(dL);
  toneR.connect(fbStraightR).connect(dR);
  // Cross feedback (ping-pong): each side loops into the other.
  toneL.connect(fbCrossL).connect(dR);
  toneR.connect(fbCrossR).connect(dL);
  // Taps to the stereo output.
  dL.connect(merger, 0, 0);
  dR.connect(merger, 0, 1);

  const { input, output, setWet } = makeDryWet(ctx, splitter, merger);

  const unit: EffectUnit<DelayState> = {
    id: 'delay',
    input,
    output,
    applyParams: (state: DelayState) => {
      const raw = state.sync ? bpmSyncSeconds(state.division, state.bpm) : state.timeMs / 1000;
      const time = Math.min(MAX_DELAY_SEC, Math.max(0, raw));
      dL.delayTime.value = time;
      dR.delayTime.value = time;
      toneL.frequency.value = state.toneHz;
      toneR.frequency.value = state.toneHz;
      const fb = Math.min(0.95, Math.max(0, state.feedback));
      fbStraightL.gain.value = state.pingPong ? 0 : fb;
      fbStraightR.gain.value = state.pingPong ? 0 : fb;
      fbCrossL.gain.value = state.pingPong ? fb : 0;
      fbCrossR.gain.value = state.pingPong ? fb : 0;
      setWet(state.enabled ? state.mix : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [
        splitter,
        dL,
        dR,
        toneL,
        toneR,
        fbStraightL,
        fbStraightR,
        fbCrossL,
        fbCrossR,
        merger,
        input,
        output,
      ].forEach((n) => n.disconnect());
    },
  };
  // Fresh feedback GainNodes default to gain 1 (runaway) — self-init to the
  // default (mix 0 / disabled => setWet(0), feedback set to 0.35 straight).
  unit.applyParams(DELAY_DEFAULT);
  return unit;
}
```

- [ ] **Step 2: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: tsc clean; build succeeds; vitest green.

- [ ] **Step 3: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/effects/delay.ts
git commit -m "feat(listen): delay/echo unit with ping-pong"
```

---

## Task 8: Reverb (irSynth + unit)

**Files:**
- Create: `audio/dsp/irSynth.ts`
- Test: `audio/dsp/irSynth.test.ts`
- Create: `audio/effects/reverb.ts`

**Interfaces:**
- Consumes: `IrType` from `../state` (in irSynth); `REVERB_DEFAULT`, `ReverbState`, `IrType` from `../state` (in unit); `makeDryWet`, `EffectUnit` from `../EffectUnit`.
- Produces: `irEnvelope(type: IrType, tSec: number, decaySec: number): number`; `createReverbUnit(ctx: AudioContext): EffectUnit<ReverbState>`.

- [ ] **Step 1: Write the failing irEnvelope test**

`audio/dsp/irSynth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { irEnvelope } from './irSynth';

const TYPES = ['room', 'hall', 'plate', 'spring', 'ambience'] as const;

describe('irEnvelope', () => {
  it('starts at full amplitude (t=0) for every type', () => {
    for (const t of TYPES) {
      expect(irEnvelope(t, 0, 2)).toBeCloseTo(1, 5);
    }
  });

  it('stays within [0, 1] across the tail', () => {
    for (const t of TYPES) {
      for (let i = 0; i <= 10; i += 1) {
        const v = irEnvelope(t, (i / 10) * 2, 2);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('decays toward silence by the end of the decay window (hall)', () => {
    expect(irEnvelope('hall', 2, 2)).toBeLessThan(0.01);
  });

  it('room decays faster than hall at the same point', () => {
    expect(irEnvelope('room', 1, 2)).toBeLessThan(irEnvelope('hall', 1, 2));
  });

  it('is monotonically decreasing for hall (no ripple)', () => {
    expect(irEnvelope('hall', 0.5, 2)).toBeGreaterThan(irEnvelope('hall', 1.5, 2));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/irSynth.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement irEnvelope**

`audio/dsp/irSynth.ts`:

```ts
import type { IrType } from '../state';

// Per-type decay steepness (higher = faster decay). hall is the smooth baseline.
const STEEP: Record<IrType, number> = {
  room: 2.2,
  hall: 1.0,
  plate: 1.3,
  spring: 1.5,
  ambience: 3.2,
};

// Amplitude envelope (0..1) for a synthesized reverb IR, sampled at tSec seconds
// into a tail of length decaySec. e^(-6.9) ~ -60 dB, so a steepness-1 tail reaches
// ~silence at tSec = decaySec.
export function irEnvelope(type: IrType, tSec: number, decaySec: number): number {
  const span = Math.max(0.2, decaySec);
  const r = Math.min(1, Math.max(0, tSec / span)); // normalized progress 0..1
  let amp: number;
  if (type === 'plate') {
    // Denser, slightly delayed knee for a brighter sustained tail.
    amp = Math.exp(-6.9 * STEEP.plate * Math.pow(r, 1.2));
  } else {
    amp = Math.exp(-6.9 * STEEP[type] * r);
  }
  if (type === 'spring') {
    // Shallow periodic ripple ("boing").
    amp *= 1 + 0.25 * Math.sin(2 * Math.PI * 9 * r);
  }
  return Math.min(1, Math.max(0, amp));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd components/frontend-spectr-v2 && npx vitest run src/features/listen/audio/dsp/irSynth.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Write the Reverb unit**

`audio/effects/reverb.ts`:

```ts
import { irEnvelope } from '../dsp/irSynth';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { REVERB_DEFAULT, type IrType, type ReverbState } from '../state';

const MAX_PREDELAY_SEC = 0.5;

function buildIr(ctx: AudioContext, ir: IrType, decaySec: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.ceil(decaySec * sr));
  const buffer = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * irEnvelope(ir, i / sr, decaySec);
    }
  }
  return buffer;
}

export function createReverbUnit(ctx: AudioContext): EffectUnit<ReverbState> {
  const preDelay = ctx.createDelay(MAX_PREDELAY_SEC);
  const convolver = ctx.createConvolver();
  const damping = ctx.createBiquadFilter();
  damping.type = 'lowpass';
  preDelay.connect(convolver).connect(damping);

  const { input, output, setWet } = makeDryWet(ctx, preDelay, damping);

  // Rebuild the IR only when ir/decay change (the fill loop is O(decaySec*sr)).
  let lastIr: IrType | null = null;
  let lastDecay = -1;

  const unit: EffectUnit<ReverbState> = {
    id: 'reverb',
    input,
    output,
    applyParams: (state: ReverbState) => {
      if (state.ir !== lastIr || state.decaySec !== lastDecay) {
        convolver.buffer = buildIr(ctx, state.ir, state.decaySec);
        lastIr = state.ir;
        lastDecay = state.decaySec;
      }
      preDelay.delayTime.value = state.preDelayMs / 1000;
      damping.frequency.value = state.dampingHz;
      setWet(state.enabled ? state.mix : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [preDelay, convolver, damping, input, output].forEach((n) => n.disconnect());
    },
  };
  // A null-buffer ConvolverNode outputs silence — self-init builds the default IR
  // and (mix 0 / disabled) sets wet=0 so the built unit is dry passthrough.
  unit.applyParams(REVERB_DEFAULT);
  return unit;
}
```

- [ ] **Step 6: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: tsc clean; build succeeds; vitest green (irSynth tests + existing suite).

- [ ] **Step 7: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/dsp/irSynth.ts components/frontend-spectr-v2/src/features/listen/audio/dsp/irSynth.test.ts components/frontend-spectr-v2/src/features/listen/audio/effects/reverb.ts
git commit -m "feat(listen): reverb unit + synthesized IR envelope"
```

---

## Task 9: Register the six factories in the composer

**Files:**
- Modify: `audio/composer.ts:1-8` (imports) and `:22-28` (the `units` record)

**Interfaces:**
- Consumes: the six `create*Unit` factories (Tasks 2–8); `DEFAULT_ORDER` (Task 1, already imported).
- Produces: a `units` record covering all ten `EffectId`s. The existing `wire`/`reorder`/`chainLinks` logic is order-generic and needs no change.

- [ ] **Step 1: Add the six imports**

In `audio/composer.ts`, add to the import block (keep existing imports; order by path):

```ts
import { createCompressorUnit } from './effects/compressor';
import { createDelayUnit } from './effects/delay';
import { createDjFilterUnit } from './effects/djFilter';
import { createEqUnit } from './effects/eq';
import { createPanUnit } from './effects/pan';
import { createReverbUnit } from './effects/reverb';
import { createSaturatorUnit } from './effects/saturator';
import { createTremoloUnit } from './effects/tremolo';
import { createTrimUnit } from './effects/trim';
import { createWidthUnit } from './effects/width';
```

- [ ] **Step 2: Register all ten units in the `units` record**

Replace the existing `units` object literal in `buildInsertChain` with:

```ts
  const units: Record<EffectId, EffectUnit<unknown>> = {
    djfilter: createDjFilterUnit(ctx) as EffectUnit<unknown>,
    eq: createEqUnit(ctx) as EffectUnit<unknown>,
    comp: createCompressorUnit(ctx) as EffectUnit<unknown>,
    sat: createSaturatorUnit(ctx) as EffectUnit<unknown>,
    ms: createWidthUnit(ctx) as EffectUnit<unknown>,
    pan: createPanUnit(ctx) as EffectUnit<unknown>,
    tremolo: createTremoloUnit(ctx) as EffectUnit<unknown>,
    delay: createDelayUnit(ctx) as EffectUnit<unknown>,
    reverb: createReverbUnit(ctx) as EffectUnit<unknown>,
    trim: createTrimUnit(ctx) as EffectUnit<unknown>,
  };
```

- [ ] **Step 3: Run the gates**

```
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```
Expected: tsc clean (the `units` record now satisfies `Record<EffectId, …>` for all ten ids; without all six entries TS errors on the missing keys); build succeeds; vitest green.

- [ ] **Step 4: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/audio/composer.ts
git commit -m "feat(listen): register the six native units in the composer"
```

---

## Task 10: Route the six units through the hook handle

**Files:**
- Modify: `useAudioGraph.ts` — imports (`:5-15`), `EffectParamMap` (`:27-32`), state refs (after `:165`), apply helpers (after `:268`), `applyEffectParams` switch (`:281-300`), `resetAll` (`:560-572`)

**Interfaces:**
- Consumes: the six `*_DEFAULT` consts + state types from `./audio/state`; `nodes.chain.units.<id>` (registered in Task 9).
- Produces: `EffectParamMap` covering all ten ids; `setEffectParams`/`reorder`/`getOrder` now span ten ids; `resetAll` resets all ten. No new public handle surface.

- [ ] **Step 1: Extend the state import**

The six state TYPES (`DjFilterState`…`TrimState`) are ALREADY imported (a prior hotfix widened `EffectParamMap`). This step adds the six `*_DEFAULT` VALUE imports (used by the refs in Step 3). Ensure the `from './audio/state'` import block matches the following exactly:

```ts
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
} from './audio/state';
```

- [ ] **Step 2: `EffectParamMap` — ALREADY DONE (verify only)**

`EffectParamMap` was already widened to all ten ids by the hotfix. Confirm it reads as below and make NO change:

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
}
```

- [ ] **Step 3: Add the six state refs**

After the `widthStateRef` declaration (line 165), add:

```ts
  const djFilterStateRef = useRef<DjFilterState>({ ...DJFILTER_DEFAULT });
  const delayStateRef = useRef<DelayState>({ ...DELAY_DEFAULT });
  const reverbStateRef = useRef<ReverbState>({ ...REVERB_DEFAULT });
  const panStateRef = useRef<PanState>({ ...PAN_DEFAULT });
  const tremoloStateRef = useRef<TremoloState>({ ...TREMOLO_DEFAULT });
  const trimStateRef = useRef<TrimState>({ ...TRIM_DEFAULT });
```

- [ ] **Step 4: Add the six apply helpers**

After `applyEq` (line 268), before `applyMasterBypass`, add:

```ts
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
```

- [ ] **Step 5: Add the six switch cases**

In `applyEffectParams`, add these cases after the `ms` case (before the closing `}` of the switch):

```ts
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
```

- [ ] **Step 6: Extend `resetAll`**

In `resetAll` (lines 560–572), reset the six new refs and re-apply them. Replace the body so it reads:

```ts
    resetAll: () => {
      eqStateRef.current = EQ_BANDS_DEFAULT.map((b) => ({ ...b }));
      compStateRef.current = { ...COMPRESSOR_DEFAULT };
      satStateRef.current = { ...SATURATION_DEFAULT };
      widthStateRef.current = { ...WIDTH_DEFAULT };
      djFilterStateRef.current = { ...DJFILTER_DEFAULT };
      delayStateRef.current = { ...DELAY_DEFAULT };
      reverbStateRef.current = { ...REVERB_DEFAULT };
      panStateRef.current = { ...PAN_DEFAULT };
      tremoloStateRef.current = { ...TREMOLO_DEFAULT };
      trimStateRef.current = { ...TRIM_DEFAULT };
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
      applyMasterBypass();
      nodesRef.current?.chain.reorder([...DEFAULT_ORDER]);
    },
```

- [ ] **Step 7: Run ALL four gates**

```
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run lint
cd components/frontend-spectr-v2 && npx vitest run
cd components/frontend-spectr-v2 && npm run build
```
Expected: tsc clean; lint clean (`--max-warnings 0`); vitest green (all dsp tests + existing suite); build succeeds.

- [ ] **Step 8: Commit**

```
git add components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts
git commit -m "feat(listen): route the six native units through the graph handle"
```

---

## Post-implementation

- **Manual browser smoke (deferred — needs the running app + a version with audio).** On the Listen page, with all new tools at defaults, confirm playback is unchanged from before Phase 4 (behavior preservation). Then, via the dev console on the audio-graph handle, exercise one new unit per family: `setEffectParams('delay', { enabled: true, mix: 0.4 })` (hear echoes), `setEffectParams('pan', { enabled: true, pan: -1 })` (hard left), `setEffectParams('djfilter', { enabled: true, morph: -0.6 })` (lowpass sweep), `setEffectParams('reverb', { enabled: true, mix: 0.5 })` (tail), `setEffectParams('tremolo', { enabled: true, depth: 1 })` (amplitude wobble), `setEffectParams('trim', { gainDb: -6 })` (level drop). Confirm `reorder` still click-free.
- **Final whole-branch review** (subagent-driven-development's final step) before merge.
- **Merge** via finishing-a-development-branch once gates + review are clean.

## Notes for the implementer

- The single most important invariant: **every new factory ends with `unit.applyParams(<DEFAULT>)`** so the built unit is transparent without a hook sweep. Reviewers verify this on every unit.
- `makeDryWet` connects `input → wetIn` unconditionally; `setWet` only controls the dry/wet **output** mix. So a unit's internal wet sub-graph always receives signal even when bypassed — that is fine (its output is muted at `setWet(0)`).
- Connecting a node to an AudioParam (`depthTrem.connect(tremGain.gain)`) is valid and is how the tremolo LFO modulates gain/pan. `.connect(param)` returns `void`, so it cannot be chained further.
- `osc.type = state.shape` type-checks because `'sine' | 'triangle' | 'square'` is a subset of the DOM `OscillatorType`.
- Do not add jsdom tests for the unit files. The dsp tests (`bpmSync`, `djMorph`, `tremoloMath`, `irSynth`) are the only new tests.
