import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

import { usePlans } from '../api/hooks';
import { formatCents } from '../features/billing/format-price';
import { useUpgradeCheckout } from '../features/billing/useUpgradeCheckout';
import { GradePill } from '../ui/GradePill';
import f from '../styles/forms.module.css';
import { PlanCard } from './PlanCard';
import s from './UpgradeSheet.module.css';

// Story 2.7 / UX-DR30 — the cap-hit upgrade modal. Opens only BETWEEN
// actions (the caller gates before any pipeline work). Shows the user's
// own climb (grade chips), PRO vs CREDITS, the verbatim trust line, and an
// honest "wait for next month" exit. Checkout runs through useUpgradeCheckout
// (popup + poll) so the caller's chosen file survives and resumes (AC2).

export interface UpgradeGradeChip {
  id: string;
  label: string;
  grade: string;
}

interface UpgradeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cap-hit framing: drives the default title. Ignored when `title` is set. */
  analysesUsed?: number;
  analysesLimit?: number;
  /** Override the cap-hit title (feature-lock / compare framing). */
  title?: string;
  /** Override the default description. */
  description?: string;
  /** The user's own reports this period — their climb. Omit/empty to hide. */
  gradeChips?: UpgradeGradeChip[];
  /** Fired once the tier flips (checkout succeeded) — caller resumes work. */
  onUpgraded?: () => void;
  /** Honest exit. Defaults to closing the sheet. */
  onWaitNextMonth?: () => void;
}

const PRO_FEATURES = ['All verdicts', 'Stems + .als', 'Coach pool', 'Version history'];

const CREDIT_FEATURES = ['Never expire', 'Pay as you go'];

export function UpgradeSheet({
  open,
  onOpenChange,
  analysesUsed,
  analysesLimit,
  title,
  description,
  gradeChips = [],
  onUpgraded,
  onWaitNextMonth,
}: UpgradeSheetProps) {
  const plans = usePlans();
  const [cadence, setCadence] = useState<'monthly' | 'annual'>('monthly');
  const { start, pending } = useUpgradeCheckout(() => {
    onOpenChange(false);
    onUpgraded?.();
  });

  const p = plans.data;
  const currency = p?.currency ?? 'USD';
  const savedCents = p ? p.proMonthlyCents * 12 - p.proAnnualCents : 0;

  const proPrice = (
    <>
      <div className={s.cadence} role="radiogroup" aria-label="Billing period">
        <button
          type="button"
          role="radio"
          aria-checked={cadence === 'monthly'}
          className={`${s.cadenceOption} ${cadence === 'monthly' ? s.cadenceSelected : ''}`}
          onClick={() => setCadence('monthly')}
        >
          {p ? `${formatCents(p.proMonthlyCents, currency)}/mo` : 'Monthly'}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={cadence === 'annual'}
          className={`${s.cadenceOption} ${cadence === 'annual' ? s.cadenceSelected : ''}`}
          onClick={() => setCadence('annual')}
        >
          {p ? `${formatCents(p.proAnnualCents, currency)}/yr` : 'Annual'}
        </button>
      </div>
      {p && savedCents > 0 && (
        <span className={s.savings}>Save {formatCents(savedCents, currency)}/yr with annual</span>
      )}
    </>
  );

  const proFeatures = [
    p?.costs ? `${p.costs.proAnalysesMonthly} analyses / month` : 'Monthly analyses',
    ...PRO_FEATURES,
  ];

  const packs = p?.creditPacks ?? [];
  const creditPrice = (
    <div className={s.packs} role="group" aria-label="Credit packs">
      {packs.map((pk) => (
        <button
          key={pk.credits}
          type="button"
          className="btn sm"
          disabled={pending !== null}
          onClick={() => void start({ type: 'credits', packSize: pk.credits })}
        >
          {`${pk.credits.toLocaleString()} credits · ${formatCents(pk.cents, currency)}`}
        </button>
      ))}
    </div>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {/* Portaled to <body> (Radix default) and on the purchase layer
          (--z-purchase): the buy sheet opens from INSIDE other modals
          (SpecialistTeamModal, AnalysisCompleteModal, the coach dialog, the
          upload dialog) and must always sit in front of them. */}
      <Dialog.Portal>
        <Dialog.Overlay className={`${f.dialogOverlay} ${f.topLayer}`} data-layer="purchase" />
        <Dialog.Content
          className={`${f.dialogContent} ${f.topLayer} ${s.sheet}`}
          data-layer="purchase"
        >
          <Dialog.Title className={f.dialogTitle}>
            {title ?? `${analysesUsed ?? 0} of ${analysesLimit ?? 0} free analyses used this month`}
          </Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            {description ??
              'Upgrade to keep going — or wait for next month. Your work is saved either way.'}
          </Dialog.Description>

          {gradeChips.length > 0 && (
            <div className={s.recap} aria-label="Your analyses this month">
              {gradeChips.map((chip) => (
                <div key={chip.id} className={s.recapItem} title={chip.label}>
                  <GradePill grade={chip.grade} size="sm" />
                  <span className={s.recapLabel}>{chip.label}</span>
                </div>
              ))}
            </div>
          )}

          <div className={s.plans}>
            <PlanCard
              tier="pro"
              title="Pro"
              priceNode={proPrice}
              features={proFeatures}
              ctaLabel="Subscribe"
              onCta={() => void start({ type: 'subscription', cadence })}
              ctaPending={pending === cadence}
              featured
            />
            <PlanCard
              tier="credits"
              title="Credits"
              priceNode={creditPrice}
              features={CREDIT_FEATURES}
              footnote="No subscription, never expire."
            />
          </div>

          <p className={s.trust}>
            Cancel anytime in two clicks · Your reports stay yours forever · No AI training on your
            audio
          </p>

          <div className={s.exitRow}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => (onWaitNextMonth ? onWaitNextMonth() : onOpenChange(false))}
            >
              wait for next month
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
