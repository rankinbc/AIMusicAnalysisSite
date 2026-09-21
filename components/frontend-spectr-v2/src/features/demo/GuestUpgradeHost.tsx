import { useEffect, useState } from 'react';

import { GuestUpgradeDialog } from './GuestUpgradeDialog';
import { onGuestUpgrade, type GuestUpgradeReason } from './guest-upgrade-bus';
import { useGuestState } from './useGuestState';

/**
 * Task G5 fix1 (item 1) — the bus subscription + the ONE upgrade dialog,
 * extracted out of `GuestShell` so it can be mounted WITHOUT the banner.
 * `GuestShell` (`_app.tsx`, authed shell) renders banner + this; the public
 * `/analyze` page (no `_app`, no `GuestShell`) mounts this alone (already its
 * own TanStack Router route chunk, so this never reaches the shared public
 * entry chunk) — a guest who hits a limit there gets the same dialog every
 * other guest limit opens, instead of a silent dead end (nothing was
 * listening on the bus).
 */
export function GuestUpgradeHost() {
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
    <GuestUpgradeDialog
      open={upgrade !== null}
      reason={upgrade?.reason ?? 'not_allowed'}
      {...(upgrade?.message !== undefined ? { message: upgrade.message } : {})}
      onOpenChange={(next) => {
        if (!next) setUpgrade(null);
      }}
    />
  );
}
