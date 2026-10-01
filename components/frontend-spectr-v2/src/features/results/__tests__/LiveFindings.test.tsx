// @vitest-environment jsdom
// The analysis page's hand-off pieces: the live findings list (rule-engine
// findings, filling in as they land), specialists listing their findings in
// the coach chat, the coach's closing line (always last, with an inline link
// to the full report), and the "Open full report" CTA greyed out until the
// report is ready.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => <span>Correct</span> }));
vi.mock('../../../ui/Coach', () => ({ Coach: () => <span data-testid="coach-mascot" /> }));
vi.mock('../../../ui/SpecialistBot', () => ({
  SpecialistBot: ({ label }: { label?: string }) => <span data-testid="spec-bot" data-label={label} />,
}));

import type { FinalJson, RoutingPlanDto, SpecialistStatus, VerdictDto } from '../../../api/types';
import { AnalysisCompleteModal } from '../AnalysisCompleteModal';
import { CLOSER_ID, COACH, type ChatMessage } from '../helpers/coachNarration';
import { appendNew, resetNarrationLogs } from '../useLiveNarration';

const phases = (arrangement: Record<string, unknown>) =>
  ({
    phases: [
      { phase: 1, status: 'ok', duration_s: 54.4, data: { lufs: -9.1, bpm: 138 } },
      { phase: 2, status: 'ok', duration_s: 0, data: { genre: 'trance', confidence: 0.8 } },
      { phase: 7, status: 'ok', duration_s: 0.02, data: arrangement },
    ],
  }) as unknown as FinalJson;
const fjPending = phases({ arrangement_status: 'pending' });
const fjArranged = phases({ arrangement_status: 'ok', grade: 'F', section_count: 7 });

const plan: RoutingPlanDto = {
  specialistsToRun: [
    { name: 'low_end', priority: 1, focus: 'sub buildup' },
    { name: 'loudness', priority: 2, focus: 'under target' },
  ],
  skip: [],
  rationale: '',
  estimatedTotalTokens: 0,
};
const st = (slug: string, status: SpecialistStatus['status']): SpecialistStatus => ({ slug, status });

let n = 0;
const vd = (over: Partial<VerdictDto>): VerdictDto =>
  ({
    id: `v${++n}`,
    specialist: 'rule_engine.x',
    source: 'rule_engine',
    category: 'low_mid',
    headline: 'h',
    severity: 'moderate',
    priorityScore: 50,
    summary: null,
    body: null,
    whyItMatters: null,
    metricLine: null,
    userState: { dismissed: false, applied: false, feedback: null },
    ...over,
  }) as VerdictDto;

const ruleMod = vd({ headline: 'Low-mid buildup', severity: 'moderate', priorityScore: 60, summary: 'Energy piles up around 250 Hz.', whyItMatters: 'It muddies the kick.' });
const ruleCrit = vd({ headline: 'Clipping on the master', severity: 'critical', priorityScore: 200, category: 'loudness' });
const ruleModHigh = vd({ headline: 'Harsh highs', severity: 'moderate', priorityScore: 90 });
const failMarker = vd({ specialist: 'low_end', headline: 'Specialist failed', severity: 'minor' });
const dismissed = vd({ headline: 'Dismissed one', severity: 'critical', userState: { dismissed: true, applied: false, feedback: null } });
const specFinding = vd({ specialist: 'low_end', headline: 'Sub too hot', severity: 'severe', priorityScore: 120 });

type Props = Parameters<typeof AnalysisCompleteModal>[0];
const base: Props = { fj: fjPending, jobId: 'job-f', songName: 'Neon Meridian', onClose: vi.fn(), onViewReport: vi.fn() };

function renderPage(over: Partial<Props> = {}) {
  const props = { ...base, onViewReport: vi.fn(), ...over };
  const utils = render(<AnalysisCompleteModal {...props} />);
  const rr = (next: Partial<Props>) => utils.rerender(<AnalysisCompleteModal {...props} {...next} />);
  return { props, rr };
}

const running: Partial<Props> = {
  routingPlan: plan,
  specialistStatuses: [st('low_end', 'idle'), st('loudness', 'idle')],
  runningSlugs: new Set(['low_end', 'loudness']),
};
const settled: Partial<Props> = {
  routingPlan: plan,
  specialistStatuses: [st('low_end', 'cached'), st('loudness', 'cached')],
  runningSlugs: new Set(),
};

