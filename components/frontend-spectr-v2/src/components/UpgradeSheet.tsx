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
  analysesUsed: number;
  analysesLimit: number;
  /** The user's own reports this period — their climb. Omit/empty to hide. */
  gradeChips?: UpgradeGradeChip[];
  /** Fired once the tier flips (checkout succeeded) — caller resumes work. */
  onUpgraded?: () => void;
  /** Honest exit. Defaults to closing the sheet. */
  onWaitNextMonth?: () => void;
}

const PRO_FEATURES = [
  'Unlimited analyses',
  'All verdicts',
  'Stems + .als',
  'Coach pool',
  'Version history',
];

const CREDIT_FEATURES = ['Full analysis, à la carte', 'No subscription'];

export function UpgradeSheet({
  open,
  onOpenChange,
  analysesUsed,
  analysesLimit,
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

  const creditPrice = (
    <span className={s.creditPrice}>
      {p ? `${formatCents(p.creditPack5Cents, currency)} · 5-pack` : '5-pack'}
    </span>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={`${f.dialogContent} ${s.sheet}`}>
          <Dialog.Title className={f.dialogTitle}>
            {analysesUsed} of {analysesLimit} free analyses used this month
          </Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Upgrade to keep going — or wait for next month. Your work is saved either way.
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
              features={PRO_FEATURES}
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
              ctaLabel="Buy credits"
              onCta={() => void start({ type: 'credits', packSize: 5 })}
              ctaPending={pending === 'credits'}
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
