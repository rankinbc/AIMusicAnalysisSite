import { toast } from 'sonner';

import s from './ResultsTabs.module.css';

export type ResultsTabKey = 'coach' | 'analysis' | 'spectrum' | 'reference' | 'arrangement';

interface TabDef {
  id: ResultsTabKey;
  label: string;
  badge?: string | number | null;
  badgeTone?: 'cyan' | 'violet' | 'orange';
  featured?: boolean;
}

interface ResultsTabsProps {
  current: ResultsTabKey;
  onChange: (id: ResultsTabKey) => void;
  coachCount: number;
  phasesDone: number;
  phasesTotal: number;
  referenceOutOfRange: number;
  arrangementFlag: boolean;
}

export function ResultsTabs({
  current,
  onChange,
  coachCount,
  phasesDone,
  phasesTotal,
  referenceOutOfRange,
  arrangementFlag,
}: ResultsTabsProps) {
  const tabs: TabDef[] = [
    {
      id: 'coach',
      label: 'AI Coach',
      badge: coachCount > 0 ? coachCount : null,
      badgeTone: 'cyan',
      featured: true,
    },
    {
      id: 'analysis',
      label: 'Analysis',
      badge: phasesTotal > 0 ? `${phasesDone}/${phasesTotal}` : null,
      badgeTone: 'violet',
    },
    { id: 'spectrum', label: 'Mix' },
    {
      id: 'reference',
      label: 'Reference',
      badge: referenceOutOfRange > 0 ? referenceOutOfRange : null,
      badgeTone: 'orange',
    },
    {
      id: 'arrangement',
      label: 'Arrangement',
      badge: arrangementFlag ? '!' : null,
      badgeTone: 'orange',
    },
  ];

  return (
    <div className={s.strip} role="tablist">
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
            <span>{t.label}</span>
            {t.badge != null && (
              <span
                className={s.badge}
                data-tone={t.badgeTone ?? 'cyan'}
                data-active={active}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
      <div className={s.actions}>
        <button
          type="button"
          className="btn sm"
          onClick={() => toast.info('PDF export not wired yet')}
        >
          ⇣ Export PDF
        </button>
        <button
          type="button"
          className="btn sm primary"
          onClick={() => toast.info('Re-analyze not wired yet')}
        >
          ↺ Re-analyze
        </button>
      </div>
    </div>
  );
}
