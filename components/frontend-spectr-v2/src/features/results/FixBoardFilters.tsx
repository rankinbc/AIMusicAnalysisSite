import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./Icon";

// Filter dropdown for the dual-mode FixBoard (v4): fixable-only, group
// checkboxes and fix-target (device/scope) checkboxes; the min-priority slider
// over the raw ~20–300 score sits inline to the LEFT of the Filter button. The menu is portal-rendered + fixed-positioned so
// ancestor overflow can't clip it, and caps its height to the viewport.
// FilterState/EMPTY_FILTERS/countActiveFilters live in fix-board-helpers.ts
// (react-refresh: component files export components only).
import {
  countActiveFilters,
  DEFAULT_MIN_PRIORITY,
  EMPTY_FILTERS,
  type FilterState,
} from "./fix-board-helpers";

export type { FilterState };

interface FixBoardFiltersProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  totalCount: number;
  fixableCount: number;
  groupsPresent: readonly { name: string; count: number }[];
  devicesPresent: readonly { name: string; count: number }[];
  maxPriority: number;
}

function toggleIn(set: ReadonlySet<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/** Portal menu anchored under its wrapper; viewport-capped, scrolls inside. */
function FddMenu({
  anchor,
  children,
}: {
  anchor: HTMLElement;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{
    top: number;
    right: number;
    maxHeight: number;
  } | null>(null);
  useEffect(() => {
    const fit = () => {
      const r = anchor.getBoundingClientRect();
      setPos({
        top: r.bottom + 5,
        right: Math.max(8, window.innerWidth - r.right),
        maxHeight: Math.max(140, window.innerHeight - r.bottom - 18),
      });
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [anchor]);
  // `rdx-pop` re-declares the .rdx design tokens — portal roots detach from
  // the page's .rdx ancestor, so the vars must ride along.
  return createPortal(
    <div className="rdx-pop">
      <div
        className="fdd-menu wide"
        style={
          pos
            ? {
                position: "fixed",
                top: pos.top,
                right: pos.right,
                maxHeight: pos.maxHeight,
              }
            : { visibility: "hidden" }
        }
      >
        <div className="fdd-scrollarea">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function FixBoardFilters({
  filters,
  onChange,
  totalCount,
  fixableCount,
  groupsPresent,
  devicesPresent,
  maxPriority,
}: FixBoardFiltersProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const n = countActiveFilters(filters);
  // Never below the default, so the default floor always sits on the track.
  const sliderMax = Math.max(
    DEFAULT_MIN_PRIORITY,
    Math.ceil(maxPriority / 10) * 10,
  );

  return (
    <>
      {maxPriority > 0 && (
        <label
          className="fb-prio"
          title="Hide findings scored below this priority (wins always show)"
        >
          <span className="fb-prio-l mono">Min priority</span>
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={10}
            value={Math.min(filters.minPriority, sliderMax)}
            onChange={(e) =>
              onChange({ ...filters, minPriority: Number(e.target.value) })
            }
            aria-label="Minimum priority"
          />
          <span className="fb-prio-v mono">
            {filters.minPriority > 0 ? `≥ ${filters.minPriority}` : "off"}
          </span>
        </label>
      )}
      <div className="fb-filterdd" ref={wrapRef}>
        <button
          type="button"
          className={`fpill fdd-btn${n > 0 ? " on" : ""}`}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="filter" size={11} />
          Filter
          {n > 0 && <span className="fn">{n}</span>}
          <span className="fdd-chev">▾</span>
        </button>
        {open && wrapRef.current && (
          <>
            {createPortal(
              <div
                className="rdx-pop fdd-scrim"
                onClick={() => setOpen(false)}
              />,
              document.body,
            )}
            <FddMenu anchor={wrapRef.current}>
              <label className="fdd-opt">
                <input
                  type="checkbox"
                  checked={!filters.fixableOnly}
                  onChange={() => onChange({ ...filters, fixableOnly: false })}
                />
                All findings <span className="fdd-c">{totalCount}</span>
              </label>
              <label className="fdd-opt">
                <input
                  type="checkbox"
                  checked={filters.fixableOnly}
                  onChange={() => onChange({ ...filters, fixableOnly: true })}
                />
                Fixable only <span className="fdd-c">{fixableCount}</span>
              </label>
              {groupsPresent.length > 0 && (
                <>
                  <div className="fdd-sec mono">Category</div>
                  {groupsPresent.map((g) => (
                    <label className="fdd-opt" key={g.name}>
                      <input
                        type="checkbox"
                        checked={filters.groups.has(g.name)}
                        onChange={() =>
                          onChange({
                            ...filters,
                            groups: toggleIn(filters.groups, g.name),
                          })
                        }
                      />
                      {g.name} <span className="fdd-c">{g.count}</span>
                    </label>
                  ))}
                </>
              )}
              {devicesPresent.length > 0 && (
                <>
                  <div className="fdd-sec mono">Fix target</div>
                  {devicesPresent.map((d) => (
                    <label className="fdd-opt" key={d.name}>
                      <input
                        type="checkbox"
                        checked={filters.devices.has(d.name)}
                        onChange={() =>
                          onChange({
                            ...filters,
                            devices: toggleIn(filters.devices, d.name),
                          })
                        }
                      />
                      {d.name === "Master" ? "Master" : `Device: ${d.name}`}{" "}
                      <span className="fdd-c">{d.count}</span>
                    </label>
                  ))}
                </>
              )}
              {n > 0 && (
                <button
                  type="button"
                  className="fdd-clear"
                  onClick={() =>
                    onChange({
                      ...EMPTY_FILTERS,
                      minPriority: filters.minPriority,
                    })
                  }
                >
                  Clear filters
                </button>
              )}
            </FddMenu>
          </>
        )}
      </div>
    </>
  );
}
