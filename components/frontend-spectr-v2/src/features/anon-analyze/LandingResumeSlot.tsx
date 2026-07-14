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
  const authed = Boolean(useOptionalAuth()?.user);
  const [resume, setResume] = useState<ResumeInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (authed) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/anon/jobs/current', { headers: { Accept: 'application/json' } });
        if (!res.ok || !live) return;
        const info = (await res.json()) as ResumeInfo;
        if (live && !isResumeDismissed(info.jobId)) setResume(info);
      } catch {
        /* no cookie / network — simply no resume card */
      }
    })();
    return () => { live = false; };
  }, [authed]);

  if (authed || !resume || dismissed || resume.status === 'failed') return null;

  return (
    <ResumeCard
      resume={resume}
      onDismiss={() => { dismissResume(resume.jobId); setDismissed(true); }}
    />
  );
}
