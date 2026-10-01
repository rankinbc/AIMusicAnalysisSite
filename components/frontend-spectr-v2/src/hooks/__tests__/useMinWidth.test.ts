// @vitest-environment jsdom
// Task P8 — `useMinWidth(px)`: true when the viewport is at least `px` wide,
// and true when matchMedia is unavailable (keeps today's behaviour).
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMinWidth } from '../useMinWidth';

afterEach(() => vi.unstubAllGlobals());

describe('useMinWidth', () => {
  it('reads the min-width query and follows its changes', () => {
    let listener: ((e: { matches: boolean }) => void) | null = null;
    const seen: string[] = [];
    vi.stubGlobal('matchMedia', (q: string) => {
      seen.push(q);
      return {
        matches: false, media: q,
        addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { listener = fn; },
        removeEventListener: () => {},
      };
    });
    const { result } = renderHook(() => useMinWidth(1024));
    expect(seen).toContain('(min-width: 1024px)');
    expect(result.current).toBe(false);
    act(() => listener?.({ matches: true }));
    expect(result.current).toBe(true);
  });

  it('is true when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMinWidth(1024));
    expect(result.current).toBe(true);
  });
});
