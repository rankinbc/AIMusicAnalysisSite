/* Landing hero — two columns on desktop: the pitch + both CTAs on the left,
 * the Coach (the app's mascot) introducing himself on the right, with one
 * real finding from the sample report that alternates with its suggested fix. Phone
 * stacks pitch → CTA → Coach → demo callout so the headline and primary
 * CTA stay above the fold.
 *
 * Kept LEAN for the landing entry chunk: the Coach is a small inline SVG
 * from ui/, and the finding below is a hand-copied excerpt (NOT an import
 * of the 40 kB generated fixture). landing.test.tsx asserts it still
 * matches sample-data.ts, so it can't drift from the real report. */
import { Coach } from '../../ui/Coach';
import { capture } from '../../lib/analytics';
import { HeroFindingCard } from './HeroFindingCard';
import s from './LandingHero.module.css';

// Re-exported: tests and other modules import them from here.
export { HERO_FINDING, HERO_FIX } from './hero-content';

export const COACH_LINE = "I'm the Coach. I'll help you get your mix where you want it to be.";

export function LandingHero() {
  return (
    <section className={s.hero} aria-labelledby="landing-title">
      <div className={s.copy}>
        <h1 id="landing-title" className={s.title}>
          Don&rsquo;t just find out what&rsquo;s wrong with your mix. Fix it.
        </h1>
        <p className={s.subtitle}>
          Most online mix checkers stop at a score and a list of problems. SPECTR works with you
          to fix them &mdash; a prioritised plan with exact settings, every fix playable on your
          own track, and a Coach who knows your mix answering your questions along the way.
        </p>
        <div className={s.ctaRow}>
          {/* Story 6.3 — straight into the anon instant-analysis funnel. */}
          <a href="/analyze" className={`btn primary ${s.primaryBtn}`} data-testid="landing-cta">
            Analyze my track free
          </a>
          <p className={s.ctaHint}>
            WAV, FLAC or MP3.
            <br />
            Your first analysis needs no account.
          </p>
        </div>
      </div>

      {/* The guest demo (task P3) needs no upload and no account — it keeps
          its own highlighted callout so a visitor without a track in hand
          still has an obvious next step. */}
      <div className={s.demoCard}>
        <div className={s.demoCopy}>
          <p className={s.demoHead}>No track handy?</p>
          <p className={s.demoText}>
            Open the results of a real sample analysis and try every feature — findings, fix plan,
            AI coach and the Listen rack. No signup.
          </p>
        </div>
        <a
          href="/demo"
          className={`btn ${s.demoBtn}`}
          data-testid="landing-demo-cta"
          onClick={() => capture('demo_cta_clicked', { source: 'landing' })}
        >
          Explore the demo →
        </a>
      </div>

      <a href="/trust/how-its-built" className={`btn ghost sm ${s.hiwBtn}`} data-testid="landing-hiw-cta">
        How it works →
      </a>

      <figure className={s.stage} data-testid="landing-coach">
        <blockquote className={s.bubble}>
          <p className={s.bubbleText}>{COACH_LINE}</p>
        </blockquote>
        <div className={s.coachRow}>
          <div className={s.coach} aria-hidden="true">
            <Coach size={148} glow={false} />
          </div>
          <p className={s.caption}>
            <span className={s.captionName}>The Coach</span>
            Reads your report&rsquo;s measurements and walks you through every fix, one
            question at a time.
          </p>
        </div>

        <HeroFindingCard className={s.finding} />
      </figure>
    </section>
  );
}
