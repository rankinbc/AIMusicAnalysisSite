import { useEntitlements } from '../../api/hooks';
import { TierChip } from '../../components/TierChip';
import { UsageMeter } from '../../components/UsageMeter';
import s from './UsageSummary.module.css';

// Story 2.8 / FR32 / UX-DR16 / UX-DR32 — the honest usage snapshot at the top
// of /_app/usage: analyses ("{used} of {limit} · resets {date}"), coach pool
// status (tier-aware grammar), current tier, and credit balance. All numbers
// come from GET /api/me/entitlements + the credits query — no tier/date math on
// the client (AR35); the server stamps scope + reset instants.

interface UsageSummaryProps {
  creditBalance: number;
}

// Reset is always a future instant (first of next month). Per UX-DR42 the reset
// is typically >7 days out, so an absolute short date is the right form.
function formatResetDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

function coachLineFor(
  coach: { used: number; limit: number; scope?: string; resetsAt?: string | null } | null | undefined,
): string {
  if (!coach) return '—';
  if (coach.scope === 'unlimited') return 'Unlimited';
  if (coach.scope === 'month') {
    const reset = formatResetDate(coach.resetsAt);
    const base = `${coach.used} of ${coach.limit} this month`;
    return reset ? `${base} · resets ${reset}` : base;
  }
  // per-analysis (free tier) — pooled "used" isn't meaningful on this page.
  return `${coach.limit} per analysis`;
}

export function UsageSummary({ creditBalance }: UsageSummaryProps) {
  const { data: ent, isError, refetch } = useEntitlements();

  // Audit wave-3 (E8.3) — an entitlements failure is distinguishable from
  // "loading": say so, with a retry. DECISION: the nav meter (_app.tsx) stays
  // hidden on entitlements failure — a nav popover is the wrong place for an
  // error state; this card on /usage carries the explicit message.
  if (isError) {
    return (
      <section className={`card ${s.card}`}>
        <div className={s.head}>
          <h2 className={s.cardTitle}>Your plan</h2>
        </div>
        <p className={`mono ${s.value}`}>
          Plan info is unavailable right now — your plan and limits are
          unaffected.
        </p>
        <button type="button" className="btn sm" onClick={() => void refetch()}>
          Retry
        </button>
      </section>
    );
  }

  if (!ent) return null;

  // Only PRO is truly unlimited. Credits also reports analysesLimit=null but is
  // bounded by the credit balance — show its à-la-carte nature, not "Unlimited"
  // (the false copy that told a credits user with a finite balance they had no
  // cap). Credit balance is its own metric below.
  const reset = formatResetDate(ent.analysesResetsAt);
  const analysesLine =
    ent.tier === 'pro'
      ? 'Unlimited'
      : ent.tier === 'credits'
        ? '1 credit each'
        : reset
          ? `${ent.analysesUsed} of ${ent.analysesLimit} · resets ${reset}`
          : `${ent.analysesUsed} of ${ent.analysesLimit}`;

  return (
    <section className={`card ${s.card}`}>
      <div className={s.head}>
        <h2 className={s.cardTitle}>Your plan</h2>
        <TierChip tier={ent.tier} />
      </div>

      <div className={s.metrics}>
        <div className={s.metric}>
          <span className="label">Analyses</span>
          <span className={`mono ${s.value}`}>{analysesLine}</span>
          {ent.analysesLimit !== null && (
            <UsageMeter
              variant="page"
              used={ent.analysesUsed}
              limit={ent.analysesLimit}
            />
          )}
        </div>

        <div className={s.metric}>
          <span className="label">Coach</span>
          <span className={`mono ${s.value}`}>{coachLineFor(ent.coach)}</span>
        </div>

        <div className={s.metric}>
          <span className="label">Credit balance</span>
          <span className={`mono ${s.value}`}>{creditBalance}</span>
        </div>
      </div>
    </section>
  );
}
