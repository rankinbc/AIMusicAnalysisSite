// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { readAttribution } from '../attribution';

const KEY = 'spectr_attribution';

function setSearch(qs: string) {
  window.history.replaceState({}, '', qs ? `/?${qs}` : '/');
}

describe('readAttribution (story 6.5 AC4)', () => {
  afterEach(() => {
    window.localStorage.clear();
    setSearch('');
  });

  it('returns {} with no param and no stash', () => {
    expect(readAttribution()).toEqual({});
  });

  it('drains the localStorage stash once and reports its slugified source', () => {
    window.localStorage.setItem(KEY, 'newsletter');
    expect(readAttribution()).toEqual({ source: 'newsletter' });
    // Drained — a later unrelated signup must not inherit it.
    expect(readAttribution()).toEqual({});
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('prefers the ?via / ?ref URL param over the stash and still drains the stash', () => {
    window.localStorage.setItem(KEY, 'stale-campaign');
    setSearch('via=fresh-campaign');
    expect(readAttribution()).toEqual({ source: 'fresh-campaign' });
    expect(window.localStorage.getItem(KEY)).toBeNull(); // drained regardless

    setSearch('ref=producthunt');
    expect(readAttribution()).toEqual({ source: 'producthunt' });
  });

  it('slugifies a ref and DROPS anything email-like / not a plausible campaign slug (privacy)', () => {
    setSearch('ref=' + encodeURIComponent('jane.doe@gmail.com'));
    // @ and . stripped → "janedoegmailcom" (no PII punctuation survives).
    expect(readAttribution().source).toBe('janedoegmailcom');
    setSearch('ref=' + encodeURIComponent('!!!'));
    expect(readAttribution()).toEqual({}); // nothing slug-shaped → dropped
  });

  it('an empty ?via= falls through to ?ref= instead of shadowing it', () => {
    setSearch('via=&ref=producthunt');
    expect(readAttribution()).toEqual({ source: 'producthunt' });
  });
});
