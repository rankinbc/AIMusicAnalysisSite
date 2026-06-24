# Listen DSP Rack — Phase 3: Unhide Existing Params (Design Delta)

Date: 2026-06-24
Status: Design approved — pending implementation plan
Builds on: Phase 2 (merged, `master`). Parent design: `PRPs/listen-dsp-rack-engine-design.md` (module spec tables, lines 190–254; phasing item 3).
Scope: audio-engine layer only. No UI, no route edits. Behavior-preserving (every new field defaults to identity; existing consumers untouched).

## Goal

Expose the full real parameter surface of the four existing `EffectUnit`s — EQ, Compressor, Saturator, M/S Width — without changing the default sound or breaking the existing `setEqBand` / `setCompressor` / `setSaturation` / `setWidth` consumers. The generic `setEffectParams(id, patch)` handle (shipped Phase 2) is the binding API; this phase widens the per-module state each id accepts.

## Decisions (locked)

- **Engine-only.** No edits to `listen.$versionId.tsx` or `PreviewTools.tsx`. The compressor gain-reduction meter *read* already works (`readEffectMeter('comp')` → `reductionDb`); wiring that value into the route's `buildMeterCells` display is **deferred to Phase 6** (metering pass), keeping P3's boundary identical to P1/P2.
- **M/S keeps the macro.** The existing `width` (0–2) param stays and the existing width tool keeps working unchanged; `midGainDb` / `sideGainDb` are additional fine trims that *compose* with the macro, and `monoMakerHz` / `mono` are added. Not a replacement — behavior-preserving for the existing consumer.
- **No new handle methods.** `setEffectParams` is already generic and typed per id; widening the state types is the only handle-surface change. `EffectParamMap` keeps its shape (`eq: { bands: EqBand[] }`, `comp/sat/ms` = their state). No `setEffectBypass` (Phase 2 decision stands: on/off is the `enabled` flag).
- **Pure math stays in `audio/dsp/`** and is the only unit-tested surface (jsdom has no `AudioContext`). New/extended: `curves.ts` (6 curve shapes + asymmetry), `msMatrix.ts` (mid/side gain scaling). AudioNode wiring is verified by `tsc` + `build` + a later manual browser check — the established constraint.

## Design

### 1. EQ — per-band type / freq / Q / enable

`EqBand` widens from `{ freq, gainDb }` to the full biquad surface:

```ts
export type BiquadType =
  | 'peaking' | 'lowshelf' | 'highshelf'
  | 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'allpass';

export interface EqBand {
  type: BiquadType;   // default 'peaking'
  freq: number;       // 20..20000 Hz
  gainDb: number;     // -24..+24 dB (applies to peaking/shelf only — Web Audio ignores gain on other types)
  q: number;          // 0.1..18, default 1.4
  enabled: boolean;   // per-band, default true
}
```

`EQ_BANDS_DEFAULT` becomes the 8 existing freqs each `{ type: 'peaking', freq, gainDb: 0, q: 1.4, enabled: true }`.

`eq.ts` `applyParams(state: EqState)` per filter `i`, band `b = state.bands[i]`:
```
filters[i].type            = b.type;
filters[i].frequency.value = b.freq;
filters[i].Q.value         = b.q;
filters[i].gain.value      = (state.enabled && b.enabled) ? b.gainDb : 0;
setWet(state.enabled ? 1 : 0);
```

**Behavior preservation:** the hook's `applyEq()` still passes `enabled: true` unconditionally (the P1 EQ rule — the existing consumer pre-gates each band gain via `setEqBand(i, eqEnabled ? gainDb : 0)`). Per-band `enabled` defaults `true`, `type` defaults `peaking`, `q` defaults `1.4`, so a band only ever touched by `setEqBand` (gain) produces the exact filter config as today. `setEqBand` / `setEqEnabled` wrappers are **unchanged**.

**Known limitation (documented):** per-band `enabled:false` zeroes `.gain`, which fully bypasses *peaking/shelf* bands (the default and only currently-used type) but does **not** silence *filter-type* bands (lowpass/highpass/bandpass/notch/allpass ignore `.gain`). True per-band bypass for filter types needs per-band dry/wet routing in the series string — out of scope this phase; filter types are future-UI only.

### 2. Compressor — parallel (NY) mix

