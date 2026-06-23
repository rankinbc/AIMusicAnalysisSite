import { Link, createFileRoute } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError, fetcher } from '../../api/fetcher';
import type { AuthedUser } from '../../api/types';
import s from './billing.module.css';

// Story 2.1 / AC5 — landing page after Stripe Checkout. Polls
// GET /api/auth/me every 5s for up to 60s waiting for tier === "pro";
// the webhook delivery is normally <2s but Stripe doesn't make that
// guarantee. After 60s without a flip we tell the user it's still
// processing rather than misrepresenting the state.
//
// review-fix P6 — go through `fetcher<T>` (CLAUDE.md "single fetch
// wrapper with 401 → silent refresh + retry") instead of a raw fetch.
// Without this, an access token expiring during the 60-s window leaks
// 401s into the poll path and the page misleadingly shows "still
// processing" even after the webhook lands.
//
// review-fix P15 — store the setTimeout handle so unmount actually
// cancels the next tick (the prior cancel flag only guarded setState).

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 60_000;

export const Route = createFileRoute('/_app/billing/success')({
  component: BillingSuccessPage,
});

function BillingSuccessPage() {
  const [state, setState] = useState<'waiting' | 'pro' | 'timeout'>('waiting');
  const qc = useQueryClient();

  // Story 2.8 / AC3 — a credit-pack purchase lands here too (shared SuccessUrl).
  // Invalidate the credits balance/ledger + entitlements + honest-math so the
  // new balance shows inline when the user navigates back to /usage (the
  // 30s-staleTime credits query would otherwise serve a stale balance).
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['billing', 'credits'] });
    void qc.invalidateQueries({ queryKey: ['me', 'entitlements'] });
    void qc.invalidateQueries({ queryKey: ['me', 'honest-math'] });
  }, [qc]);

  useEffect(() => {
    let elapsed = 0;
    let cancelled = false;
    let timerHandle: number | null = null;

    const pollOnce = async (): Promise<boolean> => {
      try {
        const me = await fetcher<AuthedUser>({
          url: '/auth/me',
          method: 'GET',
        });
        if (me.tier === 'pro') {
          if (!cancelled) setState('pro');
          return true;
        }
        return false;
      } catch (err) {
        // Swallow non-auth errors (network blips); the loop will retry.
        // ApiError 401 means refresh failed AND the user really is signed
        // out — bail out with timeout state.
        if (err instanceof ApiError && err.status === 401) {
          if (!cancelled) setState('timeout');
          return true;  // halt the loop
        }
        return false;
      }
    };

    const tick = async () => {
      if (cancelled) return;
      const halt = await pollOnce();
      if (halt || cancelled) return;
      elapsed += POLL_INTERVAL_MS;
      if (elapsed >= MAX_POLL_DURATION_MS) {
        if (!cancelled) setState('timeout');
        return;
      }
      timerHandle = window.setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timerHandle !== null) {
        window.clearTimeout(timerHandle);
        timerHandle = null;
      }
    };
  }, []);

  return (
    <main className={s.shell}>
      <section className={`card ${s.card}`}>
        {state === 'waiting' && (
          <>
            <span className="label">Finishing up…</span>
            <h1 className={s.title}>Confirming your subscription</h1>
            <p className={s.body}>
              We&rsquo;re waiting for Stripe to confirm. This usually takes a
              couple of seconds.
            </p>
          </>
        )}
        {state === 'pro' && (
          <>
            <span className="label">Welcome to Pro</span>
            <h1 className={s.title}>You&rsquo;re on Pro. Welcome.</h1>
            <p className={s.body}>
              Unlimited analyses, full coach, every specialist.
            </p>
            <div className={s.actions}>
              <Link to="/library" className="btn primary">
                Go to your library
              </Link>
            </div>
          </>
        )}
        {state === 'timeout' && (
          <>
            <span className="label">Still processing</span>
            <h1 className={s.title}>Your subscription is still being processed.</h1>
            <p className={s.body}>
              Refresh in a moment. If this persists, contact support — we never
              charge twice.
            </p>
            <div className={s.actions}>
              <Link to="/library" className="btn ghost">
                Back to library
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
