// Story 12.4 (review F6): the route's ?fixPreset narrowing — the only carry
// wiring testable without mounting the Web Audio page.
import { describe, expect, it } from 'vitest';
import { Route } from '../listen-rack.$versionId';

const validate = Route.options.validateSearch as (s: Record<string, unknown>) => { fixPreset?: string };

describe('listen-rack validateSearch', () => {
  it('accepts a uuid fixPreset (case-insensitive)', () => {
    const id = '0B0E9436-1111-2222-3333-444455556666';
    expect(validate({ fixPreset: id })).toEqual({ fixPreset: id });
    expect(validate({ fixPreset: id.toLowerCase() })).toEqual({ fixPreset: id.toLowerCase() });
  });

  it('drops non-uuid / non-string / missing values', () => {
    expect(validate({ fixPreset: 'not-a-uuid' })).toEqual({});
    expect(validate({ fixPreset: 42 })).toEqual({});
    expect(validate({ fixPreset: '../../etc/passwd' })).toEqual({});
    expect(validate({})).toEqual({});
  });
});
