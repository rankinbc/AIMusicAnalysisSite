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

  it('reads the localStorage stash and DRAINS it (attaches once)', () => {
    window.localStorage.setItem(KEY, 'share_abc');
    expect(readAttribution()).toEqual({ source: 'share_abc' });
    // Drained — a later unrelated signup must not inherit it.
    expect(readAttribution()).toEqual({});
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('prefers the ?via / ?ref URL param over the stash and still drains the stash', () => {
    window.localStorage.setItem(KEY, 'share_stale');
    setSearch('via=share_fresh');
    expect(readAttribution()).toEqual({ source: 'share_fresh' });
    expect(window.localStorage.getItem(KEY)).toBeNull(); // drained regardless

    setSearch('ref=producthunt');
    expect(readAttribution()).toEqual({ source: 'producthunt' });
  });
});
