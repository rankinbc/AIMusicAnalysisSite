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
