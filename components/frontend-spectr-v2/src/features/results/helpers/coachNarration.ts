/* The analysis page's narrating coach — a pure map from the run's current
 * state to the chat messages that state has earned. No LLM calls: every
 * message is a template filled from data already on the page (phase results
 * as they land, phase 1's early measurements, rule-engine verdicts, Triage's
 * routing plan + rationale, live specialist run state).
 *
 * Messages are keyed by EVENT (`p1:lufs`, `p3`, `plan`, `back:<slug>`, …) so
 * the same state always yields the same ids. The chat itself is append-only
 * (useLiveNarration keeps the log): a message is shown from the first render
 * whose state produces its id, in narrative order, and never moves after.
 * State-specific ids (`queued`, `p7:pending` vs `p7:settled`) let a message
 * that was true at the time stay in the log after the state moves on.
 * Time-based "still working" lines live in coachWaitLines.ts.
 *
 * The closing line (CLOSER_ID) is always the LAST message: it's earned when
 * the report is ready (static analysis complete + specialists settled), and
 * the log keeps it last even if a late line (a background arrangement
 * result) arrives after it — see useLiveNarration.appendNew. */
import type { FinalJson, Phase1Data, RoutingPlanDto, VerdictDto } from '../../../api/types';
import { phaseLines } from './coachPhaseLines';
import type { RunStatus } from './liveRun';
import { sortFindings } from './liveFindings';
import { isRuleEngineVerdict, specialistFindings, type SpecialistStage } from './specialist-stage';
import type { SpecialistGroup } from './specialists';

/** A run of text: plain, **bold** (b), *quoted/italic* (i), or an inline
 *  link to the full report (link — the feed wires it to the report CTA). */
export type LinePart = string | { b: string } | { i: string } | { link: string };
export type LineTone = 'info' | 'done' | 'warn';

export type ChatSpeaker =
  | { kind: 'coach' }
  | { kind: 'specialist'; slug: string; label: string; group: SpecialistGroup };

/** One finding listed under a specialist's report-back line. */
export interface ChatItem {
  severity: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  speaker: ChatSpeaker;
  parts: LinePart[];
  tone: LineTone;
  /** A specialist's findings, listed in the same bubble (most important
   *  first, capped at ITEMS_MAX). */
  items?: ChatItem[] | undefined;
  /** Findings beyond the listed ones ("+N more"). */
  more?: number | undefined;
}

export const COACH: ChatSpeaker = { kind: 'coach' };

/** The closing message's id — always kept last in the chat. */
export const CLOSER_ID = 'all-done';
/** The closing line; the `link` part opens the full report. */
export const CLOSER_PARTS: LinePart[] = [
  'We have a good enough analysis to get started. Let’s view the full report. ',
  'You can also dig deeper with more AI specialists or talk to me about the mix. ',
  'Let’s go to the ',
  { link: 'Full Report' },
  ' and get started.',
];

export interface NarrationInput {
  status: RunStatus;
  /** Final result, or the partial results while the job runs (liveFinalJson). */
  fj: FinalJson;
  /** Phase-1 values as far as known — incl. the early sub-results. */
  p1?: Phase1Data | undefined;
  verdicts?: readonly VerdictDto[] | undefined;
  routingPlan?: RoutingPlanDto | undefined;
  stage: SpecialistStage;
  /** Slugs in the order the page saw them settle, so specialists report
   *  back in arrival order. Settled rows missing from it follow in priority
   *  order. */
  settleOrder?: readonly string[] | undefined;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  severe: 4,
  moderate: 3,
  minor: 2,
  win: 0,
};
export const REASON_MAX = 90;
/** Findings listed in a specialist's bubble before "+N more". */
export const ITEMS_MAX = 5;
export const ITEM_TEXT_MAX = 90;
export const SKIP_MAX = 140;

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
export function topVerdict(vs: readonly VerdictDto[]): VerdictDto | undefined {
  return vs
    .filter((v) => v.headline && rank(v) > 0)
    .slice()
    .sort((a, b) => rank(b) - rank(a) || (b.priorityScore ?? 0) - (a.priorityScore ?? 0))[0];
}

