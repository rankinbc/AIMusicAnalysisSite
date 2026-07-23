// Shared terminal-state semantics for TanStack Query refetchInterval callbacks
// (audit wave 1 — E1.1/E3.1/E5.1/E5.6/E5.11). `retry: false` does NOT stop
// interval refetches: refetchInterval fires regardless of error state unless
// the callback returns false. Every changed poll site routes through this
// helper so no frontend poll can run forever on error/404/undefined status.

import { ApiError } from './fetcher';

interface TerminalPollOptions<TData> {
  /** Poll cadence in ms; a function may vary it by the latest data. */
  pollMs: number | ((data: TData | undefined) => number);
  /** Return true while the data says "keep polling". */
  active: (data: TData) => boolean;
  /** Total fetch cap (data + error updates). Unset = no cap. */
  maxPolls?: number;
  /** Total error cap — TOTAL, not consecutive (simpler and strictly safer).
   *  An error-then-recovery sequence still counts toward this. Default 3. */
  maxErrors?: number;
}

interface PollQueryState<TData> {
  state: {
    // `| undefined` is explicit for exactOptionalPropertyTypes — TanStack's
    // query.state.data is `TData | undefined`, not merely absent.
    data?: TData | undefined;
    error: unknown;
    dataUpdateCount: number;
    errorUpdateCount: number;
  };
}

export function terminalPoll<TData>(
  opts: TerminalPollOptions<TData>,
): (query: PollQueryState<TData>) => number | false {
  const maxErrors = opts.maxErrors ?? 3;
  return (query) => {
    const { data, error, dataUpdateCount, errorUpdateCount } = query.state;
    // A 404'd resource is gone — no amount of polling brings it back.
    if (error instanceof ApiError && error.status === 404) return false;
    if (errorUpdateCount >= maxErrors) return false;
    if (opts.maxPolls !== undefined && dataUpdateCount + errorUpdateCount >= opts.maxPolls)
      return false;
    if (data !== undefined && !opts.active(data)) return false;
    return typeof opts.pollMs === 'function' ? opts.pollMs(data) : opts.pollMs;
  };
}
