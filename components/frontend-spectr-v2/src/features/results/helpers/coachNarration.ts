/* The Analysis Complete modal's narrating coach — a pure map from the modal's
 * current state to a running log of coach lines. No LLM calls: every line is
 * built from data already on the page (phase-1 measurements, rule-engine
 * verdicts, Triage's routing plan + rationale, live specialist run state).
 *
 * Lines are keyed by EVENT (`static`, `big-one`, `why:<slug>`, `back:<slug>`,
 * …) so a re-render with the same state yields the same ids — React keys stay
 * stable and nothing duplicates. Order is narrative order, so as the state
 * advances new lines only ever append (the transient "picking…" line is the
 * one exception: it is replaced by the plan once Triage lands). */
import type { FinalJson, Phase1Data, RoutingPlanDto, VerdictDto } from '../../../api/types';
import { findingsLabel, type SpecialistStage } from './specialist-stage';

/** A run of text: plain, **bold** (b) or *quoted/italic* (i). */
export type LinePart = string | { b: string } | { i: string };
export type LineTone = 'info' | 'pending' | 'done' | 'warn';

export interface CoachLine {
  id: string;
  parts: LinePart[];
  tone: LineTone;
}

export interface NarrationInput {
  fj: FinalJson;
  verdicts: readonly VerdictDto[] | undefined;
  routingPlan: RoutingPlanDto | undefined;
  stage: SpecialistStage;
  /** Slugs in the order the modal saw them settle, so "X is back" lines
   *  append in arrival order. Settled rows missing from it follow in
   *  priority order. */
  settleOrder?: readonly string[] | undefined;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  severe: 4,
  moderate: 3,
  minor: 2,
  win: 0,
};
const FAIL_MARKER_HEADLINE = 'Specialist failed';
export const REASON_MAX = 90;
export const SKIP_MAX = 140;

