// @vitest-environment jsdom
/* Wave-3 E6.1 — a 404'd /listen-rack/{id} renders the honest not-found shell
 * (Library link), never the "Neon Skyline" demo fixture; other failures get a
 * Retry. The shell contains a TanStack <Link>, so it renders inside a minimal
 * memory router. */
import {
  createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/fetcher';
import { VersionErrorShell } from '../_app/listen-rack.$versionId';

afterEach(cleanup);

function renderShell(error: unknown, onRetry: () => void) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <VersionErrorShell error={error} onRetry={onRetry} />,
  });
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, libraryRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-local tree, not the app Register tree
  return render(<RouterProvider router={router as any} />);
}

describe('VersionErrorShell (E6.1)', () => {
  it('404 → honest not-found copy + Library link, no demo fixture', async () => {
    renderShell(new ApiError(404, undefined), () => {});
    expect(await screen.findByText(/version doesn.t exist or was deleted/i)).toBeTruthy();
    const link = await screen.findByText('Go to Library');
    expect(link.getAttribute('href')).toBe('/library');
    expect(screen.queryByText(/Neon Skyline/)).toBeNull();
    expect(screen.queryByTestId('listen-rack-page')).toBeNull();
  });

  it('non-404 failure → generic copy + working Retry', async () => {
    const retry = vi.fn();
    renderShell(new ApiError(500, undefined), retry);
    expect(await screen.findByText(/couldn.t load this version/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
