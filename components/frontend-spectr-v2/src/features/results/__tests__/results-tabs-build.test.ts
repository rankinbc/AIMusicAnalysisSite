// Story 12.5 (AC6, review H1/F2): the Debug tab must be absent from PROD tab
// assembly. buildResultsTabs is the pure list-builder — testable with isDev
// injected, no import.meta stubbing.
//
// v4: left group = trackinfo · project (disabled w/o .als) · stems (disabled
// w/o stems) · reference (hidden w/o data) · notes · debug(dev); right-aligned
// hot group = coach ("Findings") · actions · dawplan.
import { describe, expect, it } from 'vitest';
import { buildResultsTabs } from '../results-tabs-model';

const base = {
  findingCount: 0,
  hasProject: false,
  projectTrackCount: 0,
  hasReference: false,
  hasStems: false,
  commentCount: 0,
  actionableCount: 0,
  planLogCount: 0,
};

describe('buildResultsTabs', () => {
  it('excludes the Debug tab when not a dev build', () => {
    const ids = buildResultsTabs(base, false).map((t) => t.id);
    expect(ids).toEqual(['trackinfo', 'project', 'stems', 'notes', 'coach', 'actions', 'dawplan']);
  });

  it('includes the Debug tab in dev builds (last of the left group)', () => {
    const tabs = buildResultsTabs(base, true);
    const ids = tabs.map((t) => t.id);
    expect(ids).toContain('debug');
    // Debug sits before the hot group, which is always the trailing trio.
    expect(ids.slice(-4)).toEqual(['debug', 'coach', 'actions', 'dawplan']);
  });

  it('renders Project/Stems disabled-with-tooltip when their inputs are absent', () => {
    const tabs = buildResultsTabs(base, false);
    const project = tabs.find((t) => t.id === 'project')!;
    const stems = tabs.find((t) => t.id === 'stems')!;
    expect(project.disabled).toBe(true);
    expect(project.tooltip).toMatch(/\.als/);
    expect(stems.disabled).toBe(true);
    expect(stems.tooltip).toMatch(/stems/i);
  });

  it('enables Project/Stems and shows Reference when data exists', () => {
    const tabs = buildResultsTabs(
      { ...base, hasProject: true, projectTrackCount: 3, hasReference: true, hasStems: true },
      false,
    );
    expect(tabs.find((t) => t.id === 'project')?.disabled).toBeUndefined();
    expect(tabs.find((t) => t.id === 'project')?.badge).toBe(3);
    expect(tabs.find((t) => t.id === 'stems')?.disabled).toBeUndefined();
    expect(tabs.map((t) => t.id)).toContain('reference');
  });

  it('marks the hot trio and badges Findings/Actions/Plan counts', () => {
    const tabs = buildResultsTabs(
      { ...base, findingCount: 4, actionableCount: 2, planLogCount: 5, commentCount: 7 },
      false,
    );
    const hot = tabs.filter((t) => t.hot).map((t) => t.id);
    expect(hot).toEqual(['coach', 'actions', 'dawplan']);
    expect(tabs.find((t) => t.id === 'coach')?.badge).toBe(4);
    expect(tabs.find((t) => t.id === 'coach')?.alert).toBe(true);
    expect(tabs.find((t) => t.id === 'actions')?.badge).toBe(2);
    expect(tabs.find((t) => t.id === 'dawplan')?.badge).toBe(5);
    expect(tabs.find((t) => t.id === 'notes')?.badge).toBe(7);
  });
});
