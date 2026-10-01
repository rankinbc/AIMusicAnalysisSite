/* "How far does a pack go?" — pure maths over the SERVER price list, so the
 * pricing page never states an equivalence the API didn't imply. A cost of 0
 * means the action is free (no meaningful "N of these" count) → null. */
import type { CreditCosts } from '../../api/types';

export interface PackReach {
  analyses: number | null;
  coachMessages: number | null;
}

/** How many whole uses of `cost` a balance of `credits` buys; null when the
 *  action is free or the inputs aren't sane numbers. */
export function usesFor(credits: number, cost: number): number | null {
  if (!Number.isFinite(credits) || !Number.isFinite(cost) || cost <= 0 || credits < 0) return null;
  return Math.floor(credits / cost);
}

export function packReach(credits: number, costs: CreditCosts): PackReach {
  return {
    analyses: usesFor(credits, costs.analysis),
    coachMessages: usesFor(credits, costs.coachMessage),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "≈ 5 analyses or 100 coach messages" — or null when nothing is countable. */
export function packReachLabel(credits: number, costs: CreditCosts): string | null {
  const r = packReach(credits, costs);
  const parts: string[] = [];
  if (r.analyses !== null) parts.push(plural(r.analyses, 'analysis', 'analyses'));
  if (r.coachMessages !== null) parts.push(plural(r.coachMessages, 'coach message', 'coach messages'));
  return parts.length ? `≈ ${parts.join(' or ')}` : null;
}
