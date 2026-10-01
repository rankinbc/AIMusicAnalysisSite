// Worked examples for /trust/how-its-built, derived from the REAL demo-track
// analysis (landing/sample/sample-data.ts — generated from the demo snapshot).
// Nothing about the track is written here: headlines, evidence, "why it
// matters", fix chains and expected outcomes all come from the fixture. This
// file only picks four varied findings, chooses which evidence rows to show,
// and formats numbers.
import type { VerdictDto } from '../../api/types';
import { SAMPLE_FINDINGS, SAMPLE_META } from '../landing/sample/sample-data';
import type { SampleFinding } from '../landing/sample/sample-data';
import { describeOp, raisedBy } from '../landing/sample/sample-model';
import { parseEvidenceRows } from '../results/evidence-model';

interface MetricFmt {
  unit: string;
  digits: number;
}

interface ExampleSpec {
  /** Matched by who raised it + the first evidence metric it cites — the
   *  generator renumbers `sample-NN` ids on every regeneration. */
  specialist: string;
  leadMetric: string;
  theme: string;
  /** Evidence rows to show (metric path → number format), in this order.
   *  Rows without a measured value and an expected range are never shown. */
  metrics: Record<string, MetricFmt>;
}

// A varied set: low end, tonal balance, loudness (from the deterministic rule
// engine) and clipping. Only rows with a defensible expected range are shown.
const SPECS: readonly ExampleSpec[] = [
  {
    specialist: 'loudness',
    leadMetric: 'phase1.sub_30_energy',
    theme: 'Low end',
    metrics: { 'phase1.bands.sub_bass': { unit: ' dB', digits: 1 } },
  },
  {
    specialist: 'frequency_balance',
    leadMetric: 'phase1.bands.air',
    theme: 'Tonal balance',
    metrics: { 'phase1.bands.air': { unit: ' dB', digits: 1 } },
  },
  {
    specialist: 'rule_engine.hot_master',
    leadMetric: 'phase1.lufs',
    theme: 'Loudness',
    metrics: { 'phase1.lufs': { unit: ' LUFS', digits: 1 }, 'phase1.true_peak_db': { unit: ' dBTP', digits: 1 } },
  },
  {
    specialist: 'dynamics',
    leadMetric: 'phase1.clipping_detected',
    theme: 'Clipping',
    metrics: { 'phase1.true_peak_db': { unit: ' dBTP', digits: 1 } },
  },
];

export interface EvidenceView {
  label: string;
  measured: string;
  expected: string;
  /** Healthy zone [lo, hi] + the measured value, on a padded [min, max] axis. */
  bar: { min: number; max: number; lo: number; hi: number; value: number };
  out: 'below' | 'above' | 'in';
}

export interface ExampleView {
  id: string;
  theme: string;
  verdict: VerdictDto;
  severity: string;
  raisedBy: string;
  isRule: boolean;
  priority: number;
  evidence: EvidenceView[];
  why: string | null;
  target: string;
  steps: string[];
  device: string | null;
  outcome: string | null;
  merged: string[];
  /** Who in the OTHER lane (rules vs AI) suggested this finding's first move too. */
  sameMoveBy: string | null;
  suspected: boolean;
}

function fmt(v: number, f: MetricFmt): string {
  const s = v.toFixed(f.digits).replace(/^-/, '−');
  return `${s}${f.unit}`;
}

function cleanLabel(label: string): string {
  return label.split(' — ')[0].trim();
}

function bar(lo: number, hi: number, value: number): EvidenceView['bar'] {
  const a = Math.min(lo, value);
  const b = Math.max(hi, value);
  const pad = Math.max((b - a) * 0.18, (hi - lo) * 0.25);
  return { min: a - pad, max: b + pad, lo, hi, value };
}

function outOf(lo: number, hi: number, v: number): EvidenceView['out'] {
  return v < lo ? 'below' : v > hi ? 'above' : 'in';
}

function specEvidence(v: VerdictDto, metrics: Record<string, MetricFmt>): EvidenceView[] {
  const rows = parseEvidenceRows(v.evidence);
  const out: EvidenceView[] = [];
  for (const [metric, f] of Object.entries(metrics)) {
    const r = rows.find((row) => row.metric === metric);
    if (!r || r.value == null || !r.expected_range) continue;
    const [lo, hi] = r.expected_range;
    out.push({
      label: cleanLabel(r.label),
      measured: fmt(r.value, f),
      expected: `${fmt(lo, f)} … ${fmt(hi, f)}`,
      bar: bar(lo, hi, r.value),
      out: outOf(lo, hi, r.value),
    });
  }
  return out;
}

function opKey(v: VerdictDto): string | null {
  const op = v.fix?.dsp_chain?.[0];
  if (!op) return null;
  return `${op.type}@${String(op.params?.frequency_hz ?? '')}`;
}

function sameMove(f: SampleFinding, all: readonly SampleFinding[]): string | null {
  const key = opKey(f.verdict);
  if (!key) return null;
  const isRule = f.verdict.source === 'rule_engine';
  const other = all.find(
    (o) =>
      o !== f &&
      (o.verdict.source === 'rule_engine') !== isRule &&
      (o.verdict.fix?.dsp_chain ?? []).some((op) => `${op.type}@${String(op.params?.frequency_hz ?? '')}` === key),
  );
  return other ? raisedBy(other.verdict.specialist) : null;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hintDevice(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null;
  const d = (raw as Record<string, unknown>).device;
  return typeof d === 'string' ? d : null;
}

export function buildExamples(all: readonly SampleFinding[] = SAMPLE_FINDINGS): ExampleView[] {
  const out: ExampleView[] = [];
  for (const spec of SPECS) {
    const f = all.find(
      (x) => x.verdict.specialist === spec.specialist && parseEvidenceRows(x.verdict.evidence)[0]?.metric === spec.leadMetric,
    );
    if (!f) continue;
    const v = f.verdict;
    const isRule = v.source === 'rule_engine';
    out.push({
      id: f.verdict.id,
      theme: spec.theme,
      verdict: v,
      severity: capitalise(v.severity),
      raisedBy: raisedBy(v.specialist),
      isRule,
      priority: v.priorityScore,
      evidence: specEvidence(v, spec.metrics),
      why: v.whyItMatters?.trim() || null,
      target: capitalise(v.fix?.target?.name ?? 'master'),
      steps: (v.fix?.dsp_chain ?? []).map(describeOp),
      device: hintDevice(v.fix?.ableton_hint),
      outcome: v.fix?.expected_outcome?.trim() || null,
      merged: f.corroboratedBy.map((c) => c.headline),
      sameMoveBy: sameMove(f, all),
      suspected: v.suspected === true,
    });
  }
  return out;
}

export const EXAMPLE_GENRE = SAMPLE_META.genre;
