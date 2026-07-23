// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TriagePlanPanel } from '../TriagePlanPanel';
import { specRunState } from '../helpers/triage-plan';
import { splitRouting } from '../helpers/analysisModalData';
import type { RoutingPlanDto } from '../../../api/types';

// Field names match the BFF WIRE (JsonSerializerDefaults.Web → camelCase),
// not the Python model — see the RoutingPlanDto note in api/types.ts.
const plan: RoutingPlanDto = {
  specialistsToRun: [
    { name: 'low_end', focus: 'Sub is 4 dB hot vs genre', priority: 1 },
    { name: 'loudness', focus: 'Crest factor is squashed', priority: 2 },
    { name: 'stereo_field', focus: 'Width collapses below 120 Hz', priority: 3 },
    { name: 'sections', focus: 'No contrast into the second drop', priority: 4 },
  ],
  skip: [],
  rationale: 'Low end dominates the risk on this mix.',
  estimatedTotalTokens: 1000,
};

const none = new Set<string>();

describe('TriagePlanPanel (report-page triage plan)', () => {
  afterEach(cleanup);

  it('renders rationale, top-3 rows with focus, and the rest as chips', () => {
    render(
      <TriagePlanPanel
        routing={splitRouting(plan)}
        triagePending={false}
        ranSlugs={new Set(['low_end'])}
        runningSlugs={none}
        hasStems={false}
        onRun={() => undefined}
        onOpenTeam={() => undefined}
      />,
    );
    expect(screen.getByText('Low end dominates the risk on this mix.')).toBeTruthy();
    expect(screen.getByText('Low End')).toBeTruthy();
    expect(screen.getByText('Sub is 4 dB hot vs genre')).toBeTruthy();
    expect(screen.getByText('✓ ran')).toBeTruthy(); // low_end already ran
    // 4th entry falls into the chip row, not the high list
    expect(screen.getByText('Sections')).toBeTruthy();
  });

  it('idle specialists get a Run button that fires with the slug', () => {
    const onRun = vi.fn();
    render(
      <TriagePlanPanel
        routing={splitRouting(plan)}
        triagePending={false}
        ranSlugs={none}
        runningSlugs={none}
        hasStems={false}
        onRun={onRun}
        onOpenTeam={() => undefined}
      />,
    );
    fireEvent.click(screen.getAllByText('Run')[0]!);
    expect(onRun).toHaveBeenCalledWith('low_end');
  });

  it('shows the pending state while triage is deciding, and nothing when absent', () => {
    const { rerender, container } = render(
      <TriagePlanPanel
        routing={null}
        triagePending={true}
        ranSlugs={none}
        runningSlugs={none}
        hasStems={false}
        onRun={() => undefined}
        onOpenTeam={() => undefined}
      />,
    );
    expect(screen.getByText(/picking the right specialists/)).toBeTruthy();
    rerender(
      <TriagePlanPanel
        routing={null}
        triagePending={false}
        ranSlugs={none}
        runningSlugs={none}
        hasStems={false}
        onRun={() => undefined}
        onOpenTeam={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="triage-plan"]')).toBeNull();
  });

  it('specRunState gates stem-only specialists without stems', () => {
    expect(specRunState('stem_balance', none, none, false)).toBe('needs-stems');
    expect(specRunState('stem_balance', none, none, true)).toBe('idle');
    expect(specRunState('low_end', new Set(['low_end']), none, false)).toBe('ran');
    expect(specRunState('low_end', none, new Set(['low_end']), false)).toBe('running');
  });
});