const MINUS = '−';
const signed = (n: number, digits = 1): string => {
  const v = n.toFixed(digits);
  return n < 0 ? `${MINUS}${v.slice(1)}` : v;
};
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Cut to `max` chars at a word boundary, with an ellipsis when cut. */
export function trimWords(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.(–—-]+$/, '')}…`;
}

/** First sentence/clause of a Triage `focus` paragraph, trimmed for one line. */
export function shortReason(focus: string | undefined): string {
  const f = (focus ?? '').trim();
  if (!f) return '';
  // Sentence end = ". " / "; " not inside a decimal number ("0.12").
  const m = f.match(/^(.+?[.;])(?=\s|$)/);
  const first = (m ? m[1]! : f).replace(/[.;]$/, '');
  return trimWords(first, REASON_MAX);
}

/** The "Skip …" part of Triage's rationale, or '' when it has none. */
export function skipText(rationale: string | undefined): string {
  const r = (rationale ?? '').replace(/\s+/g, ' ');
  const m = r.match(/\bskip(?:ping)?\b\s+(.+?)(?:\.(?=\s|$)|$)/i);
  if (!m) return '';
  const body = m[1]!.trim();
  return body ? trimWords(body, SKIP_MAX) : '';
}

function rank(v: VerdictDto): number {
  return SEVERITY_RANK[String(v.severity)] ?? 1;
}
function topVerdict(vs: readonly VerdictDto[]): VerdictDto | undefined {
  return vs
    .filter((v) => v.headline && v.headline !== FAIL_MARKER_HEADLINE && rank(v) > 0)
    .slice()
    .sort((a, b) => rank(b) - rank(a) || (b.priorityScore ?? 0) - (a.priorityScore ?? 0))[0];
}

/** "Your mix sits at −11.9 LUFS, peaks at −0.4 dBTP, B minor @ 128 BPM." —
 *  flagged measurements (clipping, hot true peak) take precedence. */
function staticLine(fj: FinalJson): CoachLine | null {
  const p1 = fj.phases?.find((p) => p.phase === 1);
  if (!p1 || p1.status === 'failed' || p1.status === 'skipped') return null;
  const d = (p1.data ?? {}) as Phase1Data;
  const bits: LinePart[][] = [];
  if (d.clipping_detected) {
    bits.push([
      'is ',
      { b: 'clipping' },
      isNum(d.clipped_sample_count) && d.clipped_sample_count > 0
        ? ` (${d.clipped_sample_count} samples)`
        : '',
    ]);
  }
  if (isNum(d.true_peak_db) && d.true_peak_db > -1) {
    bits.push(['peaks hot at ', { b: `${signed(d.true_peak_db)} dBTP` }]);
  }
  if (isNum(d.lufs)) bits.push(['sits at ', { b: `${signed(d.lufs)} LUFS` }]);
  if (isNum(d.true_peak_db) && d.true_peak_db <= -1 && bits.length < 3) {
    bits.push(['peaks at ', { b: `${signed(d.true_peak_db)} dBTP` }]);
  }
  const key = d.key_estimate?.key ?? d.detected_key;
  const mode = d.key_estimate?.mode;
  const keyText = key ? `${key}${mode ? ` ${mode}` : ''}` : '';
  const bpm = isNum(d.bpm) ? `${Math.round(d.bpm)} BPM` : '';
  if (keyText || bpm) bits.push([keyText ? 'is in ' : 'runs at ', { b: [keyText, bpm].filter(Boolean).join(' @ ') }]);
  if (!bits.length) return null;
  const parts: LinePart[] = ['Your mix '];
  bits.slice(0, 3).forEach((b, i, arr) => {
    if (i > 0) parts.push(i === arr.length - 1 ? ' and ' : ', ');
    parts.push(...b.filter((x) => x !== ''));
  });
  parts.push('.');
  return { id: 'static', parts, tone: 'info' };
}

export function narrate(input: NarrationInput): CoachLine[] {
  const { fj, stage } = input;
  const verdicts = input.verdicts ?? [];
  const lines: CoachLine[] = [];

  const st = staticLine(fj);
  if (st) lines.push(st);

  const big = topVerdict(verdicts.filter((v) => v.source === 'rule_engine'));
  if (big) lines.push({ id: 'big-one', parts: ['The big one: ', { b: big.headline }, '.'], tone: 'info' });

  if (!stage.planReady) {
    lines.push({ id: 'picking', parts: ['Picking which specialists to consult…'], tone: 'pending' });
    return lines;
  }

  if (stage.total === 0) {
    lines.push({
      id: 'plan',
      parts: ['No specialist deep-dive needed for this mix — the full report has the whole picture.'],
      tone: 'done',
    });
  } else {
    lines.push({
      id: 'plan',
      parts: [
        'I’m bringing in ',
        { b: `${stage.total} specialist${stage.total === 1 ? '' : 's'}` },
        ':',
      ],
      tone: 'info',
    });
    for (const r of stage.rows) {
      const reason = shortReason(r.focus);
      lines.push({
        id: `why:${r.slug}`,
        parts: reason ? [{ b: r.label }, `: ${reason}`] : [{ b: r.label }],
        tone: 'info',
      });
    }
  }

  const skip = skipText(input.routingPlan?.rationale);
  if (skip) lines.push({ id: 'skip', parts: [`Skipping ${skip}`], tone: 'info' });

  const seen = input.settleOrder ?? [];
  const settledRows = stage.rows
    .filter((r) => r.state === 'done' || r.state === 'failed')
    .map((r, i) => ({ r, at: seen.includes(r.slug) ? seen.indexOf(r.slug) : seen.length + i }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.r);
  for (const r of settledRows) {
    if (r.state === 'done') {
      const top = topVerdict(
        verdicts.filter((v) => v.specialist === r.slug && v.source === 'llm_identifier'),
      );
      const parts: LinePart[] = [{ b: r.label }, ' is back: ', findingsLabel(r.findings) || 'done'];
      if (top) parts.push(' — top: ', { i: `“${trimWords(top.headline, 70)}”` });
      lines.push({ id: `back:${r.slug}`, parts, tone: 'done' });
    } else if (r.state === 'failed') {
      lines.push({
        id: `back:${r.slug}`,
        parts: [{ b: r.label }, ' couldn’t finish — you can re-run it from the full report.'],
        tone: 'warn',
      });
    }
  }

  if (stage.total > 0 && stage.complete) {
    lines.push({ id: 'all-done', parts: ['That’s everyone. Here’s the full picture →'], tone: 'done' });
  }
  return lines;
}
