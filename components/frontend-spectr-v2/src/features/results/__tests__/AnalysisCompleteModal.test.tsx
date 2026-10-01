// @vitest-environment jsdom
// "Analysis complete" modal: the coach summarises the static pass and names
// the specialists he'll consult next (or a pending state while triage runs),
// every step's measured results are visible without clicking, the findings
// cards are gone (the full report owns them), and the two-stage status dock +
// primary CTA are pinned OUTSIDE the scrolling body.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => <span>Correct</span> }));
vi.mock('../../billing/CostTag', () => ({ CostTag: () => <span>Included</span> }));
vi.mock('../../../ui/Coach', () => ({
  Coach: ({ thinking }: { thinking?: boolean }) => (
    <span data-testid="coach-mascot" data-thinking={String(Boolean(thinking))} />
  ),
}));

import type { FinalJson, RoutingPlanDto } from '../../../api/types';
import { AnalysisCompleteModal } from '../AnalysisCompleteModal';

const fj = {
  coach_intro: 'Solid start — the low end needs work.',
  coached_fixes: ['I would start on the sub.'],
  phases: [
    {
      phase: 1,
      status: 'ok',
      data: { lufs: -9.1, true_peak_db: -0.4, bpm: 138, detected_key: 'A', clipping_detected: false },
    },
    { phase: 2, status: 'ok', data: { genre: 'trance', confidence: 0.8 } },
    { phase: 5, status: 'ok', data: { status: 'skipped' } },
    { phase: 7, status: 'ok', data: { arrangement_status: 'pending' } },
    { phase: 8, status: 'skipped', data: {} },
    { phase: 9, status: 'failed', error: 'boom' },
  ],
} as unknown as FinalJson;

const routing: RoutingPlanDto = {
  specialistsToRun: [
    { name: 'stereo_phase', priority: 1, focus: 'correlation 0.12' },
    { name: 'low_end', priority: 2, focus: 'sub buildup' },
  ],
  skip: [],
  rationale: '',
  estimatedTotalTokens: 0,
};

function renderModal(over: Partial<Parameters<typeof AnalysisCompleteModal>[0]> = {}) {
  const props = {
    fj,
    jobId: 'job-1',
    songName: 'Neon Meridian',
    onClose: vi.fn(),
    onViewReport: vi.fn(),
    onReanalyze: vi.fn(),
    ...over,
  };
  render(<AnalysisCompleteModal {...props} />);
  return props;
}

describe('AnalysisCompleteModal', () => {
  afterEach(cleanup);

  it('does not render the "What I found" findings section', () => {
    renderModal();
    expect(screen.queryByText('What I found')).toBeNull();
    expect(screen.queryByText(/initial findings/)).toBeNull();
  });

  it('pins the status dock + AI stage outside the scrolling body', () => {
    renderModal();
    const dock = screen.getByTestId('acm-status-dock');
    const ai = screen.getByTestId('acm-ai-block');
    const steps = screen.getByTestId('acm-steps');
    expect(dock.contains(ai)).toBe(true);
    const body = steps.closest('[class*="modalBody"]');
    expect(body).not.toBeNull();
    expect(body!.contains(dock)).toBe(false);
    expect(within(ai).getByText('Next: AI analysis')).toBeTruthy();
  });

  it('shows "Static analysis complete" with a ran-of-total count', () => {
    renderModal();
    const dock = screen.getByTestId('acm-status-dock');
    expect(within(dock).getByText('Static analysis complete')).toBeTruthy();
    // ok×3 (1, 2, 7) + failed×1 (9) ran; phase 5 (no reference) + 8 skipped.
    expect(dock.textContent).toContain('4 of 6 steps ran');
    expect(dock.textContent).toContain('1 failed');
  });

  it('renders every step with its status and its results visible without clicking', () => {
    renderModal();
    const rows = within(screen.getByTestId('acm-steps')).getAllByRole('listitem');
    // Phase order, with skipped steps moved to the end.
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual([
      'ok',
      'ok',
      'pending',
      'failed',
      'skipped',
      'skipped',
    ]);
    const mix = rows[0]!;
    expect(within(mix).getByText('Mix analysis')).toBeTruthy();
    expect(within(mix).getByText('done')).toBeTruthy();
    expect(within(mix).getByText('LUFS')).toBeTruthy();
    expect(within(mix).getByText('-9.1')).toBeTruthy();
    expect(within(mix).getByText('138')).toBeTruthy();
    expect(within(rows[1]!).getByText('trance')).toBeTruthy();
    expect(within(rows[1]!).getByText('80%')).toBeTruthy();
    expect(within(rows[2]!).getByText('running')).toBeTruthy();
    expect(within(rows[3]!).getByText('failed')).toBeTruthy();
    expect(within(rows[4]!).getByText('No reference attached')).toBeTruthy();
    // No expand affordance any more — results are always on screen.
    expect(within(screen.getByTestId('acm-steps')).queryAllByRole('button')).toHaveLength(0);
  });

  it('coach summarises the static pass and names the routed specialists', () => {
    renderModal({ routingPlan: routing });
    const coach = screen.getByTestId('acm-coach');
    expect(coach.textContent).toContain('Solid start — the low end needs work.');
    const next = screen.getByTestId('acm-coach-next');
    expect(next.textContent).toContain("Next I'll bring in");
    expect(within(next).getByText('Stereo Phase')).toBeTruthy();
    expect(within(next).getByText('Low End')).toBeTruthy();
    expect(next.textContent).not.toContain('Picking which specialists');
    expect(screen.getByTestId('coach-mascot').getAttribute('data-thinking')).toBe('false');
  });

  it('shows a pending state (not an empty list) while triage has no routing plan', () => {
    renderModal({ routingPlan: undefined });
    const next = screen.getByTestId('acm-coach-next');
    expect(next.textContent).toContain('Picking which specialists to consult…');
    expect(next.textContent).not.toContain("Next I'll bring in");
    expect(screen.getByTestId('coach-mascot').getAttribute('data-thinking')).toBe('true');
  });

  it('wires the primary CTA and Re-analyze', () => {
    const props = renderModal({ routingPlan: routing });
    fireEvent.click(screen.getByText(/Open full report & run AI analysis/));
    expect(props.onViewReport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText(/Re-analyze/));
    expect(props.onReanalyze).toHaveBeenCalledTimes(1);
  });
});
