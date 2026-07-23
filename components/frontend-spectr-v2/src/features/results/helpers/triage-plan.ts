/* Pure run-state resolution for the report-page triage plan panel. */
import { SPECIALIST_CATALOG } from './specialists';

export type SpecRunState = 'ran' | 'running' | 'idle' | 'needs-stems';

export function specRunState(
  slug: string,
  ran: ReadonlySet<string>,
  running: ReadonlySet<string>,
  hasStems: boolean,
): SpecRunState {
  if (ran.has(slug)) return 'ran';
  if (running.has(slug)) return 'running';
  const meta = SPECIALIST_CATALOG.find((m) => m.slug === slug);
  if (meta?.needsStems && !hasStems) return 'needs-stems';
  return 'idle';
}

export const STATE_LABEL: Record<SpecRunState, string> = {
  ran: '✓ ran',
  running: 'running…',
  idle: 'Run',
  'needs-stems': 'needs stems',
};
