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
