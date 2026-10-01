// @vitest-environment jsdom
// Compact "Analysis complete" modal: the two-stage status dock (static
// analysis done → AI analysis next) is pinned OUTSIDE the scrolling body, and
// the step list still renders every phase with its status.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => <span>Correct</span> }));
vi.mock('../../billing/CostTag', () => ({ CostTag: () => <span>Included</span> }));

import type { FinalJson, RoutingPlanDto } from '../../../api/types';
import { AnalysisCompleteModal } from '../AnalysisCompleteModal';

const fj = {
  phases: [
    { phase: 1, status: 'ok', data: { lufs: -9.1, bpm: 138, detected_key: 'A' } },
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

  it('pins the AI block in the status dock, outside the scrolling step list', () => {
    renderModal();
    const dock = screen.getByTestId('acm-status-dock');
    const ai = screen.getByTestId('acm-ai-block');
    const steps = screen.getByTestId('acm-steps');
    expect(dock.contains(ai)).toBe(true);
    expect(steps.contains(ai)).toBe(false);
    // The dock is a sibling of the scroll body, not inside it.
    const body = steps.closest('[class*="modalBody"]');
    expect(body).not.toBeNull();
    expect(body!.contains(dock)).toBe(false);
    expect(within(ai).getByText('Continue to the full report to run AI analysis')).toBeTruthy();
  });

  it('shows the "Static analysis complete" stage with a ran-of-total count', () => {
    renderModal();
    const dock = screen.getByTestId('acm-status-dock');
    expect(within(dock).getByText('Static analysis complete')).toBeTruthy();
    // ok×3 + failed×1 ran; phase 5 (no reference) + phase 8 skipped; 6 total.
    expect(dock.textContent).toContain('4 of 6 steps ran');
    expect(dock.textContent).toContain('1 failed');
  });

  it('renders every step row with its status', () => {
    renderModal();
    const rows = within(screen.getByTestId('acm-steps')).getAllByRole('listitem');
    expect(rows).toHaveLength(6);
    const statuses = rows.map((r) => r.getAttribute('data-status'));
    expect(statuses).toEqual(['ok', 'ok', 'skipped', 'pending', 'skipped', 'failed']);
    expect(within(rows[0]!).getByText('Mix analysis')).toBeTruthy();
    expect(within(rows[0]!).getByText('done')).toBeTruthy();
    expect(within(rows[3]!).getByText('running')).toBeTruthy();
    expect(within(rows[5]!).getByText('failed')).toBeTruthy();
  });

  it('expands a step row on click', () => {
    renderModal();
    const btn = within(screen.getByTestId('acm-steps')).getAllByRole('button')[0]!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('lists routed specialists on demand and keeps the footer CTAs wired', () => {
    const props = renderModal({ routingPlan: routing });
    const ai = screen.getByTestId('acm-ai-block');
    expect(ai.textContent).toContain('2 specialists');
    fireEvent.click(within(ai).getByRole('button'));
    expect(ai.textContent).toContain('correlation 0.12');

    fireEvent.click(screen.getByText('View full report'));
    expect(props.onViewReport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText(/Re-analyze/));
    expect(props.onReanalyze).toHaveBeenCalledTimes(1);
  });
});
