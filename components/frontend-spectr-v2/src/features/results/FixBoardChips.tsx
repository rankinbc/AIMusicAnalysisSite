import type { VerdictDto } from '../../api/types';
import { Icon } from './Icon';
import { formatWhere } from './problems-helpers';
import {
  GROUP_COLOR,
  GROUP_DESC,
  TIER_CHIP_LABEL,
  priorityTip,
  sourceTip,
  tierTip,
} from './fix-board-helpers';
import type { SpecialistGroup } from './helpers/specialists';
import {
  formatEvDelta,
  formatEvRange,
  formatEvValue,
  type EvidenceRow,
} from './evidence-model';

// Small presentational chips shared by FindingDetail + ActionDetail (v4).

/** Color-coded group chip; tooltip explains the group. */
export function GroupChip({ group }: { group: SpecialistGroup }) {
  return (
    <span className="fbd-group gloss" style={{ ['--gc' as string]: GROUP_COLOR[group] }}>
      <span className="gc-dot" />
      {group}
      <span className="gtip">{GROUP_DESC[group]}</span>
    </span>
  );
}

/** "Source: Measured" / "Source: AI · <specialist>" provenance tag. */
export function SourceTag({ v, spec }: { v: VerdictDto; spec: string | null }) {
  const ai = v.source === 'llm_identifier';
  const label = spec ?? (ai ? 'AI specialist' : 'Measured');
  return (
    <span className={`src-tag gloss${ai ? ' ai' : ''}`}>
      <span className="sk">Source:</span>
      <Icon name={ai ? 'robot' : 'chart'} size={12} />
      {label}
      <span className="gtip">{sourceTip(v, spec)}</span>
    </span>
  );
}

/** Meta chip row — P-chip (breakdown hover) · confidence · data tier ·
 *  where-chip · provisional flag. Degrades gracefully field-by-field. */
export function MetaChips({ v }: { v: VerdictDto }) {
  const whereLabel = formatWhere(v.where);
  return (
    <div className="fbd-meta2">
      <span className="mchip pr gloss">
        <Icon name="target" size={11} />
        priority {v.priorityScore}
        <span className="gtip">{priorityTip(v)}</span>
      </span>
      <span className="mchip gloss">
        conf {Math.round(v.confidence * 100)}%
        <span className="gtip">How confident the analyzer is in this detection.</span>
      </span>
      <span className="mchip gloss">
        <Icon name="layers" size={11} />
        {TIER_CHIP_LABEL[v.dataTier] ?? v.dataTier}
        <span className="gtip">{tierTip(v.dataTier)}</span>
      </span>
      {whereLabel && (
        <span className="mchip">
          <Icon name="clock" size={11} />
          {whereLabel}
        </span>
      )}
      {v.suspected && (
        <span className="mchip warn gloss">
          provisional
          <span className="gtip">
            Provisional threshold — this detection uses a heuristic cutoff. Treat it as a lead to
            verify by ear, not a hard fault.
          </span>
        </span>
      )}
    </div>
  );
}

/** ev2 evidence table — metric · yours · expected · Δ. Rows carrying a
 *  frequency range render a chip that deep-links to the spectrum. */
export function EvRows({
  rows,
  onShowSpectrum,
}: {
  rows: EvidenceRow[];
  onShowSpectrum?: ((range: [number, number]) => void) | undefined;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="evrows">
      <div className="er hd">
        <span>Metric</span>
        <span>Yours</span>
        <span>Expected</span>
        <span>Δ</span>
      </div>
      {rows.map((r, i) => (
        <div className="er" key={i}>
          <span className="m mono">
            {r.label || r.metric}
            {r.frequency_range_hz && onShowSpectrum && (
              <button
                type="button"
                className="er-band"
                title={`Show ${r.frequency_range_hz[0]}–${r.frequency_range_hz[1]} Hz on the spectrum`}
                onClick={() => onShowSpectrum(r.frequency_range_hz!)}
              >
                {Math.round(r.frequency_range_hz[0])}–{Math.round(r.frequency_range_hz[1])} Hz
                <Icon name="external" size={10} />
              </button>
            )}
          </span>
          <span className="y mono">{formatEvValue(r.value)}</span>
          <span className="e mono">{formatEvRange(r.expected_range)}</span>
          <span className="d mono">{formatEvDelta(r)}</span>
        </div>
      ))}
    </div>
  );
}
