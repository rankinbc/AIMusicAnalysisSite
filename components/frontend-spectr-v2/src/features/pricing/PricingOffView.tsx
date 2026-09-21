/* Task P2 (public-surfaces-polish D6/D7) — the honest "credits are off"
 * state: SPECTR is free while we launch, so this page never advertises
 * plans that cannot be bought. Wording matches the copy already used at
 * features/account/plan-copy.ts:20-21 for the same kill-switch state. */
import { PublicChrome } from '../../components/PublicChrome';
import s from './pricing.module.css';

export function PricingOffView() {
  return (
    <>
    <PublicChrome />
    <main className={s.shell}>
      <header className={s.header}>
        <span className="label">Pricing</span>
        <h1 className={s.title}>Free while we launch.</h1>
        <p className={s.subtitle}>
          Paid plans are switched off — unlimited analyses, full coach, every specialist.
        </p>
      </header>

      <div className={s.offCtaRow}>
        <a href="/analyze" className="btn primary">Analyze a track</a>
        <a href="/demo" className="btn ghost">Explore the demo</a>
      </div>

      <footer className={s.footer}>
        <p className={s.fineprint}>
          <a href="/trust/results-forever">Your reports stay yours</a>
        </p>
      </footer>
    </main>
    </>
  );
}
