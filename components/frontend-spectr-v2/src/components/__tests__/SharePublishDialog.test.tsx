// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SharePublishDialog } from '../SharePublishDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Story 7.3 (UX-DR42) — the share controls must state EXACTLY what a share
// exposes (glyph + one-line scope text) and offer revoke + regenerate.
// The dialog's open effect POSTs create — stub fetch to return a live token.
function mockFetchShare() {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(
      JSON.stringify({
        shareToken: 'tok123',
        shareShowVerdicts: true,
        shareEnabledAt: '2026-07-02T00:00:00Z',
        publicUrl: '/r/tok123',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  ));
}

function renderOpen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SharePublishDialog open onOpenChange={() => {}} analysisId="a1" songName="Neon" />
    </QueryClientProvider>,
  );
}

describe('SharePublishDialog (story 7.3)', () => {
  it('shows the globe scope line stating what a share exposes', async () => {
    mockFetchShare();
    renderOpen();
    const scope = await screen.findByTestId('share-scope');
    expect(scope.textContent).toContain('Public link');
    expect(scope.textContent).toContain('stems and library stay private');
    expect(scope.textContent).toContain('🌐');
  });

  it('offers revoke (lock glyph) and regenerate controls', async () => {
    mockFetchShare();
    renderOpen();
    expect(await screen.findByText(/Revoke link/)).toBeTruthy();
    expect(await screen.findByText(/Regenerate/)).toBeTruthy();
  });
});
