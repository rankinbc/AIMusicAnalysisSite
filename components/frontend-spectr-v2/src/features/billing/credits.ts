import { extractApiError } from '../../api/error-utils';
import { ApiError } from '../../api/fetcher';
import type { CreditCosts, EntitlementsDto, PlansResponse } from '../../api/types';

// Credit economy (PRPs/archive/2026-10-01_credit-economy.md) — what an action costs THIS user,
// derived from the server price list + their entitlements. Labels only:
// callers show `label`, and route an unaffordable click to the buy sheet.

export type PaidAction = 'analysis' | 'specialist' | 'coachMessage' | 'coachMix';

export interface ActionCost {
  credits: number;
  included: boolean;
  affordable: boolean;
  label: string;
}

const PRICE_KEY: Record<PaidAction, keyof CreditCosts> = {
  analysis: 'analysis',
  specialist: 'specialist',
  coachMessage: 'coachMessage',
  coachMix: 'coachMix',
};

function includedForPro(action: PaidAction, ent: EntitlementsDto): boolean {
  if (action === 'specialist' || action === 'coachMix') return true;
  if (action === 'analysis')
    return (ent.proAnalysesUsed ?? 0) < (ent.proAnalysesLimit ?? Number.POSITIVE_INFINITY);
  return !(ent.coach?.capReached ?? false); // coachMessage: inside the monthly pool
}

export function costOf(
  action: PaidAction,
  plans: PlansResponse | undefined,
  ent: EntitlementsDto | undefined,
  opts: { routed?: boolean } = {},
): ActionCost | null {
  if (!plans?.costs || !ent) return null;
  if (plans.creditsEnabled === false || ent.creditsEnabled === false) return null;
  const credits = plans.costs[PRICE_KEY[action]];
  const included =
    (action === 'specialist' && opts.routed === true) ||
    (ent.tier === 'pro' && includedForPro(action, ent));
  const affordable = included || (ent.creditBalance ?? 0) >= credits;
  return { credits, included, affordable, label: included ? 'Included' : `${credits} ◆` };
}

export function isOutOfCredits(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const code = extractApiError(err.body).code;
  return code === 'insufficient_credits' || code === 'entitlement_exhausted';
}
