// D9 — the /demo entry point. Waits for the boot silent-refresh to settle
// (or it would race startDemo — see AuthContext.tsx's sessionEpoch), then:
// a signed-in real user is sent to their library; anyone else (no session,
// or an existing guest revisiting /demo) gets a fresh-or-resumed guest
// sandbox and is routed by viewport width. A failed start never says why —
// solo-principle copy rule: no "busy" / "too many visitors" wording.
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
import { useAuth } from '../../auth/AuthContext';
import { capture } from '../../lib/analytics';
import { demoDestination } from './demoDestination';
import s from './demo.module.css';

// D9 fix round 1 (item 4a): startDemo()'s own signature is locked (no
// signal parameter), so a stalled POST is bounded from the caller side via
// a race rather than AbortSignal.timeout. A distinct error type lets the
// catch below report `code: 'timeout'` instead of 'unknown'.
const START_TIMEOUT_MS = 15_000;
class DemoTimeoutError extends Error {}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DemoTimeoutError('demo start timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function DemoLauncher() {
  const { isLoading, user, startDemo } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [failCode, setFailCode] = useState<string>('unknown');
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Item 3 (fix round 2): the 15s bound races the UI, not the real request —
  // startDemo() itself keeps running after we've shown the failure card.
  // `timedOut` records that a late success needs the normal navigate path
  // instead of being silently dropped (the guest session it applied would
  // otherwise sit behind a card telling the visitor the demo is unavailable).
  const timedOutRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isLoading || startedRef.current) return;
    startedRef.current = true;

    if (user && !user.isGuest) {
      void navigate({ to: '/library', replace: true });
      return;
    }

    const run = async () => {
      const demoPromise = startDemo();
      try {
        const res = await withTimeout(demoPromise, START_TIMEOUT_MS);
        await router.invalidate();
        const dest = demoDestination(res.demo);
        await navigate({ ...dest, replace: true });
        capture('demo_started', {
          resumed: res.resumed,
          surface: 'report',
        });
      } catch (err) {
        if (err instanceof DemoTimeoutError) {
          timedOutRef.current = true;
          // The real request is still in flight — if it eventually succeeds,
          // route it exactly like the normal path instead of leaving the
          // already-applied guest session stranded behind the failure card.
          void demoPromise
            .then(async (res) => {
              if (!timedOutRef.current || !mountedRef.current) return;
              await router.invalidate();
              const dest = demoDestination(res.demo);
              await navigate({ ...dest, replace: true });
              capture('demo_started', {
                resumed: res.resumed,
                surface: 'report',
                late: true,
              });
            })
            .catch(() => {
              // The demo genuinely failed after already timing out — the
              // failure card is already showing; nothing further to do.
            });
        }
        setFailed(true);
        const code =
          err instanceof DemoTimeoutError
            ? 'timeout'
            : err instanceof ApiError
              ? extractApiError(err.body).code ?? 'unknown'
              : 'unknown';
        setFailCode(code);
        capture('demo_start_failed', { code });
      }
    };
    void run();
  }, [isLoading, user, startDemo, navigate, router]);

  // Item 4b: the failure card is an alert (assertive live region) whose
  // heading takes focus the moment it replaces the progress line, so a
  // screen-reader user isn't left focused on content that just vanished.
  useEffect(() => {
    if (failed) headingRef.current?.focus();
  }, [failed]);

  if (failed) {
    return (
      <section className={`card ${s.card}`} role="alert">
        <span className="label">Demo</span>
        <h2 ref={headingRef} tabIndex={-1} className={s.line}>
          {failCode === 'rate_limited'
            ? 'You’ve opened the demo several times this hour — give it a few minutes, or analyze your own track.'
            : 'The demo is taking a break — analyze your own track instead.'}
        </h2>
        <div className={s.actions}>
          <a href="/analyze" className="btn primary">
            Analyze your own track
          </a>
          <a href="/" className="btn ghost">
            Back home
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className={`card ${s.card}`}>
      <span className="label">Demo</span>
      <p className={s.line} role="status">
        Setting up your demo…
      </p>
    </section>
  );
}
