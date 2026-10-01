/* Pure "which specialists are running right now" resolution for the results
 * page. The BFF only reports idle | cached | failed per specialist — it has no
 * "running" state — so a run is tracked client-side from the moment it is
 * dispatched (user click in the Specialist Team modal, or the Triage auto-run)
 * until the verdicts poll shows that slug as cached/failed. */
import type { SpecialistStatus } from '../../../api/types';
import { TRIAGE_TIMEOUT_MS } from '../../../api/verdict-polling';

/** slug → epoch ms the run was dispatched. */
export type DispatchedRuns = ReadonlyMap<string, number>;

/** A dispatch that has not reported back within this window is treated as
 *  lost (budget refusal, dropped message, worker down) — same budget the
 *  verdicts poll gives up at, so the indicator never outlives the polling. */
export const RUN_EXPIRY_MS = TRIAGE_TIMEOUT_MS;

/** Slugs whose verdict has landed (cached) or whose run failed. */
export function settledSlugs(specialists: readonly SpecialistStatus[] | undefined): Set<string> {
  return new Set((specialists ?? []).filter((sp) => sp.status !== 'idle').map((sp) => sp.slug));
}

/** The truthful running set: dispatched, not yet settled, not expired. */
export function activeRunningSlugs(
  dispatched: DispatchedRuns,
  specialists: readonly SpecialistStatus[] | undefined,
  now: number = Date.now(),
): Set<string> {
  const settled = settledSlugs(specialists);
  const out = new Set<string>();
  for (const [slug, at] of dispatched) {
    if (settled.has(slug)) continue;
    if (now - at >= RUN_EXPIRY_MS) continue;
    out.add(slug);
  }
  return out;
}

/** "1 specialist running…" / "3 specialists running…" ('' when none). */
export function runningLabel(count: number): string {
  if (count <= 0) return '';
  return `${count} ${count === 1 ? 'specialist' : 'specialists'} running…`;
}
