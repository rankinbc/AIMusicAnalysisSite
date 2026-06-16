import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CreditLedgerEntryDto } from '../../../api/types';
import { CreditLedgerTable } from '../CreditLedgerTable';

// Story 2.3 / Task 9.3 — pure-render tests for the mono ledger table.
// Asserts signed-amount prefix + reason capitalization + truncation.

const PURCHASE: CreditLedgerEntryDto = {
  id: '11111111-1111-1111-1111-111111111111',
  amount: 5,
  reason: 'purchase',
  reference: 'pi_1234567890abcdef',
  createdAt: '2026-06-15T10:00:00Z',
};

const SPEND: CreditLedgerEntryDto = {
  id: '22222222-2222-2222-2222-222222222222',
  amount: -1,
  reason: 'spend',
  reference: '00000000-0000-0000-0000-aaaaaaaaaaaa',
  createdAt: '2026-06-15T11:00:00Z',
};

const REVERSAL: CreditLedgerEntryDto = {
  id: '33333333-3333-3333-3333-333333333333',
  amount: 1,
  reason: 'reversal',
  reference: '00000000-0000-0000-0000-aaaaaaaaaaaa',
  createdAt: '2026-06-15T12:00:00Z',
};

describe('CreditLedgerTable (story 2.3)', () => {
  it('renders the empty state when entries is empty', () => {
    const html = renderToStaticMarkup(<CreditLedgerTable entries={[]} />);
    expect(html).toContain('No ledger entries yet.');
    expect(html).not.toContain('<table');
  });

  it('renders signed amounts: + prefix for positive, - prefix for negative', () => {
    const html = renderToStaticMarkup(
      <CreditLedgerTable entries={[PURCHASE, SPEND, REVERSAL]} />,
    );
    expect(html).toContain('+5');
    expect(html).toContain('-1');
    expect(html).toContain('+1');
  });

  it('renders reason labels capitalized', () => {
    const html = renderToStaticMarkup(
      <CreditLedgerTable entries={[PURCHASE, SPEND, REVERSAL]} />,
    );
    expect(html).toContain('Purchase');
    expect(html).toContain('Spend');
    expect(html).toContain('Reversal');
  });

  it('truncates long references to the last 10 chars with a leading ellipsis', () => {
    const html = renderToStaticMarkup(<CreditLedgerTable entries={[PURCHASE]} />);
    // pi_1234567890abcdef is >14 chars → "…7890abcdef".
    expect(html).toContain('…7890abcdef');
    expect(html).not.toContain('pi_1234567890abcdef');
  });
});