`CompressorState += mix: number` (`0..1`, default `1`). `compressor.ts` `applyParams` changes one line:
```
setWet(state.enabled ? state.mix : 0);   // was: enabled ? 1 : 0
```
`makeDryWet`'s dry lane is the un-compressed input and the wet lane is compressed → `mix < 1` blends them = parallel compression. `mix` default `1` ⇒ full-wet when enabled ⇒ **identical to today**. threshold / ratio / attack / release / knee / makeup are already wired (`compressor.ts:17-21`) — no change. `readMeter()` already returns `{ reductionDb: compressor.reduction }` — no change.

### 3. Saturator — curve select / oversample / asymmetry / tone / output trim

`SaturationState` widens:
```ts
export type SatCurve = 'tanh' | 'softclip' | 'hardclip' | 'arctan' | 'sinefold' | 'tube';

export interface SaturationState {
  drive: number;            // 0..1
  mix: number;              // 0..1
  curve: SatCurve;          // default 'tanh'
  oversample: OverSampleType; // 'none'|'2x'|'4x', default '2x'
  asymmetry: number;        // -1..1, default 0 (even harmonics)
  tone: number;             // -1..1 tilt, default 0
  outputTrimDb: number;     // -24..+12 dB, default 0
  enabled: boolean;
}
```

**Internal topology** (the `makeDryWet` wet path widens from a lone shaper to a small chain; `wetIn = shaper`, `wetOut = trim`):
```
shaper → dcBlockerHP → toneLow(lowshelf) → toneHigh(highshelf) → trim(gain)
```
- **shaper.curve** = `makeSatCurve(drive, curve, asymmetry)` (pure, below). `shaper.oversample = state.oversample`.
- **dcBlockerHP** — a highpass biquad on the wet path. Asymmetry adds DC; the HP removes it. Frequency set to `20 Hz` when `asymmetry !== 0`, dropped to a sub-audio frequency (`10 Hz`, transparent for ≥20 Hz program) when `asymmetry === 0`, so topology stays stable and the symmetric-curve sound is unchanged.
- **tone** tilt = a low-shelf + high-shelf pair. `tone < 0` boosts lows / cuts highs; `tone > 0` the reverse; `tone = 0` ⇒ both shelves at gain 0 (identity). Mapping e.g. `lowShelf.gain = -tone * 6 dB`, `highShelf.gain = +tone * 6 dB` (exact dB span fixed in the plan).
- **trim** = `GainNode`, `gain = 10^(outputTrimDb/20)`. Default `0 dB` ⇒ unity.

**Behavior preservation:** default saturator is `enabled:false` ⇒ `setWet(0)` ⇒ fully dry ⇒ the entire wet chain (including the DC blocker) is disconnected from output. Default transparency holds regardless of the added nodes. At `curve:'tanh', asym:0, tone:0, trim:0` the wet chain reduces to `tanh shaper → ~10 Hz HP → flat shelves → unity gain`, i.e. sonically the existing saturator.

### 4. M/S Width — independent mid/side trims + mono-maker

`WidthState` widens:
```ts
export interface WidthState {
  width: number;        // 0..2 (existing macro)
  midGainDb: number;    // -12..+12 dB, default 0
  sideGainDb: number;   // -12..+12 dB, default 0
  monoMakerHz: number;  // 0..400 Hz, 0 = off, default 0
  mono: boolean;        // force width→0, default false
  enabled: boolean;
}
```

**Mid/side trims** fold into the matrix math. The M/S decode is `M=(L+R)/2, S=(L−R)/2; outL = gM·M + gS·w·S, outR = gM·M − gS·w·S`, where `gM = 10^(midGainDb/20)`, `gS = 10^(sideGainDb/20)`. `msGains` widens to `msGains(width, midGain, sideGain)` returning the four matrix coefficients; the four-gain node matrix in `width.ts` is unchanged structurally. `mono:true` forces the effective width to `0`.

**Mono-maker** (`monoMakerHz > 0`) adds a crossover ahead of the width matrix: a 2nd-order lowpass/highpass split at `monoMakerHz`; the low band is summed to mono (equal to both channels), the high band passes through the width matrix, and the two are re-merged. At `monoMakerHz = 0` the split is bypass-equivalent (lowpass frequency parked sub-audio so the low band is empty and all energy flows through the width matrix) → **bit-identical to today**. A 2nd-order crossover is not perfectly reconstructing; acceptable for a preview tool (documented).

**Behavior preservation:** defaults are `width:1, midGainDb:0, sideGainDb:0, monoMakerHz:0, mono:false` ⇒ `gM=gS=1`, no crossover ⇒ the existing identity matrix. The existing width tool (sets only `width`) is unchanged.

