// Story 12.5: pure tab-list assembly, separated from the component file so
// (a) the DEV-false shape is unit-testable and (b) react-refresh stays happy.
import type { ResultsTabKey } from './results-tab-keys';
import type { IconName } from './Icon';

export interface TabDef {
  id: ResultsTabKey;
  label: string;
  icon: IconName;
  badge?: string | number | null;
  /** A fault-bearing badge — tints the count orange (something needs attention). */
  alert?: boolean;
  /** v4: rendered but non-clickable, with a tooltip explaining how to unlock. */
  disabled?: boolean;
  tooltip?: string;
  /** v4: right-aligned "hot" group (Findings · Actions · Improvement Plan). */
  hot?: boolean;
}

export interface BuildTabsOpts {
  findingCount: number;
  hasProject: boolean;
  projectTrackCount: number;
  hasReference: boolean;
  /** v4 tabs. */
  hasStems: boolean;
  noteCount: number;
  actionableCount: number;
  planLogCount: number;
}

/** Pure tab-list assembly — exported so the DEV-false shape (Debug hidden in
 *  prod builds, story 12.5) is unit-testable without stubbing import.meta.
 *
 *  v4 layout: left group = Track Analysis · Project (disabled w/ tooltip when
 *  no .als) · Stems (disabled when no stems) · Reference (hidden when absent) ·
 *  Notes · Debug (dev). Right-aligned hot group = Findings (id `coach`,
 *  back-compat) · Actions · Improvement Plan (id `dawplan`). */
export function buildResultsTabs(opts: BuildTabsOpts, isDev: boolean): TabDef[] {
  const {
    findingCount,
    hasProject,
    projectTrackCount,
    hasReference,
    hasStems,
    noteCount,
    actionableCount,
    planLogCount,
  } = opts;
  return [
    { id: 'trackinfo', label: 'Track Analysis', icon: 'chart' },
    {
      id: 'project',
      label: 'Project',
      icon: 'folder',
      badge: hasProject && projectTrackCount > 0 ? projectTrackCount : null,
      ...(hasProject
        ? {}
        : { disabled: true, tooltip: 'Upload the .als project to unlock' }),
    },
    {
      id: 'stems',
      label: 'Stems',
      icon: 'layers',
      ...(hasStems
        ? {}
        : { disabled: true, tooltip: 'Upload stems to unlock per-stem analysis' }),
    },
    ...(hasReference
      ? [{ id: 'reference' as const, label: 'Reference', icon: 'diamond' as const }]
      : []),
    {
      id: 'notes',
      label: 'Notes',
      icon: 'message',
      badge: noteCount > 0 ? noteCount : null,
    },
    // Story 12.5: raw pipeline I/O is a developer surface — dev builds only.
    ...(isDev ? [{ id: 'debug' as const, label: 'Debug', icon: 'sliders' as const }] : []),
    // ── Right-aligned hot group ──
    {
      id: 'coach',
      label: 'Findings',
      icon: 'flag',
      badge: findingCount > 0 ? findingCount : null,
      alert: findingCount > 0,
      hot: true,
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: 'bolt',
      badge: actionableCount > 0 ? actionableCount : null,
      hot: true,
    },
    {
      id: 'dawplan',
      label: 'Improvement Plan',
      icon: 'target',
      badge: planLogCount > 0 ? planLogCount : null,
      hot: true,
    },
  ];
}
