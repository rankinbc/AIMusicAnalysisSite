import type { ReactNode } from 'react';

import { DeviceModule } from './DeviceModule';
import { enabledModuleIds, readFixChain } from './fix-rack-helpers';
import { signalFlowNodes } from './rack-view-helpers';
import s from './RackView.module.css';

interface Props {
  /** Opaque FixRackDto.chain / RackPresetDto.chain — narrowed via readFixChain. */
  chain: unknown;
  title?: string;
  /** Rendered under the module grid (Coach Mix change-log, or preset row actions). */
  footer?: ReactNode;
}

/** THE shared read-only chain renderer: signal-flow strip + DeviceModule grid.
 *  Used by the Coach Mix `auto` preset row, every user preset row, and the
 *  preset-chain modal — a compiled Coach Mix and a saved preset are the same
 *  rack JSON, and this is the same chain that renders on the Listen page. */
export function RackView({ chain, title, footer }: Props) {
  const c = readFixChain(chain);
  const ids = enabledModuleIds(chain);
  if (!c || ids.length === 0) {
    return <div className={s.emptyRack}>Empty rack — no enabled modules.</div>;
  }
  const flow = signalFlowNodes(chain);
  return (
    <div className={s.rack}>
      {title && <div className={s.rackTitle}>{title}</div>}
      <div className={`mono ${s.chainbar}`}>
        <span className={s.flowEnd}>in</span>
        {flow.map((n) => (
          <span key={n.id} className={s.node} style={{ ['--ac' as string]: n.accent }}>
            {n.glyph} {n.label}
          </span>
        ))}
        <span className={s.flowEnd}>out</span>
      </div>
      <div className={s.modules}>
        {ids.map((id) => (
          <DeviceModule key={id} id={id} state={c.modules[id]} />
        ))}
      </div>
      {footer}
    </div>
  );
}
