/* The stage's board container: honest empty/error states, the D8 preset gate,
 * and applying straight onto the rack. */
import {
  createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../../api/types';
import { buildMoves } from '../../../results/move-model';
import { FindingsStage } from '../FindingsStage';
import type { ListenFindings } from '../useListenFindings';

afterEach(cleanup);

const VERDICT: VerdictDto = {
  id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
  severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
  impact: null, chartType: null, headline: 'Sub is masking the kick',
  summary: null, body: null, metricLine: null, whyItMatters: null, presetName: null,
  evidence: null,
  fix: {
    target: { name: 'Master bus' },
    dsp_chain: [{ type: 'peaking_eq', params: { frequency_hz: 45, gain_db: -3, q: 1 } }],
  },
  sources: null, problemId: 'p1', kind: 'fault', source: 'rule_engine',
  dataTier: 'audio_only', fixable: true, suspected: false,
  where: { start_seconds: 83, end_seconds: 101 }, refines: null,
  priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
  scope: null, createdAt: '2026-09-19T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
};

function findings(patch: Partial<ListenFindings> = {}): ListenFindings {
  return {
    status: 'ready',
    jobId: 'job-a',
    verdicts: [VERDICT],
    moves: buildMoves({ verdicts: [VERDICT] }),
    appliedIds: new Set<string>(),
    overlay: { isApplied: () => false, toggle: vi.fn() },
    retry: vi.fn(),
    ...patch,
  };
}

// The empty state links to the song page, so the container renders inside a
// minimal memory router (same shape as listen-rack-version-gate.test.tsx).
function renderStage(props: Partial<React.ComponentProps<typeof FindingsStage>> = {}) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <FindingsStage
        findings={findings()}
        songId="song-1"
        durationSeconds={240}
        onSeek={vi.fn()}
        carryPhase="none"
        onClearPreset={vi.fn()}
        {...props}
      />
    ),
  });
  const songRoute = createRoute({
    getParentRoute: () => rootRoute, path: '/songs/$songId', component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, songRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-local tree
  return render(<RouterProvider router={router as any} />);
}

describe('FindingsStage', () => {
  it('lists the playing version findings and applies one onto the rack', async () => {
    const toggle = vi.fn();
    renderStage({ findings: findings({ overlay: { isApplied: () => false, toggle } }) });

    expect(await screen.findByText('Sub is masking the kick')).toBeTruthy();
    fireEvent.click(screen.getByText('Apply live'));
    expect(toggle).toHaveBeenCalledWith('v1');
  });

  it('with no analysis, points at the song instead of pretending', async () => {
    renderStage({ findings: findings({ status: 'no-analysis', jobId: null, verdicts: [], moves: [] }) });

    expect(await screen.findByText(/hasn.t been analyzed yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open this song/i }).getAttribute('href'))
      .toBe('/songs/song-1');
  });

  it('a failed load offers a retry', async () => {
    const retry = vi.fn();
    renderStage({ findings: findings({ status: 'error', verdicts: [], moves: [], retry }) });

    fireEvent.click(await screen.findByText('Retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('a loaded preset locks single-fix applying until it is cleared (D8)', async () => {
    const toggle = vi.fn();
    const onClearPreset = vi.fn();
    renderStage({
      carryPhase: 'applied',
      onClearPreset,
      findings: findings({ overlay: { isApplied: () => false, toggle } }),
    });

    expect(await screen.findByText(/A fix preset is loaded/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Apply live'));
    expect(toggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Clear preset'));
    expect(onClearPreset).toHaveBeenCalled();
  });
});
