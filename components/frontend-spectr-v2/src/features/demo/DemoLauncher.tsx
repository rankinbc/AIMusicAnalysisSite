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

export function DemoLauncher() {
  const { isLoading, user, startDemo } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isLoading || startedRef.current) return;
    startedRef.current = true;

    if (user && !user.isGuest) {
      void navigate({ to: '/library', replace: true });
      return;
    }

    const run = async () => {
      try {
        const res = await startDemo();
        await router.invalidate();
        const dest = demoDestination(res.demo, window.innerWidth);
        await navigate({ ...dest, replace: true });
        capture('demo_started', {
          resumed: res.resumed,
          surface: dest.to === '/listen-rack/$versionId' ? 'listen' : 'report',
        });
      } catch (err) {
        setFailed(true);
        const code = err instanceof ApiError ? extractApiError(err.body).code ?? 'unknown' : 'unknown';
        capture('demo_start_failed', { code });
      }
    };
    void run();
  }, [isLoading, user, startDemo, navigate, router]);

  if (failed) {
    return (
      <section className={`card ${s.card}`}>
        <span className="label">Demo</span>
        <p className={s.line}>The demo is taking a break — analyze your own track instead.</p>
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
      <p className={s.line}>Setting up your demo…</p>
    </section>
  );
}
