// Wave-3 (audit remediation) — ONE shared error-feedback mechanism for
// mutations. A global MutationCache onError fires ONLY for mutations that
// opt in via `meta: { errorToast: '<fallback copy>' }`.
//
// Opt-IN, never opt-out: TanStack v5's MutationCache callbacks can see
// `mutation.options.onError` (the useMutation options) but NOT callbacks
// passed to `.mutate(vars, { onError })` — those live on the
// MutationObserver. An opt-out rule ("fire when the hook has no onError")
// would double-toast every call-site-handled mutation. Hooks whose call
// sites already toast (useCreateSuggestion, usePostAnonComment, the
// src/api/hooks.ts sites…) must therefore never carry `meta.errorToast`.
import { MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';

import { extractApiMessage } from './error-utils';
import { ApiError } from './fetcher';

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
    onError: (error, _vars, _ctx, mutation) => mutationErrorToast(error, mutation),
  });
}