/** "A", "A and B", "A, B and C" — names bold. */
function nameList(names: string[]): LinePart[] {
  const out: LinePart[] = [];
  names.forEach((n, i) => {
    if (i > 0) out.push(i === names.length - 1 ? ' and ' : ', ');
    out.push({ b: n });
  });
  return out;
}

const coach = (id: string, parts: LinePart[], tone: LineTone = 'info'): ChatMessage => ({
  id,
  speaker: COACH,
  parts,
  tone,
});

/** Every message the current state has earned, in narrative order. */
export function narrate(input: NarrationInput): ChatMessage[] {
  const { stage, status } = input;
  const verdicts = input.verdicts ?? [];
  const out: ChatMessage[] = [coach('open', ['Let’s take a look at your mix.'])];

  if (status === 'queued') {
    out.push(coach('queued', ['You’re in the queue — I’ll start the moment a worker frees up.']));
  }

  out.push(...phaseLines(input.fj, input.p1).map((l) => coach(l.id, l.parts, l.tone)));

  if (status !== 'complete') return out;

  const big = topVerdict(verdicts.filter(isRuleEngineVerdict));
  if (big) out.push(coach('big-one', ['The big one so far: ', { b: big.headline }, '.'], 'warn'));

  out.push(coach('triage', ['I have enough information to consult some specialists…']));
  if (!stage.planReady) return out;

  if (stage.total === 0) {
    out.push(
      coach('plan', ['No specialist deep-dive needed for this mix.'], 'done'),
    );
  } else {
    out.push(coach('plan', ['I’m going to bring in ', ...nameList(stage.rows.map((r) => r.label)), '.']));
    for (const r of stage.rows) {
      const reason = shortReason(r.focus);
      out.push(coach(`why:${r.slug}`, reason ? [{ b: r.label }, ` — ${reason}`] : [{ b: r.label }]));
    }
  }

  const skip = skipText(input.routingPlan?.rationale);
  if (skip) out.push(coach('skip', [`Skipping ${skip}`]));

  const seen = input.settleOrder ?? [];
  const settled = stage.rows
    .filter((r) => r.state === 'done' || r.state === 'failed')
    .map((r, i) => ({ r, at: seen.includes(r.slug) ? seen.indexOf(r.slug) : seen.length + i }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.r);
  for (const r of settled) {
    const speaker: ChatSpeaker = { kind: 'specialist', slug: r.slug, label: r.label, group: r.group };
    if (r.state === 'failed') {
      out.push({
        id: `back:${r.slug}`,
        speaker,
        parts: ['I couldn’t finish — you can re-run me from the full report.'],
        tone: 'warn',
      });
      continue;
    }
    // Its findings, listed right in the bubble. The stage's count can run a
    // poll ahead of the verdict rows — the list fills in when they land.
    const mine = sortFindings(specialistFindings(verdicts, r.slug));
    const n = mine.length || (r.findings ?? 0);
    const parts: LinePart[] =
      n === 0
        ? ['I found ', { b: 'no issues' }, ' — this part of your mix holds up.']
        : ['I found ', { b: `${n} issue${n === 1 ? '' : 's'}` }, mine.length > 0 ? ':' : '.'];
    const msg: ChatMessage = { id: `back:${r.slug}`, speaker, parts, tone: 'done' };
    if (mine.length > 0) {
      msg.items = mine
        .slice(0, ITEMS_MAX)
        .map((f) => ({ severity: String(f.severity), text: trimWords(f.headline, ITEM_TEXT_MAX) }));
      if (n > ITEMS_MAX) msg.more = n - ITEMS_MAX;
    }
    out.push(msg);
  }

  if (stage.complete) out.push(coach(CLOSER_ID, CLOSER_PARTS, 'done'));
  return out;
}

/** Plain text of a message (tests, aria). */
export function messageText(m: Pick<ChatMessage, 'parts'>): string {
  return m.parts.map((p) => (typeof p === 'string' ? p : 'b' in p ? p.b : 'i' in p ? p.i : p.link)).join('');
}
