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
}


/** Pure tab-list assembly — exported so the DEV-false shape (Debug hidden in
 *  prod builds, story 12.5) is unit-testable without stubbing import.meta.
 *
 *  v3 redesign: the Coach chat is a permanent hero-row surface (not a tab), so
 *  the first tab — id `coach` — is LABELED "Findings" and renders the findings
 *  master-detail board. There is no longer a standalone `findings` tab. */
export function buildResultsTabs(
  opts: { findingCount: number; hasProject: boolean; projectTrackCount: number; hasReference: boolean },
  isDev: boolean,
): TabDef[] {
  const { findingCount, hasProject, projectTrackCount, hasReference } = opts;
  return [
    {
      id: 'coach',
      label: 'Findings',
      icon: 'message',
      badge: findingCount > 0 ? findingCount : null,
      alert: findingCount > 0,
    },
    { id: 'trackinfo', label: 'Track Analysis', icon: 'chart' },
    ...(hasProject
      ? [
          {
            id: 'project' as const,
            label: 'Project',
            icon: 'folder' as const,
            badge: projectTrackCount > 0 ? projectTrackCount : null,
          },
        ]
      : []),
    ...(hasReference ? [{ id: 'reference' as const, label: 'Reference', icon: 'diamond' as const }] : []),
    // Story 12.5: raw pipeline I/O is a developer surface — dev builds only.
    ...(isDev ? [{ id: 'debug' as const, label: 'Debug', icon: 'sliders' as const }] : []),
  ];
}

