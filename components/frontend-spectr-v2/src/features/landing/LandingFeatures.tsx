/* "What you get" — the six-item glowing feature list. Sits in the hero's
 * left column under the demo card (owner ruling 2026-10-01), compact type. */
import s from './LandingFeatures.module.css';

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

export function LandingFeatures({ className }: { className?: string }) {
  return (
    <section className={`${className ?? ''} ${s.features}`} aria-labelledby="landing-features-title">
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
  );
}
