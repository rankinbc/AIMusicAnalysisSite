import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { Toaster } from 'sonner';

import { createMutationCache } from './api/mutation-error-toast';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppCrashFallback } from './components/AppCrashFallback';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { NotFoundScreen } from './components/NotFoundScreen';
import { RouteErrorScreen } from './components/RouteErrorScreen';
import { initAnalytics } from './lib/analytics';
import { installChunkReloadListener } from './lib/chunk-reload';
import { initSentry } from './lib/sentry';
import { routeTree } from './routeTree.gen';
import './styles/tokens.css';
import './styles/global.css';

// Story 10.3 — both no-op without their VITE_* env keys. Wrapped: an SDK
// init failure (blocked storage, adblock) must never prevent app mount.
try {
  initSentry();
  initAnalytics();
  // D10 — a deploy while a tab is open turns the next lazy navigation into a
  // failed dynamic import; this reloads once per five minutes instead of
  // showing the user a broken page.
  installChunkReloadListener();
} catch {
  // observability is optional; the app is not
}

const queryClient = new QueryClient({
  // Wave-3: global mutation error handler — toasts ONLY for mutations that
  // opt in via `meta.errorToast` (see api/mutation-error-toast.ts).
  mutationCache: createMutationCache(),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { errorToast?: string };
  }
}

const router = createRouter({
  routeTree,
  context: {
    queryClient,
    // Placeholder — the live value is supplied by <RouterProvider context=...>
    // below. beforeLoad guards on _app read the supplied value, not this one.
    auth: { user: null, accessToken: null, isLoading: true },
  },
  defaultPreload: 'intent',
  defaultNotFoundComponent: NotFoundScreen,
  defaultErrorComponent: RouteErrorScreen,
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
        (when configured) and shows a recoverable shell, never a white page.
        P7 — a local class boundary; Sentry is a lazy import and can no
        longer supply its own ErrorBoundary component at this outer layer. */}
    <AppErrorBoundary fallback={<AppCrashFallback />}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterBridge />
        </AuthProvider>
        <Toaster theme="dark" position="top-right" />
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
