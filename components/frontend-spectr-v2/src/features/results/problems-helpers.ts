import type { ProblemWhere, VerdictDto } from '../../api/types';
import { SEVERITY_RANK } from './helpers/severity';

// Pure grouping/ordering/threading for the Problems tab — kept out of the
// component file (react-refresh) and unit-tested.

export type Tier = 'audio_only' | 'stems' | 'project_midi';

export const TIER_ORDER: Tier[] = ['audio_only', 'stems', 'project_midi'];

export const TIER_LABEL: Record<Tier, string> = {
  audio_only: 'From your mix',
  stems: 'From your stems',
  project_midi: 'From your project',
};

export interface ProblemNode {
  problem: VerdictDto;
  children: VerdictDto[];
}
export interface ProblemGroup {
  tier: Tier;
  nodes: ProblemNode[];
}

function rank(v: VerdictDto): number {
  return SEVERITY_RANK[v.severity as keyof typeof SEVERITY_RANK] ?? 0;
}

function bySeverityThenPriority(a: VerdictDto, b: VerdictDto): number {
  return rank(b) - rank(a) || b.priorityScore - a.priorityScore;
}

/** Top-level problems grouped by dataTier (severity→priority sorted), with
 *  refines-children nested under their parent and excluded from the flat list. */
export function groupProblems(verdicts: VerdictDto[]): ProblemGroup[] {
  const present = new Set(verdicts.map((v) => v.problemId).filter(Boolean) as string[]);

  const childrenOf = new Map<string, VerdictDto[]>();
  const isChild = new Set<string>();
  for (const v of verdicts) {
    if (v.refines && present.has(v.refines)) {
      (childrenOf.get(v.refines) ?? childrenOf.set(v.refines, []).get(v.refines)!).push(v);
      if (v.problemId) isChild.add(v.problemId);
    }
  }

  return TIER_ORDER.map((tier) => {
    const tops = verdicts
      .filter((v) => (v.dataTier as Tier) === tier && !(v.problemId && isChild.has(v.problemId)))
      .sort(bySeverityThenPriority);
    const nodes: ProblemNode[] = tops.map((problem) => ({
      problem,
      children: (problem.problemId ? (childrenOf.get(problem.problemId) ?? []) : [])
        .slice()
        .sort(bySeverityThenPriority),
    }));
    return { tier, nodes };
  });
}

/** Fault problems only — the tab badge count. */
export function faultCount(verdicts: VerdictDto[]): number {
  return verdicts.filter((v) => v.kind === 'fault').length;
}

function mmss(s?: number): string {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** "drop · 2:33–3:35" or null when there's no localization. */
export function formatWhere(where: ProblemWhere | null | undefined): string | null {
  if (!where) return null;
  const range =
    where.start_seconds != null && where.end_seconds != null
      ? `${mmss(where.start_seconds)}–${mmss(where.end_seconds)}`
      : '';
  const label = where.section_type ?? 'section';
  return range ? `${label} · ${range}` : label;
}
