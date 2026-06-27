// Tab keys for the results page, split out from the ResultsTabs component so
// the runtime helpers can be imported by the route's validateSearch without
// tripping react-refresh's component-only-export rule.
//
// Redesign IA (2026-06-26): AI Coach is the primary/default surface; the old
// `actions` tab is dissolved (its move list now lives under the coach), and the
// old `analysis`/`files` tabs fold into Debug / the uploads sidebar. `project`
// and `reference` are conditional (shown only when their inputs are attached).

export type ResultsTabKey = 'coach' | 'findings' | 'project' | 'reference' | 'trackinfo' | 'debug';

export const RESULTS_TAB_KEYS: readonly ResultsTabKey[] = [
  'coach',
  'findings',
  'project',
  'reference',
  'trackinfo',
  'debug',
];

/** The default tab when none is in the URL. */
export const DEFAULT_RESULTS_TAB: ResultsTabKey = 'coach';

/** Narrow an unknown (e.g. a URL search param) to a valid tab key. */
export function isResultsTabKey(v: unknown): v is ResultsTabKey {
  return typeof v === 'string' && (RESULTS_TAB_KEYS as readonly string[]).includes(v);
}
