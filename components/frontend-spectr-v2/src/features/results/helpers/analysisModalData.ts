// Derives the Analysis Complete modal's view-model from the real analysis
// `finalJson` (and the Triage routing plan). The design prototype hand-authored
// these shapes (findings, per-phase detail/kv, inputs, specialist split); this
// generates them from production data.

import type {
  FinalJson,
  PhaseResult,
  Phase1Data,
  Phase2Data,
  Phase3Data,
  Phase4Data,
  Phase6Data,
  Phase7Data,
  Phase8Data,
  RoutingPlanDto,
  RoutingPlanEntry,
} from '../../../api/types';
import { SPECIALIST_CATALOG, type SpecialistGroup } from './specialists';

export type Severity = 'crit' | 'mod' | 'min' | 'win';

export interface Finding {
  sev: Severity;
  cat: string;
  title: string;
  body: string;
}

export type PhaseStatus = 'ok' | 'warn' | 'failed' | 'skipped';

export interface KvPair {
  k: string;
  v: string;
  tone?: 'good' | 'warn' | 'bad' | undefined;
}
export interface ClashRow {
  stems: string;
  range: string;
  sev: 'high' | 'moderate' | 'low';
}
export interface PhaseRow {
  phase: number;
  short: string;
  status: PhaseStatus;
  detail: string;
  kv: KvPair[];
  clashes: ClashRow[];
  note?: string;
}

export interface InputRow {
  kind: 'song' | 'stems' | 'als' | 'reference';
  cls: 'req' | 'has' | 'empty';
  label: string;
  value: string;
  meta: string;
}

export interface SpecRow {
  label: string;
  group: SpecialistGroup;
  focus: string;
}

// Specialist persona colors (design tokens). `c` = accent, `d` = dim fill.
export const GROUP_COLORS: Record<SpecialistGroup, { c: string; d: string }> = {
  Spectrum: { c: '#00e5b0', d: 'rgba(0,229,176,0.12)' },
  Loudness: { c: '#fb923c', d: 'rgba(251,146,60,0.12)' },
  Dynamics: { c: '#fbbf24', d: 'rgba(251,191,36,0.12)' },
  Stereo: { c: '#60a5fa', d: 'rgba(96,165,250,0.12)' },
  Sections: { c: '#a78bfa', d: 'rgba(167,139,250,0.12)' },
  Stems: { c: '#34d399', d: 'rgba(52,211,153,0.12)' },
  Misc: { c: '#64748b', d: 'rgba(100,116,139,0.12)' },
};

export function specInitials(label: string): string {
  const w = label.trim().split(/\s+/);
  return (w.length > 1 ? w.map((x) => x[0]).join('') : label).slice(0, 2).toUpperCase();
}

function phaseData<T>(fj: FinalJson, n: number): T | undefined {
  return fj.phases?.find((p) => p.phase === n)?.data as T | undefined;
}
function phaseStatusOf(fj: FinalJson, n: number): PhaseStatus | undefined {
  const st = fj.phases?.find((p) => p.phase === n)?.status;
  if (st === 'ok' || st === 'skipped' || st === 'failed') return st;
  return st ? 'ok' : undefined;
}

const num = (x: unknown): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) ? x : undefined;
const f1 = (x: unknown): string => (num(x) === undefined ? '—' : (x as number).toFixed(1));
const f2 = (x: unknown): string => (num(x) === undefined ? '—' : (x as number).toFixed(2));

