import { describe, expect, it } from 'vitest';

import type { ModuleState } from '../data';
import type { RackPreset } from '../rackState';
import {
  applySuggestionChain, chainFromSnapshot, resolveRackSurface, restoreRack, snapshotRack,
  type RackRestoreTarget,
} from '../suggest-draft';

function mod(over: Partial<ModuleState> = {}): ModuleState {
  return { enabled: false, gainDb: 0, ...over };
}

function rackSrc() {
  return {
    order: ['eq', 'comp', 'trim'],
    mod: {
      eq: mod({ enabled: true, bands: [{ type: 'peaking', freq: 120, gainDb: -2.1, q: 1.4, enabled: true }] }),
      comp: mod({ enabled: false, thresholdDb: -18, ratio: 3 }),
      trim: mod({ enabled: true, gainDb: 1.5 }),
    } as Record<string, ModuleState>,
    masterBypass: false,
  };
}

/** Fake rs implementing the real recallPreset semantics (clone + replace). */
function fakeRs() {
  const state = rackSrc();
  const rs: RackRestoreTarget & { state: typeof state } = {
    state,
    recallPreset: (pr: RackPreset) => {
      state.mod = JSON.parse(JSON.stringify(pr.mod)) as Record<string, ModuleState>;
      state.order = [...pr.order];
    },
    setMasterBypass: (v: boolean) => { state.masterBypass = v; },
  };
  return rs;
}

