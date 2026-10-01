import { describe, expect, it } from 'vitest';

import { GUEST_EXPIRY_FALLBACK, guestExpiryNote } from '../guest-expiry';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('guestExpiryNote', () => {
  it('rounds the remaining time UP to whole hours (plural)', () => {
    expect(guestExpiryNote(at(23 * HOUR + 1 * MIN), NOW)).toBe(
      'Create an account to keep your progress. It will be deleted in 24 hours.',
    );
    expect(guestExpiryNote(at(24 * HOUR), NOW)).toContain('in 24 hours.');
    expect(guestExpiryNote(at(HOUR + 1), NOW)).toContain('in 2 hours.');
  });

  it('uses the singular for exactly one hour', () => {
    expect(guestExpiryNote(at(HOUR), NOW)).toBe(
      'Create an account to keep your progress. It will be deleted in 1 hour.',
    );
  });

  it('says "less than 1 hour" under an hour and once already expired', () => {
    expect(guestExpiryNote(at(59 * MIN), NOW)).toBe(
      'Create an account to keep your progress. It will be deleted in less than 1 hour.',
    );
    expect(guestExpiryNote(at(-5 * MIN), NOW)).toContain('less than 1 hour.');
  });

  it('falls back when the expiry is unknown or unparseable', () => {
    expect(guestExpiryNote(null, NOW)).toBe(GUEST_EXPIRY_FALLBACK);
    expect(guestExpiryNote(undefined, NOW)).toBe(GUEST_EXPIRY_FALLBACK);
    expect(guestExpiryNote('not-a-date', NOW)).toBe(GUEST_EXPIRY_FALLBACK);
    expect(GUEST_EXPIRY_FALLBACK).toBe(
      'Create an account to keep your progress — guest data is deleted automatically.',
    );
  });
});
