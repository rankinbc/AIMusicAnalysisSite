/* The triage routing plan, ON the report page (previously only visible inside
 * AnalysisCompleteModal — which may be retired). Shows WHY these specialists
 * and their live run state; the actual run plumbing stays in CoachTab. */
import { GROUP_COLORS, specInitials, type RoutingSplit } from './helpers/analysisModalData';
import { STATE_LABEL, specRunState } from './helpers/triage-plan';
import s from './TriagePlanPanel.module.css';

interface Props {
  routing: RoutingSplit | null;
  /** Triage hasn't produced a plan yet (and hasn't degraded) — still deciding. */
  triagePending: boolean;
  ranSlugs: ReadonlySet<string>;
  runningSlugs: ReadonlySet<string>;
  hasStems: boolean;
  onRun: (slug: string) => void;
  onOpenTeam: () => void;
}

export function TriagePlanPanel({
  routing,
  triagePending,
  ranSlugs,
  runningSlugs,
  hasStems,
  onRun,
  onOpenTeam,
}: Props) {
  if (!routing && !triagePending) return null;

  return (
    <section className={s.panel} data-testid="triage-plan">
      <div className="seclabel">
        <span className="t">AI triage plan</span>
        {routing && (
          <span className="hint">
            {routing.total} specialist{routing.total === 1 ? '' : 's'} lined up
          </span>
        )}
        <span className="rule" />
      </div>

      {!routing ? (
        <div className={s.pending}>
          <span className={s.pendingDot} aria-hidden />
          Triage is picking the right specialists for this mix…
        </div>
      ) : (
        <div className={s.card}>
          {routing.rationale && <p className={s.rationale}>{routing.rationale}</p>}

          <div className={s.highList}>
            {routing.high.map((sp) => {
              const g = GROUP_COLORS[sp.group];
              const state = specRunState(sp.slug, ranSlugs, runningSlugs, hasStems);
              return (
                <div key={sp.slug} className={s.row}>
                  <span className={s.avatar} style={{ color: g.c, background: g.d }} aria-hidden>
                    {specInitials(sp.label)}
                  </span>
                  <div className={s.rowTx}>
                    <div className={s.rowName}>{sp.label}</div>
                    {sp.focus && <div className={s.rowFocus}>{sp.focus}</div>}
                  </div>
                  {state === 'idle' ? (
                    <button type="button" className={s.runBtn} onClick={() => onRun(sp.slug)}>
                      {STATE_LABEL[state]}
                    </button>
                  ) : (
                    <span className={s.state} data-state={state}>
                      {STATE_LABEL[state]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {routing.rest.length > 0 && (
            <div className={s.chipRow}>
              {routing.rest.map((sp) => {
                const g = GROUP_COLORS[sp.group];
                const state = specRunState(sp.slug, ranSlugs, runningSlugs, hasStems);
                return (
                  <span
                    key={sp.slug}
                    className={s.chip}
                    style={{ color: g.c, borderColor: g.d }}
                    data-state={state}
                  >
                    <span className={s.chipDot} style={{ background: g.c }} aria-hidden />
                    {sp.label}
                    {state === 'ran' && <span className={s.chipTick} aria-label="ran"> ✓</span>}
                  </span>
                );
              })}
            </div>
          )}

          <button type="button" className={s.teamLink} onClick={onOpenTeam}>
            Full specialist team →
          </button>
        </div>
      )}
    </section>
  );
}
