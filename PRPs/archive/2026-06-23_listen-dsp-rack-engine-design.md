# Listen DSP Rack — Audio Engine Revamp (Design)

Date: 2026-06-23
Status: Design — pending implementation plan
Component: `components/frontend-spectr-v2` (`src/features/listen`)

## Summary

The Listen page rack currently exposes a fraction of what its Web Audio graph
can do, and the engine is a single 831-line `useAudioGraph.ts` with a monolithic
`buildGraph()`. This design rebuilds the rack as a **modular, reorderable
effect-unit engine**: every existing module surfaces all of its real parameters,
eight new effect modules are added (five native, three AudioWorklet), and the
whole insert chain becomes user-reorderable at runtime.

This spec covers the **audio-engine layer only**. The UI (knobs, panels, rack
cards) is a deliberate follow-up. The engine exposes every parameter through a
typed handle; wiring controls to it is out of scope here.

## Goals

- Surface every parameter the underlying Web Audio nodes support, including the
  several already wired but hidden today (compressor release/knee/makeup, etc.).
- Add eight new effect modules: DJ Filter, Delay, Reverb, Stereo Pan, Tremolo
  (native); Gate, Bitcrusher, True Limiter (AudioWorklet).
- Make the insert chain a runtime-reorderable, all-series-insert list.
- Replace the monolithic graph with a modular `EffectUnit` architecture where
  each effect is an isolated, individually testable unit under the 500-line cap.
- Preserve current behavior exactly: at default values the existing five modules
  sound identical to today; the pitch lane, master bypass, and analyser taps are
  unchanged.

## Non-goals

- No UI/knob/panel work. (`PreviewTools.tsx`, `PitchPanel.tsx` untouched here.)
- No true parallel send/return routing — every effect is a series insert with
  its own dry/wet. (Required for a clean reorderable linear chain; see below.)
- No formant-preserving / tempo-independent pitch (phase vocoder) in this pass.
  Flagged as a future optional worklet; the pitch lane stays detune-based and
  gains a tempo (playbackRate) control with the coupling documented.

---

## Architecture

### The `EffectUnit` interface

Every rack effect — existing and new, native and worklet — implements one
interface:

```ts
interface EffectUnit<S> {
  readonly id: EffectId;
  readonly input: AudioNode;        // chain feeds signal in here
  readonly output: AudioNode;       // chain reads processed signal out here
  applyParams(state: S): void;      // push state values onto AudioParams
  setBypass(bypassed: boolean): void;
  readMeter?(): EffectMeter;        // optional live read (GR, gate-open, etc.)
  dispose(): void;
}
```

- `input`/`output` are stable AudioNodes. The composer wires `unitA.output ->
  unitB.input` down the ordered list. The unit owns everything between its own
  input and output.
- **Bypass is a per-unit dry/wet crossfade**, not topology change. Each unit
  internally is `input -> (wetPath) + (dryGain) -> output`. `setBypass(true)`
  sets `wet=0, dry=1`; effects with a `mix` param fold mix into the same two
  gains. This generalizes the existing saturation dry/wet pattern and **replaces
  the old "off = identity values" trick uniformly** — one consistent bypass
  model that also survives reordering.

### The composer (`useAudioGraph` becomes thin)

`useAudioGraph` is reduced to a composer that:

1. Builds the fixed boundary nodes (MediaElementSource, master-bypass passthrough
   lane, analyser taps, destination) — unchanged from today.
2. Builds each `EffectUnit` and holds them in an **ordered array** (`order:
   EffectId[]`).
3. Wires the insert chain: `chainIn -> units[0].input ... units[n].output ->
   chainOut`, where `chainOut` feeds the existing analyser/destination tail.
4. Fans parameter setters and bypass calls out to the right unit.
5. Owns the pitch BufferSource lane, master bypass, and `readFrame()` exactly as
   today (these live outside the reorderable insert zone).

Target: `useAudioGraph.ts` back under ~300 lines; each effect file under ~200.

### Reorder mechanism

```ts
reorder(nextOrder: EffectId[]): void
```

1. Disconnect every inter-unit link in the current insert chain (and chainIn ->
   first, last -> chainOut).
2. Re-wire `output -> input` following `nextOrder`.
3. Suppress the reconnection click: ramp `chainOut`-feeding gain to 0 over ~10 ms
   (`setTargetAtTime` / `linearRampToValueAtTime`), perform the rewire, ramp back
   over ~10 ms. The click is hidden inside the dip; imperceptible during
   playback. (Reorder while paused needs no duck.)

