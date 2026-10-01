import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';

import type { AuthedUser } from '../api/types';
import { GuestBanner } from '../features/demo/GuestBanner';

export interface RouterAuthState {
  user: AuthedUser | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface RouterContext {
  queryClient: QueryClient;
  auth: RouterAuthState;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  // Owner ruling 2026-10-01: a guest sees the guest banner on EVERY page —
  // public pages (landing, pricing, /analyze, /trust/*), the auth column, the
  // not-found/error screens and the authed shell alike. Mounted here, once,
  // above every layout; renders nothing for a real user or signed-out
  // visitor. (The upgrade dialog is NOT here: `_app` and `/analyze` each
  // mount their own GuestUpgradeHost.)
  return (
    <>
      <GuestBanner />
      <Outlet />
    </>
  );
}
