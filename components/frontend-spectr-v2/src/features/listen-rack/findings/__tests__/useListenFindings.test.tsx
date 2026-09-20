/* Spec D3/D11/D12: findings come from the PLAYING version's own job, the board
 * needs nothing but the verdicts, and there is exactly ONE fix overlay on the
 * page — a toggle must produce exactly one rack write. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { ApiError, fetcher } from '../../../../api/fetcher';
import type { VerdictDto } from '../../../../api/types';
import type { RackState } from '../../rackState';
import { useListenFindings } from '../useListenFindings';

const fetcherMock = vi.mocked(fetcher);

const VERDICT: VerdictDto = {
  id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
  severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
  impact: null, chartType: null, headline: 'Sub is masking the kick',
  summary: null, body: null, metricLine: null, whyItMatters: null, presetName: null,
  evidence: null,
  // A REAL op from fixToRackPatch's vocabulary. `{type:'eq'}` is not in it: the
  // fix would be notApplicable and every toggle would take useFixOverlay's
  // "nothing checked" branch — the test would pass with the wiring broken.
  fix: { dsp_chain: [{ type: 'peaking_eq', params: { frequency_hz: 45, gain_db: -3, q: 1 } }] },
  sources: null, problemId: 'p1', kind: 'fault', source: 'rule_engine',
  dataTier: 'audio_only', fixable: true, suspected: false, where: null, refines: null,
  priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
  scope: null, createdAt: '2026-09-19T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
};

function fakeRs() {
  return { mod: {}, applyRackMod: vi.fn() } as unknown as RackState;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useListenFindings', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    localStorage.clear();
  });

  it('reports no-analysis and asks the server for nothing when the version has no job', () => {
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: null, rs: fakeRs() }),
      { wrapper },
    );
    expect(result.current.status).toBe('no-analysis');
    expect(result.current.jobId).toBeNull();
    expect(fetcherMock).not.toHaveBeenCalled();
  });

  it('loads the PLAYING version job and builds moves from its verdicts', async () => {
    fetcherMock.mockResolvedValue({ verdicts: [VERDICT], specialists: [] });
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: 'job-a', rs: fakeRs() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetcherMock.mock.calls[0][0].url).toBe('/reports/job-a/verdicts/');
    expect(result.current.moves.map((m) => m.id)).toEqual(['v1']);
  });

  it('one toggle writes the rack exactly once and flips isApplied', async () => {
    fetcherMock.mockResolvedValue({ verdicts: [VERDICT], specialists: [] });
    const rs = fakeRs();
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: 'job-a', rs }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.overlay.toggle('v1'));
    expect(rs.applyRackMod).toHaveBeenCalledTimes(1);
    // The write is the fix's real patch — an EQ cut at 45 Hz — not a no-op.
    expect(vi.mocked(rs.applyRackMod).mock.calls[0][0]).toMatchObject({
      eq: {
        enabled: true,
        bands: expect.arrayContaining([expect.objectContaining({ freq: 45, gainDb: -3 })]),
      },
    });
    await waitFor(() => expect(result.current.overlay.isApplied('v1')).toBe(true));
    expect(result.current.appliedIds.has('v1')).toBe(true);

    act(() => result.current.overlay.toggle('v1'));
    expect(rs.applyRackMod).toHaveBeenCalledTimes(2);
    // Un-applying restores the baseline captured at the first apply (`rs.mod`).
    expect(vi.mocked(rs.applyRackMod).mock.calls[1][0]).toEqual({});
    await waitFor(() => expect(result.current.overlay.isApplied('v1')).toBe(false));
  });

  it('retry is inert when the version has no analysis (refetch() ignores `enabled`)', async () => {
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: null, rs: fakeRs() }),
      { wrapper },
    );
    expect(result.current.status).toBe('no-analysis');
    await act(async () => { result.current.retry(); });
    expect(fetcherMock).not.toHaveBeenCalled();
  });

  it('surfaces a failed load and can retry it', async () => {
    fetcherMock.mockRejectedValueOnce(new ApiError(500, undefined));
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: 'job-a', rs: fakeRs() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('error'));

    fetcherMock.mockResolvedValue({ verdicts: [VERDICT], specialists: [] });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
