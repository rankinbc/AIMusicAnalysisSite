// Tab keys for the results page, split out from the ResultsTabs component so
// the runtime helpers can be imported by the route's validateSearch without
// tripping react-refresh's component-only-export rule.

export type ResultsTabKey = 'actions' | 'analysis' | 'files';

export const RESULTS_TAB_KEYS: readonly ResultsTabKey[] = ['actions', 'analysis', 'files'];

/** Narrow an unknown (e.g. a URL search param) to a valid tab key. */
export function isResultsTabKey(v: unknown): v is ResultsTabKey {
  return typeof v === 'string' && (RESULTS_TAB_KEYS as readonly string[]).includes(v);
}
