// Analysis tab view-model — pure derivations over data ReportView already
// holds (finalJson, version files, the verdicts list response, and the lifted
// optimistic-running set). No React, no fetching: unit-tested directly.

import type {
  FinalJson,
  Phase4Data,
  Phase7Data,
  VerdictDto,
  VerdictsListResponse,
  VersionFileEntry,
} from '../../api/types';
import {
  deriveFindings,
  derivePhaseRows,
  splitRouting,
  type Finding,
} from './helpers/analysisModalData';
import { SEVERITY_RANK } from './helpers/severity';
import { SPECIALIST_CATALOG, type SpecialistGroup } from './helpers/specialists';

// Mirrors the worker's fail-marker headline (verdict_actor.py).
const FAIL_MARKER = 'Specialist failed';

function phaseOf(fj: FinalJson, n: number) {
  return fj.phases?.find((p) => p.phase === n);
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export type InputKind = 'mix' | 'stems' | 'als' | 'reference';
/** analyzed = part of this run · failed = supplied but its phase errored ·
 *  attached = on the version but not in this run · missing = never supplied. */
export type InputState = 'analyzed' | 'failed' | 'attached' | 'missing';

export interface InputRow {
  kind: InputKind;
  label: string;
  state: InputState;
  detail: string;
}

const MISSING_DETAIL: Record<Exclude<InputKind, 'mix'>, string> = {
  stems: 'Add stems to see how each part sits in the mix.',
  als: 'Add your Ableton project to check device chains and project health.',
  reference: 'Add a reference track to compare your mix against a target.',
};

const ATTACHED_DETAIL = 'Uploaded, but not part of this run. Re-analyze to include it.';

function fileNamed(files: VersionFileEntry[], type: VersionFileEntry['type']) {
  return files.find((f) => f.type === type)?.filename ?? null;
}

/** Per-job truth comes from the phases (what THIS run analyzed); version
 *  files only add the "attached but not analyzed" nuance. Never infer
 *  presence from the phase data objects themselves — the pipeline always
 *  writes `phase4.stems = {}` and a phase-8 row, so `Boolean(...)` lies. */
export function buildInputRows(
  fj: FinalJson,
  files: VersionFileEntry[] | undefined,
  songName: string,
): InputRow[] {
  const fl = files ?? [];
  const stemFiles = fl.filter((f) => f.type === 'stem').length;

  const stems = (phaseOf(fj, 4)?.data as Phase4Data | undefined)?.stems as
    | { status?: string; error?: string }
    | undefined;
  const p8 = phaseOf(fj, 8);
  const p5 = phaseOf(fj, 5);
  const p5Inner = (p5?.data as { status?: string } | undefined)?.status;

  const stemsRow: InputRow =
    stems?.status === 'ok'
      ? {
          kind: 'stems',
          label: 'Stems',
          state: 'analyzed',
          detail: stemFiles > 0 ? `${stemFiles} stems, balance and clashes checked` : 'Balance and clashes checked',
        }
      : stems?.status === 'failed'
        ? { kind: 'stems', label: 'Stems', state: 'failed', detail: 'Stem analysis failed. Re-analyze to try again.' }
        : stemFiles > 0
          ? { kind: 'stems', label: 'Stems', state: 'attached', detail: ATTACHED_DETAIL }
          : { kind: 'stems', label: 'Stems', state: 'missing', detail: MISSING_DETAIL.stems };

  const alsName = fileNamed(fl, 'als');
  const alsRow: InputRow =
    p8?.status === 'ok'
      ? { kind: 'als', label: 'Ableton project', state: 'analyzed', detail: alsName ?? 'Project analyzed' }
      : p8?.status === 'failed'
        ? { kind: 'als', label: 'Ableton project', state: 'failed', detail: "Couldn't read the project file." }
        : alsName
          ? { kind: 'als', label: 'Ableton project', state: 'attached', detail: ATTACHED_DETAIL }
          : { kind: 'als', label: 'Ableton project', state: 'missing', detail: MISSING_DETAIL.als };

  const refName = fileNamed(fl, 'reference');
  const refRow: InputRow =
    p5?.status === 'ok' && p5Inner != null && p5Inner !== 'skipped'
      ? { kind: 'reference', label: 'Reference', state: 'analyzed', detail: refName ?? 'Compared against your reference' }
      : p5?.status === 'failed'
        ? { kind: 'reference', label: 'Reference', state: 'failed', detail: 'Reference comparison failed.' }
        : refName
          ? { kind: 'reference', label: 'Reference', state: 'attached', detail: ATTACHED_DETAIL }
          : { kind: 'reference', label: 'Reference', state: 'missing', detail: MISSING_DETAIL.reference };

  return [
    { kind: 'mix', label: 'Mix', state: 'analyzed', detail: fileNamed(fl, 'mix') ?? songName },
    stemsRow,
    alsRow,
    refRow,
  ];
}

// ── Modules (pipeline phases) ───────────────────────────────────────────────

export type ModuleStatus = 'ok' | 'skipped' | 'failed' | 'running';

export interface ModuleRow {
  phase: number;
  label: string;
  status: ModuleStatus;
  detail: string;
}

/** Phase 7's score is filled in later by a background structure-detection
 *  job; the report re-polls (useJobResults) until it lands. */
export function isArrangementPending(fj: FinalJson): boolean {
  return (phaseOf(fj, 7)?.data as Phase7Data | undefined)?.arrangement_status === 'pending';
}

export function buildModuleRows(fj: FinalJson): ModuleRow[] {
  const pending = isArrangementPending(fj);
  return derivePhaseRows(fj).map((r) => {
    if (r.phase === 7 && pending) {
      return { phase: 7, label: r.short, status: 'running', detail: 'Detecting song sections…' };
    }
    return {
      phase: r.phase,
      label: r.short,
      status: r.status === 'warn' ? 'ok' : r.status,
      detail: r.detail,
    };
  });
}

// ── Specialists ─────────────────────────────────────────────────────────────

export type SpecState = 'running' | 'ran' | 'no-findings' | 'suggested' | 'needs-stems';

export interface SpecialistRow {
  slug: string;
  label: string;
  group: SpecialistGroup;
  state: SpecState;
  count: number;
  /** One entry per finding, most severe first — drives the finding meter. */
  severities: string[];
  /** Triage's reason for suggesting it (suggested rows only). */
  focus: string | null;
}

export interface SpecialistSummary {
  /** The deterministic rule engine — runs on every analysis. */
  builtIn: { count: number; severities: string[] };
  rows: SpecialistRow[];
  triage: 'loading' | 'pending' | 'done' | 'unavailable';
  ran: number;
  suggested: number;
  /** Catalog specialists neither run nor suggested — runnable from the Coach panel. */
  otherAvailable: number;
}

/** Rule-engine rows are keyed by `specialist`, NOT `source`: on-demand
 *  specialist rows also default to source 'rule_engine' in the worker. */
export function isBuiltInCheck(v: Pick<VerdictDto, 'specialist'>): boolean {
  return v.specialist === 'rule_engine' || v.specialist.startsWith('rule_engine.');
}

const rankOf = (sev: string) => SEVERITY_RANK[sev as keyof typeof SEVERITY_RANK] ?? 0;
const bySeverity = (a: string, b: string) => rankOf(b) - rankOf(a);

const STATE_ORDER: Record<SpecState, number> = {
  running: 0,
  ran: 1,
  'no-findings': 2,
  suggested: 3,
  'needs-stems': 4,
};

function humanize(slug: string): string {
  const s = slug.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildSpecialistRows(args: {
  data: VerdictsListResponse | undefined;
  running: ReadonlySet<string>;
  hasStems: boolean;
}): SpecialistSummary {
  const { data, running, hasStems } = args;

  const builtIn: string[] = [];
  const found = new Map<string, string[]>();
  for (const v of data?.verdicts ?? []) {
    if (v.headline === FAIL_MARKER) continue;
    if (isBuiltInCheck(v)) builtIn.push(String(v.severity));
    else found.set(v.specialist, [...(found.get(v.specialist) ?? []), String(v.severity)]);
  }

  const status = new Map((data?.specialists ?? []).map((s) => [s.slug, s.status]));
  const plan = splitRouting(data?.routingPlan);
  const planRows = plan ? [...plan.high, ...plan.rest] : [];
  const planIndex = new Map(planRows.map((r, i) => [r.slug, i]));
  const focusOf = new Map(planRows.map((r) => [r.slug, r.focus]));

  const slugs = new Set<string>([
    ...found.keys(),
    ...[...status].filter(([, st]) => st !== 'idle').map(([slug]) => slug),
    ...running,
    ...planIndex.keys(),
  ]);

  const rows: SpecialistRow[] = [];
  for (const slug of slugs) {
    const meta = SPECIALIST_CATALOG.find((m) => m.slug === slug);
    const sevs = (found.get(slug) ?? []).slice().sort(bySeverity);
    const st = status.get(slug) ?? 'idle';
    let state: SpecState;
    if (sevs.length > 0 || st === 'cached') state = 'ran';
    else if (st === 'failed') state = 'no-findings';
    else if (running.has(slug)) state = 'running';
    else if (meta?.needsStems && !hasStems) state = 'needs-stems';
    else state = 'suggested';
    rows.push({
      slug,
      label: meta?.label ?? humanize(slug),
      group: meta?.group ?? 'Misc',
      state,
      count: sevs.length,
      severities: sevs,
      focus: state === 'suggested' || state === 'needs-stems' ? (focusOf.get(slug) ?? null) : null,
    });
  }

  const order = (r: SpecialistRow) => planIndex.get(r.slug) ?? Number.MAX_SAFE_INTEGER;
  rows.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (a.state === 'ran' ? b.count - a.count : 0) ||
      order(a) - order(b) ||
      a.label.localeCompare(b.label),
  );

  const listed = new Set(rows.map((r) => r.slug));
  return {
    builtIn: { count: builtIn.length, severities: builtIn.sort(bySeverity) },
    rows,
    triage: !data ? 'loading' : data.routingPlan ? 'done' : data.degradation ? 'unavailable' : 'pending',
    ran: rows.filter((r) => r.state === 'ran' || r.state === 'no-findings').length,
    suggested: rows.filter((r) => r.state === 'suggested' || r.state === 'needs-stems').length,
    otherAvailable: SPECIALIST_CATALOG.filter((m) => !listed.has(m.slug)).length,
  };
}

// ── Top tips ────────────────────────────────────────────────────────────────

// pipeline.py pads top_fixes with this when it has nothing real to say.
const FILLER = /^optimi[sz]e mix levels for streaming targets\.?$/i;
const TIP_RANK: Record<Finding['sev'], number> = { crit: 0, mod: 1, min: 2, win: 3 };

/** The coach's first-pass fixes (coached_fixes → top_fixes fallback), worst
 *  first. Same source as the Analysis Complete modal, so the two agree. */
export function pickTopTips(fj: FinalJson, n = 3): Finding[] {
  return deriveFindings(fj)
    .filter((f) => f.sev !== 'win' && !FILLER.test(f.body.trim()) && !FILLER.test(f.title.trim()))
    .sort((a, b) => TIP_RANK[a.sev] - TIP_RANK[b.sev])
    .slice(0, n);
}

// ── In progress ─────────────────────────────────────────────────────────────

export interface InProgressItem {
  key: string;
  label: string;
}

export function buildInProgress(args: {
  triagePending: boolean;
  running: ReadonlySet<string>;
  arrangementPending: boolean;
  coachMixCompiling: boolean;
}): InProgressItem[] {
  const items: InProgressItem[] = [];
  if (args.triagePending) items.push({ key: 'triage', label: 'Picking specialists for this track' });
  for (const slug of args.running) {
    const label = SPECIALIST_CATALOG.find((m) => m.slug === slug)?.label ?? humanize(slug);
    items.push({ key: `spec:${slug}`, label: `${label} is listening` });
  }
  if (args.arrangementPending) items.push({ key: 'sections', label: 'Detecting song sections' });
  if (args.coachMixCompiling) items.push({ key: 'coachmix', label: 'Compiling your Coach Mix' });
  return items;
}
