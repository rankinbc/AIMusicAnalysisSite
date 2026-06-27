import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MODULE_DEFAULTS, type ModuleState } from './data';
import { useRackState } from './rackState';

describe('applyRackMod', () => {
  it('replaces the module map and pushes the full rack to the graph', () => {
    const graph = {
      setEffectParams: vi.fn(), reorder: vi.fn(), setMasterBypass: vi.fn(),
      resetAll: vi.fn(), readEffectMeter: vi.fn().mockReturnValue(null),
    };
    const { result } = renderHook(() => useRackState(graph));
    const next: Record<string, ModuleState> = JSON.parse(JSON.stringify(MODULE_DEFAULTS));
    next.limiter = { ...next.limiter, enabled: true, ceilingDb: -1 };

    act(() => result.current.applyRackMod(next));

    expect(result.current.mod.limiter).toMatchObject({ enabled: true, ceilingDb: -1 });
    expect(graph.reorder).toHaveBeenCalled();           // pushFullRack ran
    expect(graph.setEffectParams).toHaveBeenCalled();
  });
});
