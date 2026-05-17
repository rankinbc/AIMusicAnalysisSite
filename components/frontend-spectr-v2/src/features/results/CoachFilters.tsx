import { useMemo } from 'react';

import type { VerdictDto } from '../../api/types';
import { groupColor, specialistGroup, type SpecialistGroup } from './helpers/specialists';
import s from './CoachFilters.module.css';

export type CoachFilterKey = 'all' | SpecialistGroup;

interface CoachFiltersProps {
  verdicts: VerdictDto[];
  active: CoachFilterKey;
  onActive: (key: CoachFilterKey) => void;
  showFixed: boolean;
  onShowFixedChange: (v: boolean) => void;
}

export function CoachFilters({
  verdicts,
  active,
  onActive,
  showFixed,
  onShowFixedChange,
}: CoachFiltersProps) {
  const { groups, total, fixedCount } = useMemo(() => {
    const counts = new Map<SpecialistGroup, number>();
    let fixed = 0;
    for (const v of verdicts) {
      if (v.userState.applied) fixed += 1;
      const g = specialistGroup(v.specialist);
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return {
      groups: [...counts.entries()].sort((a, b) => b[1] - a[1]),
      total: verdicts.length,
      fixedCount: fixed,
    };
  }, [verdicts]);

  if (total === 0) return null;

  return (
    <div className={s.row}>
      <button
        type="button"
        className={s.pill}
        data-active={active === 'all'}
        onClick={() => onActive('all')}
        style={
          active === 'all'
            ? {
                background: 'rgba(0,229,176,0.12)',
                borderColor: 'rgba(0,229,176,0.5)',
                color: 'var(--cyan)',
              }
            : undefined
        }
      >
        <span className={s.dot} style={{ background: 'var(--cyan)' }} />
        All <span className={s.count}>{total}</span>
      </button>
      {groups.map(([group, count]) => {
        const color = groupColor(group);
        return (
          <button
            key={group}
            type="button"
            className={s.pill}
            data-active={active === group}
            onClick={() => onActive(group)}
            style={
              active === group
                ? {
                    background: `${color}12`,
                    borderColor: `${color}80`,
                    color,
                  }
                : undefined
            }
          >
            <span className={s.dot} style={{ background: color }} />
            {group} <span className={s.count}>{count}</span>
          </button>
        );
      })}

      <div className={s.right}>
        {fixedCount > 0 && (
          <span className={s.fixedCount}>
            <span>✓</span> {fixedCount} fixed
          </span>
        )}
        <label className={s.toggle}>
          <input
            type="checkbox"
            checked={showFixed}
            onChange={(e) => onShowFixedChange(e.target.checked)}
          />
          Show fixed
        </label>
      </div>
    </div>
  );
}
