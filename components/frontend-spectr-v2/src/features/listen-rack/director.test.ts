/* Task V1 — Minimal is the default visuals program. `applyDirectorToViz` is
 * the ONE place a director's `apply` flags get merged onto a viz state; both
 * the Visuals panel's click handler (ListenRackPage.chooseDirector) and the
 * page's initial state go through it, so they can't drift. */
import { describe, expect, it } from 'vitest';

import { DEFAULT_VIZ, DIRECTORS } from './data';
import { applyDirectorToViz, DEFAULT_DIRECTOR_ID, initialDirectorState } from './director';

const MINIMAL = DIRECTORS.find((d) => d.id === 'minimal')!;
const PULSE = DIRECTORS.find((d) => d.id === 'pulse')!; // behaviorOnly: true
const MANUAL = DIRECTORS.find((d) => d.id === 'off')!; // no `apply`

describe('applyDirectorToViz', () => {
  it('merges a program\'s apply flags onto the base viz', () => {
    expect(applyDirectorToViz(DEFAULT_VIZ, MINIMAL)).toEqual({
      ...DEFAULT_VIZ,
      laserOn: false,
      laserFlash: false,
      laserMove: false,
      autoColor: false,
      bgAuto: false,
      bgFlash: false,
      dropFx: false,
    });
  });

  it('never mutates the base viz object it was given', () => {
    const base = { ...DEFAULT_VIZ };
    applyDirectorToViz(base, MINIMAL);
    expect(base).toEqual(DEFAULT_VIZ);
  });

  it('a behaviorOnly program (Pulse) leaves viz untouched — same reference back', () => {
    const base = DEFAULT_VIZ;
    expect(applyDirectorToViz(base, PULSE)).toBe(base);
  });

  it('Manual (no apply) leaves viz untouched — same reference back', () => {
    const base = DEFAULT_VIZ;
    expect(applyDirectorToViz(base, MANUAL)).toBe(base);
  });

  it('an undefined director leaves viz untouched — same reference back', () => {
    const base = DEFAULT_VIZ;
    expect(applyDirectorToViz(base, undefined)).toBe(base);
  });
});

describe('initialDirectorState — the page\'s first-paint state', () => {
  it('selects minimal as the default program', () => {
    expect(DEFAULT_DIRECTOR_ID).toBe('minimal');
    expect(initialDirectorState().director).toBe('minimal');
  });

  it('is exactly base viz + Minimal applied — the SAME transform the click path uses', () => {
    expect(initialDirectorState().viz).toEqual(applyDirectorToViz(DEFAULT_VIZ, MINIMAL));
  });

  it('lasers are off and nothing auto-cycles, matching the calmest program', () => {
    const { viz } = initialDirectorState();
    expect(viz.laserOn).toBe(false);
    expect(viz.autoColor).toBe(false);
    expect(viz.bgAuto).toBe(false);
    expect(viz.dropFx).toBe(false);
  });

  it('does not mutate DEFAULT_VIZ as a side effect', () => {
    const before = { ...DEFAULT_VIZ };
    initialDirectorState();
    expect(DEFAULT_VIZ).toEqual(before);
  });
});
