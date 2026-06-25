import { describe, expect, it } from 'vitest';

import type { EffectId } from './audio/EffectUnit';
import { DEFAULT_ORDER } from './audio/state';
import { applyChainToGraph, snapshotChainFromGraph, type Chain } from './chainApply';
import type { AudioGraphHandle, EffectParamMap } from './useAudioGraph';

// Minimal fake handle — records the imperative calls applyChainToGraph makes.
function makeFakeGraph(initialOrder: EffectId[] = [...DEFAULT_ORDER]) {
  let order = [...initialOrder];
  let masterBypass = false;
  const applied: Array<{ id: EffectId; patch: unknown }> = [];
  const reorderCalls: EffectId[][] = [];

  const graph = {
    setEffectParams: (id: EffectId, patch: unknown) => applied.push({ id, patch }),
    reorder: (next: EffectId[]) => {
      reorderCalls.push(next);
      order = [...next];
    },
    getOrder: () => [...order],
    setMasterBypass: (b: boolean) => {
      masterBypass = b;
    },
    getMasterBypass: () => masterBypass,
  } as unknown as AudioGraphHandle;

  return { graph, applied, reorderCalls, getOrder: () => order, getBypass: () => masterBypass };
}

// A representative full module-state map (values are arbitrary — the loop is
// param-agnostic; it forwards whatever object it's given).
function fullModuleState(): EffectParamMap {
  const state: Record<string, unknown> = {};
  for (const id of DEFAULT_ORDER) state[id] = { enabled: true, _tag: id };
  return state as unknown as EffectParamMap;
}

describe('applyChainToGraph', () => {
  it('applies a full chain: every module set, order reordered, bypass applied', () => {
    const { graph, applied, reorderCalls, getBypass } = makeFakeGraph([]);
    const chain: Chain = {
      order: [...DEFAULT_ORDER],
      modules: fullModuleState(),
      masterBypass: true,
    };

    applyChainToGraph(graph, chain);

    expect(applied.map((a) => a.id)).toEqual([...DEFAULT_ORDER]);
    expect(reorderCalls).toHaveLength(1);
    expect(reorderCalls[0]).toEqual([...DEFAULT_ORDER]);
    expect(getBypass()).toBe(true);
  });

  it('ignores unknown module ids and pitch (drift tolerance)', () => {
    const { graph, applied, reorderCalls } = makeFakeGraph([]);
    const chain = {
      // 'pitch' is the buffer lane, 'wobblizer' is a future/unknown module.
      order: ['eq', 'pitch', 'wobblizer', 'comp'],
      modules: {
        eq: { enabled: true, bands: [] },
        pitch: { semitones: 5 },
        wobblizer: { depth: 1 },
        comp: { enabled: false },
      },
      masterBypass: false,
    } as unknown as Chain;

    applyChainToGraph(graph, chain);

    expect(applied.map((a) => a.id)).toEqual(['eq', 'comp']);
    expect(reorderCalls[0]).toEqual(['eq', 'comp']);
  });

  it('never throws when a listed module has no params', () => {
    const { graph, applied } = makeFakeGraph([]);
    const chain = {
      order: ['eq', 'comp', 'sat'],
      modules: { eq: { enabled: true, bands: [] } }, // comp + sat missing
      masterBypass: false,
    } as unknown as Chain;

    expect(() => applyChainToGraph(graph, chain)).not.toThrow();
    expect(applied.map((a) => a.id)).toEqual(['eq']); // only the present module
  });

  it('leaves the existing order untouched when order is empty/garbage', () => {
    const { graph, reorderCalls, getOrder } = makeFakeGraph([...DEFAULT_ORDER]);
    applyChainToGraph(graph, { order: [], modules: {}, masterBypass: false });
    expect(reorderCalls).toHaveLength(0);
    expect(getOrder()).toEqual([...DEFAULT_ORDER]);
  });

  it('is a no-op on null/undefined chain', () => {
    const { graph, applied, reorderCalls } = makeFakeGraph();
    applyChainToGraph(graph, null);
    applyChainToGraph(graph, undefined);
    expect(applied).toHaveLength(0);
    expect(reorderCalls).toHaveLength(0);
  });
});

describe('snapshotChainFromGraph ↔ applyChainToGraph round-trip', () => {
  it('round-trips order and masterBypass byte-stable (incl. bypass)', () => {
    const customOrder: EffectId[] = ['eq', 'comp', 'sat', 'ms'];
    const src = makeFakeGraph(customOrder);
    src.graph.setMasterBypass(true);

    const snap = snapshotChainFromGraph(src.graph, fullModuleState());
    expect(snap.order).toEqual(customOrder);
    expect(snap.masterBypass).toBe(true);

    // Re-apply onto a fresh graph → order + bypass reproduced.
    const dst = makeFakeGraph([]);
    applyChainToGraph(dst.graph, snap);
    expect(dst.getOrder()).toEqual(customOrder);
    expect(dst.getBypass()).toBe(true);
  });

  it('snapshot deep-clones module state (no shared references)', () => {
    const src = makeFakeGraph();
    const state = fullModuleState();
    const snap = snapshotChainFromGraph(src.graph, state);
    expect(snap.modules).not.toBe(state);
    expect(snap.modules.eq).not.toBe(state.eq);
    expect(snap.modules).toEqual(state);
  });
});
