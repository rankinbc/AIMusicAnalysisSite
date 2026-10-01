import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../api/fetcher';
import type { EntitlementsDto, PlansResponse } from '../../../api/types';
import { costOf, isOutOfCredits } from '../credits';

const plans = {
  proMonthlyCents: 1299,
  proAnnualCents: 9900,
  creditPacks: [{ credits: 500, cents: 700 }],
  currency: 'USD',
  creditsEnabled: true,
  costs: { analysis: 100, specialist: 15, coachMessage: 5, coachMix: 5, signupGrant: 500, proAnalysesMonthly: 15, proCoachMonthly: 300 },
} as PlansResponse;

const ent = (over: Partial<EntitlementsDto>): EntitlementsDto =>
  ({
    analysesRemaining: 4, coachRemaining: 999, stemsEnabled: true, alsEnabled: true,
    fullVerdictsEnabled: true, historyDepth: null, tier: 'credits', analysesLimit: null,
    analysesUsed: 0, creditsEnabled: true, creditBalance: 420, ...over,
  }) as EntitlementsDto;

describe('costOf', () => {
  it('prices an analysis for a credits user', () => {
    expect(costOf('analysis', plans, ent({}))).toEqual({ credits: 100, included: false, affordable: true, label: '100 ◆' });
  });
  it('marks unaffordable when balance is below the price', () => {
    expect(costOf('analysis', plans, ent({ creditBalance: 40 }))?.affordable).toBe(false);
  });
  it('routed specialists are included', () => {
    expect(costOf('specialist', plans, ent({}), { routed: true })).toMatchObject({ included: true, label: 'Included' });
  });
  it('Pro analyses inside the allowance are included, past it they cost credits', () => {
    expect(costOf('analysis', plans, ent({ tier: 'pro', proAnalysesLimit: 15, proAnalysesUsed: 9 }))?.included).toBe(true);
    expect(costOf('analysis', plans, ent({ tier: 'pro', proAnalysesLimit: 15, proAnalysesUsed: 15 }))?.label).toBe('100 ◆');
  });
  it('returns null when credits are disabled', () => {
    expect(costOf('coachMix', { ...plans, creditsEnabled: false }, ent({ creditsEnabled: false }))).toBeNull();
  });
  it('returns null when data is missing', () => {
    expect(costOf('analysis', undefined, ent({}))).toBeNull();
    expect(costOf('analysis', plans, undefined)).toBeNull();
  });
});

describe('isOutOfCredits', () => {
  it('matches both server codes', () => {
    expect(isOutOfCredits(new ApiError(402, { error: { code: 'insufficient_credits', message: 'x' } }))).toBe(true);
    expect(isOutOfCredits(new ApiError(409, { error: { code: 'entitlement_exhausted', message: 'x' } }))).toBe(true);
    expect(isOutOfCredits(new ApiError(403, { error: { code: 'coach_cap_reached', message: 'x' } }))).toBe(false);
    expect(isOutOfCredits(new Error('boom'))).toBe(false);
  });
});
