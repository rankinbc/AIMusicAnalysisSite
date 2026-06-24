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
