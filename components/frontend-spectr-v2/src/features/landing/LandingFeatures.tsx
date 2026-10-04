/* "What you get" — the six-item glowing feature list: a 2-column grid below
 * the hero, compact type (owner ruling 2026-10-01). */
import type { CSSProperties } from 'react';

import s from './LandingFeatures.module.css';
import { useRevealOnScroll } from './useRevealOnScroll';

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
  { head: 'Create a plan to take back to your DAW', body: 'Dial in concrete settings step by step and check off each fix as you apply it.' },
  { head: 'Maintain your library', body: 'Keep your tracks organized and versioned. Compare versions side by side to make sure the changes actually helped.' },
];

export function LandingFeatures({ className }: { className?: string }) {
  const { ref, revealed } = useRevealOnScroll<HTMLElement>();
  return (
    <section
      ref={ref}
      className={`${className ?? ''} ${s.features}`}
      aria-labelledby="landing-features-title"
      data-revealed={revealed}
    >
      <h2 id="landing-features-title" className={`label ${s.featuresLabel}`}>What you get</h2>
      <ul className={s.featureList}>
        {FEATURES.map((f, i) => (
          // --i staggers each item's entrance (dynamic, so inline).
          <li key={f.head} className={s.feature} style={{ '--i': i } as CSSProperties}>
            <span className={s.featureHead}>{f.head}</span>
            <span className={s.featureBody}>{f.body}</span>
          </li>
        ))}
      </ul>
      <a href="/features" className="btn ghost sm" data-testid="landing-features-cta">
        See all features →
      </a>
    </section>
  );
}
