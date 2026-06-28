import type { VersionDto, VersionMetricsDto } from '../../api/types';

export type Dir = 'high' | 'target' | 'neutral';
export type Tone = 'good' | 'bad' | 'neutral';

export const METRICS: {
  key: keyof VersionMetricsDto; label: string; unit: string; dec: number; dir: Dir; target?: number;
}[] = [
  { key: 'score', label: 'Mix score', unit: '', dec: 0, dir: 'high' },
  { key: 'lufs', label: 'Loudness', unit: ' LUFS', dec: 1, dir: 'target', target: -9 },
  { key: 'dynamicRangeLu', label: 'Dynamics', unit: ' LU', dec: 1, dir: 'high' },
  { key: 'bass', label: 'Bass energy', unit: '', dec: 0, dir: 'neutral' },
  { key: 'air', label: 'Air / highs', unit: '', dec: 0, dir: 'high' },
  { key: 'stereoWidth', label: 'Stereo width', unit: '', dec: 0, dir: 'neutral' },
];

type MetricDef = (typeof METRICS)[number];

export function metricDelta(a: number | null, b: number | null, m: MetricDef) {
  const fmt = (x: number | null) => (x == null ? '—' : x.toFixed(m.dec) + m.unit);
  if (a == null || b == null) return { aStr: fmt(a), bStr: fmt(b), deltaStr: '—', tone: 'neutral' as Tone };
  const diff = a - b;
  const eps = m.dec ? 0.05 : 0.5;
  if (Math.abs(diff) < eps) return { aStr: fmt(a), bStr: fmt(b), deltaStr: '±0', tone: 'neutral' as Tone };
  const deltaStr = (diff > 0 ? '+' : '') + diff.toFixed(m.dec);
  let better: boolean | null = null;
  if (m.dir === 'high') better = diff > 0;
  else if (m.dir === 'target' && m.target != null) better = Math.abs(a - m.target) < Math.abs(b - m.target);
  const tone: Tone = better === true ? 'good' : better === false ? 'bad' : 'neutral';
  return { aStr: fmt(a), bStr: fmt(b), deltaStr, tone };
}

export function personalVerdict(aP: number | null, bP: number | null) {
  if (aP == null || bP == null)
    return { deltaStr: '—', tone: 'neutral' as Tone, label: 'Score A & B to weigh in' };
  const d = aP - bP;
  if (d > 0) return { deltaStr: '+' + d, tone: 'good' as Tone, label: '▲ you rate A higher' };
  if (d < 0) return { deltaStr: String(d), tone: 'bad' as Tone, label: '▼ you rate B higher' };
  return { deltaStr: '±0', tone: 'neutral' as Tone, label: '= you rate them level' };
}

export function noteKey(aId: string, bId: string): string {
  return [aId, bId].slice().sort().join('-');
}

export type VStatus = 'analyzed' | 'analyzing' | 'failed' | 'unscored';
export function versionStatus(v: VersionDto): VStatus {
  if (v.latestResult && v.latestResult.score != null) return 'analyzed';
  // analyzing/failed come from job state when wired; default unscored.
  return 'unscored';
}

export function sortVersionsDesc(versions: VersionDto[]): VersionDto[] {
  return versions.slice().sort((a, b) => b.versionNumber - a.versionNumber);
}

export function defaultSlots(versions: VersionDto[]): { a: string | null; b: string | null } {
  const desc = sortVersionsDesc(versions);
  const current = versions.find(v => v.isCurrent) ?? desc[0] ?? null;
  const prev = desc.find(v => v.id !== current?.id) ?? null;
  return { a: current?.id ?? null, b: prev?.id ?? null };
}

export function scoredAsc(versions: VersionDto[]): VersionDto[] {
  return versions
    .filter(v => v.latestResult?.score != null)
    .sort((a, b) => a.versionNumber - b.versionNumber);
}

export function trendSummary(versions: VersionDto[]): string {
  const sc = scoredAsc(versions);
  if (sc.length < 2) return '';
  const first = sc[0].latestResult!.score!;
  const last = sc[sc.length - 1].latestResult!.score!;
  const d = last - first;
  return `${d >= 0 ? '+' : ''}${d} pts · v${sc[0].versionNumber}→v${sc[sc.length - 1].versionNumber}`;
}
