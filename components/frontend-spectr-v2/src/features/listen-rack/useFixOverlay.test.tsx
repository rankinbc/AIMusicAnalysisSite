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

  it('persists applied ids and restores them on mount', () => {
    const applyRackMod = vi.fn();
    const fixes = [fix('a', eq(120))];
    const first = renderHook(() => useFixOverlay({ versionId: 'v', fixes, applyRackMod }));
    act(() => first.result.current.toggle('a'));

    const second = renderHook(() => useFixOverlay({ versionId: 'v', fixes, applyRackMod }));
    expect(second.result.current.isApplied('a')).toBe(true);
  });
});
