/* What a LOGGED-OUT page may know about pricing. One request per page load,
 * shared by every caller; never rejects. Provider-free on purpose — it is
 * read by PublicChrome, which must stay static-render testable. */
import { useEffect, useState } from 'react';
import type { PlansResponse } from '../api/types';
let inflight: Promise<PlansResponse | null> | null = null;
export function loadPublicPlans(): Promise<PlansResponse | null> {
  inflight ??= (async () => {
    try {
      const res = await fetch('/api/billing/plans', { headers: { Accept: 'application/json' } });
      return res.ok ? ((await res.json()) as PlansResponse) : null;
    } catch {
      return null;
    }
  })();
  return inflight;
}
export function resetPublicPlansForTests(): void { inflight = null; }
/** true/false only when the server said so; null = unknown → callers HIDE. */
export function useCreditsEnabled(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPublicPlans().then((p) => {
      if (alive) setValue(typeof p?.creditsEnabled === 'boolean' ? p.creditsEnabled : null);
    });
    return () => { alive = false; };
  }, []);
  return value;
}
/** The sign-up bonus a logged-out visitor may be told about: a positive
 *  number ONLY when the server says credits are on AND a bonus is set;
 *  null otherwise (loading, credits off, unknown, no bonus) → show nothing. */
export function signupBonusFrom(p: PlansResponse | null): number | null {
  if (p?.creditsEnabled !== true) return null;
  const n = p.signupBonusCredits;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}
export function usePublicSignupBonus(): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPublicPlans().then((p) => {
      if (alive) setValue(signupBonusFrom(p));
    });
    return () => { alive = false; };
  }, []);
  return value;
}
