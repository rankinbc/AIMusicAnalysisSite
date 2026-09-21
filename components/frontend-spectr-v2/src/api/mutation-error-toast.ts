// Wave-3 (audit remediation) — ONE shared error-feedback mechanism for
// mutations. A global MutationCache onError fires ONLY for mutations that
// opt in via `meta: { errorToast: '<fallback copy>' }`.
//
// Opt-IN, never opt-out: TanStack v5's MutationCache callbacks can see
// `mutation.options.onError` (the useMutation options) but NOT callbacks
// passed to `.mutate(vars, { onError })` — those live on the
// MutationObserver. An opt-out rule ("fire when the hook has no onError")
// would double-toast every call-site-handled mutation. Hooks whose call
// sites already toast (useCreateSuggestion, the src/api/hooks.ts sites…)
// must therefore never carry `meta.errorToast`.
import { MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';

import { openGuestUpgrade, type GuestUpgradeReason } from '../features/demo/guest-upgrade-bus';
import { capture } from '../lib/analytics';
import { extractApiError, extractApiMessage } from './error-utils';
import { ApiError } from './fetcher';

// D10 — task D6/G1 `details.reason` values (see guest-upgrade-bus.ts for the
// authoritative list + why "coach_limit" isn't one). An unrecognized value
// (a future reason this build doesn't know about yet) degrades to the
// generic copy rather than crashing the dialog.
const KNOWN_GUEST_REASONS: readonly GuestUpgradeReason[] = [
  'not_allowed',
  'upload_limit',
  'analysis_limit',
  'stems_limit',
  'reference_limit',
  'fix_rack_limit',
];

function guestUpgradeReason(raw: unknown): GuestUpgradeReason {
  return KNOWN_GUEST_REASONS.includes(raw as GuestUpgradeReason)
    ? (raw as GuestUpgradeReason)
    : 'not_allowed';
}

/**
 * D10 fix1 (item 1) — the ONE place that recognizes a guest_restricted 403.
 * Used by `createMutationCache` (below, for every `useMutation` in the app)
 * AND by every hand-written catch around a raw `fetcher()`/XHR call a guest
 * can reach (`UnifiedUploadDialog`'s own orchestration, the standalone
 * upload dialogs, the XHR upload hooks) — no second copy of the envelope
 * parsing.
 */
export function isGuestRestrictedError(error: unknown): error is ApiError {
  return error instanceof ApiError && extractApiError(error.body).code === 'guest_restricted';
}

/**
 * Full guest_restricted handling: opens the ONE upgrade dialog with the
 * server's reason + message and fires the analytics event exactly once.
 * Returns whether the error was a guest_restricted 403.
 *
 * Call this ONLY where nothing else already runs it for the same error —
 * `createMutationCache` (every `useMutation`) or a catch around a call that
 * bypasses `useMutation` entirely (raw `fetcher()`/XHR). A catch wrapping an
 * ALREADY-`useMutation`-backed call (its error already ran through
 * `createMutationCache`) should use `isGuestRestrictedError` instead, to
 * skip its own toast without re-firing the dialog/analytics a second time.
 */
export function handleGuestRestricted(error: unknown): boolean {
  if (!isGuestRestrictedError(error)) return false;
  const details = (error.body as { error?: { details?: { reason?: unknown } } } | undefined)
    ?.error?.details;
  const reason = guestUpgradeReason(details?.reason);
  capture('demo_guest_restricted', { reason });
  openGuestUpgrade(reason, extractApiMessage(error.body));
  return true;
}

/**
 * Toast a failed mutation's error iff the mutation opted in via
 * `meta.errorToast`. Message priority: the server's own wording (any of the
 * three parsed body shapes — never a raw "HTTP 500") → the meta fallback
 * string (also covers non-ApiError failures like a network TypeError).
 */
export function mutationErrorToast(
  error: unknown,
  mutation: { meta?: { errorToast?: string } | undefined },
): void {
  const fallback = mutation.meta?.errorToast;
  if (!fallback) return; // opt-in rule — no meta, no global toast
  const msg =
    error instanceof ApiError ? (extractApiMessage(error.body) ?? fallback) : fallback;
  toast.error(msg);
}

/**
 * The app's MutationCache. Exported as a factory so tests can construct a
 * QueryClient wired identically to main.tsx.
 */
export function createMutationCache(): MutationCache {
  return new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      // D10 — a guest_restricted 403 opens the ONE upgrade dialog instead of
      // the generic error toast, for EVERY mutation (opted into
      // meta.errorToast or not — this runs unconditionally, before the
      // opt-in check inside mutationErrorToast) and never falls through to
      // it, so the two surfaces can never fire for the same error.
      if (handleGuestRestricted(error)) return;
      mutationErrorToast(error, mutation);
    },
  });
}
