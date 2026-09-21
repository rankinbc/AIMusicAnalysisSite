/* Task V1 (2026-09-21) — top tab bar. Rack + Coach stay full-size tabs;
 * Visuals is a compact icon-only control at the end (product call: the
 * light show is a minor feature, so its settings shouldn't compete for
 * attention). All three are role="tab" children of one role="tablist" so
 * Visuals stays reachable for assistive tech exactly the way Rack/Coach are
 * — this bar has never had arrow-key roving, so none is added here; Tab
 * order and native button focus are unchanged. */
import { Icon } from '../results/Icon';

export type LrTabId = 'rack' | 'visuals' | 'coach';

/** aria-controls target for every tab — the page's single `.tabbody` panel
 * (only the active tab's content is rendered there). Exported so the page
 * can put the matching `id` on that panel without a second literal. */
export const LR_TABPANEL_ID = 'lr-tabpanel';

export function ListenTabBar({ tab, onSelect, activeCount, coachCount }: {
  tab: LrTabId;
  onSelect: (id: LrTabId) => void;
  activeCount: number;
  coachCount: number;
}) {
  return (
    <div className="rtabs" role="tablist" aria-label="Listen panels">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'rack'}
        aria-controls={LR_TABPANEL_ID}
        className={'rtab' + (tab === 'rack' ? ' active' : '')}
        onClick={() => onSelect('rack')}
      >
        <span className="ic"><Icon name="sliders" size={14} /></span>Rack
        <span className="rtab-badge">{activeCount}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'coach'}
        aria-controls={LR_TABPANEL_ID}
        className={'rtab' + (tab === 'coach' ? ' active' : '')}
        onClick={() => onSelect('coach')}
      >
        <span className="ic"><Icon name="robot" size={14} /></span>Coach
        {coachCount > 0 && <span className="rtab-badge">{coachCount}</span>}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'visuals'}
        aria-controls={LR_TABPANEL_ID}
        aria-label="Visuals"
        title="Visuals"
        className={'rtab-viz' + (tab === 'visuals' ? ' active' : '')}
        onClick={() => onSelect('visuals')}
      >
        <Icon name="sparkle" size={14} />
      </button>
    </div>
  );
}
