import { Fragment, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { Move, MoveSev } from './move-model';
import s from './MoveCard.module.css';

interface MoveCardProps {
  move: Move;
  /** Toggle the Move's plan membership (committed ⇄ suggested). */
  onToggleCommit: (move: Move) => void;
  /** Deep-link to the Listen page to audition the fix. */
  onAudition: () => void;
}

const SEV_VAR: Record<MoveSev, string> = {
  crit: 'var(--red)',
  warn: 'var(--orange)',
  info: 'var(--blue)',
  low: 'var(--green)',
};

/** Wrap measured tokens (−3 dB, 120 Hz, −14 LUFS, 8 ms, 62%) in mono/cyan so
 *  the directive reads like the prototype WITHOUT inventing values — we only
 *  style numbers that the directive prose already contains. */
function highlightParams(text: string): ReactNode[] {
  const re = /(-?\d[\d.,]*\s?(?:dBTP|dB|LUFS|LU|kHz|Hz|ms|%))/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <code key={key++} className={`mono ${s.param}`}>
        {m[0]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MoveCard({ move, onToggleCommit, onAudition }: MoveCardProps) {
  const [showWhy, setShowWhy] = useState(false);
  const [showData, setShowData] = useState(false);
  const committed = move.status === 'committed';
  const confPct = Math.round(move.confidence * 100);
  const directiveText = move.hasParams ? move.directive : move.directional;

  const style: CSSProperties = { ['--sev' as string]: SEV_VAR[move.sev] };

  return (
    <article className={s.move} style={style} data-committed={committed || undefined}>
      <div className={s.sevBar} aria-hidden />

      <h3 className={s.title}>{move.title}</h3>

      <p className={s.directive}>
        <span className={s.arrow} aria-hidden>
          →
        </span>{' '}
        {move.scope && <span className={`mono ${s.scope}`}>{move.scope}</span>}
        {move.scope && ' · '}
        {highlightParams(directiveText)}
      </p>

      {move.hasParams && move.steps.length > 0 && (
        <div className={s.steps}>
          {move.steps.map((st, i) => (
            <Fragment key={i}>
              <span className={`mono ${s.stepWhere}`}>{st.where}</span>
              <span className={`mono ${s.stepDetail}`}>{st.detail || '—'}</span>
            </Fragment>
          ))}
        </div>
      )}

      <div className={s.foot}>
        <span className={`mono ${s.conf}`} title="Confidence">
          {confPct}% conf
        </span>
        <span className={`mono ${s.source}`}>{move.source}</span>

        <div className={s.toggles}>
          {move.why && (
            <button
              type="button"
              className={s.toggle}
              aria-expanded={showWhy}
              onClick={() => setShowWhy((v) => !v)}
            >
              why {showWhy ? '▴' : '▾'}
            </button>
          )}
          {move.evidence.metric && (
            <button
              type="button"
              className={s.toggle}
              aria-expanded={showData}
              onClick={() => setShowData((v) => !v)}
            >
              data {showData ? '▴' : '▾'}
            </button>
          )}
          <button type="button" className={s.audition} onClick={onAudition}>
            ▶ Audition
          </button>
          <button
            type="button"
            className={s.triage}
            data-in={committed || undefined}
            onClick={() => onToggleCommit(move)}
          >
            {committed ? '✓ In plan' : '+ Add to plan'}
          </button>
        </div>
      </div>

      {showWhy && move.why && <p className={s.why}>{move.why}</p>}
      {showData && move.evidence.metric && (
        <p className={`mono ${s.data}`}>{move.evidence.metric}</p>
      )}
    </article>
  );
}
