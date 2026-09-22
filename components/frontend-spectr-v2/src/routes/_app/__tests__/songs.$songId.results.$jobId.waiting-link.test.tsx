// @vitest-environment jsdom
// Task G6 review fix (I2) — the "explore the demo while yours analyzes"
// waiting link (songs.$songId.results.$jobId.tsx) shipped with zero test
// coverage. `resolveDemoWaitingLink` is the pure decision (unit-tested
// exhaustively below); `DemoWaitingLink` is the markup that decision feeds
// (one render test, no need to mount the whole route's hook graph).
import {
  createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// `DemoWaitingLink` is exported from the route file purely for this test —
// same precedent as `VersionErrorShell` (listen-rack-version-gate.test.tsx),
// a route-local component exported so its markup is render-testable without
// mounting the whole route's hook graph. The pure decision itself lives in
// its own module (results-waiting-link.ts) so the route file's exports stay
// `Route` + one component (mixing in a non-component function export too
// trips react-refresh/only-export-components).
import { DemoWaitingLink } from '../songs.$songId.results.$jobId';
import { resolveDemoWaitingLink } from '../results-waiting-link';

afterEach(cleanup);

describe('resolveDemoWaitingLink', () => {
  const demoSong = { id: 'song-demo', name: 'Demo: Neon Skyline', latestResult: { jobId: 'job-demo' } };
  const realSong = { id: 'song-real', name: 'My Real Track', latestResult: { jobId: 'job-real' } };

  it('guest + a Demo: song with a latestResult, still analyzing → links to that report', () => {
    expect(
      resolveDemoWaitingLink({ isGuest: true, stage: 'in_progress', librarySongs: [realSong, demoSong] }),
    ).toEqual({ songId: 'song-demo', jobId: 'job-demo' });
  });

  it('real user → no link even with a matching demo song present', () => {
    expect(
      resolveDemoWaitingLink({ isGuest: false, stage: 'in_progress', librarySongs: [demoSong] }),
    ).toBeNull();
  });

  it('guest with no demo song in the library → no link', () => {
    expect(
      resolveDemoWaitingLink({ isGuest: true, stage: 'in_progress', librarySongs: [realSong] }),
    ).toBeNull();
  });

  it('guest with a demo song that has no latestResult yet → no link', () => {
    const unfinishedDemo = { id: 'song-demo2', name: 'Demo: Unfinished', latestResult: null };
    expect(
      resolveDemoWaitingLink({ isGuest: true, stage: 'in_progress', librarySongs: [unfinishedDemo] }),
    ).toBeNull();
  });

  it('guest with librarySongs still undefined (query not yet loaded) → no link', () => {
    expect(
      resolveDemoWaitingLink({ isGuest: true, stage: 'in_progress', librarySongs: undefined }),
    ).toBeNull();
  });

  it.each(['complete', 'failed', 'awaiting_stem_mapping'] as const)(
    'completed/terminal analysis (stage=%s) → no link even for a guest with a ready demo report',
    (stage) => {
      expect(
        resolveDemoWaitingLink({ isGuest: true, stage, librarySongs: [demoSong] }),
      ).toBeNull();
    },
  );
});

describe('DemoWaitingLink render', () => {
  function renderLink(link: { songId: string; jobId: string } | null) {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <DemoWaitingLink link={link} />,
    });
    const resultsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/songs/$songId/results/$jobId',
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, resultsRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-local tree, not the app Register tree
    return render(<RouterProvider router={router as any} />);
  }

  it('renders nothing when there is no link', () => {
    renderLink(null);
    expect(screen.queryByText(/Explore a finished report/)).toBeNull();
  });

  it('renders a link to the demo report when one resolves', async () => {
    renderLink({ songId: 'song-demo', jobId: 'job-demo' });
    const link = await screen.findByText(/Explore a finished report while yours is analyzing/);
    expect(link.closest('a')?.getAttribute('href')).toBe('/songs/song-demo/results/job-demo');
  });
});
