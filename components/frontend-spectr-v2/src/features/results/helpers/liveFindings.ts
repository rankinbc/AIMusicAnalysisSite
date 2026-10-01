/* Live findings on the analysis page — pure selection + ordering over the
 * verdicts poll. The right-column list shows the rule-engine (static
 * analysis) Problems as they land, plus each AI specialist's findings once
 * that specialist settles (its verdict rows are written when it finishes);
 * the specialists also list theirs in their coach-chat message.
 *
 * Merging: a specialist finding replaces a rule finding ONLY when the data
 * links them — its `refines` names the rule Problem's `problemId` (set by the
 * composite refiner). Similar-looking findings without that link both show.
 *
 * Excluded: the worker's "Specialist failed" fail-marker (not a finding) and
 * anything the user dismissed. Order: severity (critical → win), then the
 * server's priority score. */
import type { Severity, VerdictDto } from '../../../api/types';
import { SEVERITY_RANK } from './severity';
import { FAIL_MARKER_HEADLINE, isRuleEngineVerdict } from './specialist-stage';
import { SPECIALIST_CATALOG, type SpecialistGroup } from './specialists';

const sevRank = (v: VerdictDto): number => SEVERITY_RANK[v.severity as Severity] ?? 0;

/** Readable findings, most important first: no fail-marker, nothing the
 *  user dismissed, severity (critical → win) then priority score. */
export function sortFindings(verdicts: readonly VerdictDto[] | undefined): VerdictDto[] {
  return (verdicts ?? [])
    .filter((v) => v.headline && v.headline !== FAIL_MARKER_HEADLINE && !v.userState?.dismissed)
    .slice()
    .sort((a, b) => sevRank(b) - sevRank(a) || (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
}

/** One row of the page's findings list. */
export interface ListFinding {
  v: VerdictDto;
  /** The rule finding this one refines (merged into this row). */
  refines?: VerdictDto | undefined;
}

/** The page's findings list: rule-engine findings + specialist findings,
 *  most important first, with refined rule findings folded into the
 *  specialist finding that refines them. */
export function listFindings(verdicts: readonly VerdictDto[] | undefined): ListFinding[] {
  const all = sortFindings(verdicts);
  const rulesByProblem = new Map(
    all.filter((v) => isRuleEngineVerdict(v) && v.problemId).map((v) => [v.problemId!, v]),
  );
  const refined = new Set<string>();
  const rows: ListFinding[] = [];
  for (const v of all) {
    if (isRuleEngineVerdict(v)) continue;
    const parent = v.refines ? rulesByProblem.get(v.refines) : undefined;
    if (parent) refined.add(parent.id);
    rows.push(parent ? { v, refines: parent } : { v });
  }
  for (const v of all) {
    if (isRuleEngineVerdict(v) && !refined.has(v.id)) rows.push({ v });
  }
  return rows.sort((a, b) => sevRank(b.v) - sevRank(a.v) || (b.v.priorityScore ?? 0) - (a.v.priorityScore ?? 0));
}

/** Who produced a finding: the rules (labelled by area) or a specialist
 *  (its roster label + group, for the tint and bot head). */
export type FindingSource =
  | { kind: 'rules'; label: string }
  | { kind: 'specialist'; label: string; group: SpecialistGroup };

export function findingSource(v: VerdictDto): FindingSource {
  if (isRuleEngineVerdict(v)) return { kind: 'rules', label: findingArea(v) };
  const meta = SPECIALIST_CATALOG.find((m) => m.slug === v.specialist);
  return { kind: 'specialist', label: meta?.label ?? titleize(v.specialist), group: meta?.group ?? 'Misc' };
}

/** A finding's area label ("Low Mid", "Loudness"…) from its category. */
export function findingArea(v: VerdictDto): string {
  return titleize(v.category || '') || 'Measured';
}

function titleize(s: string): string {
  return s
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The expandable detail: summary/body prose, why it matters, the metric. */
export function findingDetail(v: VerdictDto): { text: string[]; why: string | null; metric: string | null } {
  const text = [v.summary, v.body].filter((t): t is string => Boolean(t && t.trim()));
  // Some rows repeat the summary as the body's opening — show it once.
  const deduped = text.length === 2 && text[1]!.startsWith(text[0]!) ? [text[1]!] : text;
  return { text: deduped, why: v.whyItMatters || null, metric: v.metricLine || null };
}
