/* Story 6.4 — the landing-page mount for the resume card. Owns the "does this
 * returning device have a job?" fetch so LandingPage stays a lean, provider-free
 * static-render component: this slot uses useEffect+fetch (not useQuery), so
 * under renderToStaticMarkup the effect never runs and it renders nothing.
 *
 * Anon-only: a logged-in user has the library (and the root route redirects
 * them to /library anyway) — useOptionalAuth guards against a flash mid-redirect. */
import { useEffect, useState } from 'react';

import { useOptionalAuth } from '../../auth/AuthContext';
import { ResumeCard } from './ResumeCard';
import { dismissResume, isResumeDismissed } from './resume-dismissed';
import type { ResumeInfo } from './useAnonAnalysis';

export function LandingResumeSlot() {
  const auth = useOptionalAuth();
  // Wait for auth to RESOLVE before deciding — during the silent-refresh boot
  // user is null, and firing the anon fetch then would flash a resume card for
  // a logged-in visitor who still holds a device cookie (review).
  const authSettled = !auth || !auth.isLoading;
  const authed = Boolean(auth?.user);
  const [resume, setResume] = useState<ResumeInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!authSettled || authed) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        // credentials: include — the endpoint is scoped entirely by the
        // spectr_device cookie; default same-origin would drop it cross-origin.
        const res = await fetch('/api/anon/jobs/current', {
          headers: { Accept: 'application/json' },
          credentials: 'include',
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const info = (await res.json()) as ResumeInfo;
        if (typeof info?.jobId === 'string' && !isResumeDismissed(info.jobId)) setResume(info);
      } catch {
        /* no cookie / aborted / network — simply no resume card */
      }
    })();
    return () => ctrl.abort();
  }, [authSettled, authed]);

  if (!authSettled || authed || !resume || dismissed || resume.status === 'failed') return null;

  return (
    <ResumeCard
      resume={resume}
      onDismiss={() => { dismissResume(resume.jobId); setDismissed(true); }}
    />
  );
}
