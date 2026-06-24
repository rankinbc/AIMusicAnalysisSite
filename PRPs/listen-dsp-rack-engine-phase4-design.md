# Listen DSP Rack — Phase 4: New Native Modules (Design)

Date: 2026-06-24
Status: Design — pending implementation plan
Component: `components/frontend-spectr-v2` (`src/features/listen`)
Parent design: `PRPs/listen-dsp-rack-engine-design.md` (master roadmap §6–10, §14)
Builds on: Phases 1–3 (modular `EffectUnit` engine, reorder + generic handle, unhidden params) — merged at `master@447e5b7`.

## Summary

Phase 4 adds the six **native** Web Audio effect modules from the master design
to the existing `EffectUnit` rack: DJ Filter, Delay (with BPM sync + ping-pong),
Reverb (synthesized IR), Stereo Pan, Tremolo/Auto-pan, and Output Trim. Each is
an isolated unit under the existing contract. The three AudioWorklet modules
(Gate, Bitcrusher, Limiter) remain Phase 5; their slots in the default chain stay
empty until then.

This is **engine-only**. No UI, no knob/panel work. New units are reachable only
through the existing generic handle (`setEffectParams`, `reorder`, …). At their
defaults every new unit is a dry passthrough, so the chain stays bit-equivalent to
today.

## Resolved decisions (this phase)

1. **Batching** — all six modules ship on one `listen-dsp-rack-phase4` branch,
   tasks sequenced simple→complex. One review cycle, one merge.
2. **BPM source** — tempo-sync BPM is a per-unit **state field** (`bpm`, default
   120), pushed via the existing `setEffectParams`. No new handle method, no page
   edit. `bpmSync*()` is pure, unit-tested math.
3. **Reverb IR** — impulse responses are filled **synchronously** into an
   `AudioBuffer` (`noise × decay envelope`). The per-sample envelope is pure
   tested math; only the fill loop is untested glue. No `OfflineAudioContext`,
   no async boot/placeholder.
4. **Ping-pong** — the Delay ships with `pingPong` in Phase 4 (fixed stereo
   cross-feedback topology, selected by gain values rather than rewiring).

## Non-goals

- No UI. `PreviewTools.tsx`, `PitchPanel.tsx`, and the route file are untouched.
- No new per-module wrapper setters (e.g. `setDelay`). New modules are driven only
  through the generic `setEffectParams(id, patch)`. (The legacy wrappers exist only
  to keep pre-Phase-2 callers working; new modules have no such callers.)
- No worklet modules (Gate/Bitcrusher/Limiter) and no metering wiring — Phases 5–6.

---

## Architecture fit

Each module implements the existing `EffectUnit<S>` contract
(`audio/EffectUnit.ts`): stable `input`/`output` nodes, `applyParams(state)`,
`setBypass`, `dispose`. Bypass is the established per-unit dry/wet crossfade via
`makeDryWet(ctx, wetIn, wetOut)` — `setWet(0)` = dry passthrough, `setWet(1)` =
full effect, fractional = parallel mix. The saturator
(`audio/effects/saturator.ts`) is the reference pattern: build internal nodes,
connect the wet sub-graph, wrap with `makeDryWet`, push params in `applyParams`,
disconnect everything in `dispose`.

Reorder is unchanged: `composer.ts` already wires `units[a].output →
units[b].input` from an ordered `EffectId[]` via the order-generic `chainLinks`.
Adding units means registering factories and widening `DEFAULT_ORDER` — no change
to the permute/duck/rewire logic.

### Default chain after Phase 4

```
chainIn -> DJ Filter -> EQ -> Compressor -> Saturator -> Width -> Pan
        -> Tremolo -> Delay -> Reverb -> Output Trim -> chainOut
```

This is the master design's default order (master §171) with the three worklet
slots (Gate after EQ, Bitcrusher after Saturator, Limiter before Output Trim)
omitted until Phase 5. Order is the default only; any unit is movable via
`reorder()`.

---

## Module specifications

Ranges are the engine's accepted range. "Default" is the identity/neutral value.
All new modules default `enabled:false` (dry passthrough) **except** Output Trim
(`enabled:true`, but unity at `gainDb:0`).

### 1. DJ Filter — `djfilter`

State: `{ morph: number; resonance: number; enabled: boolean }`
Default: `{ morph: 0, resonance: 0.7, enabled: false }`

| Param | Range | Default | Maps to |
|---|---|---|---|
| `morph` | −1…1 (center = open) | 0 | `filter.type` + `filter.frequency` |
| `resonance` | 0.1–20 | 0.7 | `filter.Q` |
| `enabled` | bool | false | unit bypass |

