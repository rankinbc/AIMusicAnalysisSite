// @vitest-environment jsdom
// The analysis page in its COMPLETE state (ReportView over the report): every
// step's measured values + duration visible without clicking, the routed AI
// specialists as the final stage (one row each, with its tinted robot head),
// the coach's chat (specialists reporting back in their own voice), the
// primary CTA gated until every specialist has settled (failed counts), and a
// safety valve if triage or a run stalls. Live (running) behaviour is in
// AnalysisLivePage.test.tsx.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => <span>Correct</span> }));
vi.mock('../../billing/CostTag', () => ({ CostTag: () => <span>Included</span> }));
vi.mock('../../../ui/Coach', () => ({
  Coach: ({ thinking }: { thinking?: boolean }) => (
    <span data-testid="coach-mascot" data-thinking={String(Boolean(thinking))} />
  ),
}));
vi.mock('../../../ui/SpecialistBot', () => ({
  SpecialistBot: ({ color, label }: { color?: string; label?: string }) => (
    <span data-testid="spec-bot" data-color={color} data-label={label} />
  ),
}));

import type { FinalJson, RoutingPlanDto, SpecialistStatus, VerdictDto } from '../../../api/types';
import { AnalysisCompleteModal, PLAN_WAIT_MS, SETTLE_WAIT_MS } from '../AnalysisCompleteModal';
import { resetNarrationLogs } from '../useLiveNarration';

