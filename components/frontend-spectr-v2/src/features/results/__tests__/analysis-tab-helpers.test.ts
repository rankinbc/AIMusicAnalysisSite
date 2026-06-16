import { describe, expect, it } from 'vitest';

import { rerunPhaseFor } from '../analysis-tab-helpers';

describe('rerunPhaseFor', () => {
  it('allows on-demand re-run for stem clash (4) and reference (5)', () => {
    expect(rerunPhaseFor(4, 'ok')).toBe(4);
    expect(rerunPhaseFor(5, 'ok')).toBe(5);
  });

  it('allows retry of any failed phase from 2 up', () => {
    expect(rerunPhaseFor(2, 'failed')).toBe(2);
    expect(rerunPhaseFor(3, 'failed')).toBe(3);
    expect(rerunPhaseFor(6, 'failed')).toBe(6);
    expect(rerunPhaseFor(7, 'failed')).toBe(7);
  });

  it('does NOT offer re-run for healthy non-asset phases', () => {
    expect(rerunPhaseFor(2, 'ok')).toBeUndefined();
    expect(rerunPhaseFor(3, 'ok')).toBeUndefined();
    expect(rerunPhaseFor(6, 'ok')).toBeUndefined();
    expect(rerunPhaseFor(7, 'ok')).toBeUndefined();
  });

  it('never offers re-run for phase 1 (full re-analyze only)', () => {
    expect(rerunPhaseFor(1, 'ok')).toBeUndefined();
    expect(rerunPhaseFor(1, 'failed')).toBeUndefined();
  });
});
