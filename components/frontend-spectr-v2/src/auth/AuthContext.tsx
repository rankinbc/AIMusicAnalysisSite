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

import { fetcher, onAuthCleared, onTokenRefreshed, setAccessToken } from '../api/fetcher';
import type { AuthResponse, AuthedUser } from '../api/types';

interface AuthState {
  user: AuthedUser | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  updateUser: (user: AuthedUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
      setState({ user: null, accessToken: null, isLoading: false });
    }
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        applyAuth(null);
        return false;
      }
      const data = (await res.json()) as AuthResponse;
      applyAuth(data);
      return true;
    } catch {
      applyAuth(null);
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
    () => ({ ...state, login, register, logout, refresh, updateUser }),
    [state, login, register, logout, refresh, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
