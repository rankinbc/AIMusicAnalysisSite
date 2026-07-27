import type { ResultsTabKey } from './results-tab-keys';
import { buildResultsTabs, type BuildTabsOpts } from './results-tabs-model';
import { Icon } from './Icon';

export type { ResultsTabKey } from './results-tab-keys';

interface ResultsTabsProps extends BuildTabsOpts {
  current: ResultsTabKey;
  onChange: (id: ResultsTabKey) => void;
}

// Glyphs stand in for the prototype's inline SVG icons; styling comes from the
// scoped `.rtab` rules in redesign.css. v4: disabled tabs render with a tooltip
// instead of being hidden; the hot group (Findings/Actions/Improvement Plan) is
// pushed right and tinted.
export function ResultsTabs({ current, onChange, ...opts }: ResultsTabsProps) {
  const tabs = buildResultsTabs(opts, import.meta.env.DEV);
  const firstHot = tabs.find((t) => t.hot)?.id;

  return (
    <div className="rtabs" role="tablist">
      {tabs.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            className={
              `rtab${active ? ' active' : ''}${t.alert ? ' alert' : ''}` +
              `${t.hot ? ' hot' : ''}${t.id === firstHot ? ' hot-first' : ''}` +
              `${t.disabled ? ' disabled' : ''}`
            }
            role="tab"
            aria-selected={active}
            aria-disabled={t.disabled || undefined}
            {...(t.disabled && t.tooltip ? { title: t.tooltip } : {})}
            onClick={() => {
              if (!t.disabled) onChange(t.id);
            }}
          >
            <span className="ic" aria-hidden>
              <Icon name={t.icon} size={15} />
            </span>
            {t.label}
            {t.badge != null && <span className="rtab-badge">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
