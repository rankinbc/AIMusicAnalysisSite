// D10 — module-level pub/sub. The app's MutationCache is constructed once,
// outside React (main.tsx / mutation-error-toast.ts), so it can't reach the
// shell's dialog state via props or context. A guest_restricted 403 (or a
// proactive UI gate, e.g. UnifiedUploadDialog when the guest has no uploads
// left) calls `openGuestUpgrade`; `_app.tsx` is the ONE subscriber that owns
// the actual `<GuestUpgradeDialog>` open state.
//
// A Set, not an array: unsubscribe is O(1) and calling the returned function
// twice is a harmless no-op (Set.delete on a missing member is a no-op too).

// Task D6/G1 error `details.reason` values (BFF: GuestGuard.Restricted call
// sites in Services/GuestLimits.cs). "coach_limit" from the original task
// draft does not exist server-side — coach caps are a separate, non-guest-
// specific mechanism (CoachCapService) and never emit guest_restricted.
export type GuestUpgradeReason =
  | 'not_allowed'
  | 'upload_limit'
  | 'analysis_limit'
  | 'stems_limit'
  | 'reference_limit'
  | 'fix_rack_limit'
  | 'specialist_limit';

type Listener = (reason: GuestUpgradeReason, message?: string) => void;

const listeners = new Set<Listener>();

/** `message` is the server's own `error.message` when this came from a
 *  guest_restricted 403; omitted for a proactive (pre-request) UI gate. */
export function openGuestUpgrade(reason: GuestUpgradeReason, message?: string): void {
  for (const listener of listeners) listener(reason, message);
}

export function onGuestUpgrade(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
