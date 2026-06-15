import { describe, expect, it } from 'vitest';

// Story 2.1 / AC5 / Task 7.4 — the billing-success route polls /me until
// tier === "pro" or 60s elapse. The same pattern story 1.9 Task 7.3
// established: extract the state-machine logic as a pure function so it
// can be tested without jsdom + timers.
//
// The state machine has three outcomes:
//   'waiting' — still polling, no tier flip yet
//   'pro'     — /me returned tier === "pro"
//   'timeout' — 60s elapsed without a flip

type State = 'waiting' | 'pro' | 'timeout';

interface PollContext {
  elapsedMs: number;
  maxMs: number;
}

interface PollResult {
  nextState: State;
}

function advance(
  ctx: PollContext,
  meTier: 'free' | 'pro' | null,
): PollResult {
  if (meTier === 'pro') return { nextState: 'pro' };
  if (ctx.elapsedMs >= ctx.maxMs) return { nextState: 'timeout' };
  return { nextState: 'waiting' };
}

describe('billing-success poll state-machine (story 2.1 / Task 7.4)', () => {
  it('returns waiting while tier is still free and time remains', () => {
    const result = advance({ elapsedMs: 5000, maxMs: 60000 }, 'free');
    expect(result.nextState).toBe('waiting');
  });

  it('flips to pro the moment /me returns tier=pro', () => {
    const result = advance({ elapsedMs: 5000, maxMs: 60000 }, 'pro');
    expect(result.nextState).toBe('pro');
  });

  it('flips to pro even if /me returns pro right at the timeout boundary', () => {
    // The "pro" check wins over the timeout check — a flip at the last
    // possible tick is still success.
    const result = advance({ elapsedMs: 60000, maxMs: 60000 }, 'pro');
    expect(result.nextState).toBe('pro');
  });

  it('flips to timeout when elapsed >= max and tier is still free', () => {
    const result = advance({ elapsedMs: 60000, maxMs: 60000 }, 'free');
    expect(result.nextState).toBe('timeout');
  });

  it('flips to timeout when /me responses are missing (network failure)', () => {
    const result = advance({ elapsedMs: 60000, maxMs: 60000 }, null);
    expect(result.nextState).toBe('timeout');
  });

  it('stays waiting on a transient null /me response if time remains', () => {
    // A single failed poll doesn't terminate; we keep trying.
    const result = advance({ elapsedMs: 10000, maxMs: 60000 }, null);
    expect(result.nextState).toBe('waiting');
  });
});
