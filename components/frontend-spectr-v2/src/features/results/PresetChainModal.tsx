import { Fragment } from 'react';

import { Icon } from './Icon';
import {
  MANIFEST,
  enabledModuleIds,
  moduleParams,
  readFixChain,
  signalFlowNodes,
} from './rack-view-helpers';

interface Props {
  name: string;
  chain: unknown;
  moduleCount: number;
  onClose: () => void;
}

/** Preset / Coach Mix detail modal — renders the device chain through the SAME
 *  prototype `.rack-chain` + `.rackmod` renderer as the fix-detail Suggested-fix
 *  box (the consistency invariant: a compiled Coach Mix and a saved preset are
 *  the same rack schema). Device glyph/accent/params come from the rack manifest. */
export function PresetChainModal({ name, chain, moduleCount, onClose }: Props) {
  const nodes = signalFlowNodes(chain);
  const ids = enabledModuleIds(chain);
  const parsed = readFixChain(chain);

  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={{ width: 'min(820px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Preset ${name}`}
      >
        <div className="modal-hd">
          <div className="mt">
            <div className="mk">Preset · rack</div>
            <div className="mn">
              {name}{' '}
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
                {moduleCount} devices
              </span>
            </div>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal-body">
          {ids.length === 0 ? (
            <div className="na">
              <Icon name="info" size={14} />
              Empty rack — no enabled modules.
            </div>
          ) : (
            <>
              <div className="rack-chain">
                <span className="rc-io">in</span>
                {nodes.map((n) => (
                  <Fragment key={n.id}>
                    <span className="rc-arr">→</span>
                    <span className="rc-node" style={{ ['--ac' as string]: n.accent }}>
                      {n.glyph} {n.label}
                    </span>
                  </Fragment>
                ))}
                <span className="rc-arr">→</span>
                <span className="rc-io">out</span>
              </div>
              <div className="rack-grid" style={{ marginTop: 14 }}>
                {ids.map((id) => {
                  const man = MANIFEST.get(id);
                  const rows = moduleParams(id, parsed?.modules[id] ?? {});
                  return (
                    <div
                      className="rackmod"
                      key={id}
                      style={{ ['--ac' as string]: man?.accent ?? 'var(--accent)' }}
                    >
                      <div className="rm-hd">
                        <span className="rm-glyph">{man?.glyph ?? '·'}</span>
                        <span className="rm-nm">
                          <span className="rm-name">{man?.label ?? id}</span>
                        </span>
                      </div>
                      {rows.length > 0 && (
                        <div className="rm-params">
                          {rows.map((p, i) => (
                            <div className="rm-p" key={i}>
                              <span className="rm-k">{p.label}</span>
                              <span className="rm-v">{p.val}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
