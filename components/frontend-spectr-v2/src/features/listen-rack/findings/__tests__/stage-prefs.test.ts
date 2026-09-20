/* Spec D6: the stage remembers what it was showing, per viewer — and the page
 * must work when it cannot remember anything at all. */
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultStagePrefs, readStagePrefs, STAGE_PREFS_KEY, useStagePrefs, writeStagePrefs,
} from '../stage-prefs';

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

describe('stage prefs', () => {
  beforeEach(() => {
    localStorage.clear();
    mockReducedMotion(false);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('first visit = findings in the box, visuals behind the page', () => {
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
  });

  it('first visit under prefers-reduced-motion leaves the background still', () => {
    mockReducedMotion(true);
    expect(defaultStagePrefs()).toEqual({ content: 'findings', bgViz: false });
  });

  it('an explicit choice beats the reduced-motion default', () => {
    mockReducedMotion(true);
    writeStagePrefs({ content: 'visualizer', bgViz: true });
    expect(readStagePrefs()).toEqual({ content: 'visualizer', bgViz: true });
  });

  it('round-trips a stored choice', () => {
    writeStagePrefs({ content: 'visualizer', bgViz: false });
    expect(readStagePrefs()).toEqual({ content: 'visualizer', bgViz: false });
  });

  it('falls back on garbage, on a wrong-shaped payload, and on a wrong content value', () => {
    localStorage.setItem(STAGE_PREFS_KEY, 'not json');
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
    localStorage.setItem(STAGE_PREFS_KEY, '"a string"');
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
    localStorage.setItem(STAGE_PREFS_KEY, JSON.stringify({ content: 'moon', bgViz: 'yes' }));
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
  });

  it('survives storage that throws on read and on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
    expect(() => writeStagePrefs({ content: 'visualizer', bgViz: false })).not.toThrow();
  });
});

describe('useStagePrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    mockReducedMotion(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('setters update state AND persist, so the next visit reads them back', () => {
    const { result } = renderHook(() => useStagePrefs());
    expect(result.current.content).toBe('findings');
    act(() => result.current.setContent('visualizer'));
    expect(result.current.content).toBe('visualizer');
    expect(readStagePrefs().content).toBe('visualizer');
    act(() => result.current.setBgViz(false));
    expect(result.current.bgViz).toBe(false);
    expect(readStagePrefs()).toEqual({ content: 'visualizer', bgViz: false });
  });

  it('two updates in the same tick compose instead of clobbering each other', () => {
    const { result } = renderHook(() => useStagePrefs());
    act(() => {
      result.current.setContent('visualizer');
      result.current.setBgViz(false);
    });
    expect(readStagePrefs()).toEqual({ content: 'visualizer', bgViz: false });
    expect(result.current.content).toBe('visualizer');
    expect(result.current.bgViz).toBe(false);
  });

  it('setters keep their identity across renders (safe in effect deps)', () => {
    const { result, rerender } = renderHook(() => useStagePrefs());
    const { setContent, setBgViz } = result.current;
    act(() => result.current.setBgViz(false));
    rerender();
    expect(result.current.setContent).toBe(setContent);
    expect(result.current.setBgViz).toBe(setBgViz);
  });

  it('writes storage once per change under StrictMode (no side effect in a state updater)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useStagePrefs(), { wrapper: StrictMode });
    spy.mockClear();
    act(() => result.current.setContent('visualizer'));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('still works when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useStagePrefs());
    act(() => result.current.setContent('visualizer'));
    expect(result.current.content).toBe('visualizer');
    spy.mockRestore();
  });
});
