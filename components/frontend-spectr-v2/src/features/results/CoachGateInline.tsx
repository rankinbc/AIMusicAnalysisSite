import { toast } from 'sonner';

import s from './CoachChat.module.css';

// Story 1.9 — input-replacement gate component. Renders in the same DOM
// slot the `<input>` + `Ask →` button normally fill in CoachChat.tsx when
// `caps.capReached === true`. The conversation transcript above stays
// readable + scrollable (AC3).
//
// Real Stripe Checkout dispatch ships in Epic 2 story 2.1; for now the
// upgrade + credit handlers fire informational toasts so the click is
// acknowledged but never silently swallowed.
//
// ARIA (Task 5.4): the swap is announced via the SR-only live region in
// CoachChat (a separate concern — keep this component side-effect-free).
// The container carries role="region" + aria-label so screen-reader users
// can locate the gate as a discrete landmark.

interface CoachGateInlineProps {
  onUpgrade?: () => void;
  onBuyCredits?: () => void;
}

const DEFAULT_UPGRADE = () => {
  // Story 2.1 — Get Pro routes to the public pricing page. Story 2.2's
  // Customer Portal link will live separately for already-subscribed users.
  if (typeof window !== 'undefined') {
    window.location.assign('/pricing');
  } else {
    toast.info('Open /pricing to subscribe.');
  }
};

const DEFAULT_BUY_CREDITS = () => {
  // Story 2.3 will ship credit-pack purchase. Until then, surface the
  // intent so the click is never silently swallowed.
  toast.info('Credit packs ship in story 2.3.');
};

export function CoachGateInline({
  onUpgrade = DEFAULT_UPGRADE,
  onBuyCredits = DEFAULT_BUY_CREDITS,
}: CoachGateInlineProps) {
  return (
    <section
      className={`card ${s.gateCard}`}
      role="region"
      aria-label="Coach follow-up limit reached"
    >
      <div className={s.gateHeader}>
        <span className="label">Follow-ups used for this analysis</span>
      </div>
      <p className={s.gateBody}>Pro = pooled monthly coach access</p>
      <div className={s.gateActions}>
        <button type="button" className="btn primary" onClick={onUpgrade}>
          Get Pro
        </button>
        <button type="button" className="btn ghost" onClick={onBuyCredits}>
          or buy credits
        </button>
      </div>
    </section>
  );
}
