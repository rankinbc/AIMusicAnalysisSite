/* Story 6.4 -> task G5 — the landing-page mount for the resume card. Pre-G5
 * this probed the device-cookie-scoped /api/anon/jobs/current endpoint for
 * an anon job to resume; that vertical is gone (an /analyze upload is now a
 * real guest account, not an anon job). Guest-ness lives entirely on
 * AuthContext (`user.isGuest`, D9) — no network call here at all.
 * useOptionalAuth so LandingPage stays a lean, provider-free static-render
 * component (renders nothing outside a real AuthProvider). */
import { useEffect, useRef } from 'react';

import { useOptionalAuth } from '../../auth/AuthContext';
import { capture } from '../../lib/analytics';
import { ResumeCard } from './ResumeCard';

export function LandingResumeSlot() {
  const auth = useOptionalAuth();
  const visible = Boolean(auth?.user?.isGuest);

  const shownFiredRef = useRef(false);
  useEffect(() => {
    if (visible && !shownFiredRef.current) {
      shownFiredRef.current = true;
      capture('resume_shown');
    }
  }, [visible]);

  if (!visible) return null;
  return <ResumeCard onOpen={() => capture('resume_clicked')} />;
}
