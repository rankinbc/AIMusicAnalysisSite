import { GROUP_COLOR, groupForVerdict } from '../../results/fix-board-helpers';
import { Icon } from '../../results/Icon';
import type { PlanStep } from './sample-model';
import s from './SampleReport.module.css';

// The recommended-actions view: every fix-bearing finding as one numbered,
// prioritised step — plain DAW instructions, the device to reach for, and
// what should change when it's done.

export function SamplePlan({ steps }: { steps: PlanStep[] }) {
  return (
    <ol className={s.plan} data-testid="sample-plan">
      {steps.map((p, i) => {
        const v = p.verdict;
        const group = groupForVerdict(v);
        return (
          <li key={v.id} className={s.planItem}>
            <span className={`mono ${s.planNum}`}>{String(i + 1).padStart(2, '0')}</span>
            <div className={s.planBody}>
              <div className={`mono ${s.planMeta}`}>
                <span style={{ color: GROUP_COLOR[group] }}>{group}</span>
                <span className={s.metaSep}>·</span>
                <span>priority {v.priorityScore}</span>
                <span className={s.metaSep}>·</span>
                <span>{v.fix?.target?.name ?? 'master'}</span>
              </div>
              <div className={s.planTitle}>{v.headline}</div>
              <ul className={s.planSteps}>
                {p.steps.map((st, j) => (
                  <li key={j}>
                    <Icon name="arrow" size={11} />
                    {st}
                  </li>
                ))}
              </ul>
              {(p.device || p.outcome) && (
                <div className={s.planFoot}>
                  {p.device && (
                    <span className={`mono ${s.planDevice}`}>
                      In Ableton: {p.device}
                      {p.presetName ? ` — ${p.presetName}` : ''}
                    </span>
                  )}
                  {p.outcome && <span className={s.planOutcome}>{p.outcome}</span>}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