### 5. Pure math (`audio/dsp/`)

- **`curves.ts`** — `makeSatCurve(drive: number, curve: SatCurve = 'tanh', asymmetry = 0): Float32Array`. Length 1024, output bounded to `[-1, 1]`, passes through ~0 at the curve center. Six shapes (tanh / softclip / hardclip / arctan / sinefold / tube). `asymmetry = 0` ⇒ odd-symmetric (`out[-x] = -out[x]`); `asymmetry ≠ 0` ⇒ different drive on positive vs negative half (even harmonics + DC, hence the DC blocker). The existing `makeSatCurve(drive)` tanh call site stays valid via defaults.
- **`msMatrix.ts`** — `msGains(width, midGain = 1, sideGain = 1)` returns `{ midL, midR, sideL, sideR }` with mid/side linear gains folded in. `midGain = sideGain = 1` reproduces the existing `msGains(width)` result (existing tests stay green).

### 6. Handle / state plumbing

`useAudioGraph.ts` is nearly untouched: the widened state types flow through the existing refs (`eqStateRef`, `compStateRef`, `satStateRef`, `widthStateRef`), the existing `applyEffectParams` `switch` (`Object.assign` merge for comp/sat/ms; `bands` assign for eq), and the existing wrappers. `resetAll()` resets to the widened defaults (all identity). No new methods, no `EffectParamMap` shape change.

## File changes

- `audio/state.ts` — widen `EqBand`, `CompressorState`, `SaturationState`, `WidthState`; add `BiquadType`, `SatCurve`; update `*_DEFAULT` + `default*State()` factories (all identity). Re-exports in `useAudioGraph.ts` unchanged.
- `audio/dsp/curves.ts` + `curves.test.ts` — `makeSatCurve(drive, curve, asymmetry)`; extend tests.
- `audio/dsp/msMatrix.ts` + `msMatrix.test.ts` — `msGains(width, midGain, sideGain)`; extend tests.
- `audio/effects/eq.ts` — per-band `type` / `freq` / `Q` / `enabled`.
- `audio/effects/compressor.ts` — `mix` via `setWet`.
- `audio/effects/saturator.ts` — DC-blocker HP + tone shelf pair + trim gain; curve/oversample/asymmetry plumbing.
- `audio/effects/width.ts` — mid/side gains in the matrix + mono-maker crossover.
- `useAudioGraph.ts` — type-flow only (likely no logic change beyond widened imports); `resetAll` covers new defaults.
- No route / `PreviewTools` / UI edits.

## Testing

- **`curves.test.ts`** — for each of the 6 curves: output length 1024, all values in `[-1, 1]`, monotonic non-decreasing, ~0 at center index. `drive` raises the slope at center. `asymmetry = 0` ⇒ odd-symmetric within tolerance; `asymmetry ≠ 0` ⇒ breaks symmetry. Existing `makeSatCurve(drive)` tanh assertions stay green.
- **`msMatrix.test.ts`** — `msGains(1, 1, 1)` equals the existing identity result (existing tests unchanged); `midGain`/`sideGain` scale the mid/side coefficients by the right linear factor; `width` interaction unchanged.
- **AudioNode wiring** (eq/comp/sat/width units, saturator + width topology) — `tsc --noEmit` + `npm run build` + deferred manual browser check. No jsdom tests for AudioNode code (established pattern).
- All four gates green at the branch tip: `npx tsc --noEmit` · `npm run lint` · `npx vitest run` · `npm run build`.

## Risks

- **EQ per-band enable** is gain→0, which only fully bypasses peaking/shelf bands (the default + only used type). Filter-type bands are not silenced by it — documented; per-band routing deferred.
- **Saturator DC-blocker HP** sits on the wet path always (freq parked sub-audio at `asym=0`). Inaudible for ≥20 Hz program; default (sat off) unaffected.
- **Mono-maker crossover** is 2nd-order, not perfectly reconstructing — acceptable for a preview tool; `0 Hz` = bypass-equivalent.
- **Larger sat/width unit graphs** — a handful more nodes per unit. Web Audio handles it; not a perf concern at one graph.

## Out of scope (later phases)

GR-meter display wiring into `buildMeterCells` (P6); new native modules — DJ filter, delay, reverb, pan, tremolo, output trim (P4); worklet modules — gate, bitcrusher, limiter (P5); reorder UI / rack cards / knobs (UI track).
