import type { ReactNode } from 'react';

export interface RailTab {
  id: string;
  label: string;
  /** Single-char/emoji icon placeholder; swap for inline SVG per prototype later. */
  icon: string;
  badge?: number;
  render: () => ReactNode;
}

export interface RailContext {
  meters: ReactNode;
  issues: ReactNode;
  dj: ReactNode;
  notes: ReactNode;
}

// Only tabs with a real surface this milestone. Chat/Comments/Viewers are
// intentionally absent (no realtime backend yet) — a future Show mode adds them
// here without touching RightRail.
/**
 * Builds the rail tab list. `ctx` ReactNodes are captured at call time, so the
 * caller MUST invoke this during render (e.g. in the component body or a useMemo
 * keyed on the live data) so panel content reflects current props.
 */
export function buildRailTabs(ctx: RailContext): RailTab[] {
  return [
    { id: 'meters', label: 'Meters', icon: '▦', render: () => ctx.meters },
    { id: 'issues', label: 'Issues', icon: '⚠', render: () => ctx.issues },
    { id: 'dj', label: 'DJ', icon: '◉', render: () => ctx.dj },
    { id: 'notes', label: 'Notes', icon: '✎', render: () => ctx.notes },
  ];
}