Topology: one `BiquadFilterNode`; `makeDryWet(ctx, filter, filter)`.

Pure math `djMorph(morph): { type: BiquadFilterType; freq: number }`:
- `m = clamp(morph, -1, 1)`
- `m < 0` → `{ type: 'lowpass', freq: logMap(20000, 30, -m) }` (sweeps cutoff down)
- `m ≥ 0` → `{ type: 'highpass', freq: logMap(20, 18000, m) }` (sweeps cutoff up)
- `logMap(a, b, t) = a * (b / a) ** t` (so `t=0`→`a`, `t=1`→`b`)
- At `morph=0`: lowpass @ 20000 Hz (fully open / transparent).

`applyParams`: enabled → `setWet(1)`, `filter.type`/`filter.frequency` from
`djMorph(morph)`, `filter.Q.value = resonance`. Disabled → `setWet(0)`.

### 2. Delay / Echo — `delay`

State:
```ts
{ sync: boolean; division: Division; timeMs: number; feedback: number;
  toneHz: number; pingPong: boolean; mix: number; bpm: number; enabled: boolean }
```
Default: `{ sync:true, division:'1/8', timeMs:250, feedback:0.35, toneHz:8000, pingPong:false, mix:0, bpm:120, enabled:false }`

| Param | Range | Default | Maps to |
|---|---|---|---|
| `sync` | bool | true | time source |
| `division` | `Division` | `1/8` | `bpmSyncSeconds(division,bpm)` |
| `timeMs` | 1–2000 ms | 250 | `delay.delayTime` (when `sync=false`) |
| `feedback` | 0–0.95 | 0.35 | feedback `GainNode`s |
| `toneHz` | 200–18000 Hz | 8000 | lowpass in feedback loop |
| `pingPong` | bool | false | straight vs cross feedback |
| `mix` | 0–1 | 0 | dry/wet (`setWet`) |
| `bpm` | 40–240 | 120 | sync time base |
| `enabled` | bool | false | unit bypass |

Fixed stereo topology (no runtime reconnect; ping-pong is a gain selection):

```
wetIn -> splitter
  splitter[0] -> dL (DelayNode, maxDelayTime 3s) -> toneL (lowpass)
  splitter[1] -> dR (DelayNode, maxDelayTime 3s) -> toneR (lowpass)
  toneL -> fbStraightL (gain) -> dL      toneL -> fbCrossL (gain) -> dR
  toneR -> fbStraightR (gain) -> dR      toneR -> fbCrossR (gain) -> dL
  dL -> merger[0]   dR -> merger[1]   merger -> wetOut
```

`applyParams`:
- `t = sync ? bpmSyncSeconds(division, bpm) : timeMs/1000`; `dL.delayTime.value = dR.delayTime.value = t`
- `toneL.frequency.value = toneR.frequency.value = toneHz`
- `fbStraightL.gain = fbStraightR.gain = pingPong ? 0 : feedback`
- `fbCrossL.gain = fbCrossR.gain = pingPong ? feedback : 0`
- `setWet(enabled ? mix : 0)`

`feedback` is capped ≤ 0.95 by the range; the loop cannot run away.

### 3. Reverb — `reverb`

State: `{ ir: IrType; decaySec: number; preDelayMs: number; dampingHz: number; mix: number; enabled: boolean }`
Default: `{ ir:'hall', decaySec:2.0, preDelayMs:20, dampingHz:8000, mix:0, enabled:false }`
`IrType = 'room' | 'hall' | 'plate' | 'spring' | 'ambience'`

| Param | Range | Default | Maps to |
|---|---|---|---|
| `ir` | `IrType` | hall | IR envelope shape |
| `decaySec` | 0.2–8 s | 2.0 | IR length / envelope |
| `preDelayMs` | 0–200 ms | 20 | `preDelay.delayTime` |
| `dampingHz` | 1000–18000 Hz | 8000 | post `damping` lowpass |
| `mix` | 0–1 | 0 | dry/wet (`setWet`) |
| `enabled` | bool | false | unit bypass |

Topology: `wetIn → preDelay (DelayNode) → convolver (ConvolverNode) → damping
(lowpass) → wetOut`; `makeDryWet(ctx, preDelay, damping)`.

IR built synchronously into a 2-channel `AudioBuffer` of length
`ceil(decaySec * sampleRate)`: each sample `= (Math.random()*2 − 1) ×
irEnvelope(ir, t/length, decaySec)`. The convolver's buffer is rebuilt **only**
when `ir` or `decaySec` changed since the last `applyParams` (cached last-values
guard), so steady param pushes don't refill.

