// @vitest-environment jsdom
/* Owner ruling 2026-10-01 — "Have this banner on all pages if someone is a
 * guest." The banner is mounted ONCE in the root route; the authed `_app`
 * layout no longer mounts its own. This renders the REAL root + `_app`
 * components inside a small memory router (a public sibling route and an
 * `_app` child route) and checks: a guest sees exactly one banner on both,
 * and a registered user / signed-out visitor sees none. `_app`'s heavier
 * children (palette, upload dialog, account menu, notices) are stubbed —
 * they are not what's under test. */
import {
  createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockAuthState {
  user: { id: string; email: string; isGuest?: boolean } | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}
let auth: MockAuthState;

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});
vi.mock('../../api/hooks', () => ({ useEntitlements: () => ({ data: undefined }) }));
vi.mock('../../components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../components/ShortcutSheet', () => ({ ShortcutSheet: () => null }));
vi.mock('../../components/UnifiedUploadDialog', () => ({ UnifiedUploadDialog: () => null }));
vi.mock('../../components/VerifyEmailBanner', () => ({ VerifyEmailBanner: () => null }));
vi.mock('../../features/account/AccountMenu', () => ({ AccountMenu: () => null }));
vi.mock('../../features/billing/AppDunningNotice', () => ({ AppDunningNotice: () => null }));
vi.mock('../../features/billing/CreditBalanceChip', () => ({ CreditBalanceChip: () => null }));
vi.mock('../../features/billing/BuyCreditsProvider', () => ({
  BuyCreditsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../features/health/AppWorkerHealthNotice', () => ({ AppWorkerHealthNotice: () => null }));
vi.mock('../../features/health/DevHealthDot', () => ({ DevHealthDot: () => null }));

import { fetcher } from '../../api/fetcher';
import { Route as RootRoute } from '../__root';
import { Route as AppRoute } from '../_app';

const RootComponent = RootRoute.options.component!;
const AppLayout = AppRoute.options.component!;

function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: RootComponent });
  const pricingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/pricing',
    component: () => <p>pricing page</p>,
  });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_app',
    component: AppLayout,
  });
  const libraryRoute = createRoute({
    getParentRoute: () => appRoute,
    path: '/library',
    component: () => <p>library page</p>,
  });
  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/register',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      pricingRoute,
      appRoute.addChildren([libraryRoute]),
      registerRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-local tree, not the app Register tree */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}

const logout = () => Promise.resolve();

beforeEach(() => {
  vi.mocked(fetcher).mockReset();
  // GET /me/guest stays pending — the banner doesn't need the quota numbers.
  vi.mocked(fetcher).mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--guest-banner-h');
});

describe('guest banner — root route, every page', () => {
  it('a guest sees it exactly once on a public route', async () => {
    auth = { user: { id: 'g', email: 'g@x', isGuest: true }, isLoading: false, logout };
    renderAt('/pricing');
    expect(await screen.findByText('pricing page')).toBeTruthy();
    expect(screen.getAllByTestId('guest-banner')).toHaveLength(1);
    expect(screen.getAllByText(/as a guest/i)).toHaveLength(1);
    const link = screen.getByRole('link', { name: /create a free account/i });
    expect(link.getAttribute('href')).toBe('/register?from=guest');
  });

  it('a guest sees it exactly once on an _app route (the shell no longer mounts its own)', async () => {
    auth = { user: { id: 'g', email: 'g@x', isGuest: true }, isLoading: false, logout };
    renderAt('/library');
    expect(await screen.findByText('library page')).toBeTruthy();
    expect(screen.getAllByTestId('guest-banner')).toHaveLength(1);
    // Banner sits above the app shell's top bar, not inside <main>.
    const banner = screen.getByTestId('guest-banner');
    expect(banner.closest('main')).toBeNull();
    expect(banner.closest('header')).toBeNull();
  });

  it('publishes its on-screen height for full-viewport overlays, and clears it on unmount', async () => {
    auth = { user: { id: 'g', email: 'g@x', isGuest: true }, isLoading: false, logout };
    const { unmount } = renderAt('/pricing');
    await screen.findByText('pricing page');
    expect(document.documentElement.style.getPropertyValue('--guest-banner-h')).toMatch(/^\d+px$/);
    unmount();
    expect(document.documentElement.style.getPropertyValue('--guest-banner-h')).toBe('');
  });

  it.each(['/pricing', '/library'])('never renders for a registered user (%s)', async (path) => {
    auth = { user: { id: 'u', email: 'u@x', isGuest: false }, isLoading: false, logout };
    renderAt(path);
    expect(await screen.findByText(/page$/)).toBeTruthy();
    expect(screen.queryByTestId('guest-banner')).toBeNull();
    expect(screen.queryByText(/as a guest/i)).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--guest-banner-h')).toBe('');
  });

  it('never renders for a signed-out visitor', async () => {
    auth = { user: null, isLoading: false, logout };
    renderAt('/pricing');
    expect(await screen.findByText('pricing page')).toBeTruthy();
    expect(screen.queryByTestId('guest-banner')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
