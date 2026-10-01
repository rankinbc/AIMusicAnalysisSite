/* Story 6.1 (FR40) — the public landing page at `/`. One-scroll pitch:
 * hero (with a real finding + fix card) + honesty strip + footer. Anonymous only — the
 * root route's beforeLoad redirects authed users to /library. Keep this
 * chunk LEAN (AC4 LCP): ui primitives only, nothing that pulls
 * wavesurfer/recharts/listen-rack. */
import { useEffect } from 'react';

import { PublicChrome } from '../../components/PublicChrome';
import { PublicFooter } from '../../components/PublicFooter';
import { capture } from '../../lib/analytics';
import { usePageMeta } from '../../lib/usePageMeta';
import { LandingResumeSlot } from '../anon-analyze/LandingResumeSlot';
import { LandingHero } from './LandingHero';
import s from './landing.module.css';

// The honesty strip mirrors the UpgradeSheet trust line (story 2.7 copy).
const HONESTY_POINTS = [
  { head: 'No AI training on your audio', body: 'Your unreleased music is analyzed, never used to train models.' },
  { head: 'Reports stay yours forever', body: 'Cancel anytime in two clicks — every report you generated stays accessible.' },
  { head: 'Honest grades', body: 'A real 7-phase measurement pipeline. If the mix is rough, the report says so.' },
];

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

        <section className={s.honesty}>
          {HONESTY_POINTS.map((p) => (
            <div key={p.head} className={`card ${s.honestyCard}`}>
              <h3 className={s.honestyHead}>{p.head}</h3>
              <p className={s.honestyBody}>{p.body}</p>
            </div>
          ))}
        </section>

        <PublicFooter />
      </main>
    </div>
  );
}
