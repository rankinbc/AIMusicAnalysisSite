// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMinWidth } from '../useMinWidth';

// Task P8 — phone fixes. `src/hooks/**` is NOT globbed to jsdom (only
// listen-rack/** and song/** are — see vitest.config.ts), so this file needs
// its own jsdom docblock. Mirrors the useReducedMotion precedent but adds
// the render-time behaviour useReducedMotion's own test skips (that one
// only checks the SSR-safe node-env fallback).

describe('useMinWidth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when matchMedia is unavailable (fallback = "always desktop")', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMinWidth(1024));
    expect(result.current).toBe(true);
  });

  it('follows the media query result for the given breakpoint', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1024px)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const wide = renderHook(() => useMinWidth(1024));
    expect(wide.result.current).toBe(true);
    const narrow = renderHook(() => useMinWidth(1440));
    expect(narrow.result.current).toBe(false);
  });

  it('unsubscribes its change listener on unmount', () => {
    const removeEventListener = vi.fn();
    const addEventListener = vi.fn();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener,
      removeEventListener,
    }));
    const { unmount } = renderHook(() => useMinWidth(1024));
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeEventListener).not.toHaveBeenCalled();
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