Pure math `irEnvelope(type, tNorm, decaySec): number` (amplitude 0–1, `tNorm` 0→1
over the buffer):
- Base exponential decay `e^(−k·tNorm)`, `k` from `decaySec` (longer decay → smaller k).
- Per-type shaping: `room` short/steep, `hall` long/smooth, `plate` brighter denser
  tail (slower initial drop), `spring` adds a shallow periodic ripple,
  `ambience` very short. Each returns a deterministic value of `tNorm`+`decaySec`.

`applyParams`: rebuild IR if needed → `convolver.buffer`; `preDelay.delayTime =
preDelayMs/1000`; `damping.frequency.value = dampingHz`; `setWet(enabled ? mix : 0)`.

### 4. Stereo Pan — `pan`

State: `{ pan: number; enabled: boolean }` — default `{ pan:0, enabled:false }`

| Param | Range | Default | Maps to |
|---|---|---|---|
| `pan` | −1…1 | 0 | `panner.pan` |
| `enabled` | bool | false | unit bypass |

Topology: one `StereoPannerNode`; `makeDryWet(ctx, panner, panner)`.
`applyParams`: `panner.pan.value = enabled ? pan : 0`; `setWet(enabled ? 1 : 0)`.

### 5. Tremolo / Auto-pan — `tremolo`

State:
```ts
{ mode: 'tremolo' | 'autopan'; sync: boolean; division: Division; rateHz: number;
  depth: number; shape: 'sine' | 'triangle' | 'square'; bpm: number; enabled: boolean }
```
Default: `{ mode:'tremolo', sync:true, division:'1/8', rateHz:5, depth:0.5, shape:'sine', bpm:120, enabled:false }`

| Param | Range | Default | Maps to |
|---|---|---|---|
| `mode` | tremolo / autopan | tremolo | LFO target (gain vs pan) |
| `sync` | bool | true | rate source |
| `division` | `Division` | `1/8` | `bpmSyncHz(division,bpm)` |
| `rateHz` | 0.1–20 Hz | 5 | `osc.frequency` (when `sync=false`) |
| `depth` | 0–1 | 0.5 | modulation depth |
| `shape` | sine / triangle / square | sine | `osc.type` |
| `bpm` | 40–240 | 120 | sync rate base |
| `enabled` | bool | false | unit bypass |

Fixed topology (mode is a gain selection, not a rewire):

```
signal:  wetIn -> tremGain -> panner -> wetOut
LFO:     osc -> depthTrem (gain) -> tremGain.gain
         osc -> depthPan  (gain) -> panner.pan
         constTrem (ConstantSource) -> tremGain.gain   (DC offset)
```

