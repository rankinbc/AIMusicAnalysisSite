// The "AI specialists" stage of the Analysis Complete modal: the stage's
// per-specialist rows (the coach's narration lives in AnalysisCompleteCoach). Pure presentation over deriveSpecialistStage() — the
// runs themselves are dispatched and polled by useSpecialistRuns in ReportView.

import { GROUP_COLORS } from './helpers/analysisModalData';
import { findingsLabel, type SpecialistStage, type StageRow } from './helpers/specialist-stage';
import s from './AnalysisCompleteModal.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

const STATE_TAG: Record<StageRow['state'], string> = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  failed: 'failed',
};

function fmtElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function RowGlyph({ state }: { state: StageRow['state'] }) {
  if (state === 'running') return <span className={s.spin} />;
  if (state === 'done') return <>✓</>;
  if (state === 'failed') return <>!</>;
  return <span className={s.queuedDot} />;
}

/** Final pipeline stage: one row per specialist, all running side by side. */
export function SpecialistStageSection({
  stage,
  elapsedMs,
  sequential,
}: {
  stage: SpecialistStage;
  elapsedMs: number | null;
  sequential: boolean;
}) {
  const failed = stage.rows.filter((r) => r.state === 'failed').length;
  return (
    <>
      <div className={s.sectionLabel}>
        <span>AI specialists</span>
        <span className={s.line} />
        <span className={s.inputsSum}>
          {stage.complete
            ? failed > 0
              ? `${stage.total - failed} done · ${failed} failed`
              : `${stage.total} done`
            : `${stage.settled}/${stage.total} · ${sequential ? 'one at a time' : 'in parallel'}`}
          {elapsedMs !== null && ` · ${fmtElapsed(elapsedMs)}`}
        </span>
      </div>
      <ul className={s.specRows} data-testid="acm-specialists">
        {stage.rows.map((r) => {
          const g = GROUP_COLORS[r.group];
          const result =
            r.state === 'done'
              ? findingsLabel(r.findings)
              : r.state === 'failed'
                ? 'didn’t finish'
                : r.state === 'running'
                  ? 'analyzing…'
                  : 'waiting its turn';
          return (
            <li key={r.slug} className={cx(s.specRow, s[`row_${r.state}`])} data-state={r.state}>
              <span className={cx(s.stepStat, s[r.state])} aria-hidden>
                <RowGlyph state={r.state} />
              </span>
              <span className={s.specName} style={{ color: g.c }}>
                {r.label}
              </span>
              <span className={s.specResult} title={r.focus}>
                {result}
              </span>
              <span className={cx(s.stepTag, s[r.state])}>{STATE_TAG[r.state]}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
