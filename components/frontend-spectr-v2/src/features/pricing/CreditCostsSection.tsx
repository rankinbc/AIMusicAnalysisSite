/* "What things cost" — every credit number in this section comes from
 * GET /api/billing/plans (`costs`, `signupBonusCredits`, `creditPacks`), the
 * same server price list every charge site enforces. Rendered only inside
 * PricingPlansView, i.e. only when the server says credits are ON — the
 * kill-switch state (PricingOffView) never shows costs. An older BFF that
 * sends no `costs` gets no section rather than invented numbers. */
import type { PlansResponse } from '../../api/types';
import { signupBonusFrom } from '../../lib/public-plans';
import { CostPill } from '../billing/CostPill';
import { formatCents } from '../billing/format-price';
import { ALWAYS_FREE } from './always-free';
import { packReachLabel } from './credit-math';
import s from './CreditCostsSection.module.css';

export function CreditCostsSection({ plans }: { plans: PlansResponse }) {
  const costs = plans.costs;
  if (!costs) return null;
  const bonus = signupBonusFrom(plans);
  const paid = [
    {
      key: 'analysis',
      name: 'Full analysis',
      credits: costs.analysis,
      detail: 'Upload a mix and get the complete report, plus the specialists triage routes to it.',
    },
    {
      key: 'specialist',
      name: 'Extra AI specialist',
      credits: costs.specialist,
      detail: 'Ask a specialist that wasn’t already auto-run for your track.',
    },
    {
      key: 'coachMessage',
      name: 'Coach message',
      credits: costs.coachMessage,
      detail: 'One question to the AI coach about your mix.',
    },
    {
      key: 'coachMix',
      name: 'Coach Mix',
      credits: costs.coachMix,
      detail: 'The coach merges your chosen fixes into one ready-to-use effects chain.',
    },
  ];

  return (
    <section className={s.section} aria-labelledby="credit-costs-heading" data-testid="credit-costs">
      <header className={s.head}>
        <span className="label">Credits</span>
        <h2 id="credit-costs-heading" className={s.title}>
          What things cost
        </h2>
        <p className={s.lede}>
          Credits are the pay-as-you-go unit. Here is everything that spends them &mdash; and
          everything that doesn&rsquo;t.
        </p>
        {bonus !== null && (
          <p className={s.signup} data-testid="credit-costs-signup">
            {`Signing up includes ${bonus} free credits once you verify your email.`}
          </p>
        )}
      </header>

      <div className={s.columns}>
        <div className={`card ${s.panel}`}>
          <h3 className={s.panelTitle}>Paid actions</h3>
          <ul className={s.rows}>
            {paid.map((a) => (
              <li key={a.key} className={s.row} data-testid={`credit-cost-${a.key}`}>
                <div className={s.rowText}>
                  <span className={s.rowName}>{a.name}</span>
                  <span className={s.rowDetail}>{a.detail}</span>
                </div>
                <CostPill credits={a.credits} />
              </li>
            ))}
          </ul>
        </div>

        <div className={`card ${s.panel}`}>
          <h3 className={s.panelTitle}>Always free</h3>
          <ul className={s.rows} data-testid="credit-costs-free">
            {ALWAYS_FREE.map((f) => (
              <li key={f.name} className={s.row}>
                <div className={s.rowText}>
                  <span className={s.rowName}>{f.name}</span>
                  <span className={s.rowDetail}>{f.detail}</span>
                </div>
                <span className={`mono ${s.freeTag}`}>Free</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={s.columns}>
        <div className={`card ${s.panel}`} data-testid="credit-costs-pro">
          <h3 className={s.panelTitle}>With Pro</h3>
          <p className={s.body}>
            {`Pro (${formatCents(plans.proMonthlyCents, plans.currency)}/mo or ${formatCents(plans.proAnnualCents, plans.currency)}/yr) includes ${costs.proAnalysesMonthly} analyses and ${costs.proCoachMonthly} coach messages every month, plus every extra specialist and Coach Mix.`}
          </p>
          <p className={s.body}>
            Go past the monthly allowance and extra use draws credits at the same prices listed
            here.
          </p>
        </div>

        {plans.creditPacks.length > 0 && (
          <div className={`card ${s.panel}`}>
            <h3 className={s.panelTitle}>How far a pack goes</h3>
            <ul className={s.rows} data-testid="credit-costs-packs">
              {plans.creditPacks.map((p) => {
                const reach = packReachLabel(p.credits, costs);
                return (
                  <li key={p.credits} className={s.row}>
                    <div className={s.rowText}>
                      <span className={s.rowName}>
                        {`${p.credits} credits · ${formatCents(p.cents, plans.currency)}`}
                      </span>
                      {reach && <span className={s.rowDetail}>{reach}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