describe('suggest-draft (story 11.12)', () => {
  it('snapshotRack deep-clones — later live edits never leak into the snapshot', () => {
    const src = rackSrc();
    const snap = snapshotRack(src);
    src.mod.trim.gainDb = 99;
    (src.mod.eq.bands as { gainDb: number }[])[0].gainDb = 99;
    src.order.push('sat');
    expect(snap.mod.trim.gainDb).toBe(1.5);
    expect((snap.mod.eq.bands as { gainDb: number }[])[0].gainDb).toBe(-2.1);
    expect(snap.order).toEqual(['eq', 'comp', 'trim']);
  });

  it('restore round-trip: fork → mutate modules/order/bypass → restore → deep-equal original', () => {
    const rs = fakeRs();
    const snap = snapshotRack(rs.state);
    // reviewer edits
    rs.state.mod.comp = { ...rs.state.mod.comp, enabled: true, ratio: 6 };
    rs.state.mod.trim = { ...rs.state.mod.trim, gainDb: -4 };
    rs.state.order = ['comp', 'eq', 'trim'];
    rs.state.masterBypass = true;
    restoreRack(rs, snap);
    expect(rs.state.mod).toEqual(snapshotRack(rackSrc()).mod);
    expect(rs.state.order).toEqual(['eq', 'comp', 'trim']);
    expect(rs.state.masterBypass).toBe(false);
  });

  it('restore re-applies DISABLED modules (the overlayChain skip-disabled trap)', () => {
    const rs = fakeRs();
    const snap = snapshotRack(rs.state); // comp disabled in the snapshot
    rs.state.mod.comp = { ...rs.state.mod.comp, enabled: true };
    restoreRack(rs, snap);
    expect(rs.state.mod.comp.enabled).toBe(false);
  });

  it('snapshot survives repeated restores (A/B flips)', () => {
    const rs = fakeRs();
    const snap = snapshotRack(rs.state);
    for (let i = 0; i < 3; i++) {
      rs.state.mod.trim = { ...rs.state.mod.trim, gainDb: i * 10 };
      restoreRack(rs, snap);
      // mutate what restore produced — must not corrupt the held snapshot
      rs.state.mod.trim.gainDb = 42;
    }
    expect(snap.mod.trim.gainDb).toBe(1.5);
  });

  it('chainFromSnapshot emits the wire shape and detaches from the snapshot', () => {
    const snap = snapshotRack(rackSrc());
    const chain = chainFromSnapshot(snap);
    expect(chain).toEqual({ order: ['eq', 'comp', 'trim'], modules: snap.mod, masterBypass: false });
    (chain.modules.trim as ModuleState).gainDb = 77;
    expect(snap.mod.trim.gainDb).toBe(1.5);
  });

  describe('applySuggestionChain', () => {
    it('merges a partial chain onto the base (incl. disabled entries) and applies bypass', () => {
      const rs = fakeRs();
      const base = snapshotRack(rs.state);
      const ok = applySuggestionChain(rs, base, {
        order: ['comp', 'eq'],
        modules: { comp: { enabled: true, ratio: 5 }, trim: { enabled: false, gainDb: 0 } },
        masterBypass: true,
      });
      expect(ok).toBe(true);
      expect(rs.state.mod.comp.enabled).toBe(true);
      expect(rs.state.mod.comp.ratio).toBe(5);
      expect(rs.state.mod.comp.thresholdDb).toBe(-18); // base param survives the merge
      expect(rs.state.mod.trim.enabled).toBe(false);   // disabled entry IS applied
      // chain-known ids lead in chain order; remaining base ids append —
      // the applied order is ALWAYS a permutation of the base order.
      expect(rs.state.order).toEqual(['comp', 'eq', 'trim']);
      expect(rs.state.masterBypass).toBe(true);
    });

    it('ignores unknown module ids (hostile/drifted chain) and keeps the order a base permutation', () => {
      const rs = fakeRs();
      const base = snapshotRack(rs.state);
      const ok = applySuggestionChain(rs, base, {
        order: ['ghost', 'trim', 'trim'],
        modules: { ghost: { enabled: true, zap: 11 }, trim: { enabled: true, gainDb: 2 } },
        masterBypass: false,
      });
      expect(ok).toBe(true);
      expect(rs.state.mod.ghost).toBeUndefined();          // never injected
      expect(rs.state.mod.trim.gainDb).toBe(2);
      expect(rs.state.order).toEqual(['trim', 'eq', 'comp']); // dedup'd, permutation of base
    });

    it('never writes pitch and falls back to the base order when the chain order is empty', () => {
      const rs = fakeRs();
      rs.state.mod.pitch = { enabled: false, semitones: 0 };
      const base = snapshotRack(rs.state);
      const ok = applySuggestionChain(rs, base, {
        order: [],
        modules: { pitch: { enabled: true, semitones: 12 }, trim: { enabled: true, gainDb: 3 } },
        masterBypass: false,
      });
      expect(ok).toBe(true);
      expect(rs.state.mod.pitch.enabled).toBe(false);
      expect(rs.state.mod.trim.gainDb).toBe(3);
      expect(rs.state.order).toEqual(['eq', 'comp', 'trim']);
    });

    it('returns false and applies nothing on a malformed chain', () => {
      const rs = fakeRs();
      const before = JSON.parse(JSON.stringify(rs.state)) as unknown;
      const base = snapshotRack(rs.state);
      expect(applySuggestionChain(rs, base, { nope: true })).toBe(false);
      expect(applySuggestionChain(rs, base, null)).toBe(false);
      expect(applySuggestionChain(rs, base, 'chain')).toBe(false);
      expect(rs.state).toEqual(before);
    });
  });

  // AC1 badge gating + AC2 fork lift + AC8 A-side block, pinned as pure logic
  // (they'd otherwise live only in a page-render conditional).
  describe('resolveRackSurface', () => {
    const base = { rackReadOnly: true, suggesting: false, abSide: 'draft' as const, canSuggest: true, mode: 'view', realAudio: true };

    it('read-only View with canSuggest → fork button badge (AC1)', () => {
      expect(resolveRackSurface(base)).toEqual({ editable: false, badge: 'fork-button' });
    });

    it.each([
      ['canSuggest false', { ...base, canSuggest: false }],
      ['not view mode', { ...base, mode: 'room' }],
      ['mock route', { ...base, realAudio: false }],
    ])('plain READ-ONLY badge when %s (AC1 fallback)', (_label, args) => {
      expect(resolveRackSurface(args)).toEqual({ editable: false, badge: 'readonly' });
    });

    it('fork on the draft side lifts the read-only overlay (AC2)', () => {
      expect(resolveRackSurface({ ...base, suggesting: true }))
        .toEqual({ editable: true, badge: null });
    });

    it('A side blocks edits with the original badge (AC8)', () => {
      expect(resolveRackSurface({ ...base, suggesting: true, abSide: 'original' }))
        .toEqual({ editable: false, badge: 'original-block' });
    });

    it('editable rack stays editable when not suggesting', () => {
      expect(resolveRackSurface({ ...base, rackReadOnly: false }))
        .toEqual({ editable: true, badge: null });
    });
  });
});
