import { memo, useState } from 'react';
import type { MeterCell } from './meters';
import s from './MeterModule.module.css';

interface Props {
  cells: MeterCell[];
  /** Overlay variant adds the glass card + absolute positioning (Plan 3). */
  variant?: 'overlay' | 'panel';
  defaultCollapsed?: boolean;
}

function fmt(cell: MeterCell): string {
  if (cell.value === null) return '—';
  return cell.value.toFixed(cell.decimals);
}

export const MeterModule = memo(function MeterModule({ cells, variant = 'panel', defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const mini = ['lufs_s', 'true_peak', 'gr']
    .map((k) => cells.find((c) => c.key === k))
    .filter((c): c is MeterCell => Boolean(c));

  return (
    <div className={`${s.module} ${variant === 'overlay' ? s.overlay : ''}`}>
      <div className={s.head}>
        <span className={s.led} aria-hidden="true" />
        <span className={s.title}>Metering</span>
        {collapsed && (
          <span className={`${s.mini} mono`}>
            {mini.map((c) => `${c.label} ${fmt(c)}`).join(' · ')}
          </span>
        )}
        <button
          type="button"
          className={s.chevron}
          aria-label={collapsed ? 'Expand meters' : 'Collapse meters'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!collapsed && (
        <div className={s.body}>
          <div className={s.grid}>
            {cells.map((c) => (
              <div key={c.key} className={s.cell} data-tone={c.tone} data-empty={c.value === null}>
                <span className={`${s.cellLabel} mono`}>{c.label}</span>
                <span className={`${s.cellValue} mono`} title={c.value === null ? 'Not yet measured' : undefined}>
                  {fmt(c)}
                </span>
              </div>
            ))}
          </div>
          <div className={`${s.target} mono`}>
            <span className={s.targetDot} aria-hidden="true" />
            <span className={s.targetLabel}>target</span>
            <span>−9 · −1 dBTP · 48k/24</span>
          </div>
        </div>
      )}
    </div>
  );
});
