import type { Phase3Data } from '../../api/types';
import { fmtGenre } from './helpers/format';
import s from './GenreScorePanel.module.css';

interface GenreScorePanelProps {
  phase3: Phase3Data | undefined;
}

/** "Why this grade?" — breaks down the genre-specific score into the
 *  per-axis sub-scores Phase 3 emits (keys vary per scorer; we render them
 *  in the order they arrive). Hidden entirely when phase3 is missing or
 *  empty so the report doesn't show an empty card. */
export function GenreScorePanel({ phase3 }: GenreScorePanelProps) {
  if (!phase3) return null;
  const total = phase3.total_score;
  const subEntries = phase3.sub_scores
    ? Object.entries(phase3.sub_scores).filter(([, v]) => typeof v === 'number')
    : [];
  const notes = phase3.notes ?? [];
  if (total == null && subEntries.length === 0 && notes.length === 0) return null;

  return (
    <section className={`card ${s.card}`}>
      <header className={s.hd}>
        <div>
          <div className="label">Why this grade</div>
          <div className={s.title}>
            {phase3.genre ? `${fmtGenre(phase3.genre)} scoring` : 'Genre scoring'}
          </div>
        </div>
        {total != null && (
          <div className={s.totalBlock}>
            <span className={s.totalValue}>{Math.round(total)}</span>
            <span className={s.totalUnit}>/100</span>
          </div>
        )}
      </header>

      {subEntries.length > 0 && (
        <div className={s.subList}>
          {subEntries.map(([key, value]) => (
            <SubScoreRow key={key} name={key} score={Number(value)} />
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <ul className={s.notes}>
          {notes.map((note, i) => (
            <li key={i} className={s.note}>
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubScoreRow({ name, score }: { name: string; score: number }) {
  // Sub-scores are typically 0..100, but a few genre scorers emit 0..1 ratios.
  // Detect and normalize so the bar is always meaningful.
  const normalized = score <= 1 ? score * 100 : score;
  const clamped = Math.max(0, Math.min(100, normalized));
  const tone =
    clamped >= 80
      ? 'var(--cyan)'
      : clamped >= 60
        ? 'var(--yellow)'
        : 'var(--orange)';
  const label = name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className={s.subRow}>
      <span className={s.subLabel}>{label}</span>
      <div className={s.subBarTrack}>
        <div
          className={s.subBarFill}
          style={{ width: `${clamped}%`, background: tone }}
        />
      </div>
      <span className={`mono ${s.subValue}`} style={{ color: tone }}>
        {Math.round(clamped)}
      </span>
    </div>
  );
}
