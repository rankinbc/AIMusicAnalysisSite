// AI Coach intro + ordered fix list. Falls back gracefully when the pipeline
// produced no coached_fixes — common for clean mixes or when phase 7 is
// skipped.
//
// Story 1.4 / UX-DR17: when `degraded` is true (the BFF returned a
// DegradationNotice on the verdicts response), the panel renders the
// pre-written offline copy and suppresses the live coach content. The full
// coach chat surface lands in story 1.8 — this is the only coach surface
// today, so it owns the offline state for now.

import s from './CoachPanel.module.css';

interface CoachPanelProps {
  name: string | undefined;
  intro: string | undefined;
  fixes: string[] | undefined;
  /** Story 1.4: pass `true` when the verdicts response carries a
   *  DegradationNotice. Suppresses the live coach content and shows the
   *  UX-DR17 offline copy. */
  degraded?: boolean;
}

const OFFLINE_COPY =
  'Coach is offline — your measured analysis and rule-based findings are unaffected.';

export function CoachPanel({ name, intro, fixes, degraded = false }: CoachPanelProps) {
  if (degraded) {
    return (
      <section className={s.panel} data-degraded="true">
        <div className={s.overline}>AI Coach</div>
        <h3 className={s.name}>Coach offline</h3>
        <p className={s.intro}>{OFFLINE_COPY}</p>
      </section>
    );
  }

  const hasFixes = Array.isArray(fixes) && fixes.length > 0;

  return (
    <section className={s.panel}>
      <div className={s.overline}>AI Coach</div>
      <h3 className={s.name}>{name ?? 'Coach'}</h3>
      <p className={s.intro}>{intro ?? '…'}</p>
      {hasFixes ? (
        <ol className={s.fixes}>
          {fixes!.map((fix, i) => (
            // Coached fixes are short stable strings from the pipeline; index
            // is a safe fallback key when duplicates are impossible.
            <li className={s.fix} key={`${i}-${fix.slice(0, 24)}`}>
              {fix}
            </li>
          ))}
        </ol>
      ) : (
        <p className={s.empty}>No fixes yet — your mix is in good shape.</p>
      )}
    </section>
  );
}
