import { createFileRoute, redirect } from '@tanstack/react-router';

import { LandingPage } from '../features/landing/LandingPage';

// Story 6.1 — `/` is the public landing page for anonymous visitors; authed
// users keep the old habit and land on /library. Anon-optimistic: while the
// silent-refresh boot is in flight (auth.isLoading) we RENDER THE LANDING
// rather than flash /login — main.tsx invalidates the router when auth
// resolves, so this beforeLoad re-runs and a logged-in user bounces to
// /library a beat later.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.auth.isLoading && context.auth.user) {
      throw redirect({ to: '/library' });
    }
  },
  component: LandingPage,
});