const rows = () => screen.queryAllByTestId('lf-row');
const cta = () => screen.getByTestId('acm-cta') as HTMLButtonElement;
const chatMsgs = () => screen.getAllByTestId('acm-chat-msg');

afterEach(() => {
  cleanup();
  resetNarrationLogs();
});

describe('live findings list', () => {
  it('shows an empty state until a finding arrives', () => {
    renderPage(running);
    expect(screen.getByTestId('lf-empty').textContent).toContain('Findings will appear here as they come in');
    expect(rows()).toHaveLength(0);
  });

  it('lists rule + specialist findings by severity then priority; no fail-marker or dismissed rows', () => {
    renderPage({ ...running, verdicts: [ruleMod, failMarker, ruleCrit, dismissed, specFinding, ruleModHigh] });
    expect(rows().map((r) => r.getAttribute('data-finding-id'))).toEqual([
      ruleCrit.id,
      specFinding.id,
      ruleModHigh.id,
      ruleMod.id,
    ]);
    expect(rows().map((r) => r.getAttribute('data-severity'))).toEqual(['critical', 'severe', 'moderate', 'moderate']);
    expect(screen.queryByText('Specialist failed')).toBeNull();
    expect(screen.queryByText('Dismissed one')).toBeNull();
    expect(within(screen.getByTestId('lf-list')).getByText(/4 findings/)).toBeTruthy();
  });

  it('rule rows show their area; specialist rows show the specialist with its bot head', () => {
    renderPage({ ...running, verdicts: [ruleCrit, specFinding] });
    const [rule, spec] = rows();
    const ruleSrc = within(rule!).getByTestId('lf-source');
    expect(ruleSrc.getAttribute('data-source')).toBe('rules');
    expect(ruleSrc.textContent).toBe('Loudness');
    const specSrc = within(spec!).getByTestId('lf-source');
    expect(specSrc.getAttribute('data-source')).toBe('specialist');
    expect(specSrc.textContent).toBe('Low End');
    expect(within(specSrc).getByTestId('spec-bot').getAttribute('data-label')).toBe('Low End');
  });

  it('a specialist’s findings join the list when it settles; they stay in its chat bubble too', () => {
    const { rr } = renderPage({ ...running, verdicts: [ruleMod] });
    expect(rows()).toHaveLength(1);
    rr({
      ...running,
      specialistStatuses: [st('low_end', 'cached'), st('loudness', 'idle')],
      runningSlugs: new Set(['loudness']),
      verdicts: [ruleMod, specFinding],
    });
    expect(rows().map((r) => r.getAttribute('data-finding-id'))).toEqual([specFinding.id, ruleMod.id]);
    const back = chatMsgs().find((m) => m.getAttribute('data-msg-id') === 'back:low_end')!;
    expect(within(back).getByTestId('acm-chat-items').textContent).toContain('Sub too hot');
  });

  it('merges a specialist finding with the rule finding it explicitly refines — and only then', () => {
    const parent = vd({ headline: 'Sub buildup (rule)', severity: 'moderate', problemId: 'P-sub' });
    const lookalike = vd({ headline: 'Sub buildup lookalike', severity: 'minor', problemId: 'P-other' });
    const refiner = vd({ specialist: 'low_end', headline: 'Sub buildup at 50 Hz', severity: 'severe', refines: 'P-sub' });
    renderPage({ ...running, verdicts: [parent, lookalike, refiner] });
    expect(rows().map((r) => r.getAttribute('data-finding-id'))).toEqual([refiner.id, lookalike.id]);
    fireEvent.click(within(rows()[0]!).getByRole('button'));
    expect(screen.getByTestId('lf-refines').textContent).toContain('Sub buildup (rule)');
  });

  it('fills in live as findings land, in severity order', () => {
    const { rr } = renderPage({ ...running, verdicts: [ruleMod] });
    expect(rows()).toHaveLength(1);
    rr({ ...running, verdicts: [ruleMod, ruleCrit] });
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain('Clipping on the master');
    expect(screen.queryByTestId('lf-empty')).toBeNull();
  });

  it('expanding a row shows its explanation', () => {
    renderPage({ ...running, verdicts: [ruleMod] });
    const btn = within(rows()[0]!).getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('lf-detail')).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const detail = screen.getByTestId('lf-detail');
    expect(detail.textContent).toContain('Energy piles up around 250 Hz.');
    expect(detail.textContent).toContain('It muddies the kick.');
    fireEvent.click(btn);
    expect(screen.queryByTestId('lf-detail')).toBeNull();
  });
});