This is feasible precisely because the architecture is modular and every effect
is a series insert: reorder is a list permutation plus a rewire pass. Nothing is
locked — limiter-last, gate-before-comp, etc. are defaults, not constraints.

### AudioWorklet boot path

Three modules (Gate, Bitcrusher, Limiter) are `AudioWorkletProcessor`s. These
require `await ctx.audioWorklet.addModule(url)` **before** their nodes can be
constructed, and `ensureContext()` is synchronous today.

Resolution:

- `ensureContext()` stays sync and builds all native units immediately (so the
  existing play path is unaffected).
- Worklet module registration runs once, lazily and asynchronously, the first
  time the context is created (`registerWorklets(ctx): Promise<void>`). Until it
  resolves, the three worklet units are represented by **passthrough placeholder
  gains** in the chain (audio flows through untouched). When registration
  resolves, the real `AudioWorkletNode`s are swapped in via the same duck-and-
  rewire used by reorder. Worklet effects report `ready: boolean` on their state.
- Vite serves processors as separate modules via
  `new URL('./dsp/processors/<name>.processor.ts', import.meta.url)` passed to
  `addModule`. Processor files contain no imports from app code (worklet global
  scope) and are kept dependency-free.

### File layout

```
src/features/listen/
  useAudioGraph.ts                 # thin composer + pitch lane + analysers (existing handle, extended)
  audio/
    EffectUnit.ts                  # interface + dryWetBypass() helper + EffectId union
    composer.ts                    # buildChain(), wireChain(), reorder(), duck helper
    state.ts                       # per-module state interfaces, defaults, REGISTRY, default order
    effects/
      eq.ts  compressor.ts  saturator.ts  width.ts  pitch.ts   # existing, refactored + expanded
      djFilter.ts  delay.ts  reverb.ts  pan.ts  tremolo.ts      # new native
      gate.ts  bitcrusher.ts  limiter.ts                        # new worklet (main-thread wrappers)
      outputTrim.ts
    dsp/                           # PURE, unit-tested math (no AudioContext)
      curves.ts                    # makeSatCurve variants, quantize staircase
      msMatrix.ts                  # width/mid/side gain math, mono-maker split params
      bpmSync.ts                   # division -> seconds, given BPM
      irSynth.ts                   # impulse-response generation params/shape
      limiterMath.ts gateMath.ts quantize.ts
      *.test.ts
    processors/                    # AudioWorkletProcessor source (worklet global scope)
      gate.processor.ts  bitcrusher.processor.ts  limiter.processor.ts
```

### Testability

Web Audio does not run in jsdom, so the **graph wiring itself is not unit-tested**
(verified manually + optional thin AudioContext stub asserting connect-call
order). The strategy mirrors the existing listen tests (`eqCurve.test.ts`,
`stemGains.test.ts`, `meters.test.ts`): all real DSP math is extracted into pure
functions in `audio/dsp/` and unit-tested with vitest. Worklet processor DSP is
written as pure functions imported by the processor shell, so the per-sample math
(quantize, limiter gain, gate envelope) is tested directly.

---

## Default signal chain

```
MediaElementSource
   |
chainIn
   -> DJ Filter -> EQ(8) -> Gate* -> Compressor -> Saturator -> Bitcrusher*
   -> Width -> Pan -> Tremolo -> Delay -> Reverb -> Limiter* -> Output Trim
chainOut
   -> analyserMain -> scopeSplitter -> analyserL/R -> destination
   (master-bypass dry passthrough lane preserved in parallel; pitch BufferSource
    lane feeds chainIn when active)

* = AudioWorklet
```

Order is the default only; any unit may be moved anywhere via `reorder()`.

---

## Module specifications

Ranges are the engine's accepted range. "Default" is the identity/neutral value
so a freshly built chain is transparent. "Maps to" names the Web Audio target.

### 1. EQ — 8 × `BiquadFilterNode` (existing, fully unhidden)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `bands[i].type` | peaking / lowshelf / highshelf / lowpass / highpass / bandpass / notch / allpass | peaking | `filter.type` |
| `bands[i].freq` | 20–20000 Hz | 60/170/350/700/1400/3500/7000/14000 | `filter.frequency` |
| `bands[i].gainDb` | −24…+24 dB | 0 | `filter.gain` (shelf/peak only) |
| `bands[i].q` | 0.1–18 | 1.4 | `filter.Q` |
| `bands[i].enabled` | bool | true | gain→0 when off |
| `enabled` | bool | false | unit bypass |

