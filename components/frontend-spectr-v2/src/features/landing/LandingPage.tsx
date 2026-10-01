/* Story 6.1 (FR40) — the public landing page at `/`. One-scroll pitch:
 * hero (finding/fix card, How-it-works link) + feature grid + footer. Anonymous only — the
 * root route's beforeLoad redirects authed users to /library. Keep this
 * chunk LEAN (AC4 LCP): ui primitives only, nothing that pulls
 * wavesurfer/recharts/listen-rack. */
import { useEffect } from 'react';

import { PublicChrome } from '../../components/PublicChrome';
import { PublicFooter } from '../../components/PublicFooter';
import { capture } from '../../lib/analytics';
import { usePageMeta } from '../../lib/usePageMeta';
import { LandingResumeSlot } from '../anon-analyze/LandingResumeSlot';
import { LandingFeatures } from './LandingFeatures';
import { LandingHero } from './LandingHero';
import s from './landing.module.css';

export function LandingPage() {
  usePageMeta(
    'SPECTR — AI mix analysis for producers',
    'Upload a track, get a graded mix report with concrete fixes — loudness, low end, stereo image, tonal balance — plus an AI coach that knows your report.',
    { path: '/' },
  );
  // Story 6.5 — top of funnel (once per mount; no-op without a PostHog key).
  useEffect(() => { capture('landing_viewed'); }, []);

  return (
    <div className={s.page}>
      <PublicChrome />

      <main className={s.main}>
        {/* Story 6.4 — returning-visitor resume card (renders only when a
            device has an unclaimed job; null in SSR/static render). */}
        <LandingResumeSlot />

        <LandingHero />

        <LandingFeatures />

        <PublicFooter />
      </main>
    </div>
  );
}
