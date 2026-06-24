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
