// The Move model — the atom of the Actions tab.
//
// A "Move" is a prescription: lead with the directive (what to DO), bury the
// numbers. One schema, three renderers: the web MoveCard, the .md export, and
// (future) auto-verify. Built from two sources:
//   - AI specialist verdicts (`VerdictDto`, with structured `fix.dsp_chain`)
//   - the free rule-engine baseline (`FinalJson.top_fixes` / `coached_fixes`,
//     plain strings → always *directional*, never fabricated params).
//
// Principle: render exact `steps`/params ONLY when the data backs them
// (`fix.dsp_chain` carries concrete ops). Otherwise render `directional` prose.

import type { Severity, VerdictDspOp, VerdictDto } from '../../api/types';
import { SPECIALIST_CATALOG, specialistGroup } from './helpers/specialists';

/** Prototype's 4 severity tones (the app's 5-level vocab folds into these). */
export type MoveSev = 'crit' | 'warn' | 'info' | 'low';

/** Triage lifecycle. `committed` is the only state exported to .md.
 *  `suggested`/`dismissed`/`committed` persist (→ verdict userState);
 *  `trying` is local-only (auditioning on the Listen page). */
export type MoveStatus = 'suggested' | 'trying' | 'committed' | 'dismissed';

export type MoveGroup = 'quick' | 'deep';

export interface MoveStep {
  /** The device / op (e.g. "eq", "limiter", "Master bus"). */
  where: string;
  /** Concrete params, already formatted (e.g. "freq=120, gain=-3"). Empty when
   *  the op carried none — we never invent values. */
  detail: string;
}

export interface MoveEvidence {
  type: 'meter' | 'spectrum' | 'structure' | 'none';
  /** One-line measured fact (`VerdictDto.metricLine`). */
  metric: string;
  /** `VerdictDto.chartType`, when the card can deep-link to a chart. */
  chartType: string | null;
}

export interface Move {
  id: string;
  /** Imperative action — the card heading. */
  title: string;
  group: MoveGroup;
  sev: MoveSev;
  /** Where to act: `fix.target.name` ("Master bus", "Bar 109–112") or category. */
  scope: string;
  /** The directive (the hero). Precise prose when params back it, else the
   *  directional fallback — `MoveCard` picks based on `hasParams`. */
  directive: string;
  directional: string;
  /** Structured directive — present only when `hasParams`. */
  steps: MoveStep[];
  /** True when `fix.dsp_chain` carried concrete ops → render exact steps. */
  hasParams: boolean;
  /** One-line rationale (behind the `why ▾` toggle). */
  why: string;
  evidence: MoveEvidence;
  /** 0..1 → "NN% conf"; the one number shown up front (the rank signal). */
  confidence: number;
  /** Priority/impact score 0..100 — `VerdictDto.priorityScore` for AI Moves,
   *  derived from severity for the rule-engine baseline. Drives the impact tag. */
  impact: number;
  /** "rule engine" or the specialist's display label. */
  source: string;
  /** True for the free rule-engine baseline (rendered with a `RULE` chip rather
   *  than an AI persona chip — provenance, UX-DR42). */
  isRule: boolean;
  /** Specialist slug for AI Moves (drives the persona chip's group + color);
   *  null for rule-engine Moves. */
  specialist: string | null;
  status: MoveStatus;
  /** The originating verdict id, when this Move came from a specialist. Null for
   *  rule-engine Moves (which have no server-side userState to toggle). */
  verdictId: string | null;
  /** Raw solver DSP ops (`fix.dsp_chain`), structured — drives the Listen rack
   *  apply. Empty for rule-engine moves and verdicts without a fix. */
  ops: VerdictDspOp[];
}

export interface ImpactBand {
  label: string;
  glyph: string;
  tone: string;
}

/** Map a 0..100 priority/impact score to a display band. */
export function impactBand(impact: number): ImpactBand {
  if (impact >= 75) return { label: 'HIGH IMPACT', glyph: '↑↑', tone: 'var(--orange)' };
  if (impact >= 45) return { label: 'MED IMPACT', glyph: '↑', tone: 'var(--yellow)' };
  return { label: 'LOW IMPACT', glyph: '·', tone: 'var(--muted)' };
}

