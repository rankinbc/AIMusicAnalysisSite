/* Spec D8 on the Coach tab. The stage board and this tab share the page's ONE
 * fix overlay (D11), so the carried-preset lock has to hold here too: a preset
 * carried from the report is one merged chain, and toggling single fixes on top
 * of it would silently mutate the rack the stage declares locked. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoachTabV2 } from '../CoachTabV2';
import { writeListenFixes, type ListenFix } from '../listenFixes';
import type { CarryPhase } from '../useFixCarryOver';
import type { RackState } from '../rackState';

const FIX: ListenFix = {
  fixId: 'v1', verdictId: 'v1', title: 'Cut 45 Hz', scope: 'Master bus', sev: 'crit',
  specialist: 'low_end', impact: 90, confidence: 0.8, notApplicable: false,
  ops: [{ type: 'peaking_eq', params: { frequency_hz: 45, gain_db: -3, q: 1 } }],
};

function renderTab(carryPhase: CarryPhase, canToggle: (id: string) => boolean = () => true) {
  const toggle = vi.fn();
  render(
    <CoachTabV2
      rs={{} as unknown as RackState}
      real
      versionId="ver-1"
      reportRef={null}
      fixOverlay={{ isApplied: () => false, toggle, canToggle }}
      carryPhase={carryPhase}
    />,
  );
  return { toggle, button: screen.getByRole('button', { name: /Cut 45 Hz/ }) as HTMLButtonElement };
}

describe('CoachTabV2 — carried-preset lock (D8)', () => {
  beforeEach(() => {
    localStorage.clear();
    writeListenFixes('ver-1', [FIX]);
  });
  afterEach(cleanup);

  it('no carried preset: the fix toggles the shared overlay', () => {
    const { toggle, button } = renderTab('none');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledWith('v1');
  });

  it.each(['applied', 'pending'] as const)(
    'preset %s: the fix is disabled, a click is a no-op, and the reason is shown',
    (phase) => {
      const { toggle, button } = renderTab(phase);
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(toggle).not.toHaveBeenCalled();
      expect(screen.getByTestId('coach-fix-gate').textContent ?? '').not.toBe('');
    },
  );

  // F1: the rows come from THIS version's localStorage queue, the overlay's map
  // from the CURRENT analysis's moves. A queue row the overlay cannot resolve
  // must never reach toggle() — that path rebuilt the rack from nothing.
  it('a queued fix the overlay cannot resolve is disabled and never toggles', () => {
    const { toggle, button } = renderTab('none', () => false);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain(
      "from an earlier analysis — add it again from this version's report");
    fireEvent.click(button);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('a FAILED carry leaves toggling live (nothing was applied to the rack)', () => {
    const { toggle, button } = renderTab('failed');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledWith('v1');
    expect(screen.queryByTestId('coach-fix-gate')).toBeNull();
  });
});
