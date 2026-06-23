import { describe, expect, it } from 'vitest';
import { chainLinks, isPermutation } from './chainLinks';

describe('chainLinks', () => {
  it('connects IN straight to OUT when empty', () => {
    expect(chainLinks([])).toEqual([['IN', 'OUT']]);
  });
  it('wraps a single unit between IN and OUT', () => {
    expect(chainLinks(['eq'])).toEqual([
      ['IN', 'eq'],
      ['eq', 'OUT'],
    ]);
  });
  it('chains units in order with IN/OUT bookends', () => {
    expect(chainLinks(['eq', 'comp', 'sat', 'ms'])).toEqual([
      ['IN', 'eq'],
      ['eq', 'comp'],
      ['comp', 'sat'],
      ['sat', 'ms'],
      ['ms', 'OUT'],
    ]);
  });
});

describe('isPermutation', () => {
  const known = ['eq', 'comp', 'sat', 'ms'] as const;
  it('accepts the same set in any order', () => {
    expect(isPermutation(['ms', 'sat', 'comp', 'eq'], known)).toBe(true);
    expect(isPermutation(['eq', 'comp', 'sat', 'ms'], known)).toBe(true);
  });
  it('rejects a missing id', () => {
    expect(isPermutation(['eq', 'comp', 'sat'], known)).toBe(false);
  });
  it('rejects an extra id (wrong length)', () => {
    expect(isPermutation(['eq', 'comp', 'sat', 'ms', 'eq'], known)).toBe(false);
  });
  it('rejects a duplicate (right length, wrong multiset)', () => {
    expect(isPermutation(['eq', 'eq', 'sat', 'ms'], known)).toBe(false);
  });
});
