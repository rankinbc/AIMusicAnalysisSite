import { describe, expect, it } from 'vitest';

import { WAIT_FIRST_SEC, WAIT_GAP_SEC, WAIT_QUIET_SEC, dueWaitLine, waitContext } from '../coachWaitLines';
import { messageText } from '../coachNarration';
import type { SpecialistStage } from '../specialist-stage';

const noPlan: SpecialistStage = { planReady: false, rows: [], settled: 0, total: 0, complete: false };
const running: SpecialistStage = { planReady: true, rows: [], settled: 0, total: 2, complete: false };
const done: SpecialistStage = { planReady: true, rows: [], settled: 2, total: 2, complete: true };

describe('waitContext', () => {
  it('tracks what the user is waiting on', () => {
    expect(waitContext({ status: 'queued', runningPhase: null, stage: noPlan })).toBe('queue');
    expect(waitContext({ status: 'analyzing', runningPhase: 1, stage: noPlan })).toBe('phase:1');
    expect(waitContext({ status: 'complete', runningPhase: null, stage: noPlan })).toBe('triage');
    expect(waitContext({ status: 'complete', runningPhase: null, stage: running })).toBe('specialists');
    expect(waitContext({ status: 'complete', runningPhase: null, stage: done })).toBeNull();
  });
});

describe('dueWaitLine', () => {
  it('fires only after the first delay AND a quiet spell, tied to the running phase', () => {
    expect(dueWaitLine('phase:1', WAIT_FIRST_SEC - 1, 60, 0)).toBeNull();
    expect(dueWaitLine('phase:1', WAIT_FIRST_SEC, WAIT_QUIET_SEC - 1, 0)).toBeNull();
    const m = dueWaitLine('phase:1', WAIT_FIRST_SEC, WAIT_QUIET_SEC, 0)!;
    expect(m).toMatchObject({ id: 'wait:phase:1:0', speaker: { kind: 'coach' } });
    expect(messageText(m)).toMatch(/Still measuring/);
  });

  it('spaces later lines out and stops when the context runs out of lines', () => {
    expect(dueWaitLine('phase:1', WAIT_FIRST_SEC + WAIT_GAP_SEC - 1, 60, 1)).toBeNull();
    expect(dueWaitLine('phase:1', WAIT_FIRST_SEC + WAIT_GAP_SEC, 60, 1)!.id).toBe('wait:phase:1:1');
    expect(dueWaitLine('phase:1', 999, 60, 3)).toBeNull(); // phase 1 has three
    expect(dueWaitLine('phase:2', 999, 60, 1)).toBeNull(); // phase 2 has one
    expect(dueWaitLine('nope', 999, 60, 0)).toBeNull();
  });
});
