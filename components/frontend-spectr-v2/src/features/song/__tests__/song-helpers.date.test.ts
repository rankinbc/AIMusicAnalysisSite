import { describe, expect, it } from 'vitest';
import { fmtShortDate } from '../song-helpers';

const label = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

describe('fmtShortDate', () => {
  it('formats a full ISO timestamp (the shape the API sends)', () => {
    const iso = '2026-10-04T18:22:31.123456Z';
    expect(fmtShortDate(iso)).toBe(label(new Date(iso)));
    expect(fmtShortDate(iso)).not.toContain('Invalid');
  });

  it('pins a bare date to local noon so the day never slips', () => {
    expect(fmtShortDate('2026-10-04')).toBe(label(new Date(2026, 9, 4, 12)));
  });

  it('renders nothing for missing or unparseable input', () => {
    expect(fmtShortDate('')).toBe('');
    expect(fmtShortDate(null)).toBe('');
    expect(fmtShortDate(undefined)).toBe('');
    expect(fmtShortDate('not a date')).toBe('');
  });
});
