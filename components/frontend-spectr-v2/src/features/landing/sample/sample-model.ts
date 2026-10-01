// Pure derivations for the landing page's live sample report. Everything here
// is computed from the generated fixture (sample-data.ts) — no copy is
// invented about the track; only labels/formatting live here.

import type { VerdictDspOp, VerdictDto } from '../../../api/types';
import { specialistLabel } from '../../results/helpers/specialists';
import type { SampleFinding } from './sample-data';

export function isWin(f: SampleFinding): boolean {
  return f.verdict.severity === 'win';
}

export function hasFix(v: VerdictDto): boolean {
  return (v.fix?.dsp_chain?.length ?? 0) > 0;
}

/** Display name for whoever raised a verdict: an AI specialist's catalog
 *  label, or "Measurement engine" for the deterministic rule engine. */
export function raisedBy(specialist: string): string {
  if (specialist.startsWith('rule_engine')) return 'Measurement engine';
  return specialistLabel(specialist);
}

export interface TeamMember {
  name: string;
  isRule: boolean;
  count: number;
}

/** Who reviewed the mix and how many verdicts each contributed (including
 *  corroborations that were folded into another finding). */
export function teamOf(findings: SampleFinding[]): TeamMember[] {
  const counts = new Map<string, TeamMember>();
  const add = (slug: string) => {
    const isRule = slug.startsWith('rule_engine');
    const name = raisedBy(slug);
    const cur = counts.get(name) ?? { name, isRule, count: 0 };
    cur.count += 1;
    counts.set(name, cur);
  };
  for (const f of findings) {
    add(f.verdict.specialist);
    for (const c of f.corroboratedBy) add(c.specialist);
  }
  return [...counts.values()].sort(
    (a, b) => Number(a.isRule) - Number(b.isRule) || b.count - a.count || a.name.localeCompare(b.name),
  );
}

export interface PlanStep {
  verdict: VerdictDto;
  steps: string[];
  device: string | null;
  presetName: string | null;
  outcome: string | null;
}

/** The recommended-actions list: every issue that carries a concrete DSP
 *  fix, highest priority first (the same ordering the report uses). */
export function planSteps(findings: SampleFinding[]): PlanStep[] {
  return findings
    .filter((f) => !isWin(f) && hasFix(f.verdict))
    .map((f) => f.verdict)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.confidence - a.confidence)
    .map((v) => {
      const hint = abletonHint(v.fix?.ableton_hint);
      return {
        verdict: v,
        steps: (v.fix?.dsp_chain ?? []).map(describeOp),
        device: hint.device,
        presetName: hint.presetName,
        outcome: v.fix?.expected_outcome?.trim() || null,
      };
    });
}

function abletonHint(raw: unknown): { device: string | null; presetName: string | null } {
  if (raw == null || typeof raw !== 'object') return { device: null, presetName: null };
  const o = raw as Record<string, unknown>;
  return {
    device: typeof o.device === 'string' ? o.device : null,
    presetName: typeof o.preset_name === 'string' ? o.preset_name : null,
  };
}

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function trimNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/** 10000 → "10 kHz", 3500 → "3.5 kHz", 320 → "320 Hz". */
export function formatHz(hz: number): string {
  return hz >= 1000 ? `${trimNum(hz / 1000)} kHz` : `${trimNum(hz)} Hz`;
}

/** +2.9 / −2.5 with a real minus sign. */
export function formatDb(db: number): string {
  const sign = db > 0 ? '+' : db < 0 ? '−' : '';
  return `${sign}${trimNum(Math.abs(db))} dB`;
}

/** One DSP op → a plain instruction a producer can type into any DAW. Unknown
 *  op types fall back to "type: k=v" so a new op never disappears. */
export function describeOp(op: VerdictDspOp): string {
  const p = op.params ?? {};
  const f = n(p.frequency_hz);
  const g = n(p.gain_db);
  const q = n(p.q);
  switch (op.type) {
    case 'high_pass':
    case 'low_pass': {
      const slope = n(p.slope_db);
      const kind = op.type === 'high_pass' ? 'High-pass' : 'Low-pass';
      return `${kind} at ${f != null ? formatHz(f) : '?'}${slope != null ? `, ${slope} dB/oct` : ''}`;
    }
    case 'peaking_eq':
      return `EQ bell ${g != null ? formatDb(g) : ''} at ${f != null ? formatHz(f) : '?'}${q != null ? `, Q ${trimNum(q)}` : ''}`;
    case 'high_shelf':
    case 'low_shelf':
      return `${op.type === 'high_shelf' ? 'High' : 'Low'} shelf ${g != null ? formatDb(g) : ''} at ${f != null ? formatHz(f) : '?'}`;
    case 'stereo_width': {
      const w = n(p.width_pct);
      return `Stereo width to ${w != null ? `${trimNum(w)}%` : '?'}`;
    }
    case 'gain':
    case 'trim':
      return `Gain ${g != null ? formatDb(g) : ''}`.trim();
    case 'limiter': {
      const c = n(p.ceiling_db);
      const r = n(p.release_ms);
      return `Limiter, ceiling ${c != null ? formatDb(c) : '?'}${r != null ? `, release ${trimNum(r)} ms` : ''}`;
    }
    case 'compressor': {
      const parts = [
        n(p.ratio) != null ? `${trimNum(n(p.ratio)!)}:1` : null,
        n(p.threshold_db) != null ? `threshold ${formatDb(n(p.threshold_db)!)}` : null,
        n(p.attack_ms) != null ? `attack ${trimNum(n(p.attack_ms)!)} ms` : null,
        n(p.release_ms) != null ? `release ${trimNum(n(p.release_ms)!)} ms` : null,
      ].filter(Boolean);
      return `Compressor ${parts.join(', ')}`.trim();
    }
    default: {
      const kv = Object.entries(p)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ');
      return kv ? `${op.type}: ${kv}` : op.type;
    }
  }
}
