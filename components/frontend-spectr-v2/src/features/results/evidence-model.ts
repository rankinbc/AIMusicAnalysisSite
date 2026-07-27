// Typed view over `VerdictDto.evidence` (jsonb → `unknown` on the wire).
// Mirrors the Python `aimusic_shared.verdicts.models.Evidence` shape; the
// parser NARROWS instead of casting — malformed legacy rows degrade to fewer
// rows, never to a crash (gotcha #11).

export interface EvidenceRow {
  metric: string;
  value: number | null;
  expected_range: [number, number] | null;
  delta_pct: number | null;
  label: string;
  frequency_range_hz: [number, number] | null;
  stems: string[] | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  return typeof a === 'number' && typeof b === 'number' ? [a, b] : null;
}

function strList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : null;
}

/** Parse one evidence entry; null when it isn't a usable row. `label` is the
 *  only hard requirement (it is required Python-side); `metric` tolerates
 *  absence on legacy rows by falling back to the label. */
function parseRow(raw: unknown): EvidenceRow | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const label = typeof o.label === 'string' ? o.label : null;
  const metric = typeof o.metric === 'string' ? o.metric : null;
  if (!label && !metric) return null;
  return {
    metric: metric ?? label ?? '',
    value: num(o.value),
    expected_range: pair(o.expected_range),
    delta_pct: num(o.delta_pct),
    label: label ?? metric ?? '',
    frequency_range_hz: pair(o.frequency_range_hz),
    stems: strList(o.stems),
  };
}

/** `VerdictDto.evidence` (unknown) → typed rows. Garbage in → empty out. */
export function parseEvidenceRows(evidence: unknown): EvidenceRow[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.map(parseRow).filter((r): r is EvidenceRow => r !== null);
}

/** Display formatting for the ev2 table. */
export function formatEvValue(v: number | null): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export function formatEvRange(r: [number, number] | null): string {
  if (!r) return '—';
  return `${formatEvValue(r[0])} … ${formatEvValue(r[1])}`;
}

export function formatEvDelta(row: EvidenceRow): string {
  if (row.delta_pct != null) {
    const sign = row.delta_pct > 0 ? '+' : '';
    return `${sign}${formatEvValue(row.delta_pct)}%`;
  }
  if (row.value != null && row.expected_range) {
    const [lo, hi] = row.expected_range;
    if (row.value < lo) return formatEvValue(row.value - lo);
    if (row.value > hi) return `+${formatEvValue(row.value - hi)}`;
    return 'in range';
  }
  return '—';
}
