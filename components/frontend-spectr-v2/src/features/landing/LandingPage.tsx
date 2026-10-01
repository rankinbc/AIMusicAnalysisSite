/* Story 6.1 (FR40) — the public landing page at `/`. One-scroll pitch:
 * hero (with a real finding + fix card) + feature list + footer. Anonymous only — the
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

// Ordered as the producer's loop: diagnose → understand → fix → hear → apply →
// prove. Every claim maps to a shipped surface. Copy rules (e515995): the coach
// reasons over measurements (never "hears"), and no arrangement/structure
// promise — structure detection doesn't run in prod. No export/download promise
// until the fix plan actually has one.
const FEATURES = [
  { head: 'Know exactly what’s wrong with your mix', body: 'Upload a WAV, MP3 or FLAC and get a full breakdown of loudness, low end, stereo image, dynamics and tonal balance, judged against your genre.' },
  { head: 'An AI coach that knows your report', body: 'Ask anything in plain language. Every answer points to your measured numbers, not generic advice.' },
  { head: 'From problem to exact fix', body: 'Every finding comes with a specific move: processor, frequency and amount, on the right track and section. Ranked, so you know where to start.' },
  { head: 'Hear the fix before you commit', body: 'Audition the suggested fix chain against your original mix in real time, right in the browser.' },
  { head: 'Follow along in your DAW', body: 'Dial in concrete settings step by step and check off each fix as you apply it.' },
  { head: 'Prove it got better', body: 'Every bounce of a song lives on one timeline. Compare any two versions side by side and see whether the changes actually helped.' },
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

        <section className={s.features} aria-labelledby="landing-features-title">
          <h2 id="landing-features-title" className={`label ${s.featuresLabel}`}>What you get</h2>
          <ul className={s.featureList}>
            {FEATURES.map((f) => (
              <li key={f.head} className={s.feature}>
                <span className={s.featureHead}>{f.head}</span>
                <span className={s.featureBody}>{f.body}</span>
              </li>
            ))}
          </ul>
        </section>

        <PublicFooter />
      </main>
    </div>
  );
}
