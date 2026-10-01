// @vitest-environment jsdom
// "Analysis complete" modal: the coach summarises the static pass, every
// step's measured results are visible without clicking (no findings cards),
// and the routed AI specialists are the pipeline's FINAL stage — narrated by
// the coach, one live row each, with the primary CTA gated until every one has
// settled (failed counts) and a safety valve if triage or a run stalls.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => <span>Correct</span> }));
vi.mock('../../billing/CostTag', () => ({ CostTag: () => <span>Included</span> }));
vi.mock('../../../ui/Coach', () => ({
  Coach: ({ thinking }: { thinking?: boolean }) => (
    <span data-testid="coach-mascot" data-thinking={String(Boolean(thinking))} />
  ),
}));

import type { FinalJson, RoutingPlanDto, SpecialistStatus, VerdictDto } from '../../../api/types';
import { AnalysisCompleteModal, PLAN_WAIT_MS, SETTLE_WAIT_MS } from '../AnalysisCompleteModal';

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

const plan: RoutingPlanDto = {
  specialistsToRun: [
    { name: 'stereo_phase', priority: 1, focus: 'correlation 0.12' },
    { name: 'low_end', priority: 2, focus: 'sub buildup' },
    { name: 'loudness', priority: 3, focus: 'under target' },
  ],
  skip: [],
  rationale: '',
  estimatedTotalTokens: 0,
};
const ALL = ['stereo_phase', 'low_end', 'loudness'];

const st = (slug: string, status: SpecialistStatus['status']): SpecialistStatus => ({ slug, status });
const verdict = (specialist: string): VerdictDto =>
  ({ specialist, headline: 'x', source: 'llm_identifier' }) as unknown as VerdictDto;

type Props = Parameters<typeof AnalysisCompleteModal>[0];

function renderModal(over: Partial<Props> = {}) {
  const props: Props = {
    fj,
    jobId: 'job-1',
    songName: 'Neon Meridian',
    onClose: vi.fn(),
    onViewReport: vi.fn(),
    onReanalyze: vi.fn(),
    ...over,
  };
  const utils = render(<AnalysisCompleteModal {...props} />);
  return { props, ...utils };
}

const allRunning: Partial<Props> = {
  routingPlan: plan,
  specialistStatuses: ALL.map((s) => st(s, 'idle')),
  runningSlugs: new Set(ALL),
};
const mixed: Partial<Props> = {
  routingPlan: plan,
  specialistStatuses: [st('stereo_phase', 'cached'), st('low_end', 'failed'), st('loudness', 'idle')],
  runningSlugs: new Set(['loudness']),
  verdicts: [verdict('stereo_phase'), verdict('stereo_phase'), verdict('stereo_phase')],
};
const allSettled: Partial<Props> = {
  routingPlan: plan,
  specialistStatuses: [st('stereo_phase', 'cached'), st('low_end', 'failed'), st('loudness', 'cached')],
  runningSlugs: new Set(),
  verdicts: [verdict('stereo_phase'), verdict('loudness')],
};

const cta = () => screen.getByTestId('acm-cta') as HTMLButtonElement;

