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
import { flushSync } from 'react-dom';

import { useQueryClient } from '@tanstack/react-query';

import {
  bumpSessionGeneration,
  fetcher,
  getSessionGeneration,
  onAuthCleared,
  onTokenRefreshed,
  refreshSession,
  setAccessToken,
} from '../api/fetcher';
import { resetVerifyResendState } from '../components/verify-email';
import { identifyUser } from '../lib/analytics';
import type {
  AuthResponse,
  AuthedUser,
  DemoStartResponse,
  GuestConvertResponse,
} from '../api/types';

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
  /** G2/G5 — a guest upgrades the SAME account in place (POST
   *  /auth/guest/convert). Sits next to `register`; `register.tsx` calls
   *  this instead of `register` when `user?.isGuest`. Two response shapes —
   *  see GuestConvertResponse. */
  convertGuest: (email: string, password: string) => Promise<GuestConvertResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  updateUser: (user: AuthedUser) => void;
  /** D9 — one-click guest sandbox: POST /auth/demo, apply the returned
   *  session, return the full response so the caller can route off `demo`
   *  and `resumed`. */
  startDemo: () => Promise<DemoStartResponse>;
}

// Exported for tests only (PublicChrome authed-variant pin) — app code goes
// through AuthProvider/useAuth/useOptionalAuth.
export const AuthContext = createContext<AuthContextValue | null>(null);

// Story 12.7 (found by the first-run smoke): refresh is single-flight and
// lives in fetcher.refreshSession — shared with the 401 handler so the two
// mechanisms can never race token rotation against each other.
//
// Session generation: logout/startDemo/login/devLogin/register all bump
// fetcher.ts's shared sessionGeneration counter (see fetcher.ts) so a
// refresh that was already in flight when the session changed can never
// re-apply its stale result — neither the `user` object here NOR the
// module-level token in fetcher.ts (D9 fix round 1, item 1: the token
// assignment itself is gated inside refreshSession, not just this
// component's use of its result; D9 fix round 2, item 2: login/devLogin/
// register were the gap — they didn't bump before).

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });
  const mountedRef = useRef(true);

  // Cache isolation (D9): a different user (including a guest) must never
  // see the previous user's cached queries. A never-stale query left over
  // from a signed-in session is exactly the bug class this project has hit
  // twice before (bdc9596 / 915732d) — clear on every user-id change, not
  // just logout, so a guest→real-user or guest→guest handoff is covered too.
  const queryClient = useQueryClient();
  // D9 fix round 1 (item 2): `undefined` means "not observed yet" — distinct
  // from `null` ("signed out"/never signed in). Using `null` as the initial
  // sentinel made the FIRST sign-in of any browsing session (anon `null` →
  // a real id, including the very first guest) never clear, because
  // `prevUserId.current !== null` was false before any transition had
  // happened. Now every id change after the first observation clears,
  // including `null → id` and `id → null`.
  const prevUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = state.user?.id ?? null;
    if (prevUserId.current !== undefined && prevUserId.current !== id) queryClient.clear();
    prevUserId.current = id;
  }, [state.user?.id, queryClient]);

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
    const epoch = getSessionGeneration();
    try {
      const data = await refreshSession();
      // Logout/startDemo/login happened while this refresh was in flight —
      // do not resurrect the stale session.
      if (epoch !== getSessionGeneration()) return false;
      applyAuth(data);
      return data !== null;
    } catch {
      if (epoch === getSessionGeneration()) applyAuth(null);
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
      // D9 fix round 2 (item 2): supersede any still-in-flight refresh (the
      // boot silent-refresh, most commonly) BEFORE it can resolve for the
      // previous cookie's user and applyAuth over this fresh sign-in. Same
      // pattern as startDemo/logout below.
      bumpSessionGeneration();
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
      bumpSessionGeneration();
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
      bumpSessionGeneration();
      const auth = await fetcher<AuthResponse>({
        url: '/auth/register',
        method: 'POST',
        data: { email, password },
      });
      applyAuth(auth);
    },
    [applyAuth],
  );

  // G2/G5 — a guest's "create an account" IS this same account, upgraded in
  // place (same user id — songs, analyses, coach conversation untouched).
  // Bumps the generation first, exactly like login/register/startDemo, so a
  // boot refresh still in flight for the OLD guest cookie can't resolve on
  // top of the conversion.
  const convertGuest = useCallback(
    async (email: string, password: string): Promise<GuestConvertResponse> => {
      bumpSessionGeneration();
      const res = await fetcher<GuestConvertResponse>({
        url: '/auth/guest/convert',
        method: 'POST',
        data: { email, password },
      });
      if ('sessionIssued' in res) {
        // The DB write already committed — the account IS real now — but no
        // session came back. The guest's in-memory token is dead either way
        // (the server evicted its token-version cache entry), so clear it;
        // the caller (register.tsx) routes to /login on this branch, where a
        // normal sign-in re-derives everything. Deliberately NOT the same as
        // logout(): no /auth/logout call, since there is no live session to
        // end server-side.
        applyAuth(null);
        return res;
      }
      // Same user id as the guest that called this — the prevUserId effect
      // above sees no id change, so the guest's already-loaded query cache
      // (their songs, the analysis in progress) survives untouched.
      applyAuth(res);
      return res;
    },
    [applyAuth],
  );

  // D9 — one-click guest sandbox. A boot refresh may still be in flight on a
  // cold /demo load. Bumping the session generation makes its late result a
  // no-op (see refresh() above, and fetcher.ts's own gate on the token
  // assignment) instead of overwriting — or, when it resolves null, wiping —
  // the guest session applied below.
  const startDemo = useCallback(async () => {
    bumpSessionGeneration();
    try {
      const res = await fetcher<DemoStartResponse>({ url: '/auth/demo', method: 'POST' });
      // D9 fix round 1 (item 3a): clear synchronously, inside this function,
      // BEFORE the launcher can navigate — the passive prevUserId effect
      // above is the safety net for login/logout, not the primary mechanism
      // for a flow whose caller acts on the return value immediately.
      queryClient.clear();
      // flushSync: guarantees every context.auth consumer (notably
      // main.tsx's RouterBridge, which feeds the LIVE TanStack Router
      // context) has already re-rendered with the guest by the time this
      // promise resolves. Without it, React's default scheduling can defer
      // the commit past the launcher's immediately-following
      // router.invalidate() call, which would then re-run `_app`'s
      // beforeLoad against a still-stale `context.auth.user === null` and
      // bounce the guest to /login. Scoped to startDemo only — login/logout
      // /refresh keep their existing (batched) behaviour.
      flushSync(() => {
        applyAuth({ accessToken: res.accessToken, user: res.user });
      });
      return res;
    } catch (err) {
      // D9 fix round 1 (item 3b): the generation bump above discarded
      // whatever refresh was already in flight. The demo failed to start,
      // so recover the cookie's real session (if any) rather than stranding
      // a signed-in visitor logged out. The error still propagates.
      void refresh();
      throw err;
    }
  }, [applyAuth, refresh, queryClient]);

  const logout = useCallback(async () => {
    // Invalidate any in-flight refresh FIRST so its result can't re-apply
    // a session after the user chose to leave.
    bumpSessionGeneration();
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
    () => ({
      ...state,
      login,
      devLogin,
      register,
      convertGuest,
      logout,
      refresh,
      updateUser,
      startDemo,
    }),
    [state, login, devLogin, register, convertGuest, logout, refresh, updateUser, startDemo],
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
