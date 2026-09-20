import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListenFix } from './listenFixes';
import { useFixOverlay } from './useFixOverlay';

const fix = (id: string, ops: ListenFix['ops']): ListenFix => ({
  fixId: id, verdictId: null, title: id, scope: '', sev: 'info', specialist: null, ops,
});
const eq = (hz: number) => [{ type: 'peaking_eq', params: { frequency_hz: hz, gain_db: -2, q: 1 } }];

describe('useFixOverlay', () => {
  beforeEach(() => localStorage.clear());

  it('toggles a fix on and off, recomputing the rack each time', () => {
    const applyRackMod = vi.fn();
    const fixes = [fix('a', eq(120)), fix('b', [{ type: 'limiter', params: { ceiling_db: -1 } }])];
    const { result } = renderHook(() => useFixOverlay({ versionId: 'v', fixes, applyRackMod }));

    act(() => result.current.toggle('a'));
    expect(result.current.isApplied('a')).toBe(true);
    expect(applyRackMod.mock.calls.at(-1)![0].eq.enabled).toBe(true);

    act(() => result.current.toggle('b'));
    let mod = applyRackMod.mock.calls.at(-1)![0];
    expect(mod.eq.enabled).toBe(true);
    expect(mod.limiter.enabled).toBe(true);

    act(() => result.current.toggle('a'));            // uncheck a; b stays
    mod = applyRackMod.mock.calls.at(-1)![0];
    expect(mod.eq.enabled).toBe(false);
    expect(mod.limiter.enabled).toBe(true);
    expect(result.current.isApplied('a')).toBe(false);
  });

  it('captures the live rack as baseline at first apply and restores it when all uncheck (story 12.4)', () => {
    const applyRackMod = vi.fn();
    const live = { trim: { enabled: true, gainDb: -6 }, eq: { enabled: false, bands: [] } };
    const fixes = [fix('a', [{ type: 'limiter', params: { ceiling_db: -1 } }])];
    const { result } = renderHook(() =>
      useFixOverlay({ versionId: 'v', fixes, applyRackMod, getLiveMod: () => live as never }));

    act(() => result.current.toggle('a'));
    let mod = applyRackMod.mock.calls.at(-1)![0];
    expect(mod.limiter.enabled).toBe(true);
    expect(mod.trim).toMatchObject({ enabled: true, gainDb: -6 }); // manual tweak survives overlay

    act(() => result.current.toggle('a')); // uncheck everything
    mod = applyRackMod.mock.calls.at(-1)![0];
    expect(mod.trim).toMatchObject({ enabled: true, gainDb: -6 }); // baseline restored, not defaults
  });

  it('clears applied state + baseline when the page fires the overlay-clear event (story 12.4 reset)', async () => {
    const { clearFixOverlay } = await import('./listenFixes');
    const applyRackMod = vi.fn();
    const fixes = [fix('a', eq(120))];
    const { result } = renderHook(() => useFixOverlay({ versionId: 'v', fixes, applyRackMod }));

    act(() => result.current.toggle('a'));
    expect(result.current.isApplied('a')).toBe(true);

    act(() => clearFixOverlay('v'));
    expect(result.current.isApplied('a')).toBe(false);
    // Next toggle recomputes from a CLEAN slate, not the stale pre-reset set.
    act(() => result.current.toggle('a'));
    expect(result.current.appliedIds).toEqual(['a']);
  });

  it('ignores notApplicable fixes even when stale applied ids reference them', () => {
    const applyRackMod = vi.fn();
    localStorage.setItem('listenApplied:v', JSON.stringify(['na']));
    const fixes = [
      { ...fix('na', [{ type: 'sidechain', params: {} }]), notApplicable: true },
      fix('a', eq(120)),
    ];
    const { result } = renderHook(() => useFixOverlay({ versionId: 'v', fixes, applyRackMod }));
    act(() => result.current.toggle('a'));
    // The NA id contributes no ops — only the real fix lands.
    const mod = applyRackMod.mock.calls.at(-1)![0];
    expect(mod.eq.enabled).toBe(true);
  });

  it('persists applied ids and restores them on mount', () => {
    const applyRackMod = vi.fn();
    const fixes = [fix('a', eq(120))];
    const live = { trim: { enabled: true, gainDb: -6 } };
    const first = renderHook(() =>
      useFixOverlay({ versionId: 'v', fixes, applyRackMod, getLiveMod: () => live as never }));
    act(() => first.result.current.toggle('a'));

    const second = renderHook(() =>
      useFixOverlay({ versionId: 'v', fixes, applyRackMod, getLiveMod: () => live as never }));
    expect(second.result.current.isApplied('a')).toBe(true);
  });

  // ── F1: an id the overlay cannot resolve must never touch the rack ────────
  describe('unresolvable ids are a complete no-op (F1)', () => {
    const live = () => ({ eq: { enabled: true, bands: [] }, trim: { enabled: true, gainDb: -4 } });

    it('an UNKNOWN id writes nothing — not the rack, not storage, not appliedIds', () => {
      const applyRackMod = vi.fn();
      const fixes = [fix('a', eq(120))];
      const { result } = renderHook(() =>
        useFixOverlay({ versionId: 'v', fixes, applyRackMod, getLiveMod: () => live() as never }));

      act(() => result.current.toggle('stale-id-from-an-older-analysis'));

      expect(applyRackMod).not.toHaveBeenCalled();
      expect(result.current.isApplied('stale-id-from-an-older-analysis')).toBe(false);
      expect(result.current.appliedIds).toEqual([]);
      expect(localStorage.getItem('listenApplied:v')).toBeNull();
      expect(result.current.canToggle('stale-id-from-an-older-analysis')).toBe(false);
      expect(result.current.canToggle('a')).toBe(true);
    });

    it('a notApplicable id writes nothing either', () => {
      const applyRackMod = vi.fn();
      const fixes = [
        { ...fix('na', [{ type: 'sidechain', params: {} }]), notApplicable: true },
        fix('a', eq(120)),
      ];
      const { result } = renderHook(() =>
        useFixOverlay({ versionId: 'v', fixes, applyRackMod, getLiveMod: () => live() as never }));

      act(() => result.current.toggle('na'));

      expect(applyRackMod).not.toHaveBeenCalled();
      expect(result.current.isApplied('na')).toBe(false);
      expect(localStorage.getItem('listenApplied:v')).toBeNull();
      expect(result.current.canToggle('na')).toBe(false);
    });
  });

  // ── F2: the baseline survives a reload, so un-applying restores the
  //        PRE-FIX rack instead of factory defaults ─────────────────────────
  describe('the fix-free baseline is persisted per version (F2)', () => {
    const REAL_OP = [{ type: 'peaking_eq', params: { frequency_hz: 45, gain_db: -3, q: 1 } }];
    const STORED_BASELINE = {
      trim: { enabled: true, gainDb: -6 },
      eq: { enabled: true, bands: [{ type: 'peaking', freq: 800, gainDb: 2, q: 1, enabled: true }] },
    };

    it('writes the live snapshot taken BEFORE the apply', () => {
      const applyRackMod = vi.fn();
      const live = { trim: { enabled: true, gainDb: -6 }, eq: { enabled: false, bands: [] } };
      const fixes = [fix('f1', REAL_OP)];
      const { result } = renderHook(() =>
        useFixOverlay({ versionId: 'v', fixes, applyRackMod, getLiveMod: () => live as never }));

      act(() => result.current.toggle('f1'));

      expect(JSON.parse(localStorage.getItem('listenBaseline:v') ?? 'null')).toEqual(live);
    });

    it('after a reload, un-applying the last fix restores the STORED baseline', () => {
      localStorage.setItem('listenApplied:v', JSON.stringify(['f1']));
      localStorage.setItem('listenBaseline:v', JSON.stringify(STORED_BASELINE));
      const applyRackMod = vi.fn();
      // The live rack is the autosaved draft — it already CONTAINS f1.
      const draftWithFix = {
        trim: { enabled: true, gainDb: -6 },
        eq: { enabled: true, bands: [{ type: 'peaking', freq: 45, gainDb: -3, q: 1, enabled: true }] },
      };
      const fixes = [fix('f1', REAL_OP)];
      const { result } = renderHook(() => useFixOverlay({
        versionId: 'v', fixes, applyRackMod, getLiveMod: () => draftWithFix as never,
      }));
      expect(result.current.isApplied('f1')).toBe(true);

      act(() => result.current.toggle('f1'));

      expect(applyRackMod).toHaveBeenCalledTimes(1);
      expect(applyRackMod.mock.calls[0]![0]).toEqual(STORED_BASELINE);
      expect(localStorage.getItem('listenBaseline:v')).toBeNull();
    });

    it('a SECOND fix recomputes from the stored baseline, never from the live draft', () => {
      localStorage.setItem('listenApplied:v', JSON.stringify(['f1']));
      localStorage.setItem('listenBaseline:v', JSON.stringify(STORED_BASELINE));
      const applyRackMod = vi.fn();
      const draftWithFix = { trim: { enabled: true, gainDb: -6 }, eq: { enabled: true, bands: [] } };
      const fixes = [
        fix('f1', REAL_OP),
        fix('f2', [{ type: 'limiter', params: { ceiling_db: -1 } }]),
      ];
      const { result } = renderHook(() => useFixOverlay({
        versionId: 'v', fixes, applyRackMod, getLiveMod: () => draftWithFix as never,
      }));

      act(() => result.current.toggle('f2'));

      const mod = applyRackMod.mock.calls.at(-1)![0];
      // The stored baseline's own 800 Hz move is gone: f1 was recomputed from
      // the PRE-FIX rack, so its 45 Hz cut lands exactly once.
      const gains = (mod.eq.bands as { freq: number; gainDb: number }[])
        .filter((b) => Math.abs(b.freq - 45) < 5);
      expect(gains).toHaveLength(1);
      expect(gains[0]!.gainDb).toBeCloseTo(-3, 5);
      expect(mod.limiter.enabled).toBe(true);
      expect(mod.trim).toMatchObject({ enabled: true, gainDb: -6 });
    });

    it('applied ids with NO stored baseline are dropped — we cannot un-apply them', () => {
      localStorage.setItem('listenApplied:v', JSON.stringify(['f1']));
      const applyRackMod = vi.fn();
      const fixes = [fix('f1', REAL_OP)];
      const { result } = renderHook(() => useFixOverlay({
        versionId: 'v', fixes, applyRackMod, getLiveMod: () => ({ trim: {} }) as never,
      }));

      expect(result.current.isApplied('f1')).toBe(false);
      expect(result.current.appliedIds).toEqual([]);
      expect(applyRackMod).not.toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem('listenApplied:v') ?? 'null')).toEqual([]);
    });

    it('the overlay-clear event removes the stored baseline too', async () => {
      const { clearFixOverlay } = await import('./listenFixes');
      const applyRackMod = vi.fn();
      const live = { trim: { enabled: true, gainDb: -6 } };
      const fixes = [fix('f1', REAL_OP)];
      const { result } = renderHook(() =>
        useFixOverlay({ versionId: 'v', fixes, applyRackMod, getLiveMod: () => live as never }));

      act(() => result.current.toggle('f1'));
      expect(localStorage.getItem('listenBaseline:v')).not.toBeNull();

      act(() => clearFixOverlay('v'));
      expect(localStorage.getItem('listenBaseline:v')).toBeNull();
      expect(result.current.isApplied('f1')).toBe(false);
    });
  });
});
