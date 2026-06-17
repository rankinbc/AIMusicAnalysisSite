import { SPECIALIST_CATALOG } from './helpers/specialists';
import type { RoutingPlanDto } from '../../api/types';
import s from './DeepenZone.module.css';

const LABEL = new Map(SPECIALIST_CATALOG.map((m) => [m.slug, m.label]));

interface DeepenZoneProps {
  routingPlan: RoutingPlanDto | undefined;
  /** Specialist slugs that already produced a verdict — hidden from prompts. */
  ranSlugs: ReadonlySet<string>;
  /** Slugs currently running (optimistic) — show a spinner. */
  runningSlugs: ReadonlySet<string>;
  onRun: (slug: string) => void;
  onBrowseAll: () => void;
}

/** The triage-recommended specialists as inline priced prompts (NOT the full
 *  26). Running one is the priced action; the result appends a new Move. */
export function DeepenZone({
  routingPlan,
  ranSlugs,
  runningSlugs,
  onRun,
  onBrowseAll,
}: DeepenZoneProps) {
  const recommended = (routingPlan?.specialists_to_run ?? [])
    .filter((e) => !ranSlugs.has(e.name))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 4);

  return (
    <section className={s.zone}>
      <div className={s.head}>
        <h3 className={s.title}>
          <span aria-hidden>✦</span> Deepen your plan
        </h3>
        <span className={s.sub}>priced · no auto-spend</span>
      </div>

      {recommended.length > 0 ? (
        <div className={s.grid}>
          {recommended.map((e) => {
            const running = runningSlugs.has(e.name);
            return (
              <div key={e.name} className={s.card}>
                <div className={s.cardBody}>
                  <h4 className={s.cardTitle}>{LABEL.get(e.name) ?? e.name}</h4>
                  <p className={s.cardReason}>{e.focus}</p>
                </div>
                <button
                  type="button"
                  className={`btn sm ${s.run}`}
                  disabled={running}
                  onClick={() => onRun(e.name)}
                >
                  {running ? (
                    <>
                      <span className={s.spinner} aria-hidden /> Running…
                    </>
                  ) : (
                    <>Run · 1 credit</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className={s.empty}>
          No more recommended specialists — you've run the ones triage flagged.
        </p>
      )}

      <button type="button" className={s.browse} onClick={onBrowseAll}>
        Browse all {SPECIALIST_CATALOG.length} specialists →
      </button>
    </section>
  );
}
