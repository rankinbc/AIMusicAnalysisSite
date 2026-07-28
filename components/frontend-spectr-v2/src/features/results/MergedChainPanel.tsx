// "What this adds up to" — the merged chain, shown above the Actions queue.
//
// The queue is the analysis; this is the answer. Same weighted merge the Listen
// rack and the server's preset compiler run, so the numbers here are the ones
// "Try Fixes" and "Create Preset" will actually produce — never a second
// opinion. Each device expands to the fixes that fed it, which is where the
// long list earns its keep: as evidence for a short instruction.
import { useMemo, useState } from 'react';

import { Icon } from './Icon';
import { buildMergedChain } from './merged-chain-model';
import type { Move } from './move-model';

interface MergedChainPanelProps {
  committed: Move[];
}

export function MergedChainPanel({ committed }: MergedChainPanelProps) {
  const chain = useMemo(() => buildMergedChain(committed), [committed]);
  const [openDevice, setOpenDevice] = useState<string | null>(null);
  const [showDecisions, setShowDecisions] = useState(false);

  if (chain.devices.length === 0) return null;

  const collapsed = chain.fixCount > chain.devices.length;

  return (
    <section className="mc-panel" aria-label="Merged chain">
      <header className="mc-hd">
        <span className="mc-t">What this adds up to</span>
        <span className="mc-count mono">
          {collapsed
            ? `${chain.fixCount} fixes → ${chain.devices.length} ${chain.devices.length === 1 ? 'move' : 'moves'}`
            : `${chain.devices.length} ${chain.devices.length === 1 ? 'move' : 'moves'}`}
        </span>
      </header>

      <ul className="mc-list">
        {chain.devices.map((d) => {
          const open = openDevice === d.moduleId;
          return (
            <li key={d.moduleId} className={'mc-dev' + (open ? ' open' : '')}>
              <button
                type="button"
                className="mc-devhd"
                aria-expanded={open}
                onClick={() => setOpenDevice(open ? null : d.moduleId)}
              >
                <span className="mc-dl">{d.label}</span>
                <span className="mc-ds mono">{d.summary}</span>
                <span className="mc-dn mono">
                  {d.sources.length === 1 ? '1 fix' : `${d.sources.length} fixes`}
                </span>
                <Icon name="chevron" size={12} />
              </button>
              {open && (
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
          <button type="button" className="mc-dect" onClick={() => setShowDecisions((s) => !s)} aria-expanded={showDecisions}>
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
    </section>
  );
}
