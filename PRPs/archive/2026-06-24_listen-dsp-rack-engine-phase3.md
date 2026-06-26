# Listen DSP Rack — Phase 3: Unhide Existing Params — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the full real parameter surface of the four existing `EffectUnit`s (EQ, Compressor, Saturator, M/S Width) on the Listen-page DSP rack, without changing the default sound or breaking existing consumers.

**Architecture:** Widen each module's state type (identity defaults), extend the two pure-math files (`dsp/curves.ts`, `dsp/msMatrix.ts`), and update each `EffectUnit` factory to apply the new params. The generic `setEffectParams(id, patch)` handle (Phase 2) is the binding API; no new handle methods. Engine-only — no UI/route edits.

**Tech Stack:** React 19 + Vite 6 + TypeScript strict (`verbatimModuleSyntax`) + Web Audio API + Vitest. CSS Modules (not touched here).

**Design doc:** `PRPs/listen-dsp-rack-engine-phase3-design.md`. Parent: `PRPs/listen-dsp-rack-engine-design.md` (module spec tables).

## Global Constraints

- **TypeScript strict + `verbatimModuleSyntax`** — type-only imports MUST use `import type`.
- **Pure math (`audio/dsp/*`) is the ONLY unit-tested surface.** jsdom has no `AudioContext`, so AudioNode code (`effects/*.ts`, `useAudioGraph.ts`) is verified by `npx tsc --noEmit` + `npm run build` (+ a deferred manual browser check) — NOT by vitest. Do NOT add jsdom tests for AudioNode wiring; this is the established Phase 1/2 pattern.
- **Behavior-preserving.** Every new state field defaults to an identity value. Do NOT edit `PreviewTools.tsx`, `listen.$versionId.tsx`, or the existing `setEqBand` / `setEqEnabled` / `setCompressor` / `setSaturation` / `setWidth` wrappers. Their behavior must be byte-identical after this phase.
- **Engine-only.** No route/UI edits. The compressor gain-reduction meter *display* (the `buildMeterCells` `grReductionDb: null` stub) is deferred to Phase 6. `readEffectMeter('comp')` already returns `reductionDb` — leave it.
- **`EffectParamMap` keeps its shape** (`eq: { bands: EqBand[] }`, `comp/sat/ms` = their state). No new `AudioGraphHandle` methods. No `setEffectBypass` (on/off stays the `enabled` flag).
- **No file over ~500 lines.**
- **All commands run from `components/frontend-spectr-v2`.**
- **Four gates green at the branch tip:** `npx tsc --noEmit` · `npm run lint` (`--max-warnings 0`) · `npx vitest run` · `npm run build`.
- **Commit after each task.** Branch is `listen-dsp-rack-phase3` (already created).

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/features/listen/audio/state.ts` | param types + identity defaults + factories | 1 |
| `src/features/listen/audio/state.test.ts` (new) | asserts defaults are identity | 1 |
| `src/features/listen/audio/dsp/curves.ts` | waveshaper curve generation (6 shapes + asymmetry) | 2 |
| `src/features/listen/audio/dsp/curves.test.ts` | curve math tests | 2 |
| `src/features/listen/audio/dsp/msMatrix.ts` | M/S matrix coefficients (+ mid/side gain) | 3 |
| `src/features/listen/audio/dsp/msMatrix.test.ts` | matrix math tests | 3 |
| `src/features/listen/audio/effects/eq.ts` | EQ unit — per-band type/freq/Q/enable | 4 |
| `src/features/listen/audio/effects/compressor.ts` | Comp unit — parallel mix | 5 |
| `src/features/listen/audio/effects/saturator.ts` | Sat unit — curve/oversample/asym/tone/trim | 6 |
| `src/features/listen/audio/effects/width.ts` | M/S unit — mid/side gain (T7), mono-maker (T8) | 7, 8 |

`useAudioGraph.ts` needs **no logic change** — widened types flow through the existing refs/dispatch/`resetAll`; `tsc` at each task confirms it.

---

### Task 1: Widen `state.ts` — types, defaults, factories

**Files:**
- Modify: `src/features/listen/audio/state.ts`
- Test: `src/features/listen/audio/state.test.ts` (create)

**Interfaces:**
- Consumes: `EffectId` from `./EffectUnit` (unchanged).
- Produces:
  - `type BiquadType = 'peaking'|'lowshelf'|'highshelf'|'lowpass'|'highpass'|'bandpass'|'notch'|'allpass'`
  - `type SatCurve = 'tanh'|'softclip'|'hardclip'|'arctan'|'sinefold'|'tube'`
  - `interface EqBand { type: BiquadType; freq: number; gainDb: number; q: number; enabled: boolean }`
  - `interface CompressorState { thresholdDb; ratio; attackMs; releaseMs; kneeDb; makeupDb; mix; enabled }`
  - `interface SaturationState { drive; mix; curve: SatCurve; oversample: OverSampleType; asymmetry; tone; outputTrimDb; enabled }`
  - `interface WidthState { width; midGainDb; sideGainDb; monoMakerHz; mono; enabled }`
  - Defaults `EQ_BANDS_DEFAULT`, `COMPRESSOR_DEFAULT`, `SATURATION_DEFAULT`, `WIDTH_DEFAULT` + factories `default*State()` (all identity).

- [ ] **Step 1: Write the failing test**

Create `src/features/listen/audio/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  COMPRESSOR_DEFAULT,
  EQ_BANDS_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
} from './state';

