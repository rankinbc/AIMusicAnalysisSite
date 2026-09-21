import { describe, expect, it } from 'vitest';

import { demoDestination, LISTEN_MIN_WIDTH } from '../demoDestination';

const t = { songId: 's', versionId: 'v', jobId: 'j' };

describe('demoDestination', () => {
  it('sends a desktop visitor straight to Listen', () =>
    expect(demoDestination(t, LISTEN_MIN_WIDTH)).toEqual({
      to: '/listen-rack/$versionId',
      params: { versionId: 'v' },
    }));

  it('sends a phone to the report — Listen is desktop-gated below 1024px', () =>
    expect(demoDestination(t, LISTEN_MIN_WIDTH - 1)).toEqual({
      to: '/songs/$songId/results/$jobId',
      params: { songId: 's', jobId: 'j' },
    }));

  it('treats an unknown width as a phone', () =>
    expect(demoDestination(t, 0).to).toBe('/songs/$songId/results/$jobId'));
});