Today only 3 macro knobs over fixed freq/Q/peaking exist; all eight bands and
freq/Q/type are real and exposed here.

### 2. Compressor — `DynamicsCompressorNode` + makeup gain + parallel mix (existing, unhidden)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `thresholdDb` | −60…0 dB | 0 | `compressor.threshold` |
| `ratio` | 1–20 | 1 | `compressor.ratio` |
| `attackMs` | 0–250 ms | 3 | `compressor.attack` (÷1000) |
| `releaseMs` | 0–1000 ms | 250 | `compressor.release` (÷1000) |
| `kneeDb` | 0–40 dB | 30 | `compressor.knee` |
| `makeupDb` | −12…+24 dB | 0 | makeup `GainNode` (10^(dB/20)) |
| `mix` | 0–1 | 1 | parallel dry/wet (NY compression) |
| `enabled` | bool | false | unit bypass |
| `meter.reductionDb` (read) | — | — | `compressor.reduction` |

Release/knee/makeup are **already wired** (`useAudioGraph.ts:414-419`) — only the
parallel `mix` and the GR meter read are new. The GR meter satisfies the existing
stub at `listen.$versionId.tsx:771` (`grReductionDb: null`). Native
`DynamicsCompressorNode` has no sidechain detector input, so a detector HPF is not
possible without a custom worklet; omitted.

### 3. Saturator — `WaveShaperNode` + tone + trim (existing, unhidden)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `drive` | 0–1 | 0 | curve generation |
| `mix` | 0–1 | 0 | dry/wet |
| `curve` | tanh / softclip / hardclip / arctan / sinefold / tube | tanh | `shaper.curve` (generated Float32Array) |
| `oversample` | none / 2x / 4x | 2x | `shaper.oversample` |
| `asymmetry` | −1…1 | 0 | pre-curve bias (even harmonics) |
| `tone` | −1…1 (tilt) | 0 | post shelving-pair |
| `outputTrimDb` | −24…+12 dB | 0 | trim `GainNode` |
| `enabled` | bool | false | unit bypass |

WaveShaper curves are arbitrary Float32Arrays, so the curve-select set is cheap.
A fixed ~20 Hz DC-blocker highpass is inserted post-shaper internally whenever
`asymmetry != 0` (asymmetry introduces DC); not a user param.

### 4. M/S Width — gain matrix + mono-maker (existing, unhidden)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `width` | 0–2 | 1 | M/S side scale (existing matrix) |
| `midGainDb` | −12…+12 dB | 0 | mid bus gain |
| `sideGainDb` | −12…+12 dB | 0 | side bus gain |
| `monoMakerHz` | 0–400 Hz (0 = off) | 0 | low-band split → mono sum |
| `mono` | bool | false | force width→0 |
| `enabled` | bool | false | unit bypass |

Width keeps the current 4-gain matrix. Mono-maker adds a crossover: lows below
`monoMakerHz` summed to mono, highs through the width matrix, re-merged. Extra
filter + gain nodes; off (0 Hz) is bit-identical to today.

### 5. Pitch — `AudioBufferSourceNode` (existing lane, extended)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `semitones` | −12…12 | 0 | `source.detune` (×100) |
| `cents` | −50…50 | 0 | `source.detune` |
| `tempo` | 0.5–2.0× | 1.0 | `source.playbackRate` |
| `enabled` | bool | false | pitch lane active |

Special-cased: pitch is the BufferSource lane, not an insert unit, and is not part
of `reorder()`. **Coupling is unavoidable in vanilla Web Audio**: both `detune`
and `playbackRate` scale the computed rate, so semitones change tempo and tempo
changes pitch. Both are exposed as honest, independent transport controls with
that coupling documented. True decoupling (formant-preserving phase vocoder) is a
future optional worklet, explicitly out of scope here.

### 6. DJ Filter — `BiquadFilterNode` (new, native)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `morph` | −1…1 (center = bypass, − = LP sweep, + = HP sweep) | 0 | `filter.type` + `filter.frequency` |
| `resonance` | 0.1–20 | 0.7 | `filter.Q` |
| `enabled` | bool | false | unit bypass |

Single bipolar DJ-style knob: center opens fully (transparent), left sweeps a
lowpass down, right sweeps a highpass up. Cutoff is log-mapped from `morph`.