describe('effect defaults are identity/neutral', () => {
  it('compressor default has mix=1 (full wet) and is disabled', () => {
    expect(COMPRESSOR_DEFAULT.mix).toBe(1);
    expect(COMPRESSOR_DEFAULT.enabled).toBe(false);
  });

  it('saturator default is tanh with no asymmetry/tone/trim', () => {
    expect(SATURATION_DEFAULT.curve).toBe('tanh');
    expect(SATURATION_DEFAULT.oversample).toBe('2x');
    expect(SATURATION_DEFAULT.asymmetry).toBe(0);
    expect(SATURATION_DEFAULT.tone).toBe(0);
    expect(SATURATION_DEFAULT.outputTrimDb).toBe(0);
  });

  it('width default has unity trims and mono-maker off', () => {
    expect(WIDTH_DEFAULT.width).toBe(1);
    expect(WIDTH_DEFAULT.midGainDb).toBe(0);
    expect(WIDTH_DEFAULT.sideGainDb).toBe(0);
    expect(WIDTH_DEFAULT.monoMakerHz).toBe(0);
    expect(WIDTH_DEFAULT.mono).toBe(false);
  });

  it('every EQ band defaults to an enabled flat peaking filter at Q 1.4', () => {
    expect(EQ_BANDS_DEFAULT).toHaveLength(8);
    for (const b of EQ_BANDS_DEFAULT) {
      expect(b.type).toBe('peaking');
      expect(b.gainDb).toBe(0);
      expect(b.q).toBe(1.4);
      expect(b.enabled).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen/audio/state.test.ts`
Expected: FAIL — `mix`/`curve`/`midGainDb`/band `type` etc. don't exist yet (compile/assertion errors).

- [ ] **Step 3: Implement — replace the whole `state.ts` body**

Replace the entire contents of `src/features/listen/audio/state.ts` with:

```ts
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

// Phase-1 default insert order. Matches the legacy chain EQ -> Comp -> Sat -> M/S.
export const DEFAULT_ORDER: ReadonlyArray<EffectId> = ['eq', 'comp', 'sat', 'ms'];

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

- [ ] **Step 4: Run the gates**

```
npx vitest run src/features/listen/audio/state.test.ts
npx tsc --noEmit
```
Expected: state test PASSES; `tsc` PASSES (the consumer sites in `PreviewTools.tsx` and `useAudioGraph.ts` spread the widened defaults, so the new fields flow through with no literal-construction breaks).

- [ ] **Step 5: Commit**

```bash
git add src/features/listen/audio/state.ts src/features/listen/audio/state.test.ts
git commit -m "feat(listen): widen effect state types + identity defaults (P3 task 1)"
```

---

### Task 2: `curves.ts` — 6 curve shapes + asymmetry

**Files:**
- Modify: `src/features/listen/audio/dsp/curves.ts`
- Test: `src/features/listen/audio/dsp/curves.test.ts`

**Interfaces:**
- Consumes: `SatCurve` from `../state` (Task 1).
- Produces: `makeSatCurve(drive: number, curve?: SatCurve, asymmetry?: number): Float32Array` — 1024 samples, bounded `[-1,1]`, odd-symmetric when `asymmetry === 0`. Back-compat: `makeSatCurve(d) === makeSatCurve(d, 'tanh', 0)`. Consumed by `saturator.ts` (Task 6).

- [ ] **Step 1: Write the failing tests** (append to the existing `curves.test.ts`, keep the current 3 tests)

Add these imports/blocks to `src/features/listen/audio/dsp/curves.test.ts` (the file already imports `makeSatCurve`):

```ts
const CURVES = ['tanh', 'softclip', 'hardclip', 'arctan', 'sinefold', 'tube'] as const;

describe('makeSatCurve — all curve shapes', () => {
  it.each(CURVES)('%s: 1024 samples bounded to [-1,1], ~0 at center', (curve) => {
    const c = makeSatCurve(0.6, curve, 0);
    expect(c).toHaveLength(1024);
    for (const v of c) {
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
    // 511/512 straddle x=0; their mean cancels to ~0 for an odd curve.
    expect((c[511] + c[512]) / 2).toBeCloseTo(0, 5);
  });

  it.each(CURVES)('%s: odd-symmetric when asymmetry is 0', (curve) => {
    const c = makeSatCurve(0.7, curve, 0);
    for (const i of [100, 300, 480]) {
      expect(c[i] + c[1023 - i]).toBeCloseTo(0, 4);
    }
  });

  it('asymmetry breaks odd symmetry (tanh)', () => {
    const c = makeSatCurve(0.7, 'tanh', 0.6);
    expect(c[800] + c[1023 - 800]).not.toBeCloseTo(0, 2);
  });

  it('back-compat: makeSatCurve(d) equals makeSatCurve(d, tanh, 0)', () => {
    expect(Array.from(makeSatCurve(0.5))).toEqual(Array.from(makeSatCurve(0.5, 'tanh', 0)));
  });

  it('drive steepens the curve at the center (tanh)', () => {
    const slope = (c: Float32Array) => c[512] - c[511];
    expect(slope(makeSatCurve(0.9, 'tanh', 0))).toBeGreaterThan(
      slope(makeSatCurve(0.1, 'tanh', 0)),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/listen/audio/dsp/curves.test.ts`
Expected: FAIL — `makeSatCurve` doesn't accept a `curve` arg yet (the `.each` curves error / wrong output).

- [ ] **Step 3: Implement — replace the whole `curves.ts`**

Replace the entire contents of `src/features/listen/audio/dsp/curves.ts` with:

```ts
import type { SatCurve } from '../state';

// Per-curve waveshaper transfer function over x in [-1, 1]. Each shape is odd
// in x at a fixed drive `d` (shape(-x) = -shape(x)); even harmonics come from
// the asymmetry param (per-half drive in makeSatCurve), not from these shapes.
// d 0 => near-linear, d 1 => strong saturation.
function shape(curve: SatCurve, x: number, d: number): number {
  switch (curve) {
    case 'tanh': {
      const k = 1 + d * 4;
      return Math.tanh(k * x) / Math.tanh(k);
    }
    case 'arctan': {
      const k = 1 + d * 4;
      return Math.atan(k * x) / Math.atan(k);
    }
    case 'softclip': {
      const k = 1 + d * 2;
      const t = Math.max(-1, Math.min(1, k * x));
      return 1.5 * t - 0.5 * t * t * t;
    }
    case 'hardclip': {
      const k = 1 + d * 9;
      return Math.max(-1, Math.min(1, k * x));
    }
    case 'sinefold': {
      const k = 1 + d * 4;
      return Math.sin((k * Math.PI * x) / 2);
    }
    case 'tube': {
      const k = 1 + d * 4;
      const num = (k * x) / (1 + Math.abs(k * x));
      return num / (k / (1 + k));
    }
    default: {
      const exhaustive: never = curve;
      return exhaustive;
    }
  }
}

// 1024-sample waveshaper curve. `asymmetry` (-1..1) scales drive differently on
// the positive vs negative half, generating even harmonics (and DC, which the
// saturator unit removes with a post highpass). asymmetry 0 => odd-symmetric.
// Back-compat: makeSatCurve(drive) === makeSatCurve(drive, 'tanh', 0).
export function makeSatCurve(
  drive: number,
  curve: SatCurve = 'tanh',
  asymmetry = 0,
): Float32Array {
  const n = 1024;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    const d = Math.max(0, drive * (x >= 0 ? 1 + asymmetry : 1 - asymmetry));
    out[i] = shape(curve, x, d);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/listen/audio/dsp/curves.test.ts`
Expected: PASS (existing 3 tanh tests + new blocks).

- [ ] **Step 5: Commit**

```bash
git add src/features/listen/audio/dsp/curves.ts src/features/listen/audio/dsp/curves.test.ts
git commit -m "feat(listen): saturator curve shapes + asymmetry in makeSatCurve (P3 task 2)"
```

---

### Task 3: `msMatrix.ts` — mid/side gain folding

**Files:**
- Modify: `src/features/listen/audio/dsp/msMatrix.ts`
- Test: `src/features/listen/audio/dsp/msMatrix.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `msGains(width: number, midGain?: number, sideGain?: number): { midL; midR; sideL; sideR }`. Defaults `midGain = sideGain = 1` reproduce the existing `msGains(width)`. Consumed by `width.ts` (Tasks 7, 8).

- [ ] **Step 1: Write the failing tests** (append to existing `msMatrix.test.ts`, keep the current 3)

Add to `src/features/listen/audio/dsp/msMatrix.test.ts`:

```ts
  it('mid gain scales the mid coefficients', () => {
    // midGain 2 at width 1: a = 0.5(2+1) = 1.5, b = 0.5(2-1) = 0.5
    expect(msGains(1, 2, 1)).toEqual({ midL: 1.5, midR: 0.5, sideL: 0.5, sideR: 1.5 });
  });
  it('side gain scales the side like width does (sideGain*width)', () => {
    // sideGain 2 at width 1 equals sideGain 1 at width 2
    expect(msGains(1, 1, 2)).toEqual(msGains(2, 1, 1));
  });
```

(Place them inside the existing `describe('msGains', …)` block, before its closing `});`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/listen/audio/dsp/msMatrix.test.ts`
Expected: FAIL — `msGains` ignores the extra args today.

- [ ] **Step 3: Implement — replace the whole `msMatrix.ts`**

Replace the entire contents of `src/features/listen/audio/dsp/msMatrix.ts` with:

```ts
// Channel-matrix gains for the M/S width control. width=1 identity, width=0
// mono, width=2 exaggerated. midGain/sideGain are linear bus gains (default 1).
// Derivation: L_out = gM*M + gS*w*S, R_out = gM*M - gS*w*S, where M=(L+R)/2,
// S=(L-R)/2. Wired as:
//   L_out = L_in*midL + R_in*sideL ; R_out = L_in*midR + R_in*sideR
export function msGains(
  width: number,
  midGain = 1,
  sideGain = 1,
): { midL: number; midR: number; sideL: number; sideR: number } {
  const a = 0.5 * (midGain + sideGain * width);
  const b = 0.5 * (midGain - sideGain * width);
  return { midL: a, midR: b, sideL: b, sideR: a };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/listen/audio/dsp/msMatrix.test.ts`
Expected: PASS — existing identity/mono/exaggerate tests still green (defaults), plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/features/listen/audio/dsp/msMatrix.ts src/features/listen/audio/dsp/msMatrix.test.ts
git commit -m "feat(listen): mid/side bus gain in msGains (P3 task 3)"
```

---

### Task 4: `eq.ts` — per-band type / freq / Q / enable

**Files:**
- Modify: `src/features/listen/audio/effects/eq.ts`

**Interfaces:**
- Consumes: `EqState` (Task 1) — each band now carries `type`, `freq`, `gainDb`, `q`, `enabled`.
- Produces: unchanged `EffectUnit<EqState>` factory `createEqUnit(ctx)`.

**No vitest** — AudioNode wiring (jsdom has no `AudioContext`). Verified by `tsc` + `build` + existing suite staying green, per the Global Constraints.

- [ ] **Step 1: Implement — replace the whole `eq.ts`**

Replace the entire contents of `src/features/listen/audio/effects/eq.ts` with:

```ts
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
        const band = state.bands[i];
        if (!band) continue;
        filters[i].type = band.type;
        filters[i].frequency.value = band.freq;
        filters[i].Q.value = band.q;
        // gain applies to peaking/shelf types only (Web Audio ignores it on
        // filter types). A disabled band — or disabled unit — flattens to 0 dB.
        filters[i].gain.value = state.enabled && band.enabled ? band.gainDb : 0;
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

Behavior note: the hook's `applyEq()` calls this with `{ bands, enabled: true }`. With band defaults (`type:'peaking'`, `q:1.4`, `enabled:true`) the filter config is identical to before; `gain = (true && true) ? gainDb : 0 = gainDb`, exactly the prior `enabled ? gainDb : 0` with `enabled:true`.

- [ ] **Step 2: Run the gates**

```
npx tsc --noEmit
npx vitest run
npm run lint
npm run build
```
Expected: all PASS (370 existing tests unaffected; no new vitest for this AudioNode file).

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/eq.ts
git commit -m "feat(listen): EQ per-band type/freq/Q/enable (P3 task 4)"
```

---

### Task 5: `compressor.ts` — parallel (NY) mix

**Files:**
- Modify: `src/features/listen/audio/effects/compressor.ts`

**Interfaces:**
- Consumes: `CompressorState` (Task 1) — now carries `mix`.
- Produces: unchanged `EffectUnit<CompressorState>` factory.

**No vitest** — AudioNode wiring.

- [ ] **Step 1: Implement — change the `setWet` line in `applyParams`**

In `src/features/listen/audio/effects/compressor.ts`, change the last line of `applyParams` from:

```ts
      setWet(state.enabled ? 1 : 0);
```

to:

```ts
      // Parallel (New York) compression: wet level = mix. mix 1 = fully
      // compressed, < 1 blends the un-compressed dry lane back in.
      setWet(state.enabled ? state.mix : 0);
```

(Everything else in the file is unchanged — threshold/ratio/attack/release/knee/makeup are already wired, `readMeter()` already returns `reductionDb`.)

- [ ] **Step 2: Run the gates**

```
npx tsc --noEmit
npx vitest run
npm run lint
npm run build
```
Expected: all PASS. `mix` default 1 ⇒ `enabled` ⇒ `setWet(1)` ⇒ identical to today.

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/compressor.ts
git commit -m "feat(listen): compressor parallel mix (P3 task 5)"
```

---

### Task 6: `saturator.ts` — curve / oversample / asymmetry / tone / output trim

**Files:**
- Modify: `src/features/listen/audio/effects/saturator.ts`

**Interfaces:**
- Consumes: `makeSatCurve(drive, curve, asymmetry)` (Task 2), `SaturationState` (Task 1).
- Produces: unchanged `EffectUnit<SaturationState>` factory.

**No vitest** — AudioNode wiring. Internal wet path widens to `shaper → dcBlocker → toneLow → toneHigh → trim` (`makeDryWet(ctx, shaper, trim)`).

- [ ] **Step 1: Implement — replace the whole `saturator.ts`**

Replace the entire contents of `src/features/listen/audio/effects/saturator.ts` with:

```ts
import { makeSatCurve } from '../dsp/curves';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { SaturationState } from '../state';

// Tone-tilt shelf pivots + max boost/cut for the `tone` param.
const TONE_LOW_HZ = 320;
const TONE_HIGH_HZ = 3200;
const TONE_MAX_DB = 6;

export function createSaturatorUnit(ctx: AudioContext): EffectUnit<SaturationState> {
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSatCurve(0, 'tanh', 0);
  shaper.oversample = '2x';

  // DC blocker — asymmetry introduces DC. Parked sub-audio (10 Hz, transparent
  // for >=20 Hz program) until asymmetry != 0, where it moves up to 20 Hz.
  const dcBlocker = ctx.createBiquadFilter();
  dcBlocker.type = 'highpass';
  dcBlocker.frequency.value = 10;
  dcBlocker.Q.value = 0.707;

  // Tone tilt — low-shelf + high-shelf pair, both flat (0 dB) at tone=0.
  const toneLow = ctx.createBiquadFilter();
  toneLow.type = 'lowshelf';
  toneLow.frequency.value = TONE_LOW_HZ;
  toneLow.gain.value = 0;
  const toneHigh = ctx.createBiquadFilter();
  toneHigh.type = 'highshelf';
  toneHigh.frequency.value = TONE_HIGH_HZ;
  toneHigh.gain.value = 0;

  const trim = ctx.createGain();
  trim.gain.value = 1;

  shaper.connect(dcBlocker).connect(toneLow).connect(toneHigh).connect(trim);

  const { input, output, setWet } = makeDryWet(ctx, shaper, trim);

  return {
    id: 'sat',
    input,
    output,
    applyParams: (state: SaturationState) => {
      const on = state.enabled;
      shaper.curve = makeSatCurve(on ? state.drive : 0, state.curve, on ? state.asymmetry : 0);
      shaper.oversample = state.oversample;
      dcBlocker.frequency.value = on && state.asymmetry !== 0 ? 20 : 10;
      const tilt = on ? state.tone : 0;
      toneLow.gain.value = -tilt * TONE_MAX_DB;
      toneHigh.gain.value = tilt * TONE_MAX_DB;
      trim.gain.value = Math.pow(10, (on ? state.outputTrimDb : 0) / 20);
      // A saturator has no "full wet" identity — its wet level IS the mix param.
      setWet(on ? state.mix : 0);
    },
    setBypass: () => setWet(0),
    dispose: () => {
      [shaper, dcBlocker, toneLow, toneHigh, trim, input, output].forEach((n) => n.disconnect());
    },
  };
}
```

Behavior note: default (`enabled:false`) ⇒ `setWet(0)` ⇒ fully dry ⇒ the wet chain is silent regardless of the added nodes. At `enabled` with `curve:'tanh', asym:0, tone:0, trim:0` the wet path is `tanh shaper → ~10 Hz HP → flat shelves → unity gain` — sonically the prior saturator.

- [ ] **Step 2: Run the gates**

```
npx tsc --noEmit
npx vitest run
npm run lint
npm run build
```
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/saturator.ts
git commit -m "feat(listen): saturator curve/oversample/asymmetry/tone/trim (P3 task 6)"
```

---

### Task 7: `width.ts` — independent mid/side gain

**Files:**
- Modify: `src/features/listen/audio/effects/width.ts`

**Interfaces:**
- Consumes: `msGains(width, midGain, sideGain)` (Task 3), `WidthState` (Task 1).
- Produces: unchanged `EffectUnit<WidthState>` factory. (Task 8 extends this same file with mono-maker.)

**No vitest** — AudioNode wiring.

- [ ] **Step 1: Implement — replace the whole `width.ts`**

Replace the entire contents of `src/features/listen/audio/effects/width.ts` with:

```ts
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

  const setMatrix = (width: number, midGain: number, sideGain: number) => {
    const g = msGains(width, midGain, sideGain);
    midL.gain.value = g.midL;
    midR.gain.value = g.midR;
    sideL.gain.value = g.sideL;
    sideR.gain.value = g.sideR;
  };
  setMatrix(1, 1, 1); // identity default

  const { input, output, setWet } = makeDryWet(ctx, splitter, merger);

  return {
    id: 'ms',
    input,
    output,
    applyParams: (state: WidthState) => {
      if (!state.enabled) {
        setMatrix(1, 1, 1);
        return;
      }
      const gM = Math.pow(10, state.midGainDb / 20);
      const gS = Math.pow(10, state.sideGainDb / 20);
      const w = state.mono ? 0 : state.width;
      setMatrix(w, gM, gS);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [splitter, midL, midR, sideL, sideR, merger, input, output].forEach((n) => n.disconnect());
    },
  };
}
```

Behavior note: default (`enabled:false`) ⇒ `setMatrix(1,1,1)` identity. At `enabled` with defaults (`width:1, midGainDb:0, sideGainDb:0, mono:false`) ⇒ `gM=gS=1, w=1` ⇒ `msGains(1,1,1)` identity — same as before. A non-default `width` reproduces the old `msGains(width)`.

- [ ] **Step 2: Run the gates**

```
npx tsc --noEmit
npx vitest run
npm run lint
npm run build
```
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/width.ts
git commit -m "feat(listen): M/S independent mid/side gain (P3 task 7)"
```

---

### Task 8: `width.ts` — mono-maker (low-band mono correction)

**Files:**
- Modify: `src/features/listen/audio/effects/width.ts`

**Interfaces:**
- Consumes: Task 7's `width.ts` + `msGains` + `WidthState` (`monoMakerHz`, `mono`).
- Produces: unchanged `EffectUnit<WidthState>` factory.

**No vitest** — AudioNode wiring. Adds a parallel correction that subtracts the low-frequency *side* energy from the matrix output so lows collapse to mono. The correction gain is 0 when `monoMakerHz <= 0`, making the off state bit-identical to Task 7. Derivation: matrix output is `L=gM·M+gS·w·S`, `R=gM·M−gS·w·S`; subtracting `c = gS·w·lowpass(S)` from L and adding it to R nulls the low-band side → lows become `gM·M` (mono).

- [ ] **Step 1: Implement — replace the whole `width.ts`** (extends Task 7)

Replace the entire contents of `src/features/listen/audio/effects/width.ts` with:

```ts
import { msGains } from '../dsp/msMatrix';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { WidthState } from '../state';

export function createWidthUnit(ctx: AudioContext): EffectUnit<WidthState> {
  // Stable wet entry/exit so the mono-maker correction can tap the same input
  // and sum into the same output as the width matrix.
  const preGain = ctx.createGain();
  const finalMerger = ctx.createChannelMerger(2);

  // ── Width matrix (full-range) ──
  const splitter = ctx.createChannelSplitter(2);
  const midL = ctx.createGain();
  const midR = ctx.createGain();
  const sideL = ctx.createGain();
  const sideR = ctx.createGain();
  preGain.connect(splitter);
  splitter.connect(midL, 0);
  splitter.connect(sideL, 1);
  splitter.connect(midR, 0);
  splitter.connect(sideR, 1);
  midL.connect(finalMerger, 0, 0);
  sideL.connect(finalMerger, 0, 0);
  midR.connect(finalMerger, 0, 1);
  sideR.connect(finalMerger, 0, 1);

  // ── Mono-maker correction ──
  // sideBus = 0.5*L - 0.5*R = S (mono). lowpass(S) -> corrGain -> ±finalMerger.
  // corrGain 0 (default / monoMakerHz<=0) => exactly the matrix above.
  const corrSplitter = ctx.createChannelSplitter(2);
  const sPos = ctx.createGain();
  const sNeg = ctx.createGain();
  sPos.gain.value = 0.5;
  sNeg.gain.value = -0.5;
  const sideBus = ctx.createGain();
  const corrLP = ctx.createBiquadFilter();
  corrLP.type = 'lowpass';
  corrLP.frequency.value = 200;
  corrLP.Q.value = 0.707;
  const corrGain = ctx.createGain();
  corrGain.gain.value = 0;
  const cNeg = ctx.createGain(); // -> L_out (subtract low-band side)
  const cPos = ctx.createGain(); // -> R_out (add low-band side)
  cNeg.gain.value = -1;
  cPos.gain.value = 1;

  preGain.connect(corrSplitter);
  corrSplitter.connect(sPos, 0);
  corrSplitter.connect(sNeg, 1);
  sPos.connect(sideBus);
  sNeg.connect(sideBus);
  sideBus.connect(corrLP).connect(corrGain);
  corrGain.connect(cNeg).connect(finalMerger, 0, 0);
  corrGain.connect(cPos).connect(finalMerger, 0, 1);

  const setMatrix = (width: number, midGain: number, sideGain: number) => {
    const g = msGains(width, midGain, sideGain);
    midL.gain.value = g.midL;
    midR.gain.value = g.midR;
    sideL.gain.value = g.sideL;
    sideR.gain.value = g.sideR;
  };
  setMatrix(1, 1, 1); // identity default

  const { input, output, setWet } = makeDryWet(ctx, preGain, finalMerger);

  return {
    id: 'ms',
    input,
    output,
    applyParams: (state: WidthState) => {
      if (!state.enabled) {
        setMatrix(1, 1, 1);
        corrGain.gain.value = 0;
        return;
      }
      const gM = Math.pow(10, state.midGainDb / 20);
      const gS = Math.pow(10, state.sideGainDb / 20);
      const w = state.mono ? 0 : state.width;
      setMatrix(w, gM, gS);
      // Mono-maker: null the low-band side. Correction level tracks the matrix
      // side level (gS * w). Off (gain 0) when monoMakerHz <= 0 => pure matrix.
      if (state.monoMakerHz > 0) {
        corrLP.frequency.value = state.monoMakerHz;
        corrGain.gain.value = gS * w;
      } else {
        corrGain.gain.value = 0;
      }
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [
        preGain,
        splitter,
        midL,
        midR,
        sideL,
        sideR,
        corrSplitter,
        sPos,
        sNeg,
        sideBus,
        corrLP,
        corrGain,
        cNeg,
        cPos,
        finalMerger,
        input,
        output,
      ].forEach((n) => n.disconnect());
    },
  };
}
```

Behavior note: default (`enabled:false`) ⇒ identity matrix + `corrGain 0` ⇒ exact passthrough. `enabled` + `monoMakerHz:0` ⇒ `corrGain 0` ⇒ exactly Task 7's mid/side matrix (bit-identical). Multiple connections summing into a single `ChannelMerger` input is the same mechanism the matrix already relies on (`midL`+`sideL` both → input 0).

- [ ] **Step 2: Run the gates**

```
npx tsc --noEmit
npx vitest run
npm run lint
npm run build
```
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/listen/audio/effects/width.ts
git commit -m "feat(listen): M/S mono-maker low-band correction (P3 task 8)"
```

---

## Final verification (after Task 8)

Run the full gate suite from `components/frontend-spectr-v2` and confirm all green:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

Expected: `tsc` clean, lint 0 warnings, vitest all pass (370 existing + the new `state` / `curves` / `msMatrix` cases), build succeeds. AudioNode behavior (eq/comp/sat/width units) carries to the deferred manual browser smoke test; nothing in this phase changes default-state output.
