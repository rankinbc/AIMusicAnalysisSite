import { describe, expect, it } from 'vitest';

import { demoDestination } from '../demoDestination';

const t = { songId: 's', versionId: 'v', jobId: 'j' };
const report = { to: '/songs/$songId/results/$jobId', params: { songId: 's', jobId: 'j' } };

describe('demoDestination', () => {
  // Owner ruling 2026-10-01: "Explore the demo" always opens the demo song's
  // results page — findings, actions and the coach are the first impression on
  // every screen size; Listen is one click away from the report.
  it('sends every visitor to the demo song results page', () =>
    expect(demoDestination(t)).toEqual(report));

  it('does not route a wide desktop to Listen', () => {
    // Guards against reintroducing the old viewport-width branch.
    const legacyCall = demoDestination as (...args: unknown[]) => unknown;
    expect(legacyCall(t, 1920)).toEqual(report);
  });
});
