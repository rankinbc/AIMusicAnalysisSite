import { describe, expect, it } from 'vitest';

import type { ModuleState, RackPatch } from './data';
import {
  isInsertEffect, pushCoach, pushEnabled, pushEqBands, pushFullRack, pushModuleState, pushParam,
  type RackGraphBindings,
} from './rackBindings';

interface Call { method: string; args: unknown[] }

function fakeGraph() {
  const calls: Call[] = [];
  const g: RackGraphBindings = {
    setEffectParams: ((id: string, patch: unknown) =>
      calls.push({ method: 'setEffectParams', args: [id, patch] })) as RackGraphBindings['setEffectParams'],
    reorder: (order) => { calls.push({ method: 'reorder', args: [order] }); },
    setMasterBypass: (b) => { calls.push({ method: 'setMasterBypass', args: [b] }); },
    resetAll: () => { calls.push({ method: 'resetAll', args: [] }); },
    readEffectMeter: () => null,
  };
  return { g, calls };
}

describe('isInsertEffect', () => {
  it('accepts the 13 insert effects and rejects pitch + unknowns', () => {
    expect(isInsertEffect('comp')).toBe(true);
    expect(isInsertEffect('eq')).toBe(true);
    expect(isInsertEffect('limiter')).toBe(true);
    expect(isInsertEffect('pitch')).toBe(false);
    expect(isInsertEffect('nope')).toBe(false);
  });
});

describe('pushParam', () => {
  it('forwards an insert-effect param change to setEffectParams', () => {
    const { g, calls } = fakeGraph();
    pushParam(g, 'comp', 'thresholdDb', -10);
    expect(calls).toEqual([{ method: 'setEffectParams', args: ['comp', { thresholdDb: -10 }] }]);
  });
  it('is a no-op for the pitch lane (not an insert effect)', () => {
    const { g, calls } = fakeGraph();
    pushParam(g, 'pitch', 'semitones', 3);
    expect(calls).toEqual([]);
  });
});

describe('pushEnabled / pushEqBands', () => {
  it('toggles enable via setEffectParams', () => {
    const { g, calls } = fakeGraph();
    pushEnabled(g, 'sat', true);
    expect(calls).toEqual([{ method: 'setEffectParams', args: ['sat', { enabled: true }] }]);
  });
  it('pushes the whole eq band array', () => {
    const { g, calls } = fakeGraph();
    const bands = [{ type: 'peaking', freq: 1000, gainDb: 3, q: 1.4, enabled: true }];
    pushEqBands(g, bands);
    expect(calls).toEqual([{ method: 'setEffectParams', args: ['eq', { bands }] }]);
  });
});

describe('pushModuleState / pushCoach', () => {
  it('pushes a full module state for an insert effect, skips pitch', () => {
    const { g, calls } = fakeGraph();
    const comp: ModuleState = { enabled: true, thresholdDb: -8, ratio: 4 };
    pushModuleState(g, 'comp', comp);
    pushModuleState(g, 'pitch', { enabled: true, semitones: 2 });
    expect(calls).toEqual([{ method: 'setEffectParams', args: ['comp', { enabled: true, thresholdDb: -8, ratio: 4 }] }]);
  });
  it('applies each insert effect in a coach patch and skips non-inserts', () => {
    const { g, calls } = fakeGraph();
    const patch: RackPatch = { comp: { ratio: 3 }, pitch: { semitones: 1 }, eq: { enabled: true } };
    pushCoach(g, patch);
    expect(calls).toEqual([
      { method: 'setEffectParams', args: ['comp', { ratio: 3 }] },
      { method: 'setEffectParams', args: ['eq', { enabled: true }] },
    ]);
  });
});

describe('pushFullRack', () => {
  it('reorders insert-only, pushes every module, then sets master bypass', () => {
    const { g, calls } = fakeGraph();
    const mod: Record<string, ModuleState> = {
      eq: { enabled: false, bands: [] },
      comp: { enabled: true, ratio: 2 },
      pitch: { enabled: true, semitones: 4 },
    };
    pushFullRack(g, mod, ['eq', 'pitch', 'comp'], true);
    expect(calls).toEqual([
      { method: 'reorder', args: [['eq', 'comp']] },
      { method: 'setEffectParams', args: ['eq', { enabled: false, bands: [] }] },
      { method: 'setEffectParams', args: ['comp', { enabled: true, ratio: 2 }] },
      { method: 'setMasterBypass', args: [true] },
    ]);
  });
});
