import { useMemo } from 'react';

import type { VerdictDto } from '../../api/types';
import type { Move } from './move-model';
import { Icon } from './Icon';
import { CoachStatic } from '../../ui/Coach';
import { severityColor } from './helpers/severity';
import { parseEvidenceRows } from './evidence-model';
import { Glossify } from './glossary';
import { EvRows, GroupChip, MetaChips, SourceTag } from './FixBoardChips';
import {
  defaultWhy,
  groupForVerdict,
  sevTitle,
  specName,
  type FixBoardSurface,
  type SeekAffordance,
} from './fix-board-helpers';

// Findings-mode detail panel (v4): diagnosis-first. Why-it-matters is always
// open (with fallback copy), the ev2 evidence table renders auto-expanded, and
// the footer links across to the Actions tab when a fix exists.

interface FindingDetailProps {
  f: VerdictDto | null;
  move: Move | null;
  onAskCoach?: ((v: VerdictDto) => void) | undefined;
  onShowFix: (verdictId: string) => void;
  onShowSpectrum?: ((range: [number, number]) => void) | undefined;
  surface?: FixBoardSurface | undefined;
  seek?: SeekAffordance | undefined;
}

export function FindingDetail({
  f,
  move,
  onAskCoach,
  onShowFix,
  onShowSpectrum,
  surface = 'report',
  seek,
}: FindingDetailProps) {
  const evRows = useMemo(() => (f ? parseEvidenceRows(f.evidence) : []), [f]);

  if (!f) {
    return (
      <div className="fb-detail empty">
        <Icon name="info" size={18} />
        <span>Select a finding to see the detail and its fix.</span>
      </div>
    );
  }

  const group = groupForVerdict(f);
  const spec = specName(f);
  const dimmed = f.userState.dismissed;
  const seekLabel = seek ? seek.label(f) : null;
  const showAsk = surface === 'report' && onAskCoach != null;

  return (
    <div
      className={`fb-detail${dimmed ? ' dismissed' : ''}`}
      style={{ ['--sev' as string]: severityColor(f.severity) }}
    >
      <div className="fbd-scroll">
        <div className="fbd-toplab">Finding</div>
        <div className="fbd-meta">
          <span className="fbd-sev">{sevTitle(f.severity)}</span>
          <GroupChip group={group} />
          <SourceTag v={f} spec={spec !== group ? spec : null} />
        </div>
        <MetaChips v={f} />

        {seek && seekLabel && (
          <button
            type="button"
            className="fbd-seek"
            title="Jump to this moment in the track"
            aria-label={`Jump to ${seekLabel}`}
            onClick={() => seek.go(f)}
          >
            <Icon name="play" size={11} />
            {seekLabel}
          </button>
        )}

        <h3 className="fbd-head">
          {f.headline}
          {f.metricLine && (
            <span className="fbd-metric">
              <Glossify text={f.metricLine} />
            </span>
          )}
        </h3>
        <div className="fbd-cols">
          <p className="fbd-sum">
            <Glossify text={f.summary ?? f.body} />
          </p>
        </div>

        {f.severity !== 'win' && (
          <div className="fbd-why2">
            <span className="wh">
              <Icon name="info" size={12} />
              Why it matters
            </span>
            <p>
              <Glossify text={f.whyItMatters?.trim() || defaultWhy(f)} />
            </p>
          </div>
        )}

        {evRows.length > 0 && (
          <div className="fbd-data open">
            <div className="fbd-datahd static">
              <span className="lab">The data</span>
            </div>
            <div className="fbd-datachart fade-up">
              <p className="fbd-dataexp">
                Each row is one measurement this finding rests on — your value against the range the
                analyzer expects for this genre.
              </p>
              <EvRows rows={evRows} onShowSpectrum={onShowSpectrum} />
            </div>
          </div>
        )}

        {dimmed && (
          <div className="na" style={{ marginTop: 10 }}>
            <Icon name="eyeoff" size={13} />
            Ignored — its action is hidden from the Actions tab.
          </div>
        )}

        {move ? (
          <div className="fbd-avail">
            <Icon name="check" size={13} />
            Applicable Fix Available
          </div>
        ) : (
          f.severity !== 'win' && (
            <div className="fbd-nofix">
              <Icon name="info" size={14} />
              No one-click fix — this is an observation. Ask the Coach to dig in, or address it by
              hand.
            </div>
          )
        )}

        {(showAsk || move) && (
          <div className="fbd-cta divided">
            {showAsk && (
              <button type="button" className="fbd-ask" onClick={() => onAskCoach?.(f)}>
                <span className="coach-ic">
                  <CoachStatic size={17} />
                </span>
                Ask the coach about this
              </button>
            )}
            {move && (
              <button
                type="button"
                className="fbd-ask green"
                onClick={() => onShowFix(f.id)}
                title={`${move.title} — open on the Actions tab`}
              >
                Show Suggested Fix
                <Icon name="arrow" size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
