import type { ResultsTabKey } from './results-tab-keys';

export type { ResultsTabKey } from './results-tab-keys';

interface TabDef {
  id: ResultsTabKey;
  label: string;
  icon: string;
  badge?: string | number | null;
  /** A fault-bearing badge — tints the count orange (something needs attention). */
  alert?: boolean;
}

interface ResultsTabsProps {
  current: ResultsTabKey;
  onChange: (id: ResultsTabKey) => void;
  /** Number of findings (faults) — badge on the Findings tab; tinted when > 0. */
  findingCount: number;
  /** Show the Project tab — only when an .als project map was stored. */
  hasProject: boolean;
  /** Track count for the Project tab badge. */
  projectTrackCount: number;
  /** Show the Reference tab — only when a reference profile or track was attached. */
  hasReference: boolean;
}

// Glyphs stand in for the prototype's inline SVG icons; styling comes from the
// scoped `.rtab` rules in redesign.css.
export function ResultsTabs({
  current,
  onChange,
  findingCount,
  hasProject,
  projectTrackCount,
  hasReference,
}: ResultsTabsProps) {
  const tabs: TabDef[] = [
    { id: 'coach', label: 'AI Coach', icon: '✦' },
    {
      id: 'findings',
      label: 'Findings',
      icon: '⚑',
      badge: findingCount > 0 ? findingCount : null,
      alert: findingCount > 0,
    },
    ...(hasProject
      ? [
          {
            id: 'project' as const,
            label: 'Project',
            icon: '▤',
            badge: projectTrackCount > 0 ? projectTrackCount : null,
          },
        ]
      : []),
    ...(hasReference ? [{ id: 'reference' as const, label: 'Reference', icon: '◎' }] : []),
    { id: 'trackinfo', label: 'Track Info', icon: '▦' },
    // Story 12.5: raw pipeline I/O is a developer surface — dev builds only.
    ...(import.meta.env.DEV ? [{ id: 'debug' as const, label: 'Debug', icon: '⟂' }] : []),
  ];

  return (
    <div className="rtabs" role="tablist">
      {tabs.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            className={`rtab${active ? ' active' : ''}${t.alert ? ' alert' : ''}`}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
          >
            <span className="ic" aria-hidden>
              {t.icon}
            </span>
            <span>{t.label}</span>
            {t.badge != null && <span className="rtab-badge">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
