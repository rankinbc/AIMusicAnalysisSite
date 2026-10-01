/* Live findings on the analysis page — pure selection + ordering over the
 * verdicts poll. The right-column list shows the rule-engine (static
 * analysis) Problems as they land; each AI specialist's findings are listed
 * in its coach-chat message instead (coachNarration).
 *
 * Excluded: the worker's "Specialist failed" fail-marker (not a finding) and
 * anything the user dismissed. Order: severity (critical → win), then the
 * server's priority score. */
import type { Severity, VerdictDto } from '../../../api/types';
import { SEVERITY_RANK } from './severity';
import { FAIL_MARKER_HEADLINE, isRuleEngineVerdict } from './specialist-stage';

const sevRank = (v: VerdictDto): number => SEVERITY_RANK[v.severity as Severity] ?? 0;

/** Readable findings, most important first: no fail-marker, nothing the
 *  user dismissed, severity (critical → win) then priority score. */
export function sortFindings(verdicts: readonly VerdictDto[] | undefined): VerdictDto[] {
  return (verdicts ?? [])
    .filter((v) => v.headline && v.headline !== FAIL_MARKER_HEADLINE && !v.userState?.dismissed)
    .slice()
    .sort((a, b) => sevRank(b) - sevRank(a) || (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
}

/** The page's findings list: the static analysis' (rule-engine) findings.
 *  Specialists report theirs in the coach chat instead. */
export function ruleFindings(verdicts: readonly VerdictDto[] | undefined): VerdictDto[] {
  return sortFindings((verdicts ?? []).filter(isRuleEngineVerdict));
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
