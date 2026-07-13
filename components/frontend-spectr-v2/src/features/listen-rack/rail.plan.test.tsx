import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanPanel } from './rail';
import type { RackState } from './rackState';
import { writeListenFixes } from './listenFixes';

function fakeRs(): RackState {
  return { applyRackMod: vi.fn() } as unknown as RackState;
}

describe('PlanPanel', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup); // no RTL auto-cleanup in this suite — renders accumulate otherwise

  it('shows the empty state when no fixes were added', () => {
    render(<PlanPanel rs={fakeRs()} versionId="v1" />);
    expect(screen.getByText(/add fixes on the results page/i)).toBeTruthy();
  });

  it('renders a checkbox per added fix', () => {
    writeListenFixes('v1', [
      { fixId: 'a', verdictId: null, title: 'Tame the master', scope: 'Master bus', sev: 'crit', specialist: 'loudness', ops: [{ type: 'limiter', params: { ceiling_db: -1 } }] },
    ]);
    render(<PlanPanel rs={fakeRs()} versionId="v1" />);
    expect(screen.getByText('Tame the master')).toBeTruthy();
    expect(screen.getByRole('checkbox')).toBeTruthy();
  });

  // Story 12.4 (AC5): unmapped fixes render disabled — never silently dropped.
  it('renders a notApplicable fix as a disabled row with honest copy', () => {
    writeListenFixes('v1', [
      { fixId: 'sc', verdictId: null, title: 'Sidechain the bass', scope: 'Low end', sev: 'warn', specialist: 'low_end', ops: [{ type: 'sidechain', params: {} }], notApplicable: true },
    ]);
    render(<PlanPanel rs={fakeRs()} versionId="v1" />);
    expect(screen.getByText('Sidechain the bass')).toBeTruthy();
    expect(screen.getByText(/not applicable in the rack/i)).toBeTruthy();
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
  });
});
