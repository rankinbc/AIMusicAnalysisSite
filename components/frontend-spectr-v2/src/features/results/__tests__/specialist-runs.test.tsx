// @vitest-environment jsdom
// "N specialists running…" — the truthful running set (dispatched minus
// settled minus expired), the label grammar, the header pill, and the lifted
// useSpecialistRuns hook (Triage auto-run + user clicks → one shared set that
// clears as verdicts land).
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoutingPlanDto, SpecialistStatus, VerdictsListResponse } from '../../../api/types';
import { RUN_EXPIRY_MS, activeRunningSlugs, runningLabel } from '../helpers/specialist-runs';
import { SpecialistsRunning } from '../SpecialistsRunning';
import { SongHeader } from '../SongHeader';
import { useSpecialistRuns } from '../useSpecialistRuns';

// ── hook mocks (useSpecialistRuns reads the verdicts query + run mutation) ──
let verdictsData: VerdictsListResponse | undefined;
const mutateAsync = vi.fn<(slug: string) => Promise<unknown>>();
const useVerdictsSpy = vi.fn();
vi.mock('../../../api/hooks', () => ({
  useVerdicts: (jobId: string, opts: unknown) => {
    useVerdictsSpy(jobId, opts);
    return { data: verdictsData };
  },
  useRunSpecialist: () => ({ mutateAsync }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => null }));

afterEach(cleanup);

const st = (slug: string, status: SpecialistStatus['status']): SpecialistStatus => ({ slug, status });

describe('activeRunningSlugs', () => {
  const now = 1_000_000;
  it('is empty when nothing was dispatched', () => {
    expect(activeRunningSlugs(new Map(), [], now).size).toBe(0);
  });

  it('counts one / many dispatched-but-idle specialists', () => {
    expect(activeRunningSlugs(new Map([['low_end', now]]), [st('low_end', 'idle')], now)).toEqual(
      new Set(['low_end']),
    );
    const many = new Map([
      ['low_end', now],
      ['clarity', now],
      ['loudness', now],
    ]);
    expect(activeRunningSlugs(many, undefined, now).size).toBe(3);
  });

  it('drops specialists whose verdict landed (cached) or failed', () => {
    const d = new Map([
      ['low_end', now],
      ['clarity', now],
      ['loudness', now],
    ]);
    const running = activeRunningSlugs(d, [st('low_end', 'cached'), st('clarity', 'failed')], now);
    expect(running).toEqual(new Set(['loudness']));
  });

  it('does not count idle specialists that were never dispatched', () => {
    expect(activeRunningSlugs(new Map(), [st('low_end', 'idle'), st('clarity', 'idle')], now).size).toBe(0);
  });

  it('expires a dispatch that never reported back', () => {
    const d = new Map([['low_end', now - RUN_EXPIRY_MS]]);
    expect(activeRunningSlugs(d, [], now).size).toBe(0);
    expect(activeRunningSlugs(d, [], now - 1).size).toBe(1);
  });
});

describe('runningLabel', () => {
  it('is empty at 0, singular at 1, plural above', () => {
    expect(runningLabel(0)).toBe('');
    expect(runningLabel(1)).toBe('1 specialist running…');
    expect(runningLabel(3)).toBe('3 specialists running…');
  });
});

describe('SpecialistsRunning', () => {
  it('renders nothing when none are running', () => {
    const { container } = render(<SpecialistsRunning count={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the singular / plural label as a polite status', () => {
    const { rerender } = render(<SpecialistsRunning count={1} />);
    expect(screen.getByRole('status').textContent).toBe('1 specialist running…');
    rerender(<SpecialistsRunning count={4} />);
    expect(screen.getByRole('status').textContent).toBe('4 specialists running…');
  });

  it('is a button that opens the roster when given onClick', () => {
    const onClick = vi.fn();
    render(<SpecialistsRunning count={2} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /2 specialists running/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows in the SongHeader kicker row only while specialists run', () => {
    const base = {
      songId: 's',
      versionId: 'v',
      versionLabel: 'v1',
      trackName: 'T',
      genre: null,
      durationSeconds: 60,
      inputs: { mix: true, stems: false, als: false, reference: false },
      findingCount: 0,
      suggestionCount: 0,
      onAddInputs: () => {},
    };
    const { rerender } = render(<SongHeader {...base} specialistsRunning={0} />);
    expect(screen.queryByTestId('specialists-running')).toBeNull();
    rerender(<SongHeader {...base} specialistsRunning={3} />);
    expect(screen.getByTestId('specialists-running').textContent).toBe('3 specialists running…');
  });
});

describe('useSpecialistRuns', () => {
  const plan = (names: string[]): RoutingPlanDto => ({
    specialistsToRun: names.map((name, i) => ({ name, priority: i, focus: '' })),
    skip: [],
    rationale: '',
    estimatedTotalTokens: 0,
  });
  const response = (
    specialists: SpecialistStatus[],
    names = ['low_end', 'clarity', 'loudness'],
  ): VerdictsListResponse => ({ verdicts: [], specialists, routingPlan: plan(names) });

  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ status: 'queued' });
    useVerdictsSpy.mockReset();
    verdictsData = undefined;
  });

  it('counts Triage auto-runs, then clears as each verdict lands', () => {
    const { result, rerender } = renderHook(() =>
      useSpecialistRuns({ jobId: 'j', analysisId: 'a', hasStems: false }),
    );
    expect(result.current.running.size).toBe(0);

    verdictsData = response([st('low_end', 'idle'), st('clarity', 'idle'), st('loudness', 'idle')]);
    rerender();
    expect(mutateAsync).toHaveBeenCalledTimes(3);
    expect(result.current.running.size).toBe(3);
    // Polling is kept alive with the dispatched set.
    const lastOpts = useVerdictsSpy.mock.lastCall?.[1] as { optimisticRunning: ReadonlySet<string> };
    expect(lastOpts.optimisticRunning.size).toBe(3);

    verdictsData = response([st('low_end', 'cached'), st('clarity', 'failed'), st('loudness', 'idle')]);
    rerender();
    expect([...result.current.running]).toEqual(['loudness']);

    verdictsData = response([st('low_end', 'cached'), st('clarity', 'failed'), st('loudness', 'cached')]);
    rerender();
    expect(result.current.running.size).toBe(0);
    const finalOpts = useVerdictsSpy.mock.lastCall?.[1] as { optimisticRunning: ReadonlySet<string> };
    expect(finalOpts.optimisticRunning.size).toBe(0);
  });

  it('skips stem-only specialists without stems and already-settled ones', () => {
    verdictsData = response(
      [st('low_end', 'cached'), st('stem_balance', 'idle'), st('clarity', 'idle')],
      ['low_end', 'stem_balance', 'clarity'],
    );
    const { result } = renderHook(() =>
      useSpecialistRuns({ jobId: 'j', analysisId: 'a', hasStems: false }),
    );
    expect([...result.current.running]).toEqual(['clarity']);
  });

  it('adds a user-clicked run and drops it when the dispatch fails', async () => {
    verdictsData = { verdicts: [], specialists: [st('low_end', 'idle')] }; // no plan → no auto-run
    const { result } = renderHook(() =>
      useSpecialistRuns({ jobId: 'j', analysisId: 'a', hasStems: false }),
    );
    mutateAsync.mockRejectedValueOnce(new Error('nope'));
    await act(async () => {
      await result.current.runSpecialist('low_end');
    });
    expect(result.current.running.size).toBe(0);

    let pending!: (v: unknown) => void;
    mutateAsync.mockReturnValueOnce(new Promise((r) => (pending = r)));
    act(() => {
      void result.current.runSpecialist('low_end');
    });
    expect([...result.current.running]).toEqual(['low_end']);
    await act(async () => pending({ status: 'queued' }));
    expect(result.current.running.size).toBe(1); // still running until the verdict lands
  });
});
