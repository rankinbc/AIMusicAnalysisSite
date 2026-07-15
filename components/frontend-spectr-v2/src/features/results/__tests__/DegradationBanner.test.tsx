// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FinalJson } from '../../../api/types';
import { DegradationBanner } from '../DegradationBanner';
import { failedPhases } from '../helpers/failed-phases';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Story 5.7 (FR6/AC1) — the "we kept everything that worked" banner: renders
// only on ≥1 failed phase, names the phase with the shared PHASE_SHORT label,
// and drives the entitlement-free POST /jobs/{id}/retry (409 hides the button;
// never the UpgradeSheet).

const degradedFj: FinalJson = {
  phases: [
    { phase: 1, name: 'Mix', status: 'ok' },
    { phase: 4, name: 'Stems', status: 'failed', error: 'boom' },
    { phase: 8, name: 'ALS Analysis', status: 'skipped' },
  ],
};
const cleanFj: FinalJson = {
  phases: [
    { phase: 1, name: 'Mix', status: 'ok' },
    { phase: 8, name: 'ALS Analysis', status: 'skipped' },
  ],
};

function renderBanner(fj: FinalJson, onRetryDispatched = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <DegradationBanner fj={fj} jobId="job-1" onRetryDispatched={onRetryDispatched} />
    </QueryClientProvider>,
  );
}

describe('failedPhases', () => {
  it('collects only failed entries, tolerating absent phases[]', () => {
    expect(failedPhases(degradedFj).map((p) => p.phase)).toEqual([4]);
    expect(failedPhases(cleanFj)).toEqual([]);
    expect(failedPhases({})).toEqual([]);
  });
});

describe('DegradationBanner (story 5.7)', () => {
  it('renders on a failed phase, naming it with the shared label', () => {
    renderBanner(degradedFj);
    const banner = screen.getByTestId('degradation-banner');
    expect(banner.textContent).toContain('Stem clash'); // PHASE_SHORT[4]
    expect(banner.textContent).toContain('we kept everything that worked');
    expect(screen.getByText('Retry free')).toBeTruthy();
  });

  it('renders nothing for a clean report (skipped ≠ failed)', () => {
    renderBanner(cleanFj);
    expect(screen.queryByTestId('degradation-banner')).toBeNull();
  });

  it('POSTs the free retry and hands the new jobId to navigation', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ jobId: 'job-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const onDispatched = vi.fn();
    renderBanner(degradedFj, onDispatched);

    fireEvent.click(screen.getByText('Retry free'));
    await waitFor(() => expect(onDispatched).toHaveBeenCalledWith('job-2'));
    expect(seen[0]).toContain('/jobs/job-1/retry');
  });

  it('hides the button on 409 retry_already_used instead of upselling', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: 'retry_already_used', message: 'used' } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    ));
    renderBanner(degradedFj);

    fireEvent.click(screen.getByText('Retry free'));
    await waitFor(() => expect(screen.queryByText('Retry free')).toBeNull());
    // Banner itself stays — the report is still partial.
    expect(screen.getByTestId('degradation-banner')).toBeTruthy();
  });
});