// ── Findings ────────────────────────────────────────────────────────────────
// coached_fixes / top_fixes are coaching-voice strings. Classify each into a
// severity + category and split into a short title + body.
const CATEGORY_RULES: Array<{ re: RegExp; cat: string }> = [
  { re: /lufs|loud|limiter|ceiling|streaming|spotify|quiet/i, cat: 'Loudness' },
  { re: /clip/i, cat: 'Clipping' },
  { re: /mono|phase|collaps/i, cat: 'Stereo' },
  { re: /bass|sub|low.?end|low.?mid|mud/i, cat: 'Low End' },
  { re: /air|high.?shelf|presence|bright|treble/i, cat: 'Air' },
  { re: /clash|collision|overlap|mask/i, cat: 'Frequency' },
  { re: /head ?phone|speaker|translat|crossfeed/i, cat: 'Translation' },
  { re: /width|stereo|wide/i, cat: 'Stereo' },
  { re: /arrang|section|8.?bar|transition|structure/i, cat: 'Arrangement' },
  { re: /quantiz|humaniz|midi|velocity/i, cat: 'MIDI' },
  { re: /device|clutter|project|ableton|\.als/i, cat: 'Project' },
  { re: /dynamic|crest|compress|punch/i, cat: 'Dynamics' },
  { re: /percentile|above the pack|strong start|genuinely strong/i, cat: 'Overall' },
];

