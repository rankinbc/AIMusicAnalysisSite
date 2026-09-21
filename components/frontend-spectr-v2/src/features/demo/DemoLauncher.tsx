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
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (isLoading || startedRef.current) return;
    startedRef.current = true;

    if (user && !user.isGuest) {
      void navigate({ to: '/library', replace: true });
      return;
    }

    const run = async () => {
      try {
        const res = await withTimeout(startDemo(), START_TIMEOUT_MS);
        await router.invalidate();
        const dest = demoDestination(res.demo, window.innerWidth);
        await navigate({ ...dest, replace: true });
        capture('demo_started', {
          resumed: res.resumed,
          surface: dest.to === '/listen-rack/$versionId' ? 'listen' : 'report',
        });
      } catch (err) {
        setFailed(true);
        const code =
          err instanceof DemoTimeoutError
            ? 'timeout'
            : err instanceof ApiError
              ? extractApiError(err.body).code ?? 'unknown'
              : 'unknown';
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
          The demo is taking a break — analyze your own track instead.
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
