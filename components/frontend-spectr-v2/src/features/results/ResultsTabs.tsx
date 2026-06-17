import s from './ResultsTabs.module.css';

export type ResultsTabKey = 'actions' | 'analysis' | 'files';

interface TabDef {
  id: ResultsTabKey;
  label: string;
  icon: string;
  badge?: string | number | null;
  featured?: boolean;
}

interface ResultsTabsProps {
  current: ResultsTabKey;
  onChange: (id: ResultsTabKey) => void;
  /** Number of moves in the plan — small badge on the Actions tab. */
  moveCount: number;
  /** Worker phases done / total — small badge on the Analysis tab. */
  phasesDone: number;
  phasesTotal: number;
  /** Right-side shortcut: jump to the plan + open the export preview. */
  onGamePlan: () => void;
}

export function ResultsTabs({
  current,
  onChange,
  moveCount,
  phasesDone,
  phasesTotal,
  onGamePlan,
}: ResultsTabsProps) {
  const tabs: TabDef[] = [
    { id: 'actions', label: 'Actions', icon: '◎', badge: moveCount > 0 ? moveCount : null, featured: true },
    {
      id: 'analysis',
      label: 'Analysis',
      icon: '▤',
      badge: phasesTotal > 0 ? `${phasesDone}/${phasesTotal}` : null,
    },
    { id: 'files', label: 'Files', icon: '▥' },
  ];

  return (
    <div className={s.strip} role="tablist">
      <div className={s.tabs}>
        {tabs.map((t) => {
          const active = current === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={s.tab}
              data-active={active}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.id)}
            >
              {t.featured && <span className={s.featuredDot} />}
              <span className={s.icon} aria-hidden>
                {t.icon}
              </span>
              <span>{t.label}</span>
              {t.badge != null && (
                <span className={s.badge} data-active={active}>
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button type="button" className={s.gamePlan} onClick={onGamePlan}>
        ⇣ Game Plan
      </button>
    </div>
  );
}