function classify(text: string): { sev: Severity; cat: string } {
  const t = text.toLowerCase();
  const cat = CATEGORY_RULES.find((r) => r.re.test(t))?.cat ?? 'Mix';
  let sev: Severity = 'min';
  if (/percentile|above the pack|strong start|genuinely strong|nicely|great|good\b/.test(t))
    sev = 'win';
  if (/clip|collaps|critical|wo n['’]?t read|inaudible|fail/.test(t)) sev = 'crit';
  else if (/clash|collision|quiet|hot|over.?compress|boomy|muddy|won['’]?t translate/.test(t))
    sev = 'mod';
  return { sev, cat };
}

function splitTitle(text: string, cat: string): { title: string; body: string } {
  const trimmed = text.trim();
  const m = trimmed.match(/^(.*?[.!?])\s+(.*)$/s);
  if (m && m[1].length <= 80 && m[2].length > 0) {
    return { title: m[1].replace(/[.]$/, ''), body: m[2] };
  }
  // Single sentence: use a category headline as the title.
  return { title: cat, body: trimmed };
}

export function deriveFindings(fj: FinalJson): Finding[] {
  const raw = (
    fj.coached_fixes && fj.coached_fixes.length ? fj.coached_fixes : (fj.top_fixes ?? [])
  ).filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

  const findings: Finding[] = raw.map((text) => {
    const { sev, cat } = classify(text);
    const { title, body } = splitTitle(text, cat);
    return { sev, cat, title, body };
  });

  // A "win" finding from the gap-analysis percentile, if present and not already.
  const p6 = phaseData<Phase6Data>(fj, 6);
  const pct = num(p6?.percentile);
  if (pct !== undefined && !findings.some((f) => f.sev === 'win')) {
    findings.push({
      sev: 'win',
      cat: 'Overall',
      title: "You're above the pack",
      body: `You land in the ${Math.round(pct)}th percentile against pro tracks in your genre — a strong starting point to build on.`,
    });
  }
  return findings;
}

// ── Pipeline ────────────────────────────────────────────────────────────────
const PHASE_SHORT: Record<number, string> = {
  1: 'Mix analysis',
  2: 'Genre',
  3: 'Genre scoring',
  4: 'Stem clash',
  5: 'Reference',
  6: 'Gap analysis',
  7: 'Arrangement',
  8: 'Ableton project',
  9: 'Mix translation',
};

function summarize(fj: FinalJson, p: PhaseResult): PhaseRow {
  const phase = p.phase;
  const status: PhaseStatus = phaseStatusOf(fj, phase) ?? 'skipped';
  const short = PHASE_SHORT[phase] ?? `Phase ${phase}`;
  const row: PhaseRow = { phase, short, status, detail: '', kv: [], clashes: [] };
  if (status === 'skipped') {
    row.detail = 'Skipped for this run';
    row.note = SKIP_NOTE[phase] ?? 'Not applicable for this run.';
    return row;
  }
  if (status === 'failed') {
    row.detail = p.error ? String(p.error).slice(0, 60) : 'Phase failed';
    row.note = p.error ?? 'This phase failed to run.';
    return row;
  }
  switch (phase) {
    case 1: {
      const d = (p.data ?? {}) as Phase1Data;
      row.detail = `${f1(d.lufs)} LUFS · ${num(d.bpm) ? Math.round(d.bpm as number) : '—'} BPM · ${d.detected_key ?? '—'}${d.clipping_detected ? ' · clipping' : ' · no clipping'}`;
      row.kv = [
        { k: 'Integrated LUFS', v: f1(d.lufs) },
        { k: 'True peak', v: `${f1(d.true_peak_db)} dBTP`, tone: 'good' },
        { k: 'Detected key', v: d.detected_key ?? '—' },
        { k: 'Stereo width', v: f2(d.stereo_width) },
        { k: 'Stereo corr.', v: f2(d.stereo_correlation) },
        { k: 'Mono compat', v: f2(d.mono_compatibility) },
        { k: 'Clipping', v: d.clipping_detected ? `${d.clipped_sample_count ?? 0} samp` : 'none', tone: d.clipping_detected ? 'warn' : 'good' },
      ];
      break;
    }
    case 2: {
      const d = (p.data ?? {}) as Phase2Data;
      const conf = num(d.confidence);
      row.detail = `${d.genre ?? '—'}${conf !== undefined ? ` · ${Math.round(conf * 100)}% confidence` : ''}`;
      row.kv = [
        { k: 'Genre', v: d.genre ?? '—' },
        ...(conf !== undefined ? [{ k: 'Confidence', v: `${Math.round(conf * 100)}%`, tone: 'good' as const }] : []),
      ];
      break;
    }
    case 3: {
      const d = (p.data ?? {}) as Phase3Data;
      row.detail = `${num(d.total_score) !== undefined ? Math.round(d.total_score as number) : '—'} / 100 vs ${d.genre ?? 'genre'} profile`;
      row.kv = [
        { k: 'Total score', v: `${num(d.total_score) !== undefined ? Math.round(d.total_score as number) : '—'} / 100`, tone: 'good' },
        ...Object.entries(d.sub_scores ?? {}).slice(0, 5).map(([k, v]) => ({
          k: k.replace(/_/g, ' '),
          v: String(typeof v === 'number' ? Math.round(v) : v),
        })),
      ];
      break;
    }
    case 4: {
      const d = (p.data ?? {}) as Phase4Data;
      const clashes = d.clashes ?? [];
      row.detail = clashes.length
        ? `${clashes.length} clash${clashes.length === 1 ? '' : 'es'} found`
        : 'No significant clashes';
      row.clashes = clashes.slice(0, 4).map((c) => ({
        stems: c.stems ?? 'overlap',
        range: c.frequency_range ?? '',
        sev: (c.severity === 'high' || c.severity === 'low' ? c.severity : 'moderate') as ClashRow['sev'],
      }));
      if (!clashes.length) row.note = 'Upload stems to unlock per-instrument clash detection.';
      break;
    }
    case 5: {
      const d = (p.data ?? {}) as { status?: string };
      if (d.status === 'skipped') {
        row.status = 'skipped';
        row.detail = 'No reference attached';
        row.note = SKIP_NOTE[5];
      } else {
        row.detail = 'Compared against reference track';
      }
      break;
    }
    case 6: {
      const d = (p.data ?? {}) as Phase6Data;
      const pct = num(d.percentile);
      row.detail = pct !== undefined ? `${Math.round(pct)}th percentile vs genre profile` : 'Gap vs genre profile';
      row.kv = [
        ...(pct !== undefined ? [{ k: 'Percentile', v: `${Math.round(pct)}th`, tone: 'good' as const }] : []),
        ...Object.entries(d.gaps ?? {})
          .slice(0, 5)
          .map(([k, g]): KvPair => {
            const delta = num(g?.delta);
            return {
              k: k.replace(/_/g, ' '),
              v: delta === undefined ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} vs mean`,
              tone: g && !g.in_range ? 'warn' : undefined,
            };
          }),
      ];
      break;
    }
    case 7: {
      const d = (p.data ?? {}) as Phase7Data;
      row.detail = `Grade ${d.grade ?? '—'}${d.section_count ? ` · ${d.section_count} sections` : ''}`;
      row.kv = [
        { k: 'Arrangement grade', v: d.grade ?? '—', tone: 'good' },
        ...(d.section_count ? [{ k: 'Sections', v: String(d.section_count) }] : []),
        ...Object.entries(d.component_scores ?? {}).slice(0, 4).map(([k, v]) => ({
          k: k.replace(/_/g, ' '),
          v: String(typeof v === 'number' ? Math.round(v) : v),
        })),
      ];
      break;
    }
    case 8: {
      const d = (p.data ?? {}) as Phase8Data;
      row.detail = `Health ${num(d.health_score) !== undefined ? Math.round(d.health_score as number) : '—'} · ${d.total_devices ?? '—'} devices`;
      row.kv = [
        { k: 'Project health', v: `${num(d.health_score) !== undefined ? Math.round(d.health_score as number) : '—'} / 100`, tone: 'good' },
        ...(d.total_devices !== undefined ? [{ k: 'Total devices', v: String(d.total_devices) }] : []),
        ...(d.disabled_devices !== undefined ? [{ k: 'Disabled', v: String(d.disabled_devices), tone: 'warn' as const }] : []),
        ...(d.clutter_pct !== undefined ? [{ k: 'Clutter', v: `${Math.round(d.clutter_pct)}%` }] : []),
      ];
      break;
    }
    case 9: {
      const d = (p.data ?? {}) as {
        surround?: { mono_compatibility?: number; phase_score?: number };
        playback?: { speaker_score?: number; headphone_score?: number; bass_translation?: string };
      };
      const mono = num(d.surround?.mono_compatibility);
      row.detail = `Mono ${mono !== undefined ? Math.round(mono) : '—'} · speaker ${num(d.playback?.speaker_score) !== undefined ? Math.round(d.playback!.speaker_score as number) : '—'} · headphone ${num(d.playback?.headphone_score) !== undefined ? Math.round(d.playback!.headphone_score as number) : '—'}`;
      row.kv = [
        { k: 'Mono compat', v: mono !== undefined ? String(Math.round(mono)) : '—', tone: mono !== undefined && mono < 50 ? 'bad' : 'good' },
        { k: 'Speaker', v: num(d.playback?.speaker_score) !== undefined ? String(Math.round(d.playback!.speaker_score as number)) : '—' },
        { k: 'Headphone', v: num(d.playback?.headphone_score) !== undefined ? String(Math.round(d.playback!.headphone_score as number)) : '—' },
        { k: 'Bass translation', v: d.playback?.bass_translation ?? '—', tone: d.playback?.bass_translation === 'weak' ? 'warn' : undefined },
      ];
      break;
    }
    default: {
      const entries = Object.entries((p.data ?? {}) as Record<string, unknown>)
        .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
        .slice(0, 6);
      row.detail = `${entries.length} metrics`;
      row.kv = entries.map(([k, v]) => ({ k: k.replace(/_/g, ' '), v: String(v) }));
    }
  }
  return row;
}

const SKIP_NOTE: Record<number, string> = {
  5: 'Attach a reference track on the Compare page to benchmark this mix against a target.',
  8: 'Upload an .als to analyze device chains, MIDI humanization, and project health.',
};

export function derivePhaseRows(fj: FinalJson): PhaseRow[] {
  const phases = (fj.phases ?? [])
    .filter((p) => typeof p.phase === 'number')
    .slice()
    .sort((a, b) => a.phase - b.phase);
  return phases.map((p) => summarize(fj, p));
}

// ── Inputs ──────────────────────────────────────────────────────────────────
export function deriveInputs(fj: FinalJson, songName: string | undefined): InputRow[] {
  const p4 = phaseData<Phase4Data>(fj, 4);
  const stemsPresent = Boolean(
    p4?.stems && typeof p4.stems === 'object' && (p4.stems as { status?: string }).status === 'ok',
  );
  const alsPresent = phaseStatusOf(fj, 8) === 'ok';
  // Phase 5 always runs (result status 'ok') even with no reference — it carries
  // an INNER status of 'skipped' when none was attached. Read that, not the row.
  const p5 = phaseData<{ status?: string }>(fj, 5);
  const refPresent = phaseStatusOf(fj, 5) === 'ok' && p5?.status !== 'skipped';
  return [
    { kind: 'song', cls: 'req', label: 'Song / mix', value: songName ?? 'Master', meta: 'required' },
    stemsPresent
      ? { kind: 'stems', cls: 'has', label: 'Stems', value: 'Provided', meta: 'auto-classified' }
      : { kind: 'stems', cls: 'empty', label: 'Stems', value: 'None', meta: 'optional — not uploaded' },
    alsPresent
      ? { kind: 'als', cls: 'has', label: 'Ableton project', value: 'Loaded', meta: '.als analyzed' }
      : { kind: 'als', cls: 'empty', label: 'Ableton project', value: 'None', meta: 'optional — not uploaded' },
    refPresent
      ? { kind: 'reference', cls: 'has', label: 'Reference', value: 'Attached', meta: 'benchmarked' }
      : { kind: 'reference', cls: 'empty', label: 'Reference', value: 'None', meta: 'optional — not attached' },
  ];
}

export function inputsSummary(rows: InputRow[]): { present: string[]; used: number } {
  const present = ['Song'];
  if (rows.find((r) => r.kind === 'stems')?.cls === 'has') present.push('stems');
  if (rows.find((r) => r.kind === 'als')?.cls === 'has') present.push('Ableton project');
  if (rows.find((r) => r.kind === 'reference')?.cls === 'has') present.push('reference');
  return { present, used: present.length };
}

// ── Routing (specialists) ─────────────────────────────────────────────────────
function resolveSpec(entry: RoutingPlanEntry): { label: string; group: SpecialistGroup } {
  const hit = SPECIALIST_CATALOG.find(
    (m) => m.slug === entry.name || m.label.toLowerCase() === entry.name.toLowerCase(),
  );
  return hit ? { label: hit.label, group: hit.group } : { label: entry.name, group: 'Misc' };
}

export interface RoutingSplit {
  high: SpecRow[];
  rest: SpecRow[];
  total: number;
  rationale: string;
}

export function splitRouting(plan: RoutingPlanDto | undefined): RoutingSplit | null {
  if (!plan || !plan.specialists_to_run?.length) return null;
  const sorted = plan.specialists_to_run.slice().sort((a, b) => a.priority - b.priority);
  const rows: SpecRow[] = sorted.map((e) => {
    const { label, group } = resolveSpec(e);
    return { label, group, focus: e.focus };
  });
  return {
    high: rows.slice(0, 3),
    rest: rows.slice(3),
    total: rows.length,
    rationale: plan.rationale,
  };
}

// ── Coach message ─────────────────────────────────────────────────────────────
export function coachMessage(fj: FinalJson): string {
  const intro = (fj.coach_intro ?? '').trim();
  const first = (fj.coached_fixes ?? []).find((s) => typeof s === 'string' && s.trim());
  if (intro && first) return `${intro} ${first}`;
  if (first) return first;
  if (intro) return intro;
  return "I've taken a first pass over your mix. Open the full report and I'll run a deeper analysis and build a plan you can take into your DAW.";
}
