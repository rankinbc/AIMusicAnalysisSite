/* Page-level wiring: the stage opens on the findings board by default, the
 * switch is remembered (spec D6), and the page resolves findings from the
 * PLAYING version's job id only (spec D3). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// The page mounts the whole Listen shell, so the router is stubbed rather than
// built: `to`/`params` must NOT reach the <a> or React warns about unknown DOM
// attributes on every render.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, params, ...rest }: {
    children: ReactNode; to?: string; params?: Record<string, string>;
  }) => {
    const href = to && params
      ? Object.entries(params).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)
      : (to ?? '#');
    return <a href={href} {...rest}>{children}</a>;
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn(), getAccessToken: () => 'tok' };
});

import { fetcher } from '../../../../api/fetcher';
import { ListenRackPage } from '../../ListenRackPage';
import { STAGE_PREFS_KEY } from '../stage-prefs';

const fetcherMock = vi.mocked(fetcher);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderPage() {
  return render(
    <ListenRackPage versionId="ver-1" songId="song-1" latestJobId="job-a" />,
    { wrapper },
  );
}

describe('Listen stage wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    fetcherMock.mockReset();
    fetcherMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url.startsWith('/reports/')) {
        return { verdicts: [], specialists: [] };
      }
      if (url.includes('/rack/presets')) return [];
      return null;
    });
  });
  afterEach(cleanup);

  it('opens on the findings board and asks the PLAYING version job for verdicts', async () => {
    const { container } = renderPage();
    await waitFor(() =>
      expect(container.querySelector('.lr-stagecard')?.getAttribute('data-stage'))
        .toBe('findings'),
    );
    expect(fetcherMock.mock.calls.some(([arg]) => arg.url === '/reports/job-a/verdicts/'))
      .toBe(true);
  });

  it('remembers the switch to the visualizer', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Visualizer' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Visualizer' }));

    await waitFor(() =>
      expect(container.querySelector('.lr-stagecard')?.getAttribute('data-stage'))
        .toBe('visualizer'),
    );
    expect(JSON.parse(localStorage.getItem(STAGE_PREFS_KEY) ?? '{}').content)
      .toBe('visualizer');
  });

  it('a version with no analysis of its own says so instead of borrowing one', async () => {
    render(<ListenRackPage versionId="ver-1" songId="song-1" latestJobId={null} />, { wrapper });
    expect(await screen.findByTestId('listen-findings-empty')).toBeTruthy();
    expect(fetcherMock.mock.calls.some(([arg]) => String(arg.url).startsWith('/reports/')))
      .toBe(false);
  });
});
