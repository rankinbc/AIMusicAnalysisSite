import { describe, expect, it } from 'vitest';

import { ApiError } from '../fetcher';
import { terminalPoll } from '../poll-helpers';

interface Data {
  status: string;
}

function query(over: {
  data?: Data;
  error?: unknown;
  dataUpdateCount?: number;
  errorUpdateCount?: number;
}) {
  return {
    state: {
      data: over.data,
      error: over.error ?? null,
      dataUpdateCount: over.dataUpdateCount ?? 0,
      errorUpdateCount: over.errorUpdateCount ?? 0,
    },
  };
}

const activeWhilePending = (d: Data) => d.status === 'pending';

describe('terminalPoll', () => {
  it('polls at pollMs while data says active', () => {
    const cb = terminalPoll<Data>({ pollMs: 2000, active: activeWhilePending });
    expect(cb(query({ data: { status: 'pending' }, dataUpdateCount: 1 }))).toBe(2000);
  });

  it('polls at pollMs before any data arrives', () => {
    const cb = terminalPoll<Data>({ pollMs: 1500, active: activeWhilePending });
    expect(cb(query({}))).toBe(1500);
  });

  it('stops when data goes terminal', () => {
    const cb = terminalPoll<Data>({ pollMs: 2000, active: activeWhilePending });
    expect(cb(query({ data: { status: 'complete' }, dataUpdateCount: 3 }))).toBe(false);
  });

  it('stops immediately on a 404 ApiError regardless of counts', () => {
    const cb = terminalPoll<Data>({ pollMs: 2000, active: activeWhilePending });
    expect(cb(query({ error: new ApiError(404, undefined), errorUpdateCount: 1 }))).toBe(false);
  });

  it('keeps polling through non-404 errors until maxErrors (default 3)', () => {
    const cb = terminalPoll<Data>({ pollMs: 2000, active: activeWhilePending });
    expect(cb(query({ error: new ApiError(500, undefined), errorUpdateCount: 1 }))).toBe(2000);
    expect(cb(query({ error: new ApiError(500, undefined), errorUpdateCount: 2 }))).toBe(2000);
    expect(cb(query({ error: new ApiError(500, undefined), errorUpdateCount: 3 }))).toBe(false);
  });

  it('counts errors as TOTAL, not consecutive — recovery does not reset the cap', () => {
    const cb = terminalPoll<Data>({ pollMs: 1000, active: activeWhilePending, maxErrors: 2 });
    // error, recover (error stays counted), error again → dead at 2 total.
    expect(cb(query({ error: new Error('boom'), errorUpdateCount: 1 }))).toBe(1000);
    expect(
      cb(query({ data: { status: 'pending' }, dataUpdateCount: 1, errorUpdateCount: 1 })),
    ).toBe(1000);
    expect(
      cb(query({ data: { status: 'pending' }, dataUpdateCount: 1, errorUpdateCount: 2 })),
    ).toBe(false);
  });

  it('stops at maxPolls counting data AND error updates', () => {
    const cb = terminalPoll<Data>({ pollMs: 1000, active: activeWhilePending, maxPolls: 5 });
    expect(
      cb(query({ data: { status: 'pending' }, dataUpdateCount: 3, errorUpdateCount: 1 })),
    ).toBe(1000);
    expect(
      cb(query({ data: { status: 'pending' }, dataUpdateCount: 4, errorUpdateCount: 1 })),
    ).toBe(false);
  });

  it('does not cap total polls when maxPolls is unset', () => {
    const cb = terminalPoll<Data>({ pollMs: 1000, active: activeWhilePending });
    expect(cb(query({ data: { status: 'pending' }, dataUpdateCount: 9999 }))).toBe(1000);
  });

  it('resolves a function pollMs against the latest data', () => {
    const cb = terminalPoll<Data>({
      pollMs: (d) => (d ? 5000 : 1000),
      active: activeWhilePending,
    });
    expect(cb(query({}))).toBe(1000);
    expect(cb(query({ data: { status: 'pending' }, dataUpdateCount: 1 }))).toBe(5000);
  });

  it('a plain non-ApiError error does not trigger the 404 fast-stop', () => {
    const cb = terminalPoll<Data>({ pollMs: 2000, active: activeWhilePending });
    expect(cb(query({ error: new Error('404'), errorUpdateCount: 1 }))).toBe(2000);
  });
});
