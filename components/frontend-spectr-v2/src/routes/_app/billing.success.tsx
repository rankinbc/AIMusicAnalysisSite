import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { getAccessToken } from '../../api/fetcher';
import type { AuthedUser } from '../../api/types';
import s from './billing.module.css';

// Story 2.1 / AC5 — landing page after Stripe Checkout. Polls
// GET /api/auth/me every 5s for up to 60s waiting for tier === "pro";
// the webhook delivery is normally <2s but Stripe doesn't make that
// guarantee. After 60s without a flip we tell the user it's still
// processing rather than misrepresenting the state.

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 60_000;

export const Route = createFileRoute('/_app/billing/success')({
  component: BillingSuccessPage,
});

function BillingSuccessPage() {
  const [state, setState] = useState<'waiting' | 'pro' | 'timeout'>('waiting');

  useEffect(() => {
    let elapsed = 0;
    let cancelled = false;
    const token = getAccessToken();
    if (!token) {
      setState('timeout');
      return () => {};
    }

    const pollOnce = async (): Promise<boolean> => {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return false;
        const me = (await res.json()) as AuthedUser;
        if (me.tier === 'pro') {
          if (!cancelled) setState('pro');
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };

    const tick = async () => {
      if (cancelled) return;
      const ok = await pollOnce();
      if (ok) return;
      elapsed += POLL_INTERVAL_MS;
      if (elapsed >= MAX_POLL_DURATION_MS) {
        if (!cancelled) setState('timeout');
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };

    // Fire the first poll immediately so a fast webhook doesn't waste 5s.
    void tick();
    return () => {
      cancelled = true;
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
