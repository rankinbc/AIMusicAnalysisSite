import { GuestBanner } from './GuestBanner';
import { GuestUpgradeHost } from './GuestUpgradeHost';

/**
 * D10 fix1 (item 5) — the guest banner + the ONE upgrade dialog + its bus
 * subscription, extracted from `_app.tsx` so the wiring (subscribe only for
 * a guest, unsubscribe on unmount) is unit-testable without mounting the
 * whole authenticated shell. `_app.tsx` keeps its own `useGuestState()` call
 * for the "+ Upload" swap / ⌘U gate — a second call here (inside
 * `GuestUpgradeHost`) shares the same `['me','guest']` query (TanStack Query
 * dedupes by key), so this costs no extra fetch.
 *
 * Task G5 fix1 (item 1) — the dialog + subscription now live in
 * `GuestUpgradeHost`, reused as-is here AND lazy-loaded standalone (no
 * banner) on the public `/analyze` page, which has no `GuestShell`.
 */
export function GuestShell() {
  return (
    <>
      <GuestBanner />
      <GuestUpgradeHost />
    </>
  );
}
