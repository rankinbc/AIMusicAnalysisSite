import { useCallback } from 'react';

import { useEntitlements, usePlans } from '../../api/hooks';
import { useOptionalAuth } from '../../auth/AuthContext';
import { useBuyCredits } from './BuyCreditsProvider';
import { costOf } from './credits';
import type { ActionCost, PaidAction } from './credits';
import s from './CostTag.module.css';

// Credit economy — "what will this cost me" next to every paid action.

// Hook lives beside its component (brief); the lint rule is about fast-refresh only.
// eslint-disable-next-line react-refresh/only-export-components
export function usePaidAction(action: PaidAction, opts: { routed?: boolean } = {}) {
  const { data: plans } = usePlans();
  const { data: ent } = useEntitlements();
  const { open } = useBuyCredits();
  // Guests (users.is_guest) are never charged and never granted credits —
  // every BFF charge site skips them and their limits come back as a
  // guest_restricted 403 (→ GuestUpgradeDialog via the mutation cache).
  // Their entitlements still say tier "free" / balance 0, so without this a
  // guest saw "15 ◆" tags and a buy sheet for actions the server runs free.
  const isGuest = useOptionalAuth()?.user?.isGuest === true;
  const cost: ActionCost | null = isGuest ? null : costOf(action, plans, ent, opts);
  const guard = useCallback(
    (run: () => void) => {
      if (cost && !cost.affordable) {
        open({
          title: 'Not enough credits',
          description: `This costs ${cost.credits} credits and you have ${ent?.creditBalance ?? 0}.`,
          onBought: run,
        });
        return;
      }
      run();
    },
    [cost, ent?.creditBalance, open],
  );
  return { cost, guard };
}

export function CostTag({ action, routed }: { action: PaidAction; routed?: boolean }) {
  const { cost } = usePaidAction(action, routed === undefined ? {} : { routed });
  if (!cost) return null;
  return (
    <span className={`mono ${s.tag}`} data-included={cost.included} data-short={!cost.affordable}>
      {cost.label}
    </span>
  );
}
