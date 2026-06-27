import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanPanel } from './rail';
import type { RackState } from './rackState';
import { writeListenFixes } from './listenFixes';

function fakeRs(): RackState {
  return { applyRackMod: vi.fn() } as unknown as RackState;
}

describe('PlanPanel', () => {
  beforeEach(() => localStorage.clear());

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
});
