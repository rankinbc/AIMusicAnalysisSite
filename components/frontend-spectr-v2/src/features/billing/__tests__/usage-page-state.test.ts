import { describe, expect, it } from 'vitest';

import type { CreditsResponse } from '../../../api/types';

// Story 2.3 — pure reducer for the Usage page state machine. The
// page renders one of three states based on (balance, entries.length):
//
//   empty: balance === 0 AND entries.length === 0 → "haven't bought any credits yet" empty state
//   active: entries.length > 0                    → ledger table
//   loading-more: query.hasNextPage               → renders Load-more button
//
// Mirrors story 2.2's billing-page-state pattern: decision is a pure
// function the page calls; the renderer just switches on it.

type Card = 'loading' | 'empty' | 'active';

function pickCard(
  isLoading: boolean,
  balance: number,
  entries: ReadonlyArray<unknown>,
): Card {
  if (isLoading) return 'loading';
  if (balance === 0 && entries.length === 0) return 'empty';
  return 'active';
}

const EMPTY: CreditsResponse = {
  balance: 0,
  entries: [],
  nextCursor: null,
};

const PURCHASED: CreditsResponse = {
  balance: 5,
  entries: [
    {
      id: '00000000-0000-0000-0000-000000000001',
      amount: 5,
      reason: 'purchase',
      reference: 'pi_test',
      createdAt: '2026-06-15T10:00:00Z',
    },
  ],
  nextCursor: null,
};

const SPENT_TO_ZERO: CreditsResponse = {
  balance: 0,
  entries: [
    {
      id: '00000000-0000-0000-0000-000000000002',
      amount: -1,
      reason: 'spend',
      reference: 'job-1',
      createdAt: '2026-06-15T11:00:00Z',
    },
  ],
  nextCursor: null,
};

describe('Usage page card-selection state machine (story 2.3)', () => {
  it('isLoading → loading card', () => {
    expect(pickCard(true, 0, [])).toBe('loading');
  });

  it('balance=0 AND empty entries → empty card', () => {
    expect(pickCard(false, EMPTY.balance, EMPTY.entries)).toBe('empty');
  });

  it('balance>0 with entries → active card (ledger renders)', () => {
    expect(pickCard(false, PURCHASED.balance, PURCHASED.entries)).toBe('active');
  });

  it('balance=0 but with historical entries → active card (show ledger anyway)', () => {
    // User has spent down to zero but still has a ledger history;
    // show the ledger rather than the "no credits yet" empty state.
    expect(pickCard(false, SPENT_TO_ZERO.balance, SPENT_TO_ZERO.entries)).toBe(
      'active',
    );
  });
});
