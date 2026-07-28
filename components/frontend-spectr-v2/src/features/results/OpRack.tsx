import type { VerdictDspOp } from '../../api/types';
import { Icon, type IconName } from './Icon';
import { formatParam } from './fix-board-helpers';

// Op-based rack renderer — promoted from FixBoard's local RackModule (v4).
// Renders `fix.dsp_chain` ops as device cards. This is THE shared op renderer;
// RackView/RackModules were chain/MoveStep-shaped and are retired (gotcha #7).

// Device glyph + accent per module/op type — a subset of the Listen-rack
// vocabulary plus the solver's DSP-op vocabulary. Unknown types fall back to
// the neutral sliders glyph so a chain always renders.
const MODULE_META: Record<string, { icon: IconName; accent: string }> = {
  eq: { icon: 'sliders', accent: 'var(--accent)' },
  peaking_eq: { icon: 'sliders', accent: 'var(--accent)' },
  low_shelf: { icon: 'sliders', accent: 'var(--accent)' },
  high_shelf: { icon: 'sliders', accent: 'var(--accent)' },
  high_pass: { icon: 'sliders', accent: 'var(--blue)' },
  low_pass: { icon: 'sliders', accent: 'var(--blue)' },
  djfilter: { icon: 'sliders', accent: 'var(--blue)' },
  filter: { icon: 'sliders', accent: 'var(--blue)' },
  comp: { icon: 'pulse', accent: 'var(--blue)' },
  compressor: { icon: 'pulse', accent: 'var(--blue)' },
  multiband_compressor: { icon: 'pulse', accent: 'var(--blue)' },
  sidechain: { icon: 'pulse', accent: 'var(--green)' },
  gate: { icon: 'target', accent: 'var(--blue)' },
  sat: { icon: 'wave', accent: 'var(--yellow)' },
  saturation: { icon: 'wave', accent: 'var(--yellow)' },
  bitcrusher: { icon: 'collision', accent: 'var(--orange)' },
  width: { icon: 'spatial', accent: 'var(--violet)' },
  stereo_width: { icon: 'spatial', accent: 'var(--violet)' },
  pan: { icon: 'spatial', accent: 'var(--violet)' },
  tremolo: { icon: 'pulse', accent: 'var(--violet)' },
  delay: { icon: 'clock', accent: 'var(--blue)' },
  reverb: { icon: 'spatial', accent: 'var(--violet)' },
  limiter: { icon: 'bolt', accent: 'var(--orange)' },
  trim: { icon: 'sliders', accent: 'var(--muted)' },
  gain: { icon: 'sliders', accent: 'var(--muted)' },
  pitch: { icon: 'music', accent: 'var(--green)' },
};

function moduleMeta(type: string): { icon: IconName; accent: string } {
  return MODULE_META[type.toLowerCase()] ?? { icon: 'sliders', accent: 'var(--accent)' };
}

export function RackModule({ op }: { op: VerdictDspOp }) {
  const meta = moduleMeta(op.type);
  const entries = Object.entries(op.params ?? {});
  return (
    <div className="rackmod" style={{ ['--ac' as string]: meta.accent }}>
      <div className="rm-hd">
        <span className="rm-glyph">
          <Icon name={meta.icon} size={13} />
        </span>
        <span className="rm-nm">
          <span className="rm-name">{op.type}</span>
        </span>
      </div>
      <div className="rm-params">
        {entries.map(([k, v]) => (
          <div className="rm-p" key={k}>
            <span className="rm-k">{k}</span>
            <span className="rm-v">{formatParam(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A whole dsp_chain as a `.preset-mods` strip. */
export function OpRack({ ops }: { ops: VerdictDspOp[] }) {
  if (ops.length === 0) return null;
  return (
    <div className="preset-mods">
      {ops.map((op, i) => (
        <RackModule key={i} op={op} />
      ))}
    </div>
  );
}