/** Rule-engine Moves carry no per-finding priority score, so derive a stable
 *  impact from severity (keeps the baseline ranked sensibly without inventing
 *  precision we don't have). */
const RULE_IMPACT_BY_SEV: Record<MoveSev, number> = {
  crit: 80,
  warn: 60,
  info: 38,
  low: 22,
};

const SPECIALIST_LABEL = new Map(SPECIALIST_CATALOG.map((m) => [m.slug, m.label]));

/** App's 5-level severity → the prototype's 4 tones. moderate stays amber
 *  (a genuine warning); minor → info (slate); win → low (green). */
export function toMoveSev(severity: Severity | string): MoveSev {
  switch (severity) {
    case 'critical':
      return 'crit';
    case 'severe':
    case 'moderate':
      return 'warn';
    case 'minor':
      return 'info';
    case 'win':
      return 'low';
    default:
      return 'info';
  }
}

/** Sort weight — crit leads, low trails. */
export const MOVE_SEV_RANK: Record<MoveSev, number> = {
  crit: 4,
  warn: 3,
  info: 2,
  low: 1,
};

function statusFromUserState(u: VerdictDto['userState']): MoveStatus {
  if (u.applied) return 'committed';
  if (u.dismissed) return 'dismissed';
  return 'suggested';
}

/** Arrangement / structural fixes are "deeper work"; everything else (spectral,
 *  loudness, stereo, dynamics, plus the rule-engine baseline) is a quick win. */
function groupForSpecialist(specialist: string): MoveGroup {
  return specialistGroup(specialist) === 'Sections' ? 'deep' : 'quick';
}

function formatParam(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (v === null || v === undefined) return '';
  return String(v);
}

function opToStep(op: VerdictDspOp): MoveStep {
  const detail = Object.entries(op.params)
    .map(([k, v]) => {
      const fv = formatParam(v);
      return fv ? `${k}=${fv}` : k;
    })
    .filter(Boolean)
    .join(', ');
  return { where: op.type, detail };
}

function evidenceType(chartType: string | null): MoveEvidence['type'] {
  if (!chartType) return 'none';
  if (/spectr|freq|band|eq/i.test(chartType)) return 'spectrum';
  if (/struct|section|arrange|timeline/i.test(chartType)) return 'structure';
  return 'meter';
}

/** AI specialist verdict → Move. */
export function verdictToMove(v: VerdictDto): Move {
  const ops = v.fix?.dsp_chain ?? [];
  const steps = ops.map(opToStep);
  const hasParams = steps.length > 0;
  const scope = v.fix?.target?.name?.trim() || prettifyCategory(v.category);
  const directive =
    v.fix?.expected_outcome?.trim() || v.body?.trim() || v.summary?.trim() || v.headline;
  const directional = v.summary?.trim() || v.whyItMatters?.trim() || directive;

  return {
    id: v.id,
    title: v.headline,
    group: groupForSpecialist(v.specialist),
    sev: toMoveSev(v.severity),
    scope,
    directive,
    directional,
    steps,
    hasParams,
    why: v.whyItMatters?.trim() || v.body?.trim() || '',
    evidence: {
      type: evidenceType(v.chartType),
      metric: v.metricLine?.trim() ?? '',
      chartType: v.chartType,
    },
    confidence: clamp01(v.confidence),
    impact: clampImpact(v.priorityScore),
    source: SPECIALIST_LABEL.get(v.specialist) ?? prettifyCategory(v.specialist),
    isRule: false,
    specialist: v.specialist,
    status: statusFromUserState(v.userState),
    verdictId: v.id,
    ops,
  };
}

/** Rule-engine baseline string → directional Move (the free plan). No params,
 *  so it never shows fabricated values. */
export function ruleFixToMove(
  text: string,
  index: number,
  opts: { coached?: boolean } = {},
): Move {
  const trimmed = text.trim();
  const { title, scope } = splitScope(trimmed);
  return {
    id: `rule-${opts.coached ? 'c' : 't'}-${index}`,
    title,
    group: 'quick',
    sev: 'info',
    scope,
    directive: trimmed,
    directional: trimmed,
    steps: [],
    hasParams: false,
    why: '',
    evidence: { type: 'none', metric: '', chartType: null },
    // Rule-engine findings are deterministic measurements → high confidence,
    // but they carry no per-finding score, so we use a fixed baseline that
    // still ranks them above unproven low-confidence specialist guesses.
    confidence: 0.9,
    impact: RULE_IMPACT_BY_SEV.info,
    source: 'rule engine',
    isRule: true,
    specialist: null,
    status: 'suggested',
    verdictId: null,
    ops: [],
  };
}

