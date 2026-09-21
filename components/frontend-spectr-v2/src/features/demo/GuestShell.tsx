import { useEffect, useState } from 'react';

import { GuestBanner } from './GuestBanner';
import { GuestUpgradeDialog } from './GuestUpgradeDialog';
import { onGuestUpgrade, type GuestUpgradeReason } from './guest-upgrade-bus';
import { useGuestState } from './useGuestState';

/**
 * D10 fix1 (item 5) — the guest banner + the ONE upgrade dialog + its bus
 * subscription, extracted from `_app.tsx` so the wiring (subscribe only for
 * a guest, unsubscribe on unmount) is unit-testable without mounting the
 * whole authenticated shell. `_app.tsx` keeps its own `useGuestState()` call
 * for the "+ Upload" swap / ⌘U gate — a second call here shares the same
 * `['me','guest']` query (TanStack Query dedupes by key), so this costs no
 * extra fetch.
 */
export function GuestShell() {
  const { isGuest } = useGuestState();
  // `message` stays required-but-nullable (not `message?:`) — the bus
  // callback always passes a value, possibly `undefined`, and
  // exactOptionalPropertyTypes rejects assigning `undefined` into an
  // optional field.
  const [upgrade, setUpgrade] = useState<{
    reason: GuestUpgradeReason;
    message: string | undefined;
  } | null>(null);

  useEffect(() => {
    // A real user can never receive a guest_restricted 403 (the server-side
    // check only applies to guest accounts) — skip the subscription
    // entirely rather than leaving a permanently-idle listener registered.
    if (!isGuest) return undefined;
    return onGuestUpgrade((reason, message) => setUpgrade({ reason, message }));
  }, [isGuest]);

  return (
    <>
      <GuestBanner />
      <GuestUpgradeDialog
        open={upgrade !== null}
        reason={upgrade?.reason ?? 'not_allowed'}
        {...(upgrade?.message !== undefined ? { message: upgrade.message } : {})}
        onOpenChange={(next) => {
          if (!next) setUpgrade(null);
        }}
      />
    </>
  );
}
