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