describe('specialists list their findings in the chat', () => {
  it('a settled specialist’s bubble lists its findings with severity marks, capped with "+N more"', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      vd({ specialist: 'low_end', headline: `Low issue ${i}`, severity: i === 3 ? 'critical' : 'minor', priorityScore: 100 - i }),
    );
    renderPage({ ...settled, verdicts: [...many, ruleMod] });
    const back = chatMsgs().find((m) => m.getAttribute('data-msg-id') === 'back:low_end')!;
    expect(back.textContent).toContain('I found 7 issues:');
    const items = within(back).getByTestId('acm-chat-items');
    const lis = within(items).getAllByRole('listitem');
    expect(lis[0]!.getAttribute('data-severity')).toBe('critical');
    expect(lis[0]!.textContent).toBe('Low issue 3');
    expect(within(lis[0]!).getByRole('img').getAttribute('aria-label')).toBe('critical');
    expect(within(back).getByTestId('acm-chat-more').textContent).toBe('+2 more');
  });
});

describe('closing line + report CTA', () => {
  it('the CTA is greyed out (disabled) until the report is ready, then opens it', () => {
    const { props, rr } = renderPage(running);
    expect(cta().disabled).toBe(true);
    expect(cta().getAttribute('data-ready')).toBe('false');
    fireEvent.click(cta());
    expect(props.onViewReport).not.toHaveBeenCalled();
    expect(screen.queryByTestId('acm-chat-link')).toBeNull();
    rr(settled);
    expect(cta().disabled).toBe(false);
    expect(cta().getAttribute('data-ready')).toBe('true');
    fireEvent.click(cta());
    expect(props.onViewReport).toHaveBeenCalledTimes(1);
  });

  it('a still-pending arrangement doesn’t hold back the CTA or the closing line', () => {
    renderPage(settled);
    expect(cta().disabled).toBe(false);
    expect(chatMsgs().at(-1)!.getAttribute('data-msg-id')).toBe(CLOSER_ID);
  });

  it('the closing line is last — a late arrangement result lands above it — and its link opens the report', () => {
    const { props, rr } = renderPage(settled);
    rr({ ...settled, fj: fjArranged });
    const ids = chatMsgs().map((m) => m.getAttribute('data-msg-id'));
    expect(ids).toContain('p7:settled');
    expect(ids.at(-1)).toBe(CLOSER_ID);
    expect(ids.indexOf('p7:settled')).toBeLessThan(ids.indexOf(CLOSER_ID));
    const closer = chatMsgs().at(-1)!;
    expect(closer.textContent).toContain(
      'We have a good enough analysis to get started. Let’s view the full report. You can also dig deeper with more AI specialists or talk to me about the mix. Let’s go to the Full Report and determine how we can improve this mix.',
    );
    fireEvent.click(within(closer).getByTestId('acm-chat-link'));
    expect(props.onViewReport).toHaveBeenCalledTimes(1);
  });

  it('there is no Re-analyze action on the page', () => {
    renderPage(settled);
    expect(screen.queryByRole('button', { name: /Re-analyze/ })).toBeNull();
  });

  it('a sub-50 ms step reads "<0.1s", never "0.0s"', () => {
    renderPage(settled);
    const times = screen.getAllByTestId('acm-step-time').map((t) => t.textContent);
    expect(times).toContain('<0.1s');
    expect(times).not.toContain('0.0s');
  });
});

describe('appendNew keeps the closing line last', () => {
  const m = (id: string): ChatMessage => ({ id, speaker: COACH, parts: [id], tone: 'info' });
  it('inserts late messages just above the closer', () => {
    const log = [m('a'), m(CLOSER_ID)];
    expect(appendNew(log, [m('a'), m(CLOSER_ID), m('late')]).map((x) => x.id)).toEqual(['a', 'late', CLOSER_ID]);
  });
  it('appends normally when there is no closer yet', () => {
    expect(appendNew([m('a')], [m('b')]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});
