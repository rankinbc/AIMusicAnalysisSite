// Story 12.5 (AC6, review H1/F2): the Debug tab must be absent from PROD tab
// assembly. buildResultsTabs is the pure list-builder — testable with isDev
// injected, no import.meta stubbing.
import { describe, expect, it } from 'vitest';
import { buildResultsTabs } from '../results-tabs-model';

const base = { findingCount: 0, hasProject: false, projectTrackCount: 0, hasReference: false };

describe('buildResultsTabs', () => {
  it('excludes the Debug tab when not a dev build', () => {
    const ids = buildResultsTabs(base, false).map((t) => t.id);
    // v3: the Coach-labeled "Findings" board (id `coach`) is the first tab; the
    // standalone `findings` tab was dissolved into it.
    expect(ids).toEqual(['coach', 'trackinfo']);
  });

  it('includes the Debug tab in dev builds', () => {
    const ids = buildResultsTabs(base, true).map((t) => t.id);
    expect(ids).toContain('debug');
    expect(ids.at(-1)).toBe('debug');
  });

  it('conditions Project/Reference on their data', () => {
    const ids = buildResultsTabs(
      { ...base, hasProject: true, projectTrackCount: 3, hasReference: true }, false,
    ).map((t) => t.id);
    expect(ids).toEqual(['coach', 'trackinfo', 'project', 'reference']);
  });
});
