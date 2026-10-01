// @vitest-environment jsdom
// The live analysis page: the SAME layout from the moment the job exists —
// "Analyzing…" with every step waiting, steps flipping to running/✓ (values +
// durations) as the job poll's partial results land, the coach narrating it
// all as an append-only chat (with "still working" lines in long quiet
// stretches), and no jump at the hand-off: ReportView's complete page
// continues the same conversation.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => <span>Correct</span> }));
vi.mock('../../billing/CostTag', () => ({ CostTag: () => <span>Included</span> }));
vi.mock('../../../ui/Coach', () => ({
  Coach: ({ thinking }: { thinking?: boolean }) => (
    <span data-testid="coach-mascot" data-thinking={String(Boolean(thinking))} />
  ),
}));
vi.mock('../../../ui/SpecialistBot', () => ({
  SpecialistBot: ({ label }: { label?: string }) => <span data-testid="spec-bot" data-label={label} />,
}));

import type { FinalJson, JobPartial, JobStatusDto } from '../../../api/types';
import { AnalysisCompleteModal } from '../AnalysisCompleteModal';
import { LiveAnalysisView } from '../LiveAnalysisView';
import { WAIT_FIRST_SEC } from '../helpers/coachWaitLines';
import { resetNarrationLogs } from '../useLiveNarration';

const T0 = Date.parse('2026-10-01T10:00:00Z');
const iso = (msAfterT0: number) => new Date(T0 + msAfterT0).toISOString();

const job = (status: JobStatusDto['status'], partial?: JobPartial | null, currentPhase = ''): JobStatusDto => ({
  id: 'job-live',
  status,
  currentPhase,
  phasePct: 0,
  versionId: 'v1',
  songId: 's1',
  errorMessage: null,
  dispatchedAt: iso(0),
  startedAt: null,
  completedAt: null,
  failedAt: null,
  partial,
});

const inputs = { hasStems: false, hasReference: false, hasAls: false };
const steps = () => within(screen.getByTestId('acm-steps')).getAllByRole('listitem');
const step = (phase: number) => steps().find((r) => r.getAttribute('data-phase') === String(phase))!;
const chatIds = () => screen.getAllByTestId('acm-chat-msg').map((m) => m.getAttribute('data-msg-id'));
const cta = () => screen.getByTestId('acm-cta') as HTMLButtonElement;

function renderLive(j: JobStatusDto) {
  const utils = render(<LiveAnalysisView jobId="job-live" job={j} songName="Neon Meridian" inputs={inputs} />);
  const update = (next: JobStatusDto) =>
    utils.rerender(<LiveAnalysisView jobId="job-live" job={next} songName="Neon Meridian" inputs={inputs} />);
  return { ...utils, update };
}

// The poll sequence of one real run, phase by phase.
const p1Early: JobPartial = {
  early: { '1': { lufs: -9.2, duration_seconds: 212 } },
  running: { phase: 1, name: 'Universal Mix Analysis', started_at: iso(0) },
};
const p1More: JobPartial = {
  ...p1Early,
  early: { '1': { lufs: -9.2, duration_seconds: 212, true_peak_db: -0.4, clipping_detected: false, bpm: 128 } },
};
const p1Done: JobPartial = {
  early: p1More.early,
  phases: {
    '1': {
      name: 'Universal Mix Analysis',
      status: 'ok',
      seconds: 54.4,
      data: { lufs: -9.2, true_peak_db: -0.4, bpm: 128, detected_key: 'F', clipping_detected: false, duration_seconds: 212 },
    },
  },
  running: { phase: 2, name: 'Genre Detection', started_at: iso(55_000) },
};
const p2Done: JobPartial = {
  ...p1Done,
  phases: { ...p1Done.phases, '2': { name: 'Genre Detection', status: 'ok', seconds: 1.2, data: { genre: 'trance', confidence: 0.8 } } },
  running: { phase: 3, name: 'Genre-Specific Scoring', started_at: iso(56_500) },
};

