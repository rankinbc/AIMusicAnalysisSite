/* The public /features page: what SPECTR does, in the order a producer uses
 * it. Every feature gets a product vignette (the landing hero card's idiom):
 * drawn from the sample report where it has the data, otherwise tagged
 * "illustration". Copy lives in features-content.ts.
 * Same static-render idiom as the landing page: plain <a> anchors, no
 * RouterProvider needed. */
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { PublicChrome } from '../../components/PublicChrome';
import { PublicFooter } from '../../components/PublicFooter';
import { capture } from '../../lib/analytics';
import { usePageMeta } from '../../lib/usePageMeta';
import { Coach } from '../../ui/Coach';
import { useRevealOnScroll } from '../landing/useRevealOnScroll';
import { FEATURES, TRUST_POINTS } from './features-content';
import type { LeadFeature } from './features-content';
import { CoachMixVignette, CoachVignette, TeamVignette } from './vignettes/CoachVignettes';
import { EvidenceVignette } from './vignettes/EvidenceVignette';
import { ExactFixVignette } from './vignettes/ExactFixVignette';
import { HearItVignette } from './vignettes/HearItVignette';
import { LearnVignette } from './vignettes/LearnVignette';
import { ReferenceVignette } from './vignettes/ReferenceVignette';
import { AnalysisVignette, DawPlanVignette, DeeperVignette, LibraryVignette } from './vignettes/WorkflowVignettes';
import s from './FeaturesPage.module.css';

const VIGNETTES: Record<LeadFeature['id'], () => ReactNode> = {
  hear: () => <HearItVignette />,
  fix: () => <ExactFixVignette />,
  evidence: () => <EvidenceVignette />,
  learn: () => <LearnVignette />,
  reference: () => <ReferenceVignette />,
  coach: () => <CoachVignette />,
  team: () => <TeamVignette />,
  mix: () => <CoachMixVignette />,
  plan: () => <DawPlanVignette />,
  library: () => <LibraryVignette />,
  deeper: () => <DeeperVignette />,
  analysis: () => <AnalysisVignette />,
};

function LeadRow({ feature }: { feature: LeadFeature }) {
  const { ref, revealed } = useRevealOnScroll<HTMLElement>(0.15);
  return (
    <section
      ref={ref}
      id={feature.id}
      className={s.row}
      data-revealed={revealed}
      aria-labelledby={`feature-${feature.id}`}
    >
      <div className={s.rowCopy}>
        {feature.id === 'coach' && (
          <span className={s.mascot} aria-hidden="true"><Coach size={96} /></span>
        )}
        <span className={`label ${s.kicker}`} data-kind={feature.id}>{feature.kicker}</span>
        <h2 id={`feature-${feature.id}`} className={s.rowHead}>{feature.head}</h2>
        <p className={s.rowBody}>{feature.body}</p>
        <ul className={s.points}>
          {feature.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
      <figure className={`card ${s.vignette}`} data-kind={feature.id}>
        <figcaption className={s.vignetteTop}>
          <span className={s.vignetteTag}>{feature.kicker}</span>
          <span className={s.vignetteSrc}>{feature.sample === false ? 'illustration' : 'sample report'}</span>
        </figcaption>
        {VIGNETTES[feature.id]()}
        {feature.note && <p className={s.vignetteNote}>{feature.note}</p>}
      </figure>
    </section>
  );
}

export function FeaturesPage() {
  usePageMeta(
    'Features — SPECTR',
    'What SPECTR does for your mix: findings with the evidence behind them, an exact fix for each, every fix playable on your own track, plain-language explanations of why, a Coach that knows your report, and a plan to take back to your DAW.',
    { path: '/features' },
  );
  useEffect(() => { capture('features_viewed'); }, []);

  return (
    <div className={s.page}>
      <PublicChrome />

      <main className={s.main}>
        <header className={s.hero}>
          <span className="label">Features</span>
          <h1 className={s.title}>Find it. Fix it. Hear it — before you touch your DAW.</h1>
          <p className={s.subtitle}>
            Most online mix checkers stop at a score and a list of problems. SPECTR is built for
            the part that comes after: knowing exactly what to change, hearing it on your own
            track, and taking a plan back to your project.
          </p>
          <div className={s.ctaRow}>
            <a href="/analyze" className="btn primary" data-testid="features-cta">Analyze my track free</a>
            <a
              href="/demo"
              className="btn ghost"
              data-testid="features-demo-cta"
              onClick={() => capture('demo_cta_clicked', { source: 'features' })}
            >
              Explore the demo →
            </a>
          </div>
        </header>

        <nav className={s.jump} aria-label="Features on this page">
          {FEATURES.map((f) => (
            <a key={f.id} href={`#${f.id}`} className={s.jumpLink}>{f.kicker}</a>
          ))}
        </nav>

        {FEATURES.map((f) => (
          <LeadRow key={f.id} feature={f} />
        ))}

        <section className={s.trust} aria-labelledby="features-trust-title">
          <h2 id="features-trust-title" className={`label ${s.trustLabel}`}>Your music stays yours</h2>
          <ul className={s.trustGrid}>
            {TRUST_POINTS.map((t) => (
              <li key={t.head} className={s.trustItem}>
                <h3 className={s.trustHead}>{t.head}</h3>
                <p className={s.trustBody}>{t.body}</p>
                <a href={t.href} className={s.trustLink}>{t.link} →</a>
              </li>
            ))}
          </ul>
        </section>

        <section className={`card ${s.closing}`} aria-labelledby="features-closing-title">
          <h2 id="features-closing-title" className={s.closingHead}>See it on your own mix</h2>
          <p className={s.closingBody}>
            WAV, FLAC or MP3. Your first analysis needs no account — a free account keeps every
            track, version and report in your library.
          </p>
          <div className={s.ctaRow}>
            <a href="/analyze" className="btn primary">Analyze my track free</a>
            <a
              href="/register"
              className="btn ghost"
              onClick={() => capture('signup_cta_clicked', { source: 'features' })}
            >
              Sign up free
            </a>
          </div>
        </section>

        <PublicFooter />
      </main>
    </div>
  );
}
