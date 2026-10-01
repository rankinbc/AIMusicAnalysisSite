import { useId, useMemo } from 'react';

import { parseEvidenceRows } from '../../results/evidence-model';
import { EvRows, GroupChip, MetaChips, SourceTag } from '../../results/FixBoardChips';
import { GROUP_COLOR, groupForVerdict, sevTitle } from '../../results/fix-board-helpers';
import { Glossify } from '../../results/glossary';
import { severityColor } from '../../results/helpers/severity';
import { Icon } from '../../results/Icon';
import { OpRack } from '../../results/OpRack';
import type { SampleFinding } from './sample-data';
import { describeOp, hasFix, isWin, raisedBy } from './sample-model';
import s from './SampleReport.module.css';

// One finding in the landing sample: a collapsed row (severity, headline,
// who raised it, measured number) that expands into the same detail the
// results page shows — summary, why it matters, the measured evidence table,
// and the concrete fix chain. Read-only: no queue/apply/ignore controls.

interface Props {
  finding: SampleFinding;
  open: boolean;
  plain: boolean;
  onToggle: () => void;
}

export function SampleFindingRow({ finding, open, plain, onToggle }: Props) {
  const v = finding.verdict;
  const panelId = useId();
  const evRows = useMemo(() => parseEvidenceRows(v.evidence), [v.evidence]);
  const group = groupForVerdict(v);
  const by = raisedBy(v.specialist);
  const fix = hasFix(v);
  const win = isWin(finding);
  const why = v.whyItMatters?.trim();
  const agree = finding.corroboratedBy.length;

  return (
    <li
      className={`${s.row}${open ? ` ${s.rowOpen}` : ''}`}
      style={{ ['--sev' as string]: severityColor(v.severity) }}
      data-testid="sample-finding"
    >
      <button
        type="button"
        className={s.rowBtn}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className={s.sevDot} aria-hidden />
        <span className={s.rowMain}>
          <span className={s.rowHead}>{v.headline}</span>
          <span className={`mono ${s.rowMeta}`}>
            <span style={{ color: GROUP_COLOR[group] }}>{group}</span>
            <span className={s.metaSep}>·</span>
            <span className={s.by}>
              <Icon name={v.source === 'llm_identifier' ? 'robot' : 'chart'} size={11} />
              {by}
            </span>
            {agree > 0 && (
              <>
                <span className={s.metaSep}>·</span>
                <span className={s.agree}>+{agree} agree</span>
              </>
            )}
            {fix && (
              <>
                <span className={s.metaSep}>·</span>
                <span className={s.fixReady}>fix ready</span>
              </>
            )}
          </span>
          {plain && why && <span className={s.rowPlain}>{why}</span>}
        </span>
        <span className={s.chev} aria-hidden>
          <Icon name="chevron" size={14} />
        </span>
      </button>

      {open && (
        <div className={s.detail} id={panelId}>
          <div className="fbd-meta">
            <span className="fbd-sev">{sevTitle(v.severity)}</span>
            <GroupChip group={group} />
            <SourceTag v={v} spec={by} />
          </div>
          <MetaChips v={v} />

          <p className="fbd-sum">
            <Glossify text={v.summary ?? v.body} />
          </p>

          {!win && why && (
            <div className="fbd-why2">
              <span className="wh">
                <Icon name="info" size={12} />
                Why it matters
              </span>
              <p>
                <Glossify text={why} />
              </p>
            </div>
          )}

          {evRows.length > 0 && (
            <div className="fbd-data open">
              <div className="fbd-datahd static">
                <span className="lab">The data</span>
              </div>
              <p className="fbd-dataexp">
                Each row is one measurement taken from the track, against the range expected for
                the genre.
              </p>
              <EvRows rows={evRows} />
            </div>
          )}

          {fix && (
            <div className={s.fix}>
              <div className={s.fixHd}>
                <span className={`mono ${s.fixLab}`}>The fix</span>
                <span className={`mono ${s.fixScope}`}>{v.fix?.target?.name ?? 'master'}</span>
              </div>
              <ol className={s.fixSteps}>
                {(v.fix?.dsp_chain ?? []).map((op, i) => (
                  <li key={i}>{describeOp(op)}</li>
                ))}
              </ol>
              <div className="fbd-rack">
                <OpRack ops={v.fix?.dsp_chain ?? []} />
              </div>
              {v.fix?.expected_outcome && (
                <p className={s.outcome}>
                  <span className={`mono ${s.outcomeLab}`}>Expected result</span>
                  {v.fix.expected_outcome}
                </p>
              )}
            </div>
          )}

          {agree > 0 && (
            <div className={s.corro}>
              <span className={`mono ${s.corroLab}`}>Independently flagged by</span>
              <ul>
                {finding.corroboratedBy.map((c, i) => (
                  <li key={i}>
                    <b>{raisedBy(c.specialist)}</b> — {c.headline}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
