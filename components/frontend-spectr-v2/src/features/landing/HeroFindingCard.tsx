/* The hero's product hint: one real finding from the sample report, which
 * alternates with the fix SPECTR suggested for it — the "it doesn't just tell
 * you what's wrong, it helps you fix it" pitch in one card. Both faces are
 * always in the DOM (crawlers, tests, no layout jump); the inactive one is
 * aria-hidden. Auto-advances every CYCLE_MS, pauses on hover/focus, and never
 * auto-advances under prefers-reduced-motion (the tabs still switch it). */
import { useEffect, useState } from 'react';

import { HERO_FINDING, HERO_FIX } from './hero-content';
import s from './HeroFindingCard.module.css';

const CYCLE_MS = 4500;
type Face = 'finding' | 'fix';

export function HeroFindingCard({ className }: { className?: string }) {
  const [face, setFace] = useState<Face>('finding');
  const [paused, setPaused] = useState(false);
  const [autoplay, setAutoplay] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setAutoplay(!reduce);
  }, []);

  useEffect(() => {
    if (!autoplay || paused) return;
    const t = window.setTimeout(() => setFace((f) => (f === 'finding' ? 'fix' : 'finding')), CYCLE_MS);
    return () => window.clearTimeout(t);
  }, [face, autoplay, paused]);

  const running = autoplay && !paused;

  return (
    <div
      className={`${className ?? ''} ${s.card}`}
      data-face={face}
      role="group"
      aria-label="A finding from the sample report, and the fix SPECTR suggested"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className={s.top}>
        <div className={s.tabs} role="tablist" aria-label="Finding or fix">
          <button
            type="button"
            role="tab"
            aria-selected={face === 'finding'}
            className={s.tab}
            data-kind="finding"
            onClick={() => setFace('finding')}
          >
            <span className={s.tabDot} aria-hidden="true" />
            Finding
          </button>
          <span className={s.arrow} aria-hidden="true">
            →
          </span>
          <button
            type="button"
            role="tab"
            aria-selected={face === 'fix'}
            className={s.tab}
            data-kind="fix"
            onClick={() => setFace('fix')}
          >
            <span className={s.tabDot} aria-hidden="true" />
            The fix
          </button>
        </div>
        <span className={s.src}>from the sample report</span>
      </div>

      <div className={s.faces}>
        <div className={s.face} data-active={face === 'finding'} aria-hidden={face !== 'finding'}>
          <p className={s.meta}>
            <span>{HERO_FINDING.category}</span>
            <span className={s.sev}>{HERO_FINDING.severity}</span>
          </p>
          <p className={s.head}>{HERO_FINDING.headline}</p>
          <p className={`mono ${s.measure}`}>{HERO_FINDING.measure}</p>
          <p className={s.also}>
            Corroborated by a second check: {HERO_FINDING.alsoFlagged.toLowerCase()}
          </p>
        </div>

        <div className={s.face} data-active={face === 'fix'} aria-hidden={face !== 'fix'}>
          <p className={s.meta}>
            <span>On the {HERO_FIX.target.toLowerCase()}</span>
            <span className={s.device}>{HERO_FIX.device}</span>
          </p>
          <ol className={s.steps}>
            {HERO_FIX.steps.map((step, i) => (
              <li key={step} className={`mono ${s.step}`}>
                <span className={s.stepNo} aria-hidden="true">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className={s.outcome}>
            <span className={s.outcomeLabel}>Expected result</span> {HERO_FIX.outcome}
          </p>
        </div>
      </div>

      <div className={s.progress} aria-hidden="true">
        <span key={face} className={s.bar} data-running={running} />
      </div>
    </div>
  );
}
