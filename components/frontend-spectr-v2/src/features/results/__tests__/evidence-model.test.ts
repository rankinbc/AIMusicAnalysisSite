import { describe, expect, it } from 'vitest';

import {
  formatEvDelta,
  formatEvRange,
  formatEvValue,
  parseEvidenceRows,
} from '../evidence-model';

// A real evidence payload shape (Python aimusic_shared Evidence.model_dump()).
const realRow = {
  metric: 'phase1.true_peak_db',
  value: 0.4,
  expected_range: [-3.0, -1.0],
  delta_pct: null,
  label: '+0.4 dBTP true peak',
  frequency_range_hz: null,
  stems: null,
};

describe('parseEvidenceRows', () => {
  it('parses a real evidence list', () => {
    const rows = parseEvidenceRows([realRow]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      metric: 'phase1.true_peak_db',
      value: 0.4,
      expected_range: [-3.0, -1.0],
      label: '+0.4 dBTP true peak',
    });
  });

  it('keeps frequency ranges and stems when present', () => {
    const rows = parseEvidenceRows([
      { ...realRow, frequency_range_hz: [40, 60], stems: ['kick', 'bass'] },
    ]);
    expect(rows[0]?.frequency_range_hz).toEqual([40, 60]);
    expect(rows[0]?.stems).toEqual(['kick', 'bass']);
  });

  it('tolerates legacy rows missing label (falls back to metric)', () => {
    const rows = parseEvidenceRows([{ metric: 'phase1.lufs', value: -8.2 }]);
    expect(rows[0]?.label).toBe('phase1.lufs');
  });

  it('degrades garbage input to zero rows instead of crashing', () => {
    expect(parseEvidenceRows(null)).toEqual([]);
    expect(parseEvidenceRows('not-an-array')).toEqual([]);
    expect(parseEvidenceRows([null, 42, 'x', {}, { value: 'NaN-ish' }])).toEqual([]);
    expect(parseEvidenceRows([{ label: 'ok' }, undefined])).toHaveLength(1);
  });

  it('drops malformed tuple fields but keeps the row', () => {
    const rows = parseEvidenceRows([
      { ...realRow, expected_range: [1], frequency_range_hz: ['a', 'b'] },
    ]);
    expect(rows[0]?.expected_range).toBeNull();
    expect(rows[0]?.frequency_range_hz).toBeNull();
  });
});

describe('formatters', () => {
  it('formats values, ranges and deltas', () => {
    expect(formatEvValue(null)).toBe('—');
    expect(formatEvValue(3)).toBe('3');
    expect(formatEvValue(-8.234)).toBe('-8.23');
    expect(formatEvRange([-16, -12])).toBe('-16 … -12');
    expect(formatEvRange(null)).toBe('—');
  });

  it('derives delta from delta_pct first, then range distance', () => {
    const withPct = parseEvidenceRows([{ ...realRow, delta_pct: 22.5 }])[0]!;
    expect(formatEvDelta(withPct)).toBe('+22.50%');
    const above = parseEvidenceRows([realRow])[0]!; // 0.4 vs [-3, -1] → +1.4 over
    expect(formatEvDelta(above)).toBe('+1.40');
    const inRange = parseEvidenceRows([{ ...realRow, value: -2 }])[0]!;
    expect(formatEvDelta(inRange)).toBe('in range');
  });
});
