import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { Toaster } from 'sonner';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { routeTree } from './routeTree.gen';
import './styles/tokens.css';
import './styles/global.css';

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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterBridge />
      </AuthProvider>
      <Toaster theme="dark" position="top-right" />
    </QueryClientProvider>
  </StrictMode>,
);
