// AI Coach intro + ordered fix list. Falls back gracefully when the pipeline
// produced no coached_fixes — common for clean mixes or when phase 7 is
// skipped.

import s from './CoachPanel.module.css';

interface CoachPanelProps {
  name: string | undefined;
  intro: string | undefined;
  fixes: string[] | undefined;
}

export function CoachPanel({ name, intro, fixes }: CoachPanelProps) {
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
