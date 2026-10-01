/* Task P2 (public-surfaces-polish D7) — the "credits are on" state of the
 * pricing page. A pure move of the markup that used to live directly in
 * routes/pricing.tsx (story 2.1 / UX-DR + UX-spec line 318): display values
 * come from GET /api/billing/plans so the no-price-literals lint (AR39)
 * stays clean. Every value the original markup closed over is now a prop —
 * this component owns no state of its own. */
import type { PlansResponse } from '../../api/types';
import { PublicChrome } from '../../components/PublicChrome';
import { PublicFooter } from '../../components/PublicFooter';
import { Pill } from '../../ui/Pill';
import { formatCents } from '../billing/format-price';
import { CreditCostsSection } from './CreditCostsSection';
import s from './pricing.module.css';

export function PricingPlansView({
  plans,
  pending,
  onCheckout,
}: {
  plans: PlansResponse | null;
  pending: 'monthly' | 'annual' | null;
  onCheckout: (cadence: 'monthly' | 'annual') => void;
}) {
  const costs = plans?.costs ?? null;
  return (
    <>
    <PublicChrome />
    <main className={s.shell}>
      <header className={s.header}>
        <span className="label">Plans &amp; pricing</span>
        <h1 className={s.title}>Honest billing. No asterisks.</h1>
        <p className={s.subtitle}>
          Pay monthly, annually, or per-release with credits.
          Reports stay yours forever — even after you cancel.
        </p>
        {/* Story 6.1 (UX-DR25): tax honesty up front, not in a footnote. */}
        <p className={`mono ${s.taxNote}`}>
          Prices in USD. Tax is calculated and shown at checkout before you pay.
        </p>
      </header>

      <section className={s.grid}>
        <article className={`card ${s.planCard}`}>
          <div className={s.planHead}>
            <Pill>Free</Pill>
            <h2 className={s.planName}>Free</h2>
          </div>
          {/* Credit economy — every number comes from plans.costs (never literals);
              an older BFF without costs simply shows no credit lines. */}
          {costs && <p className={s.planLine}>{`${costs.signupGrant} credits to start`}</p>}
          {costs && (
            <p className={s.planLine}>
              {`Analysis ${costs.analysis} ◆ · specialist ${costs.specialist} ◆ · coach ${costs.coachMessage} ◆`}
            </p>
          )}
          <p className={s.planLine}>Core report + verdicts</p>
          <button type="button" className="btn ghost" disabled>
            Current plan
          </button>
        </article>

        <article className={`card ${s.planCard} ${s.planFeatured}`}>
          <div className={s.planHead}>
            <Pill tone="cyan">Pro</Pill>
            <h2 className={s.planName}>Pro</h2>
          </div>
          {costs && (
            <p className={s.planLine}>
              {`${costs.proAnalysesMonthly} analyses + ${costs.proCoachMonthly} coach messages / month`}
            </p>
          )}
          {costs && <p className={s.planLine}>Then pay as you go with credits</p>}
          <p className={s.planLine}>Full coach + all specialists</p>
          <p className={s.planLine}>Stems + .als + reference library</p>
          <div className={s.cadenceRow}>
            <button
              type="button"
              className="btn primary"
              disabled={pending !== null}
              onClick={() => onCheckout('monthly')}
            >
              {pending === 'monthly'
                ? 'Starting…'
                : plans
                  ? `Monthly ${formatCents(plans.proMonthlyCents, plans.currency)}`
                  : 'Monthly'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={pending !== null}
              onClick={() => onCheckout('annual')}
            >
              {pending === 'annual'
                ? 'Starting…'
                : plans
                  ? `Annual ${formatCents(plans.proAnnualCents, plans.currency)}`
                  : 'Annual'}
            </button>
          </div>
          {/* Story 6.1 (UX-DR25): terms restated AT the buttons — no asterisks. */}
          <p className={`mono ${s.buttonTerms}`}>
            Monthly renews monthly · Annual is billed once a year · cancel anytime in two clicks
          </p>
        </article>

        <article className={`card ${s.planCard}`}>
          <div className={s.planHead}>
            <Pill tone="violet">Credits</Pill>
            <h2 className={s.planName}>Credits</h2>
          </div>
          <p className={s.planLine}>Pay per release cycle</p>
          {plans?.creditPacks.map((pack) => (
            <p key={pack.credits} className={s.planLine}>
              {`${pack.credits} credits · ${formatCents(pack.cents, plans.currency)}`}
            </p>
          ))}
          {/* /usage is auth-gated and hosts BuyCreditsCard (pack picker) —
              anonymous visitors are bounced through login and land back there. */}
          <a href="/usage" className="btn ghost" data-testid="pricing-credits-cta">
            Buy credits
          </a>
          <p className={`mono ${s.buttonTerms}`}>One-time purchase · credits never expire</p>
        </article>
      </section>

      {/* Owner ask: "show how many credits everything costs" — server values only. */}
      {plans && <CreditCostsSection plans={plans} />}

      {/* Task P3 — billing-specific fineprint stays here; the trust-link
          paragraph that used to live below it is now the shared footer. */}
      <div className={s.footer}>
        <p className={s.fineprint}>
          Cancel anytime in two clicks. Your reports remain accessible after
          cancellation.
        </p>
        <p className={s.fineprint}>
          {/* Plain <a>: static-render testable + full-nav is fine on funnel pages. */}
          <a href="/login">Sign in</a> if you already have an account.
        </p>
      </div>
      <PublicFooter />
    </main>
    </>
  );
}