const fj = {
  coach_intro: 'Solid start — the low end needs work.',
  phases: [
    {
      phase: 1,
      status: 'ok',
      duration_s: 54.4,
      data: { lufs: -9.1, true_peak_db: -0.4, bpm: 138, detected_key: 'A', clipping_detected: false },
    },
    { phase: 2, status: 'ok', duration_s: 1.2, data: { genre: 'trance', confidence: 0.8 } },
    { phase: 5, status: 'ok', data: { status: 'skipped' } },
    { phase: 7, status: 'ok', data: { arrangement_status: 'pending' } },
    { phase: 8, status: 'skipped', data: {} },
    { phase: 9, status: 'failed', error: 'boom', duration_s: 0.3 },
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
// The real stored shape (bug A): specialist verdicts carry specialist=<slug>
// and source='rule_engine' (the column default the specialist actor leaves).
const verdict = (specialist: string, headline = 'x', severity = 'moderate'): VerdictDto =>
  ({ specialist, headline, severity, source: 'rule_engine' }) as unknown as VerdictDto;
const ruleVerdict = {
  specialist: 'rule_engine.low_mid',
  headline: 'Low-mid buildup',
  severity: 'severe',
  source: 'rule_engine',
  priorityScore: 100,
} as unknown as VerdictDto;

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
  verdicts: [verdict('stereo_phase'), verdict('stereo_phase'), verdict('stereo_phase'), ruleVerdict],
};
const allSettled: Partial<Props> = {
  routingPlan: plan,
  specialistStatuses: [st('stereo_phase', 'cached'), st('low_end', 'failed'), st('loudness', 'cached')],
  runningSlugs: new Set(),
  verdicts: [verdict('stereo_phase'), verdict('loudness')],
};

const cta = () => screen.getByTestId('acm-cta') as HTMLButtonElement;
const headerMascot = () => screen.getAllByTestId('coach-mascot')[0]!;
const chatIds = () => screen.getAllByTestId('acm-chat-msg').map((m) => m.getAttribute('data-msg-id'));
const chatText = () => screen.getByTestId('acm-coach-log').textContent ?? '';

describe('AnalysisCompleteModal (complete)', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetNarrationLogs();
  });

  it('reads "Analysis complete" and pins the status dock outside the scrolling body', () => {
    renderModal(allRunning);
    expect(screen.getByTestId('acm-overline').textContent).toBe('Analysis complete');
    const dock = screen.getByTestId('acm-status-dock');
    const body = screen.getByTestId('acm-steps').closest('[class*="modalBody"]');
    expect(body).not.toBeNull();
    expect(body!.contains(dock)).toBe(false);
    expect(within(dock).getByText('Static analysis complete')).toBeTruthy();
    // ok×3 (1, 2, 7) + failed×1 (9) ran; phase 5 (no reference) + 8 skipped.
    expect(dock.textContent).toContain('4 of 6 steps ran');
    expect(dock.textContent).toContain('1 failed');
    expect(dock.textContent).toContain('55.9s'); // 54.4 + 1.2 + 0.3
  });

  it('renders every step with its status, values and how long it took', () => {
    renderModal();
    const rows = within(screen.getByTestId('acm-steps')).getAllByRole('listitem');
    // Run order, skipped steps last.
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'background',
      'failed',
      'skipped',
      'skipped',
    ]);
    const mix = rows[0]!;
    expect(within(mix).getByText('LUFS')).toBeTruthy();
    expect(within(mix).getByText('-9.1')).toBeTruthy();
    expect(within(mix).getByText('138')).toBeTruthy();
    expect(within(mix).getByTestId('acm-step-time').textContent).toBe('54.4s');
    expect(within(rows[1]!).getByText('80%')).toBeTruthy();
    expect(within(rows[1]!).getByTestId('acm-step-time').textContent).toBe('1.2s');
    expect(within(rows[3]!).getByTestId('acm-step-time').textContent).toBe('0.3s');
    expect(within(rows[4]!).getByText('No reference attached')).toBeTruthy();
  });

  it('a settled arrangement is terminal ("Couldn’t detect structure"), never a spinner', () => {
    const settled = {
      ...fj,
      phases: fj.phases!.map((p) => (p.phase === 7 ? { ...p, data: { arrangement_status: 'unavailable' } } : p)),
    } as FinalJson;
    renderModal({ fj: settled });
    const row = screen.getByText('Arrangement').closest('li')!;
    expect(row.getAttribute('data-status')).toBe('unavailable');
    expect(row.textContent).toContain('Couldn’t detect structure');
    expect(row.querySelector('[class*="spin"]')).toBeNull();
  });

  describe('AI specialists stage', () => {
    it('before triage: coach says he has enough to consult, CTA disabled, no stage rows', () => {
      renderModal();
      expect(chatText()).toContain('I have enough information to consult some specialists…');
      expect(headerMascot().getAttribute('data-thinking')).toBe('true');
      expect(screen.queryByTestId('acm-specialists')).toBeNull();
      expect(cta().disabled).toBe(true);
      expect(cta().textContent).toContain('Picking specialists');
    });

    it('all running: one row each with its own tinted robot head; coach brings them in', () => {
      renderModal(allRunning);
      const rows = within(screen.getByTestId('acm-specialists')).getAllByRole('listitem');
      expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['running', 'running', 'running']);
      expect(within(rows[0]!).getByText('Stereo Phase')).toBeTruthy();
      const bot = within(rows[0]!).getByTestId('spec-bot');
      expect(bot.getAttribute('data-label')).toBe('Stereo Phase');
      expect(bot.getAttribute('data-color')).toBe('var(--blue)'); // roster group colour
      expect(chatText()).toContain('I’m going to bring in Stereo Phase, Low End and Loudness.');
      // Chips carry the bots too.
      expect(within(screen.getByTestId('acm-coach-next')).getAllByTestId('spec-bot')).toHaveLength(3);
      expect(cta().disabled).toBe(true);
      expect(cta().textContent).toContain('Consulting specialists… (0/3)');
      expect(screen.getByTestId('acm-ai-block').textContent).toContain('running in parallel');
    });

    it('mixed: done shows its findings (bug A: source=rule_engine counted), failed counts as settled', () => {
      renderModal(mixed);
      const rows = within(screen.getByTestId('acm-specialists')).getAllByRole('listitem');
      expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['done', 'failed', 'running']);
      expect(rows[0]!.textContent).toContain('3 findings');
      expect(rows[1]!.textContent).toContain('didn’t finish');
      expect(cta().disabled).toBe(true);
      expect(cta().textContent).toContain('(2/3)');
    });

    it('all settled (one failed): CTA enabled, coach done, mascot calm', () => {
      const { props } = renderModal(allSettled);
      expect(cta().disabled).toBe(false);
      expect(cta().textContent).toContain('Open full report');
      expect(chatText()).toContain('That’s everyone.');
      expect(headerMascot().getAttribute('data-thinking')).toBe('false');
      expect(screen.getByTestId('acm-ai-block').textContent).toContain('AI specialists complete');
      fireEvent.click(cta());
      expect(props.onViewReport).toHaveBeenCalledTimes(1);
    });

    it('a pending arrangement blocks neither the specialist stage nor the CTA', () => {
      renderModal(allSettled); // fj's phase 7 is still 'pending'
      expect(screen.getByText('Arrangement').closest('li')!.getAttribute('data-status')).toBe('background');
      expect(screen.getByTestId('acm-specialists')).toBeTruthy();
      expect(cta().disabled).toBe(false);
    });

    it('zero runnable specialists: stage skipped, CTA enabled immediately', () => {
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

  describe('chat', () => {
    it('appends in sequence; each specialist posts its own message from its bot', () => {
      const { rerender, props } = renderModal({ verdicts: [ruleVerdict] });
      const rr = (over: Partial<Props>) => rerender(<AnalysisCompleteModal {...props} {...over} />);

      expect(chatIds()).toEqual([
        'open',
        'p1:lufs',
        'p1:peak',
        'p1:tempo',
        'p1:key',
        'p2',
        'p7:pending',
        'fail:9',
        'big-one',
        'triage',
      ]);
      expect(chatText()).toContain('−9.1 LUFS');
      expect(chatText()).toContain('The big one so far: Low-mid buildup');

      // Plan arrives — appended after what was already said.
      rr({ ...allRunning, verdicts: [ruleVerdict] });
      expect(chatIds().slice(-4)).toEqual(['plan', 'why:stereo_phase', 'why:low_end', 'why:loudness']);

      // Loudness comes back first — its own message, from its bot, at the bottom.
      rr({
        routingPlan: plan,
        specialistStatuses: [st('stereo_phase', 'idle'), st('low_end', 'idle'), st('loudness', 'cached')],
        runningSlugs: new Set(['stereo_phase', 'low_end']),
        verdicts: [ruleVerdict, verdict('loudness', 'Too quiet for club play', 'severe')],
      });
      const last = screen.getAllByTestId('acm-chat-msg').at(-1)!;
      expect(last.getAttribute('data-msg-id')).toBe('back:loudness');
      expect(last.getAttribute('data-speaker')).toBe('loudness');
      expect(within(last).getByTestId('spec-bot').getAttribute('data-label')).toBe('Loudness');
      expect(last.textContent).toContain('Loudness');
      expect(last.textContent).toContain('I found 1 issue. Top: “Too quiet for club play”');

      // Then Stereo Phase, then Low End fails → all settled.
      rr({
        routingPlan: plan,
        specialistStatuses: [st('stereo_phase', 'cached'), st('low_end', 'idle'), st('loudness', 'cached')],
        runningSlugs: new Set(['low_end']),
        verdicts: [ruleVerdict, verdict('loudness'), verdict('stereo_phase')],
      });
      rr({
        routingPlan: plan,
        specialistStatuses: [st('stereo_phase', 'cached'), st('low_end', 'failed'), st('loudness', 'cached')],
        runningSlugs: new Set(),
        verdicts: [ruleVerdict, verdict('loudness'), verdict('stereo_phase')],
      });
      expect(chatIds().slice(-4)).toEqual(['back:loudness', 'back:stereo_phase', 'back:low_end', 'all-done']);
      expect(chatText()).toContain('I couldn’t finish');
      expect(screen.queryByTestId('acm-chat-typing')).toBeNull();
    });

    it('the coach speaks through his mascot; consecutive messages share one avatar', () => {
      renderModal();
      const msgs = screen.getAllByTestId('acm-chat-msg');
      expect(within(msgs[0]!).getByTestId('coach-mascot')).toBeTruthy();
      expect(within(msgs[1]!).queryByTestId('coach-mascot')).toBeNull();
    });

    it('a specialist chip shows its full Triage reason on focus', async () => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      renderModal(allRunning);
      const chip = within(screen.getByTestId('acm-coach-next')).getByRole('button', {
        name: /Low End: why I picked/,
      });
      act(() => {
        chip.focus();
      });
      const tips = await screen.findAllByRole('tooltip');
      expect(tips.some((t) => (t.textContent ?? '').includes('sub buildup'))).toBe(true);
      vi.unstubAllGlobals();
    });
  });

  it('Re-analyze stays available', () => {
    const { props } = renderModal(allRunning);
    fireEvent.click(screen.getByText(/Re-analyze/));
    expect(props.onReanalyze).toHaveBeenCalledTimes(1);
  });
});
