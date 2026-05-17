// Verdict severity helpers — color tokens + display labels + rank ordering.

import type { Severity } from '../../../api/types';

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'CRITICAL',
  severe: 'SEVERE',
  moderate: 'MODERATE',
  minor: 'MINOR',
  win: 'WIN',
};

/** Returns a CSS var ('var(--sev-critical)' etc.) for the given severity. */
export function severityColor(sev: string): string {
  switch (sev) {
    case 'critical': return 'var(--sev-critical)';
    case 'severe':   return 'var(--sev-severe)';
    case 'moderate': return 'var(--sev-moderate)';
    case 'minor':    return 'var(--sev-minor)';
    case 'win':      return 'var(--sev-win)';
    default:         return 'var(--muted)';
  }
}

export function severityLabel(sev: string): string {
  if (isSeverity(sev)) return SEVERITY_LABEL[sev];
  return sev.toUpperCase();
}

function isSeverity(s: string): s is Severity {
  return s === 'critical' || s === 'severe' || s === 'moderate' || s === 'minor' || s === 'win';
}

/** Sort order: critical(5) > severe(4) > moderate(3) > minor(2) > win(1). */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  severe: 4,
  moderate: 3,
  minor: 2,
  win: 1,
};
