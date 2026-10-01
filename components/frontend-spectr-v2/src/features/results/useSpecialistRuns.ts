import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useRunSpecialist, useVerdicts } from '../../api/hooks';
import { useBuyCredits } from '../billing/BuyCreditsProvider';
import { isOutOfCredits } from '../billing/credits';
import type { VerdictsListResponse } from '../../api/types';
import { SPECIALIST_CATALOG } from './helpers/specialists';
import { hasSpecialistVerdict } from './helpers/specialist-stage';
import {
  RUN_EXPIRY_MS,
  activeRunningSlugs,
  settledSlugs,
  type DispatchedRuns,
} from './helpers/specialist-runs';

interface Options {
  jobId: string;
  analysisId: string;
  /** Whether the analysis has stems — stem-only specialists are never auto-run without them. */
  hasStems: boolean;
}

export interface SpecialistRuns {
  data: VerdictsListResponse | undefined;
  /** Dispatched, not yet cached/failed, not expired. */
  running: ReadonlySet<string>;
  /** Specialists with a cached or failed status. */
  ranSlugs: ReadonlySet<string>;
  /** User-initiated run (toasts on dispatch failure). */
  runSpecialist: (slug: string) => Promise<void>;
}

/** Single owner of the results page's specialist run state: the verdicts
 *  query (polling while anything runs), the Triage auto-run, and user-clicked
 *  runs. Lifted out of CoachTab so the header's "N specialists running…"
 *  indicator and the Specialist Team roster read the SAME running set. */
export function useSpecialistRuns({ jobId, analysisId, hasStems }: Options): SpecialistRuns {
  const [dispatched, setDispatched] = useState<DispatchedRuns>(() => new Map());
  // Expiry clock — bumped by the timer below (never read Date.now() in render).
  const [clock, setClock] = useState(() => Date.now());

  // Poll while anything is dispatched (settled entries are pruned below;
  // optimisticRefetchMs bounds a run that never reports back).
  const pollSet = useMemo<ReadonlySet<string>>(() => new Set(dispatched.keys()), [dispatched]);
  const { data } = useVerdicts(jobId, { optimisticRunning: pollSet, enabled: true });
  const run = useRunSpecialist(jobId);
  const buyCredits = useBuyCredits();

  const running = useMemo(
    () => activeRunningSlugs(dispatched, data?.specialists, clock),
    [dispatched, data, clock],
  );
  const ranSlugs = useMemo(() => settledSlugs(data?.specialists), [data]);

  // Drop settled entries so a later re-run of the same slug starts fresh.
  useEffect(() => {
    const settled = settledSlugs(data?.specialists);
    setDispatched((prev) => {
      let changed = false;
      const next = new Map<string, number>();
      for (const [slug, at] of prev) {
        if (settled.has(slug)) changed = true;
        else next.set(slug, at);
      }
      return changed ? next : prev;
    });
  }, [data]);

  // Expire runs that never reported back, so the indicator can't spin forever.
  useEffect(() => {
    if (dispatched.size === 0) return undefined;
    const earliest = Math.min(...dispatched.values());
    const wait = Math.max(0, earliest + RUN_EXPIRY_MS - Date.now()) + 50;
    const t = setTimeout(() => {
      const now = Date.now();
      setClock(now);
      setDispatched((prev) => {
        const next = new Map<string, number>();
        for (const [slug, at] of prev) if (now - at < RUN_EXPIRY_MS) next.set(slug, at);
        return next.size === prev.size ? prev : next;
      });
    }, wait);
    return () => clearTimeout(t);
  }, [dispatched]);

  const markDispatched = useCallback((slug: string) => {
    setDispatched((prev) => new Map(prev).set(slug, Date.now()));
  }, []);
  const unmark = useCallback((slug: string) => {
    setDispatched((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Map(prev);
      next.delete(slug);
      return next;
    });
  }, []);

  const runSpecialist = useCallback(
    async (slug: string): Promise<void> => {
      markDispatched(slug);
      try {
        await run.mutateAsync(slug);
      } catch (err) {
        unmark(slug);
        if (isOutOfCredits(err)) {
          buyCredits.open({
            title: 'Not enough credits',
            onBought: () => void runSpecialist(slug),
          });
          return;
        }
        toast.error(err instanceof Error ? err.message : 'Could not start specialist');
      }
    },
    [run, markDispatched, unmark, buyCredits],
  );

  // Auto-run the Triage-suggested specialists on the initial view so the
  // rack-backed suggested fixes actually appear. Fires once per analysis, only
  // when no AI verdict has landed yet, and skips stem-only specialists.
  const autoRanRef = useRef<string | null>(null);
  useEffect(() => {
    const plan = data?.routingPlan;
    if (!plan || autoRanRef.current === analysisId) return;
    autoRanRef.current = analysisId;
    // Already have AI fixes. Specialist verdicts carry `specialist = <slug>`
    // (their `source` is the 'rule_engine' column default — never key on it).
    if (hasSpecialistVerdict(data.verdicts)) return;
    const already = settledSlugs(data.specialists);
    for (const entry of plan.specialistsToRun) {
      const meta = SPECIALIST_CATALOG.find((s) => s.slug === entry.name);
      if (already.has(entry.name)) continue;
      if (meta?.needsStems && !hasStems) continue;
      markDispatched(entry.name);
      void run.mutateAsync(entry.name).catch(() => unmark(entry.name));
    }
  }, [data, analysisId, hasStems, run, markDispatched, unmark]);

  return { data, running, ranSlugs, runSpecialist };
}
