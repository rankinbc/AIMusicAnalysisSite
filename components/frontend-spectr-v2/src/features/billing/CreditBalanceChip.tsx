import { useEntitlements } from '../../api/hooks';
import { useBuyCredits } from './BuyCreditsProvider';
import s from './CreditBalanceChip.module.css';

// Credit economy — always-visible balance in the app top bar. Click → buy sheet.
export function CreditBalanceChip() {
  const { data: ent } = useEntitlements();
  const { open } = useBuyCredits();
  if (!ent || ent.creditsEnabled === false) return null;
  const balance = ent.creditBalance ?? 0;
  const pro =
    ent.tier === 'pro' && ent.proAnalysesLimit != null
      ? `Pro · ${ent.proAnalysesUsed ?? 0}/${ent.proAnalysesLimit}`
      : null;
  return (
    <button
      type="button"
      className={s.chip}
      onClick={() => open()}
      aria-label={`${balance} credits — buy more`}
    >
      {pro && <span className={s.pro}>{pro}</span>}
      <span className={`mono ${s.balance}`}>◆ {balance}</span>
    </button>
  );
}
