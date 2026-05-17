import { describe, expect, it } from 'vitest';

import { SEVERITY_LABEL, SEVERITY_RANK, severityColor, severityLabel } from '../helpers/severity';

describe('severityColor', () => {
  it('maps each known severity to its CSS var', () => {
    expect(severityColor('critical')).toBe('var(--sev-critical)');
    expect(severityColor('severe')).toBe('var(--sev-severe)');
    expect(severityColor('moderate')).toBe('var(--sev-moderate)');
    expect(severityColor('minor')).toBe('var(--sev-minor)');
    expect(severityColor('win')).toBe('var(--sev-win)');
  });

  it('returns the muted token for unknown input', () => {
    expect(severityColor('weird')).toBe('var(--muted)');
    expect(severityColor('')).toBe('var(--muted)');
  });
});

describe('severityLabel', () => {
  it('returns the canonical label for known severities', () => {
    expect(severityLabel('critical')).toBe(SEVERITY_LABEL.critical);
    expect(severityLabel('win')).toBe('WIN');
  });

  it('falls back to uppercased input for unknown severities', () => {
    expect(severityLabel('mystery')).toBe('MYSTERY');
  });
});

describe('SEVERITY_RANK', () => {
  it('orders critical > severe > moderate > minor > win', () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.severe);
    expect(SEVERITY_RANK.severe).toBeGreaterThan(SEVERITY_RANK.moderate);
    expect(SEVERITY_RANK.moderate).toBeGreaterThan(SEVERITY_RANK.minor);
    expect(SEVERITY_RANK.minor).toBeGreaterThan(SEVERITY_RANK.win);
  });
});
