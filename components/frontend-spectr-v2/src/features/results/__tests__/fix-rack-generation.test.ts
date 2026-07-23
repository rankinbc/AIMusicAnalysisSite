// @vitest-environment jsdom
/* UI-cleanup sweep — the Fix Rack generation lifecycle. Pins the failure paths
 * the old boolean flag lacked: a failed POST lands in 'error' (with a toast),
 * a worker that never persists a preset lands in 'timeout' after the poll
 * window, and generate() from either state retries with a fresh query reset. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateMock, resetQueriesMock, toastErrorMock, queryState } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  resetQueriesMock: vi.fn(),
  toastErrorMock: vi.fn(),
  queryState: { fixRackData: undefined as unknown },
}));

vi.mock('../../../api/hooks', () => ({
  useGenerateFixRack: () => ({ mutate: mutateMock, isPending: false }),
  useFixRack: () => ({ data: queryState.fixRackData }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ resetQueries: resetQueriesMock }),
}));
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }));

import { FIX_RACK_POLL_WINDOW_MS, useFixRackGeneration } from '../useFixRackGeneration';

type MutateOptions = { onError: (err: Error) => void };

describe('useFixRackGeneration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryState.fixRackData = undefined;
    mutateMock.mockReset();
    resetQueriesMock.mockReset();
    toastErrorMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle with no rack', () => {
    const { result } = renderHook(() => useFixRackGeneration('job-1'));
    expect(result.current.phase).toBe('idle');
    expect(result.current.rack).toBeNull();
  });

  it('generate() resets the query, POSTs, and enters generating', () => {
    const { result } = renderHook(() => useFixRackGeneration('job-1'));
    act(() => result.current.generate());
    expect(resetQueriesMock).toHaveBeenCalledWith({ queryKey: ['fix-rack', 'job-1'] });
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('generating');
  });

  it('a failed POST lands in error and toasts the message', () => {
    const { result } = renderHook(() => useFixRackGeneration('job-1'));
    act(() => result.current.generate());
    const opts = mutateMock.mock.calls[0][1] as MutateOptions;
    act(() => opts.onError(new Error('entitlements_unavailable')));
    expect(result.current.phase).toBe('error');
    expect(toastErrorMock).toHaveBeenCalledWith('entitlements_unavailable');
  });

  it('flips to timeout when no rack lands inside the poll window', () => {
    const { result } = renderHook(() => useFixRackGeneration('job-1'));
    act(() => result.current.generate());
    act(() => vi.advanceTimersByTime(FIX_RACK_POLL_WINDOW_MS + 1));
    expect(result.current.phase).toBe('timeout');
  });

  it('a rack arriving disarms the timeout (rack wins over phase)', () => {
    const { result, rerender } = renderHook(() => useFixRackGeneration('job-1'));
    act(() => result.current.generate());
    queryState.fixRackData = { name: 'rack' };
    rerender();
    act(() => vi.advanceTimersByTime(FIX_RACK_POLL_WINDOW_MS + 1));
    expect(result.current.phase).toBe('generating');
    expect(result.current.rack).toEqual({ name: 'rack' });
  });

  it('generate() from timeout retries: fresh reset, fresh POST, generating again', () => {
    const { result } = renderHook(() => useFixRackGeneration('job-1'));
    act(() => result.current.generate());
    act(() => vi.advanceTimersByTime(FIX_RACK_POLL_WINDOW_MS + 1));
    expect(result.current.phase).toBe('timeout');
    act(() => result.current.generate());
    expect(result.current.phase).toBe('generating');
    expect(resetQueriesMock).toHaveBeenCalledTimes(2);
    expect(mutateMock).toHaveBeenCalledTimes(2);
  });
});
