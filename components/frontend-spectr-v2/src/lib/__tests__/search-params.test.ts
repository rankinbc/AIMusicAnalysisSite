import { describe, expect, it } from 'vitest';
import { optionalString } from '../search-params';
describe('optionalString', () => {
  const next = optionalString('next');
  it('keeps a string', () => { expect(next({ next: '/pricing' })).toEqual({ next: '/pricing' }); });
  it('omits the key entirely when absent (exactOptionalPropertyTypes)', () => { expect(next({})).toEqual({}); });
  it('drops non-strings instead of coercing them', () => {
    expect(next({ next: 5 })).toEqual({});
    expect(next({ next: ['/a'] })).toEqual({});
  });
});
