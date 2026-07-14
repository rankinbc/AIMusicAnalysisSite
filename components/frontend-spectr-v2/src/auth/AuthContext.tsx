import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  fetcher,
  onAuthCleared,
  onTokenRefreshed,
  refreshSession,
  setAccessToken,
} from '../api/fetcher';
import { resetVerifyResendState } from '../components/verify-email';
import { identifyUser } from '../lib/analytics';
import type { AuthResponse, AuthedUser } from '../api/types';

interface AuthState {
  user: AuthedUser | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  /** Development-only one-click sign-in (no password). Defaults to the dev account. */
  devLogin: (email?: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  updateUser: (user: AuthedUser) => void;
}

// Exported for tests only (PublicChrome authed-variant pin) — app code goes
// through AuthProvider/useAuth/useOptionalAuth.
export const AuthContext = createContext<AuthContextValue | null>(null);

// Story 12.7 (found by the first-run smoke): refresh is single-flight and
// lives in fetcher.refreshSession — shared with the 401 handler so the two
// mechanisms can never race token rotation against each other.
//
// Session epoch: logout bumps this so a refresh that was already in flight
// when the user logged out can never re-apply its (stale) session onto the
// logged-out UI.
let sessionEpoch = 0;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });
  const mountedRef = useRef(true);

  const applyAuth = useCallback((auth: AuthResponse | null) => {
    if (auth) {
      setAccessToken(auth.accessToken);
      setState({ user: auth.user, accessToken: auth.accessToken, isLoading: false });
    } else {
      setAccessToken(null);
      // Session ended (logout / refresh-clear): drop the verify-email resend
      // debounce so the next user on this tab isn't blocked by the prior
      // account's cooldown/in-flight state.
      resetVerifyResendState();
      setState({ user: null, accessToken: null, isLoading: false });
    }
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    const epoch = sessionEpoch;
    try {
      const data = await refreshSession();
      // Logout happened while this refresh was in flight — do not resurrect
      // the stale session.
      if (epoch !== sessionEpoch) return false;
      applyAuth(data);
      return data !== null;
    } catch {
      if (epoch === sessionEpoch) applyAuth(null);
      return false;
    }
  }, [applyAuth]);

  // Silent refresh on mount.
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Story 10.3 — PostHog identity follows the auth state (no-op without a
  // key): events join to the user id; logout resets the device identity so
  // shared machines don't bleed.
  useEffect(() => {
    if (!state.isLoading) identifyUser(state.user?.id ?? null);
  }, [state.user?.id, state.isLoading]);

  // Listen to fetcher events — tokens refreshed by the 401 handler, or
  // refresh-failed events that should clear our state.
  useEffect(() => {
    onTokenRefreshed((token) => {
      setState((s) => ({ ...s, accessToken: token }));
    });
    onAuthCleared(() => {
      setState({ user: null, accessToken: null, isLoading: false });
    });
    return () => {
      onTokenRefreshed(null);
      onAuthCleared(null);
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const auth = await fetcher<AuthResponse>({
        url: '/auth/login',
        method: 'POST',
        data: { email, password },
      });
      applyAuth(auth);
    },
    [applyAuth],
  );

  const devLogin = useCallback(
    async (email?: string) => {
      const auth = await fetcher<AuthResponse>({
        url: '/auth/dev-login',
        method: 'POST',
        data: { email },
      });
      applyAuth(auth);
    },
    [applyAuth],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const auth = await fetcher<AuthResponse>({
        url: '/auth/register',
        method: 'POST',
        data: { email, password },
      });
      applyAuth(auth);
    },
    [applyAuth],
  );

  const logout = useCallback(async () => {
    // Invalidate any in-flight refresh FIRST so its result can't re-apply
    // a session after the user chose to leave.
    sessionEpoch++;
    try {
      await fetcher<void>({ url: '/auth/logout', method: 'POST' });
    } finally {
      applyAuth(null);
    }
  }, [applyAuth]);

  const updateUser = useCallback((user: AuthedUser) => {
    setState((prev) => ({ ...prev, user }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, devLogin, register, logout, refresh, updateUser }),
    [state, login, devLogin, register, logout, refresh, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Story 6.1 — non-throwing variant for components that render both inside the
 *  app (provider present) and in static-render tests (no provider). Returns
 *  null outside an AuthProvider instead of throwing. */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