/** Build the full Move list: free rule-engine baseline + AI specialist Moves.
 *  Dismissed Moves are dropped. Sorted by group then severity then confidence. */
export function buildMoves(input: {
  verdicts: VerdictDto[];
  topFixes?: string[] | undefined;
  coachedFixes?: string[] | undefined;
}): Move[] {
  const ruleMoves = dedupeRuleMoves([
    ...(input.topFixes ?? []).map((t, i) => ruleFixToMove(t, i)),
    ...(input.coachedFixes ?? []).map((t, i) => ruleFixToMove(t, i, { coached: true })),
  ]);
  // A fail-marker verdict ("Specialist failed") isn't a Move.
  const aiMoves = input.verdicts
    .filter((v) => v.headline !== 'Specialist failed')
    .map(verdictToMove);
  return [...ruleMoves, ...aiMoves]
    .filter((m) => m.status !== 'dismissed')
    .sort(compareMoves);
}

export function groupMoves(moves: Move[]): { quick: Move[]; deep: Move[] } {
  return {
    quick: moves.filter((m) => m.group === 'quick'),
    deep: moves.filter((m) => m.group === 'deep'),
  };
}

/** A "clean mix" has no crit/warn Moves — lead with polish, not invented problems. */
export function isCleanMix(moves: Move[]): boolean {
  return moves.length > 0 && moves.every((m) => m.sev === 'info' || m.sev === 'low');
}

function compareMoves(a: Move, b: Move): number {
  if (a.group !== b.group) return a.group === 'quick' ? -1 : 1;
  const sev = MOVE_SEV_RANK[b.sev] - MOVE_SEV_RANK[a.sev];
  if (sev !== 0) return sev;
  return b.confidence - a.confidence;
}

/** Rule-engine top_fixes and coached_fixes often restate the same issue. Drop
 *  near-duplicates (case/space-insensitive prefix match). */
function dedupeRuleMoves(moves: Move[]): Move[] {
  const seen = new Set<string>();
  const out: Move[] = [];
  for (const m of moves) {
    const key = m.directive.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Split "Master bus: lower the ceiling…" → scope "Master bus", title rest.
 *  Falls back to the whole string as the title with an empty scope. */
function splitScope(text: string): { title: string; scope: string } {
  const m = text.match(/^([A-Z][\w /&.+-]{1,24}?)\s*[:—–-]\s+(.*)$/);
  if (m && m[2].length > 8) {
    return { scope: m[1].trim(), title: capitalize(m[2].trim()) };
  }
  return { title: capitalize(text), scope: '' };
}

function prettifyCategory(c: string): string {
  return c
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ');
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampImpact(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ── Markdown export ─────────────────────────────────────────────────────────

/** Serialize committed Moves to a Game Plan .md checklist. Quick wins first,
 *  then Deeper work; each item `- [ ] scope · directive`. Only committed Moves
 *  are passed in (the export contract). */
export function moveToMarkdown(committed: Move[], trackName: string): string {
  const { quick, deep } = groupMoves(committed);
  const lines: string[] = [`# Game Plan — ${trackName}`, ''];

  const section = (label: string, items: Move[]) => {
    if (items.length === 0) return;
    lines.push(`## ${label}`, '');
    for (const m of items) {
      const head = m.scope ? `**${m.scope}** — ${m.directive}` : m.directive;
      lines.push(`- [ ] ${head}`);
      if (m.hasParams) {
        for (const st of m.steps) {
          lines.push(`  - ${st.where}${st.detail ? `: \`${st.detail}\`` : ''}`);
        }
      }
    }
    lines.push('');
  };

  section('⚡ Quick wins', quick);
  section('🛠 Deeper work', deep);

  if (quick.length === 0 && deep.length === 0) {
    lines.push('_No moves committed yet. Add moves to your plan to export them._', '');
  }
  return lines.join('\n');
}
