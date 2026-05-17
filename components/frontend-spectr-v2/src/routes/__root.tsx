import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';

import type { AuthedUser } from '../api/types';

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
  return <Outlet />;
}
