/* Task P2 (public-surfaces-polish D6/D7) — the honest "credits are off"
 * state: SPECTR is free while we launch, so this page never advertises
 * plans that cannot be bought. Wording matches the copy already used at
 * features/account/plan-copy.ts:20-21 for the same kill-switch state. */
import { PublicChrome } from '../../components/PublicChrome';
import { PublicFooter } from '../../components/PublicFooter';
import s from './pricing.module.css';

/** `guestSignupHref` is set for a GUEST viewer (owner ruling 2026-10-01):
 *  the analyze/demo CTAs make no sense for someone already in the sandbox,
 *  so the row becomes the one guest → account sign-up CTA instead. */
export function PricingOffView({ guestSignupHref }: { guestSignupHref?: string | undefined } = {}) {
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
        {/* Task P3 — the shared footer's Product group repeats these labels;
            testids disambiguate the page's own CTA row for tests. */}
        {guestSignupHref ? (
          <a href={guestSignupHref} className="btn primary" data-testid="pricing-off-signup-cta">
            Create a free account
          </a>
        ) : (
          <>
            <a href="/analyze" className="btn primary" data-testid="pricing-off-analyze-cta">
              Analyze a track
            </a>
            <a href="/demo" className="btn ghost" data-testid="pricing-off-demo-cta">
              Explore the demo
            </a>
          </>
        )}
      </div>

      <PublicFooter />
    </main>
    </>
  );
}
