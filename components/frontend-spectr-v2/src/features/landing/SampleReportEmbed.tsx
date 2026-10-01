/* Landing page live sample report shell. The report body (SampleReport) is
 * lazy-loaded: it pulls the results-page stylesheets and the generated
 * fixture, none of which belong in the landing entry chunk. The frame, label
 * and CTAs render immediately (and under static render, where the lazy body
 * shows its fallback). */
import { lazy, Suspense } from 'react';

import { capture } from '../../lib/analytics';
import s from './landing.module.css';

const SampleReport = lazy(() => import('./sample/SampleReport'));

export function SampleReportEmbed() {
  return (
    <section className={`card ${s.embed}`} aria-label="Sample report">
      <div className={s.embedHead}>
        <span className="label">Live sample report</span>
        <span className={`mono ${s.embedNote}`}>sample track · real analyzer output, curated</span>
      </div>

      <Suspense
        fallback={
          <div className={s.embedLoading} aria-hidden>
            Loading the sample report…
          </div>
        }
      >
        <SampleReport />
      </Suspense>

      <div className={s.embedCtas}>
        <p className={s.embedCaption}>
          This is what every upload gets: findings with the measurements behind them, and a fix
          plan you can act on tonight. The full demo lets you click through all of it — coach and
          Listen rack included, no signup.
        </p>
        <div className={s.embedBtns}>
          <a href="/analyze" className="btn primary" data-testid="sample-cta">
            Analyze my track free
          </a>
          <a
            href="/demo"
            className={`btn ${s.demoBtn}`}
            onClick={() => capture('demo_cta_clicked', { source: 'landing_sample' })}
          >
            Explore the full demo →
          </a>
        </div>
      </div>
    </section>
  );
}
