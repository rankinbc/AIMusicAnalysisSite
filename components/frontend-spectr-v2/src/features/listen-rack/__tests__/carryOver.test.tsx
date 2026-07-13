// Story 12.4 (AC3 + AC6) — carry-over integration at the rack seam.
//
// AC6: a carried chain reaches the rack STATE through the real graph handle:
// real useRackState wired to a fake RackGraphBindings (the exact 5-method
// interface the audio graph satisfies), overlayChain → applyRackMod →
// pushFullRack — asserting both the React module map and the pushes the graph
// received. AC3: the TrackHeader chip renders in EVERY mode.
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RackGraphBindings } from '../rackBindings';
import { useRackState } from '../rackState';
import { overlayChain } from '../fixToRackPatch';
import { TrackHeader } from '../ListenRackPage';
import { TRACK } from '../data';
import type { ModuleState } from '../data';
import type { ModeId } from '../access';
import type { Identity } from '../identity';

function fakeGraph(): RackGraphBindings & { params: Array<[string, unknown]> } {
  const params: Array<[string, unknown]> = [];
  return {
    params,
    setEffectParams: vi.fn((id: string, patch: unknown) => { params.push([id, patch]); }) as never,
    reorder: vi.fn(),
    setMasterBypass: vi.fn(),
    resetAll: vi.fn(),
    readEffectMeter: vi.fn(() => null),
  };
}

describe('carry-over → rack state through the graph handle (AC6)', () => {
  it('applies a carried chain via overlayChain + applyRackMod: state updates and the graph receives the push', () => {
    const graph = fakeGraph();
    const { result } = renderHook(() => useRackState(graph));

    // Manual tweak first — must survive the carried overlay.
    act(() => result.current.setParam('trim', 'gainDb', -6));
    act(() => result.current.setEnabled('trim', true));

    const carried: Partial<Record<string, ModuleState>> = {
      limiter: { enabled: true, ceilingDb: -0.8 } as unknown as ModuleState,
    };
    act(() => {
      result.current.applyRackMod(overlayChain(result.current.mod, carried));
    });

    // React rack state took the carried module…
    expect(result.current.mod.limiter).toMatchObject({ enabled: true, ceilingDb: -0.8 });
    // …preserved the manual tweak…
    expect(result.current.mod.trim).toMatchObject({ enabled: true, gainDb: -6 });
    // …and the full-rack push flowed through the graph bindings (limiter among them).
    expect(graph.params.some(([id]) => id === 'limiter')).toBe(true);
  });
});

describe('Fixes-applied chip renders in every mode (AC3)', () => {
  afterEach(cleanup); // no RTL auto-cleanup in this suite — renders accumulate otherwise
  const identity: Identity = { isOwner: true } as Identity;
  const modes: ModeId[] = ['view', 'room', 'work'];

  for (const mode of modes) {
    it(`renders the chip + reset in ${mode} mode`, () => {
      const onReset = vi.fn();
      render(
        <TrackHeader track={TRACK} mode={mode} modes={modes} identity={identity}
          fixesApplied={4} onResetFixes={onReset} />,
      );
      const chip = screen.getByTestId('fixes-applied-chip');
      expect(chip.textContent).toContain('Fixes applied: 4');
      act(() => { (screen.getByText('reset') as HTMLButtonElement).click(); });
      expect(onReset).toHaveBeenCalled();
    });
  }

  it('renders no chip when nothing is applied', () => {
    render(
      <TrackHeader track={TRACK} mode="work" modes={modes} identity={identity}
        fixesApplied={null} />,
    );
    expect(screen.queryByTestId('fixes-applied-chip')).toBeNull();
  });
});