### 7. Delay / Echo — `DelayNode` + feedback + loop filter (new, native)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `sync` | bool | true | time source |
| `division` | 1/4, 1/8, 1/8., 1/8T, 1/16 | 1/8 | BPM → seconds (`bpmSync`) |
| `timeMs` | 1–2000 ms | 250 | `delay.delayTime` (when `sync=false`) |
| `feedback` | 0–0.95 | 0.35 | feedback `GainNode` |
| `toneHz` | 200–18000 Hz | 8000 | lowpass in feedback loop |
| `pingPong` | bool | false | stereo cross-feedback |
| `mix` | 0–1 | 0 | dry/wet |
| `enabled` | bool | false | unit bypass |

BPM comes from `phase2.bpm ?? phase1.bpm` (already in the page, passed into the
graph). `maxDelayTime` fixed at construction (3 s). Ping-pong uses two delays with
crossed feedback through a splitter/merger.

### 8. Reverb — `ConvolverNode` (new, native)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `ir` | room / hall / plate / spring / ambience | hall | `convolver.buffer` |
| `decaySec` | 0.2–8 s | 2.0 | IR synthesis |
| `preDelayMs` | 0–200 ms | 20 | `DelayNode` pre-convolver |
| `dampingHz` | 1000–18000 Hz | 8000 | post lowpass |
| `mix` | 0–1 | 0 | dry/wet |
| `enabled` | bool | false | unit bypass |

Impulse responses are **synthesized offline** via `OfflineAudioContext` (noise
burst shaped by an exponential decay envelope, per IR type) and cached — no audio
assets shipped. `decaySec` regenerates the IR (debounced).

### 9. Stereo Pan — `StereoPannerNode` (new, native)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `pan` | −1…1 | 0 | `panner.pan` |
| `enabled` | bool | false | unit bypass |

### 10. Tremolo / Auto-pan — LFO (new, native)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `mode` | tremolo / autopan | tremolo | LFO target (gain vs pan) |
| `sync` | bool | true | rate source |
| `division` | 1/4 … 1/16 | 1/8 | BPM → Hz |
| `rateHz` | 0.1–20 Hz | 5 | LFO `osc.frequency` (when `sync=false`) |
| `depth` | 0–1 | 0.5 | LFO depth gain |
| `shape` | sine / triangle / square | sine | `osc.type` |
| `enabled` | bool | false | unit bypass |

`OscillatorNode` (LFO) → depth `GainNode` modulates either a tremolo `GainNode`
(`.gain`) or a `StereoPannerNode` (`.pan`), summed against a `ConstantSourceNode`
offset so the modulation centers correctly.

### 11. Gate — AudioWorklet (new)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `thresholdDb` | −80…0 dB | −40 | worklet param |
| `attackMs` | 0–50 ms | 1 | worklet param |
| `holdMs` | 0–500 ms | 10 | worklet param |
| `releaseMs` | 0–1000 ms | 100 | worklet param |
| `floorDb` | −80…0 dB | −80 | worklet param (closed-state attenuation) |
| `enabled` | bool | false | unit bypass / processor passthrough flag |
| `meter.reductionDb` (read) | — | — | worklet `port` message |

Processor: per-sample envelope follower + gate state machine
(attack/hold/release). Pure math in `dsp/gateMath.ts`, tested directly.

### 12. Bitcrusher — AudioWorklet (new)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `bitDepth` | 1–16 bits | 16 | worklet param (quantize) |
| `downsample` | 1–50× | 1 | worklet param (sample-and-hold decimation) |
| `mix` | 0–1 | 0 | dry/wet |
| `enabled` | bool | false | unit bypass |

Bit-depth quantization alone could be a WaveShaper staircase, but sample-rate
decimation needs sample-and-hold state, so both live in one worklet. Pure math in
`dsp/quantize.ts`.

### 13. True Limiter — AudioWorklet (new)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `ceilingDb` | −12…0 dBTP | −1.0 | worklet param |
| `releaseMs` | 1–500 ms | 50 | worklet param |
| `lookaheadMs` | 0–10 ms | 5 | worklet param (delay-buffer length) |
| `enabled` | bool | false | unit bypass |
| `meter.reductionDb` (read) | — | — | worklet `port` message |

