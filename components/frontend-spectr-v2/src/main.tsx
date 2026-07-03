import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { Toaster } from 'sonner';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { initAnalytics } from './lib/analytics';
import { Sentry, initSentry } from './lib/sentry';
import { routeTree } from './routeTree.gen';
import './styles/tokens.css';
import './styles/global.css';

// Story 10.3 — both no-op without their VITE_* env keys. Wrapped: an SDK
// init failure (blocked storage, adblock) must never prevent app mount.
try {
  initSentry();
  initAnalytics();
} catch {
  // observability is optional; the app is not
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  context: {
    queryClient,
    // Placeholder — the live value is supplied by <RouterProvider context=...>
    // below. beforeLoad guards on _app read the supplied value, not this one.
    auth: { user: null, accessToken: null, isLoading: true },
  },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Forwards AuthContext into router context. When auth resolves, invalidates
// the router so any cached matches re-run their beforeLoad guards with the
// new state (without this, the first paint's match cache holds isLoading=true
// forever and clicks inside _app bounce to /login).
function RouterBridge() {
  const auth = useAuth();
  useEffect(() => {
    void router.invalidate();
  }, [auth.user, auth.isLoading]);
  return <RouterProvider router={router} context={{ queryClient, auth }} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Story 10.3 — root error boundary: a render crash reports to Sentry
        (when configured) and shows a recoverable shell, never a white page. */}
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: '4rem', textAlign: 'center', color: '#e6e8ef' }}>
          <h1>Something broke.</h1>
          <p>The error has been reported. Reload to continue.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      }
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterBridge />
        </AuthProvider>
        <Toaster theme="dark" position="top-right" />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
