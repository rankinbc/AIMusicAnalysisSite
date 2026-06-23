import { useState } from 'react';

import { useEntitlements, useHonestMath } from '../../api/hooks';
import { UpgradeSheet } from '../../components/UpgradeSheet';
import { formatCents } from './format-price';
import s from './HonestMathBanner.module.css';

// Story 2.8 / AC2 / UX-DR32 — the honest-math comparison banner. Shows ONLY
// when the server flags `qualifies` (90-day credit spend ≥ Pro-equivalent).
// Dismissible, never a modal (UX-DR40 remembered-dismiss); the dismissal is
// persisted in localStorage so it stays hidden on return visits. The CTA opens
// the shared UpgradeSheet in place (story 2.7 D2 — one upgrade surface).

const DISMISS_KEY = 'spectr.honestMath.dismissed';

function readDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function HonestMathBanner() {
  const { data } = useHonestMath();
  const { data: ent } = useEntitlements();
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!data || !data.qualifies || dismissed) return null;

  const spent = formatCents(data.creditsSpentCents, data.currency);
  const proWouldBe = formatCents(data.proEquivalentCents, data.currency);

  const dismiss = () => {
    setDismissed(true);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      /* private mode / quota — dismissal still holds for this session */
    }
  };

  return (
    <div className={s.banner} role="status">
      <div className={s.copy}>
        <span className="label">Honest math</span>
        <p className={s.text}>
          You&rsquo;ve spent <span className="mono">{spent}</span> on credits in {data.periodDays}{' '}
          days — Pro would&rsquo;ve been <span className="mono">{proWouldBe}</span>.
        </p>
      </div>
      <div className={s.actions}>
        <button type="button" className="btn sm" onClick={() => setSheetOpen(true)}>
          Compare Pro
        </button>
        <button
          type="button"
          className={s.dismiss}
          onClick={dismiss}
          aria-label="Dismiss honest-math comparison"
        >
          ×
        </button>
      </div>

      {sheetOpen && (
        <UpgradeSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          analysesUsed={ent?.analysesUsed ?? 0}
          analysesLimit={ent?.analysesLimit ?? 0}
          title="Pro could cost you less"
          description={`You've spent ${spent} on credits in ${data.periodDays} days — Pro would've been ${proWouldBe}. Compare below.`}
          onUpgraded={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
