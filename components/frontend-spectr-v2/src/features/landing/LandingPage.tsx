/* Story 6.1 (FR40) — the public landing page at `/`. One-scroll pitch:
 * hero + live sample report + honesty strip + footer. Anonymous only — the
 * root route's beforeLoad redirects authed users to /library. Keep this
 * chunk LEAN (AC4 LCP): ui primitives + GradeHero only, nothing that pulls
 * wavesurfer/recharts/listen-rack. */
import { useEffect } from 'react';

import { PublicChrome } from '../../components/PublicChrome';
import { capture } from '../../lib/analytics';
import { usePageMeta } from '../../lib/usePageMeta';
import { LandingResumeSlot } from '../anon-analyze/LandingResumeSlot';
import { SampleReportEmbed } from './SampleReportEmbed';
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
    'Upload a track, get a graded 7-phase mix report with concrete fixes — loudness, low end, stereo image, arrangement — plus an AI coach that hears what you hear.',
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

        <section className={s.hero}>
          <span className="label">AI Music Analysis</span>
          <h1 className={s.title}>
            Know exactly what&rsquo;s wrong with your mix<span className={s.titleAccent}> — before anyone else hears it.</span>
          </h1>
          <p className={s.subtitle}>
            Upload a track and get a graded report across loudness, low end, stereo image and
            arrangement — with concrete fixes you can hear, not vibes.
          </p>
          <div className={s.ctaRow}>
            {/* Story 6.3 — straight into the anon instant-analysis funnel. */}
            <a href="/analyze" className="btn primary" data-testid="landing-cta">
              Analyze my track free
            </a>
            <a href="/pricing" className="btn ghost">See pricing</a>
          </div>
          <p className={`mono ${s.ctaHint}`}>WAV · FLAC · MP3 · no account needed for the first one</p>
        </section>

        <SampleReportEmbed />

        <section className={s.honesty}>
          {HONESTY_POINTS.map((p) => (
            <div key={p.head} className={`card ${s.honestyCard}`}>
              <h3 className={s.honestyHead}>{p.head}</h3>
              <p className={s.honestyBody}>{p.body}</p>
            </div>
          ))}
        </section>

        <footer className={s.footer}>
          <a href="/pricing" className={s.footerLink}>Pricing</a>
          <a href="/login" className={s.footerLink}>Sign in</a>
          {/* Story 6.2 — trust pages. */}
          <a href="/trust/no-training" className={s.footerLink}>No AI training</a>
          <a href="/trust/results-forever" className={s.footerLink}>Results forever</a>
          <a href="/trust/privacy" className={s.footerLink}>Privacy</a>
          <span className={`mono ${s.footerNote}`}>SPECTR</span>
        </footer>
      </main>
    </div>
  );
}