describe('AnalysisCompleteModal', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not render the "What I found" findings section', () => {
    renderModal();
    expect(screen.queryByText('What I found')).toBeNull();
    expect(screen.queryByText(/initial findings/)).toBeNull();
  });

  it('pins the status dock outside the scrolling body', () => {
    renderModal(allRunning);
    const dock = screen.getByTestId('acm-status-dock');
    const body = screen.getByTestId('acm-steps').closest('[class*="modalBody"]');
    expect(body).not.toBeNull();
    expect(body!.contains(dock)).toBe(false);
    expect(dock.contains(screen.getByTestId('acm-ai-block'))).toBe(true);
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
    expect(within(mix).getByText('LUFS')).toBeTruthy();
    expect(within(mix).getByText('-9.1')).toBeTruthy();
    expect(within(mix).getByText('138')).toBeTruthy();
    expect(within(rows[1]!).getByText('80%')).toBeTruthy();
    expect(within(rows[4]!).getByText('No reference attached')).toBeTruthy();
  });

  describe('AI specialists stage', () => {
    it('before triage: coach is picking, CTA disabled, no stage rows', () => {
      renderModal();
      expect(screen.getByTestId('acm-coach-next').textContent).toContain(
        'Picking which specialists to consult…',
      );
      expect(screen.getByTestId('coach-mascot').getAttribute('data-thinking')).toBe('true');
      expect(screen.queryByTestId('acm-specialists')).toBeNull();
      expect(cta().disabled).toBe(true);
      expect(cta().textContent).toContain('Picking specialists');
    });

    it('all running: one spinning row each, coach consulting, CTA gated with a count', () => {
      renderModal(allRunning);
      const rows = within(screen.getByTestId('acm-specialists')).getAllByRole('listitem');
      expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['running', 'running', 'running']);
      expect(within(rows[0]!).getByText('Stereo Phase')).toBeTruthy();
      const next = screen.getByTestId('acm-coach-next');
      expect(next.textContent).toContain('I’m consulting with these specialists…');
      expect(within(next).getByText('Low End')).toBeTruthy();
      expect(screen.getByTestId('coach-mascot').getAttribute('data-thinking')).toBe('true');
      expect(cta().disabled).toBe(true);
      expect(cta().textContent).toContain('Consulting specialists… (0/3)');
      expect(screen.getByTestId('acm-ai-block').textContent).toContain('running in parallel');
    });

    it('mixed: done shows its findings, failed is shown and counts as settled', () => {
      renderModal(mixed);
      const rows = within(screen.getByTestId('acm-specialists')).getAllByRole('listitem');
      expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['done', 'failed', 'running']);
      expect(rows[0]!.textContent).toContain('3 findings');
      expect(rows[1]!.textContent).toContain('failed');
      expect(cta().disabled).toBe(true);
      expect(cta().textContent).toContain('(2/3)');
    });

    it('all settled (one failed): CTA enabled, coach done, mascot calm', () => {
      const { props } = renderModal(allSettled);
      expect(cta().disabled).toBe(false);
      expect(cta().textContent).toContain('Open full report');
      expect(screen.getByTestId('acm-coach-next').textContent).toContain('My specialists are done');
      expect(screen.getByTestId('coach-mascot').getAttribute('data-thinking')).toBe('false');
      expect(screen.getByTestId('acm-ai-block').textContent).toContain('AI specialists complete');
      fireEvent.click(cta());
      expect(props.onViewReport).toHaveBeenCalledTimes(1);
    });

    it('zero runnable specialists: stage skipped, CTA enabled immediately', () => {
      // stem_balance is stem-only and this analysis has no stems.
      renderModal({
        routingPlan: { ...plan, specialistsToRun: [{ name: 'stem_balance', priority: 1, focus: '' }] },
        hasStems: false,
      });
      expect(screen.queryByTestId('acm-specialists')).toBeNull();
      expect(cta().disabled).toBe(false);
    });

    it('guest lane: only the first unsettled specialist runs, the rest are queued', () => {
      renderModal({ ...allRunning, sequential: true });
      const rows = within(screen.getByTestId('acm-specialists')).getAllByRole('listitem');
      expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['running', 'queued', 'queued']);
      expect(screen.getByTestId('acm-ai-block').textContent).toContain('one at a time');
    });

    it('safety valve: "Open report now" after the settle timeout', () => {
      vi.useFakeTimers();
      const { props } = renderModal(allRunning);
      expect(screen.queryByText('Open report now')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(SETTLE_WAIT_MS + 2000);
      });
      fireEvent.click(screen.getByText('Open report now'));
      expect(props.onViewReport).toHaveBeenCalledTimes(1);
      expect(cta().disabled).toBe(true);
    });

    it('safety valve: "Open report now" when triage never produces a plan', () => {
      vi.useFakeTimers();
      renderModal();
      act(() => {
        vi.advanceTimersByTime(PLAN_WAIT_MS - 5000);
      });
      expect(screen.queryByText('Open report now')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(screen.getByText('Open report now')).toBeTruthy();
    });
  });

  it('Re-analyze stays available', () => {
    const { props } = renderModal(allRunning);
    fireEvent.click(screen.getByText(/Re-analyze/));
    expect(props.onReanalyze).toHaveBeenCalledTimes(1);
  });
});