describe('live analysis page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetNarrationLogs();
  });

  it('shows the full page as soon as the job exists (pending) — no separate progress view', () => {
    renderLive(job('pending'));
    expect(screen.getByRole('region', { name: 'Analysis' })).toBeTruthy();
    expect(screen.getByTestId('acm-overline').textContent).toBe('Analyzing…');
    expect(screen.queryByText('Analysis in progress')).toBeNull();
    expect(steps().map((r) => r.getAttribute('data-status'))).toEqual([
      'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'skipped', 'skipped',
    ]);
    expect(chatIds()).toEqual(['open', 'queued']);
    expect(screen.getByTestId('acm-coach-log').textContent).toContain('Let’s take a look at your mix.');
    expect(screen.getByTestId('acm-chat-typing')).toBeTruthy();
    expect(cta().disabled).toBe(true);
    expect(cta().getAttribute('data-ready')).toBe('false');
  });

  it('steps go waiting → running (values filling in, live clock) → ✓ with their duration', () => {
    const { update } = renderLive(job('pending'));
    update(job('processing', p1Early, 'Universal Mix Analysis'));
    expect(step(1).getAttribute('data-status')).toBe('running');
    expect(within(step(1)).getByText('-9.2')).toBeTruthy(); // early LUFS, before phase 1 finishes
    expect(step(2).getAttribute('data-status')).toBe('waiting');

    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(within(step(1)).getByTestId('acm-step-time').textContent).toBe('12s');

    update(job('processing', p1Done, 'Genre Detection'));
    expect(step(1).getAttribute('data-status')).toBe('done');
    expect(within(step(1)).getByTestId('acm-step-time').textContent).toBe('54.4s');
    expect(within(step(1)).getByText('F')).toBeTruthy();
    expect(step(2).getAttribute('data-status')).toBe('running');

    update(job('processing', p2Done, 'Genre-Specific Scoring'));
    expect(step(2).getAttribute('data-status')).toBe('done');
    expect(within(step(2)).getByTestId('acm-step-time').textContent).toBe('1.2s');
    expect(within(step(2)).getByText('80%')).toBeTruthy();
    expect(step(3).getAttribute('data-status')).toBe('running');
    // Header picks up what's known so far.
    const header = screen.getByText('Neon Meridian').parentElement!;
    expect(header.textContent).toContain('trance');
    expect(header.textContent).toContain('3:32');
  });

  it('the coach narrates in order, with a "still working" line in a long quiet stretch', () => {
    const { update } = renderLive(job('pending'));
    update(job('processing', p1Early, 'Universal Mix Analysis'));
    expect(chatIds()).toEqual(['open', 'queued', 'p1:lufs']);

    // Phase 1 grinds on with nothing new — the coach fills the silence.
    act(() => {
      vi.advanceTimersByTime((WAIT_FIRST_SEC + 1) * 1000);
    });
    expect(chatIds().at(-1)).toBe('wait:phase:1:0');
    expect(screen.getByTestId('acm-coach-log').textContent).toContain('Still measuring');

    update(job('processing', p1More, 'Universal Mix Analysis'));
    update(job('processing', p1Done, 'Genre Detection'));
    update(job('processing', p2Done, 'Genre-Specific Scoring'));
    expect(chatIds()).toEqual(['open', 'queued', 'p1:lufs', 'wait:phase:1:0', 'p1:peak', 'p1:tempo', 'p1:key', 'p2']);
    expect(screen.getByTestId('acm-coach-log').textContent).toContain('This reads as trance — 80% confident.');
  });

  it('hand-off: the report’s page continues the same conversation — nothing reshuffles or replays', () => {
    const live = renderLive(job('pending'));
    live.update(job('processing', p1Early, 'Universal Mix Analysis'));
    act(() => {
      vi.advanceTimersByTime((WAIT_FIRST_SEC + 1) * 1000);
    });
    live.update(job('processing', p2Done, 'Genre-Specific Scoring'));
    const before = chatIds();
    live.unmount();

    const fj = {
      phases: [
        { phase: 1, status: 'ok', duration_s: 54.4, data: (p1Done.phases!['1']!.data as object) },
        { phase: 2, status: 'ok', duration_s: 1.2, data: { genre: 'trance', confidence: 0.8 } },
        { phase: 7, status: 'ok', duration_s: 0.1, data: { arrangement_status: 'pending' } },
      ],
    } as unknown as FinalJson;
    render(
      <AnalysisCompleteModal
        jobId="job-live"
        fj={fj}
        songName="Neon Meridian"
        onViewReport={vi.fn()}
      />,
    );
    const after = chatIds();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(['p7:pending', 'triage']);
    expect(screen.getByTestId('acm-overline').textContent).toBe('Analysis complete');
    // Already-seen messages don't animate in again; new ones do.
    const msgs = screen.getAllByTestId('acm-chat-msg');
    expect(msgs[0]!.className).not.toMatch(/enter/);
    expect(msgs.at(-1)!.className).toMatch(/enter/);
  });

  it('complete but the report still loading: the live page reads "Analysis complete"', () => {
    renderLive(job('complete', p2Done));
    expect(screen.getByTestId('acm-overline').textContent).toBe('Analysis complete');
    expect(screen.getByTestId('acm-coach-log').textContent).toContain('enough information to consult');
    expect(cta().disabled).toBe(true);
  });
});
