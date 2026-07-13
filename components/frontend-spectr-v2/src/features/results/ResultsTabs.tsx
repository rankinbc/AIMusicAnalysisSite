import type { ResultsTabKey } from './results-tab-keys';
import { buildResultsTabs } from './results-tabs-model';

export type { ResultsTabKey } from './results-tab-keys';

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
  const tabs = buildResultsTabs(
    { findingCount, hasProject, projectTrackCount, hasReference },
    import.meta.env.DEV,
  );

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
