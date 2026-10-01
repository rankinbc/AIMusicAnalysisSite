// @vitest-environment jsdom
// The analysis page's chrome (owner ruling 2026-10-01): a big SPECTR lockup
// above the box in every state, no "×" close button, no "Run in background",
// and nothing — Esc, a click outside the box — that silently dismisses it.
// The ways out are "Open full report", the site header and the back button.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => <span>Correct</span> }));
vi.mock('../../billing/CostTag', () => ({ CostTag: () => <span>Included</span> }));
vi.mock('../../../ui/Coach', () => ({ Coach: () => <span data-testid="coach-mascot" /> }));
vi.mock('../../../ui/SpecialistBot', () => ({ SpecialistBot: () => <span data-testid="spec-bot" /> }));

import type { FinalJson, JobStatusDto, RoutingPlanDto, SpecialistStatus } from '../../../api/types';
import { AnalysisCompleteModal } from '../AnalysisCompleteModal';
import { LiveAnalysisView } from '../LiveAnalysisView';
import { resetNarrationLogs } from '../useLiveNarration';

const running: JobStatusDto = {
  id: 'job-chrome',
  status: 'processing',
  currentPhase: 'Universal Mix Analysis',
  phasePct: 0,
  versionId: 'v1',
  songId: 's1',
  errorMessage: null,
  dispatchedAt: new Date().toISOString(),
  startedAt: null,
  completedAt: null,
  failedAt: null,
  partial: null,
};

const fj = {
  phases: [
    { phase: 1, status: 'ok', duration_s: 50, data: { duration_seconds: 200, lufs_integrated: -9 } },
    { phase: 2, status: 'ok', duration_s: 1, data: { genre: 'trance', confidence: 0.8 } },
  ],
} as unknown as FinalJson;

const plan = {
  specialists: [{ slug: 'low_end', focus: 'sub' }],
} as unknown as RoutingPlanDto;
const specRunning = [{ slug: 'low_end', status: 'idle' }] as unknown as SpecialistStatus[];

type Props = Parameters<typeof AnalysisCompleteModal>[0];

const states: Array<[string, () => Props]> = [
  ['running', () => ({ jobId: 'job-chrome', job: running, songName: 'Neon Meridian', onViewReport: vi.fn() })],
  [
    'specialists running',
    () => ({
      jobId: 'job-chrome',
      fj,
      songName: 'Neon Meridian',
      routingPlan: plan,
      specialistStatuses: specRunning,
      runningSlugs: new Set(['low_end']),
      onViewReport: vi.fn(),
    }),
  ],
  [
    'finished',
    () => ({ jobId: 'job-chrome', fj, songName: 'Neon Meridian', routingPlan: { specialists: [] } as unknown as RoutingPlanDto, onViewReport: vi.fn() }),
  ],
];

afterEach(() => {
  cleanup();
  resetNarrationLogs();
});

describe('analysis page chrome', () => {
  it.each(states)('%s: SPECTR logo + "AI Music Analysis" sit above the box', (_, make) => {
    render(<AnalysisCompleteModal {...make()} />);
    const brand = screen.getByTestId('acm-brand');
    expect(brand.textContent).toContain('SPECTR');
    expect(brand.textContent).toContain('AI Music Analysis');
    // The shared lockup at its hero size, not a copy of the SVG.
    expect(brand.querySelector('[data-size="xl"]')).toBeTruthy();
    // Above the box: an earlier sibling of the panel holding the header.
    const box = screen.getByTestId('acm-overline').closest('[data-status]')!;
    expect(brand.parentElement).toBe(box.parentElement);
    expect(brand.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(states)('%s: no close button and no "Run in background"', (_, make) => {
    render(<AnalysisCompleteModal {...make()} />);
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
    expect(screen.queryByText(/run in background/i)).toBeNull();
    // The one way forward is still there.
    expect(screen.getByTestId('acm-cta').textContent).toContain('Open full report');
  });

  it.each(states)('%s: Esc and clicks outside the box do not dismiss it', (_, make) => {
    const props = make();
    render(<AnalysisCompleteModal {...props} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    const region = screen.getByRole('region', { name: 'Analysis' });
    fireEvent.click(region.firstElementChild!); // the backdrop
    expect(screen.getByRole('region', { name: 'Analysis' })).toBeTruthy();
    expect(screen.getByTestId('acm-status-dock')).toBeTruthy();
    expect(props.onViewReport).not.toHaveBeenCalled();
  });

  it('is not an aria-modal dialog — the site header stays reachable', () => {
    render(<LiveAnalysisView jobId="job-chrome" job={running} songName="Neon Meridian" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('finished: "Open full report" is the way into the report', () => {
    const props = states[2]![1]();
    render(<AnalysisCompleteModal {...props} />);
    const cta = screen.getByTestId('acm-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    fireEvent.click(cta);
    expect(props.onViewReport).toHaveBeenCalledTimes(1);
  });
});
