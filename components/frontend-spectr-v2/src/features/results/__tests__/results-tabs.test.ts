import { describe, expect, it } from 'vitest';

import { isResultsTabKey, RESULTS_TAB_KEYS } from '../results-tab-keys';

// Guards the `?tab=` deep-link parsing in the results route's validateSearch.
describe('isResultsTabKey', () => {
  it('accepts every known tab key', () => {
    for (const key of RESULTS_TAB_KEYS) {
      expect(isResultsTabKey(key)).toBe(true);
    }
  });

  it('rejects unknown / non-string values', () => {
    // v4 revived 'actions' as the fix-first board and added stems/notes/dawplan.
    expect(isResultsTabKey('actions')).toBe(true);
    expect(isResultsTabKey('analysis')).toBe(false); // old key, folded into debug
    expect(isResultsTabKey('nope')).toBe(false);
    expect(isResultsTabKey('')).toBe(false);
    expect(isResultsTabKey(undefined)).toBe(false);
    expect(isResultsTabKey(null)).toBe(false);
    expect(isResultsTabKey(2)).toBe(false);
  });
});
