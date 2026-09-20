/* Spec D6: the stage remembers what it was showing, per viewer — and the page
 * must work when it cannot remember anything at all. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultStagePrefs, readStagePrefs, STAGE_PREFS_KEY, writeStagePrefs,
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
