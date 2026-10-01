/* The "AI specialists" stage of the Analysis Complete modal — pure derivation
 * of which routed specialists are part of this run and where each one is.
 *
 * Mirrors the Triage auto-run in useSpecialistRuns (the modal never dispatches
 * anything itself, it only narrates what that hook is doing):
 *  - stem-only specialists are skipped when the analysis has no stems;
 *  - when an AI verdict already existed, the auto-run does not fire, so a
 *    specialist that is neither settled nor running will never run here and
 *    is left out of the stage instead of spinning forever.
 * Settled = cached (done) or failed, exactly as settledSlugs() defines it.
 *
 * Whose verdict is whose: a specialist's own (LLM) verdicts are stored with
 * `specialist = <slug>` — and `source = 'rule_engine'`, the column default the
 * specialist actor leaves in place (the worker's idempotency guard keys on
 * that value, so it is NOT changed). Rule-engine Problems use
 * `specialist = 'rule_engine.<rule>'`. So: findings for slug X are the
 * verdicts with `specialist === X`, minus the "Specialist failed" marker.
 * Never filter on `source` here. */
import type { RoutingPlanDto, SpecialistStatus, VerdictDto } from '../../../api/types';
import { SPECIALIST_CATALOG, type SpecialistGroup } from './specialists';

export type StageRowState = 'queued' | 'running' | 'done' | 'failed';

export interface StageRow {
  slug: string;
  label: string;
  group: SpecialistGroup;
  focus: string;
  state: StageRowState;
  /** Verdicts this specialist produced (done rows only). */
  findings?: number | undefined;
}

export interface SpecialistStage {
  /** Triage has produced a routing plan. */
  planReady: boolean;
  rows: StageRow[];
  settled: number;
  total: number;
  /** Plan is in and every row is done/failed (true for a zero-row plan). */
  complete: boolean;
}

export interface SpecialistStageInput {
  routingPlan: RoutingPlanDto | undefined;
  specialists: readonly SpecialistStatus[] | undefined;
  running: ReadonlySet<string> | undefined;
  verdicts: readonly VerdictDto[] | undefined;
  hasStems: boolean;
  /** The worker lane runs one specialist at a time (guest pool): only the
   *  first unsettled specialist is shown running, the rest queued. */
  sequential?: boolean | undefined;
}

// The worker's fail-marker verdict (run_specialist writes it on exception).
export const FAIL_MARKER_HEADLINE = 'Specialist failed';

/** A routed specialist's own findings (fail-marker excluded). */
export function specialistFindings(
  verdicts: readonly VerdictDto[] | undefined,
  slug: string,
): VerdictDto[] {
  return (verdicts ?? []).filter((v) => v.specialist === slug && v.headline !== FAIL_MARKER_HEADLINE);
}

/** Rule-engine (deterministic) Problems — `specialist = 'rule_engine.<rule>'`. */
export function isRuleEngineVerdict(v: VerdictDto): boolean {
  return v.specialist === 'rule_engine' || v.specialist.startsWith('rule_engine.');
}

/** Some specialist already produced verdicts for this analysis — the Triage
 *  auto-run (useSpecialistRuns) then does not fire again. */
export function hasSpecialistVerdict(verdicts: readonly VerdictDto[] | undefined): boolean {
  return (verdicts ?? []).some(
    (v) => !isRuleEngineVerdict(v) && SPECIALIST_CATALOG.some((m) => m.slug === v.specialist),
  );
}

export function deriveSpecialistStage(input: SpecialistStageInput): SpecialistStage {
  const plan = input.routingPlan;
  if (!plan) return { planReady: false, rows: [], settled: 0, total: 0, complete: false };

  const statusOf = new Map((input.specialists ?? []).map((s) => [s.slug, s.status]));
  const running = input.running ?? new Set<string>();
  const verdicts = input.verdicts ?? [];
  const aiAlreadyRan = hasSpecialistVerdict(verdicts);

  const rows: StageRow[] = [];
  const ordered = (plan.specialistsToRun ?? []).slice().sort((a, b) => a.priority - b.priority);
  for (const entry of ordered) {
    const meta = SPECIALIST_CATALOG.find((m) => m.slug === entry.name);
    if (meta?.needsStems && !input.hasStems) continue;
    const st = statusOf.get(entry.name);
    let state: StageRowState;
    if (st === 'cached') state = 'done';
    else if (st === 'failed') state = 'failed';
    else if (running.has(entry.name)) state = 'running';
    else if (aiAlreadyRan) continue; // auto-run skipped — this one will not run now
    else state = 'queued'; // plan just landed; dispatch is a tick away
    const row: StageRow = {
      slug: entry.name,
      label: meta?.label ?? entry.name,
      group: meta?.group ?? 'Misc',
      focus: entry.focus,
      state,
    };
    if (state === 'done') row.findings = specialistFindings(verdicts, entry.name).length;
    rows.push(row);
  }

  if (input.sequential) {
    let first = true;
    for (const r of rows) {
      if (r.state !== 'running' && r.state !== 'queued') continue;
      r.state = first ? 'running' : 'queued';
      first = false;
    }
  }

  const settled = rows.filter((r) => r.state === 'done' || r.state === 'failed').length;
  return { planReady: true, rows, settled, total: rows.length, complete: settled === rows.length };
}

/** "3 findings" / "1 finding" / "no issues" — '' when unknown. */
export function findingsLabel(n: number | undefined): string {
  if (n === undefined) return '';
  if (n === 0) return 'no issues';
  return `${n} finding${n === 1 ? '' : 's'}`;
}
