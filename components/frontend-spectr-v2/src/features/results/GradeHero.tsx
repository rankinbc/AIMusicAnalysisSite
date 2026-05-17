// Top-of-report hero: huge dynamic-color grade letter, mix score under it,
// and a tiny "DANCE" chip on its own line. All three values are tolerant of
// undefined — the formatters return an em-dash so the panel never throws.

import { gradeColor, gradeLabel } from './helpers/grade';
import { fmtScore } from './helpers/format';
import s from './GradeHero.module.css';

interface GradeHeroProps {
  grade: string | null | undefined;
  score: number | undefined;
  danceability: number | undefined;
}

export function GradeHero({ grade, score, danceability }: GradeHeroProps) {
  return (
    <section className={s.hero}>
      {/* Inline color is permitted: helper returns a dynamic CSS var per grade. */}
      <div className={s.letter} style={{ color: gradeColor(grade) }}>
        {gradeLabel(grade)}
      </div>
      <div className={`${s.score} mono`}>{fmtScore(score)}</div>
      <div className={s.chip}>
        <span className={s.chipLabel}>DANCE</span>
        <span className={s.chipDot}>·</span>
        <span className={`${s.chipValue} mono`}>{fmtScore(danceability)}</span>
      </div>
    </section>
  );
}
