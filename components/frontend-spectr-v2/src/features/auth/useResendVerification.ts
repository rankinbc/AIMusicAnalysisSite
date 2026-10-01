// Verify-before-sign-in (2026-10) — the anonymous "Resend verification email"
// action shared by the register "Check your inbox" screen, the login page's
// email_unverified state, and the verify page's failure state.
//
// POST /auth/verify-email/resend always answers the same 202 whether or not
// the address has a pending account (no enumeration), so the UI can only ever
// say "if there's a pending account, a new link is on its way". The cooldown
// is a client courtesy on top of the server's per-address limit (3 / 15 min):
// it stops button mashing from burning that budget silently.
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetcher } from '../../api/fetcher';

export const RESEND_COOLDOWN_SECONDS = 30;

export interface ResendState {
  pending: boolean;
  /** Seconds until another send is allowed; 0 = ready. */
  cooldown: number;
  /** A resend from THIS screen went through at least once. */
  sent: boolean;
  error: string | null;
}

export function useResendVerification(opts?: { startCoolingDown?: boolean }) {
  const [state, setState] = useState<ResendState>({
    pending: false,
    cooldown: opts?.startCoolingDown ? RESEND_COOLDOWN_SECONDS : 0,
    sent: false,
    error: null,
  });
  // Ref mirror so a double click inside one render can't fire twice.
  const busy = useRef(false);

  useEffect(() => {
    if (state.cooldown <= 0) return;
    const t = window.setTimeout(
      () => setState((s) => ({ ...s, cooldown: Math.max(0, s.cooldown - 1) })),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [state.cooldown]);

  const send = useCallback(
    async (email: string): Promise<boolean> => {
      const address = email.trim();
      if (busy.current || state.cooldown > 0 || !address) return false;
      busy.current = true;
      setState((s) => ({ ...s, pending: true, error: null }));
      try {
        await fetcher<void>({
          url: '/auth/verify-email/resend',
          method: 'POST',
          data: { email: address },
        });
        setState({ pending: false, cooldown: RESEND_COOLDOWN_SECONDS, sent: true, error: null });
        return true;
      } catch (err) {
        setState((s) => ({
          ...s,
          pending: false,
          error: err instanceof Error ? err.message : 'Could not send the email — try again.',
        }));
        return false;
      } finally {
        busy.current = false;
      }
    },
    [state.cooldown],
  );

  return { ...state, send };
}