`osc` and `constTrem` call `.start()` once at construction (Web Audio sources are
one-shot; they run for the unit's life).

Pure math `tremoloOffsets(mode, depth): { offset: number; depthTrem: number; depthPan: number }`:
- `tremolo` → `{ offset: 1 − depth/2, depthTrem: depth/2, depthPan: 0 }` (gain ∈ [1−depth, 1])
- `autopan` → `{ offset: 1, depthTrem: 0, depthPan: depth }` (pan ∈ [−depth, +depth], gain unity)

`applyParams`: when enabled, `{offset,depthTrem,depthPan} = tremoloOffsets(mode,depth)`;
`constTrem.offset.value = offset`; `depthTrem.gain.value = depthTrem`;
`depthPan.gain.value = depthPan`; `osc.frequency.value = sync ?
bpmSyncHz(division,bpm) : rateHz`; `osc.type = shape`; `setWet(1)`. Disabled →
neutralize (`depthTrem=0, depthPan=0, constTrem.offset=1`) and `setWet(0)`.

### 6. Output Trim — `trim`

State: `{ gainDb: number; enabled: boolean }` — default `{ gainDb:0, enabled:true }`

| Param | Range | Default | Maps to |
|---|---|---|---|
| `gainDb` | −24…+12 dB | 0 | `trimGain.gain` (10^(dB/20)) |
| `enabled` | bool | true | unit bypass |

The only default-enabled unit, but unity at `gainDb:0` → transparent. One
`GainNode`; `makeDryWet(ctx, trimGain, trimGain)`. `applyParams`:
`trimGain.gain.value = 10^(gainDb/20)`; `setWet(enabled ? 1 : 0)`.

---

## Shared / engine changes

### `audio/state.ts`
- Add `export type Division = '1/4' | '1/8' | '1/8.' | '1/8T' | '1/16'`.
- Add `IrType` and the six state interfaces (above) + their `*_DEFAULT` constants
  + `default*State()` factory functions (mirroring the existing pattern).
- Widen `DEFAULT_ORDER` to
  `['djfilter','eq','comp','sat','ms','pan','tremolo','delay','reverb','trim']`.

### `audio/EffectUnit.ts`
- Widen `EffectId` union: `+ 'djfilter' | 'delay' | 'reverb' | 'pan' | 'tremolo' | 'trim'`.
- `EffectMeter` unchanged — no Phase-4 module meters (metering is Phase 6).

### `audio/composer.ts`
- Import and register the six new factories in the `units` record. Wiring is
  already order-generic via `chainLinks(order)` — `reorder`/`wire`/duck logic is
  untouched.

### `useAudioGraph.ts` (thin composer hook)
- Hold default state for the six new units and call `applyParams(default)` at
  build (additive; existing unit handling unchanged).
- The generic `setEffectParams(id, patch)` already routes by id — new ids flow
  through with no new handle surface. `reorder`/`getOrder` now span 10 ids.
- No new per-module wrappers. `PreviewTools.tsx` and the route are not edited.

### New pure DSP (unit-tested, no AudioContext)
- `audio/dsp/bpmSync.ts` — `bpmSyncSeconds(division, bpm)` and
  `bpmSyncHz(division, bpm) = 1 / bpmSyncSeconds(...)`.
  Reference values (whole = `60/bpm`): `1/4 = 60/bpm`, `1/8 = 30/bpm`,
  `1/8. = 45/bpm` (dotted), `1/8T = 20/bpm` (triplet), `1/16 = 15/bpm`.
- `audio/dsp/djMorph.ts` — `djMorph(morph)` (above).
- `audio/dsp/irSynth.ts` — `irEnvelope(type, tNorm, decaySec)` (above).
- `audio/dsp/tremoloMath.ts` — `tremoloOffsets(mode, depth)` (above).

---

## Behavior preservation

- Every new unit at its default is a dry passthrough: `enabled:false` →
  `setWet(0)`; Output Trim is `enabled:true` but unity (`gainDb:0`). Inserting all
  six into the chain at defaults = six unity passthroughs, so output is
  bit-equivalent to today's four-unit chain at defaults.
- Existing units (`eq`/`comp`/`sat`/`ms`), the pitch BufferSource lane, master
  bypass, and analyser taps are untouched.
- `DEFAULT_ORDER` grows by transparent units only; `reorder` math is unchanged.

## Testability

- Pure math — `bpmSyncSeconds`/`bpmSyncHz`, `djMorph`, `irEnvelope`,
  `tremoloOffsets` — is unit-tested with vitest (boundaries, monotonicity,
  reference values).
- The six unit files + `composer.ts`/`useAudioGraph.ts` edits are AudioNode-graph
  code; Web Audio does not run in jsdom, so they are verified by `tsc --noEmit` +
  `npm run build` + a manual browser smoke. This is the established Phase 1–3
  pattern; no jsdom tests for AudioNode wiring.

## Validation gates (run from `components/frontend-spectr-v2`)

`npx tsc --noEmit` · `npm run lint` (`--max-warnings 0`) · `npx vitest run` ·
`npm run build`. All four green at the branch tip before merge.

## Task outline (for the plan, simple→complex)

1. `state.ts` — `Division`, `IrType`, six interfaces + defaults + factories; widen
   `EffectId` and `DEFAULT_ORDER`.
2. Pan unit.
3. Output Trim unit.
4. `dsp/djMorph.ts` (+ tests) → DJ Filter unit.
5. `dsp/bpmSync.ts` (+ tests).
6. `dsp/tremoloMath.ts` (+ tests) → Tremolo unit.
7. Delay unit (+ ping-pong) — consumes `bpmSync`.
8. `dsp/irSynth.ts` (+ tests) → Reverb unit.
9. `composer.ts` — register the six factories.
10. `useAudioGraph.ts` — init the six units at defaults; confirm handle spans 10 ids.

## Risks

- **DJ Filter zero-crossing** — `morph` crossing 0 swaps lowpass↔highpass, a
  discontinuity if automated through center. Default rests at 0 (open, bypassed),
  so it is inaudible until the future UI sweeps it; acceptable for an engine pass.
- **Reverb IR quality** — synthesized noise×decay is cheaper but less "real" than
  sampled spaces (master risk #3). Acceptable for an in-browser preview; the unit
  interface is unchanged if sampled IRs replace it later.
- **Tremolo idle LFO** — `osc` runs even when the unit is bypassed (`setWet(0)`
  mutes its effect). Negligible CPU for one oscillator; avoids one-shot restart
  complexity.
