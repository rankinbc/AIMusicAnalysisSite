// "What this adds up to" — the merged chain, as a ONE-LINE strip under the
// Actions list (owner, 2026-10-01: the list must start at the top of the
// section, so the queue summary moved below it and collapsed to a line).
//
// The queue is the analysis; this is the answer. Same weighted merge the Listen
// rack and the server's preset compiler run, so the numbers here are the ones
// "Try Fixes" and "Create Preset" will actually produce — never a second
// opinion. Collapsed it reads "15 queued · EQ · M/S width · Limiter"; expanded
// each device shows its merged settings and the fixes that fed it.
import { useMemo, useState } from 'react';

import { Icon } from './Icon';
import { buildMergedChain } from './merged-chain-model';
import type { Move } from './move-model';

interface MergedChainPanelProps {
  committed: Move[];
}

function queuedLabel(n: number): string {
  return n > 0 ? `${n} queued` : 'Queue fixes to unlock these';
}

export function MergedChainPanel({ committed }: MergedChainPanelProps) {
  const chain = useMemo(() => buildMergedChain(committed), [committed]);
  const [open, setOpen] = useState(false);
  const [openDevice, setOpenDevice] = useState<string | null>(null);
  const [showDecisions, setShowDecisions] = useState(false);

  // Nothing compiles to a rack device (empty queue, or DAW-only moves): the
  // count is the whole story — no expander.
  if (chain.devices.length === 0) {
    return (
      <section className="mc-panel" aria-label="What this adds up to">
        <p className="mc-line mono">{queuedLabel(committed.length)}</p>
      </section>
    );
  }

  const moves = `${chain.devices.length} ${chain.devices.length === 1 ? 'move' : 'moves'}`;

  return (
    <section className={'mc-panel' + (open ? ' open' : '')} aria-label="What this adds up to">
      <button
        type="button"
        className="mc-hd"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="What the queued fixes add up to"
      >
        <span className="mc-count mono">{queuedLabel(committed.length)}</span>
        <span className="mc-devs">{chain.devices.map((d) => d.label).join(' · ')}</span>
        <Icon name="chevron" size={12} />
      </button>

      {open && (
        <div className="mc-body">
          <div className="mc-t">
            What this adds up to
            <span className="mc-sub mono">
              {chain.fixCount > chain.devices.length ? `${chain.fixCount} fixes → ${moves}` : moves}
            </span>
          </div>
          <ul className="mc-list">
            {chain.devices.map((d) => {
              const devOpen = openDevice === d.moduleId;
              return (
                <li key={d.moduleId} className={'mc-dev' + (devOpen ? ' open' : '')}>
                  <button
                    type="button"
                    className="mc-devhd"
                    aria-expanded={devOpen}
                    onClick={() => setOpenDevice(devOpen ? null : d.moduleId)}
                  >
                    <span className="mc-dl">{d.label}</span>
                    <span className="mc-dn mono">
                      {d.sources.length === 1 ? '1 fix' : `${d.sources.length} fixes`}
                    </span>
                    <Icon name="chevron" size={11} />
                    <span className="mc-ds mono">{d.summary}</span>
                  </button>
                  {devOpen && (
                    <ul className="mc-src">
                      {d.sources.map((s, i) => (
                        <li key={`${s.moveId}-${i}`}>
                          <span className="h">{s.title}</span>
                          <span className="a mono">{s.ask}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {chain.decisions.length > 0 && (
            <div className="mc-dec">
              <button
                type="button"
                className="mc-dect"
                onClick={() => setShowDecisions((s) => !s)}
                aria-expanded={showDecisions}
              >
                {chain.decisions.length === 1
                  ? '1 merge decision'
                  : `${chain.decisions.length} merge decisions`}
                <Icon name="chevron" size={11} />
              </button>
              {showDecisions && (
                <ul className="mc-decl">
                  {chain.decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