Lookahead peak limiter: short delay buffer + gain-reduction envelope computed
from the peak inside the lookahead window. Pure math in `dsp/limiterMath.ts`.
This is the genuine brickwall the stubbed "Limiter v2.0" card promised; the
compressor-approximation alternative is not used.

### 14. Output Trim — `GainNode` (new, minor)

| Param | Range | Default | Maps to |
|---|---|---|---|
| `gainDb` | −24…+12 dB | 0 | output `GainNode` |
| `enabled` | bool | true | always in chain |

A normal reorderable insert unit that simply defaults to the last slot. The
analyser tap always reads `chainOut` after the full insert list, so output
metering is order-independent regardless of where Trim sits. The page already
owns element-level volume; this is a chain-level make-up/trim stage.

---

## Metering

`AudioFrame` (from `readFrame()`) is extended, and a separate per-unit
`readMeter()` exposes:

- `compReductionDb` — `compressor.reduction` (k-rate read each frame).
- `gateReductionDb`, `gateOpen` — from the gate worklet `port`.
- `limiterReductionDb` — from the limiter worklet `port`.

Worklet meters post messages at a throttled rate (~30 Hz) to avoid main-thread
churn; the composer caches the latest value for synchronous `readMeter()` reads.
This finally feeds `buildMeterCells({ grReductionDb })`, currently passed `null`.

## State, defaults, and the handle API

`audio/state.ts` defines a state interface + neutral default per module and a
`REGISTRY` describing each effect (id, label, factory, default order index).

The `AudioGraphHandle` gains:

```ts
setEffectParams(id: EffectId, patch: Partial<S>): void   // typed per id
setEffectBypass(id: EffectId, bypassed: boolean): void
reorder(order: EffectId[]): void
getOrder(): EffectId[]
readEffectMeter(id: EffectId): EffectMeter | null
// existing pitch lane, master bypass, readFrame, ensureContext — unchanged
```

The old per-module setters (`setCompressor`, `setSaturation`, …) are kept as thin
wrappers over `setEffectParams` so nothing currently calling the handle breaks
until the UI migrates.

## Behavior preservation

- Built at defaults, the chain is transparent: every unit bypassed / identity,
  so output is bit-equivalent to today's "all tools off" state.
- The existing five modules at their current default values produce the same
  sound; the refactor into units is behavior-preserving (verified against the
  current graph before adding any new param).
- Pitch BufferSource lane, master-bypass passthrough, and analyser taps are moved
  verbatim, not redesigned.

---

## Risks and open questions

1. **Worklet async boot** — the placeholder-then-swap approach adds a code path.
   If a worklet fails to register (older browser), its unit stays a passthrough
   and reports `ready:false`; the chain still works. Acceptable degradation.
2. **Reorder click** — the ~10 ms duck must be tuned; too short clicks, too long
   is audible. Start at 10 ms, adjust by ear.
3. **Reverb IR synthesis** — synthesized IRs are cheaper than shipping assets but
   sound less "real" than sampled spaces. Acceptable for an in-browser preview
   tool; can swap to sampled IRs later without interface change.
4. **Pitch coupling** — documented, not solved. If tempo-independent pitch is
   later required, it is a separate phase-vocoder worklet that replaces the pitch
   lane internals behind the same handle.
5. **Node count** — ~13 units with internal dry/wet, filters, and LFOs is dozens
   of nodes. Web Audio handles this comfortably; not a perf concern at one graph.

## Implementation phasing (for the plan)

Each phase is independently shippable and testable:

1. **Refactor to units, behavior-preserving** — extract existing 5 into
   `EffectUnit`s + composer; no new params, no sound change. Pure-math extraction
   + tests. Handle API back-compat wrappers.
2. **Bypass + reorder infrastructure** — per-unit dry/wet bypass; `reorder()` +
   duck; `getOrder()`. Tests for the permutation/wiring math.
3. **Unhide existing params** — EQ full per-band, compressor full + parallel mix
   + GR meter, saturator curves/oversample/tone/asym/trim, M/S split + mono-maker.
4. **New native modules** — DJ Filter, Delay (+ bpmSync), Reverb (+ irSynth),
   Pan, Tremolo, Output Trim.
5. **Worklet infrastructure + modules** — registration/boot/swap; Gate,
   Bitcrusher, Limiter processors + wrappers + pure-math tests; metering port.
6. **Metering wiring** — extend `readFrame`/`readMeter`; feed `buildMeterCells`.

UI work (rack cards, knobs, reorder drag, panels) follows in a separate plan.
