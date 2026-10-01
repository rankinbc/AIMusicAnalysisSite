/* The hero's product hint: one real finding from the sample report, which
 * alternates with the fix SPECTR suggested for it — the "it doesn't just tell
 * you what's wrong, it helps you fix it" pitch in one card. Both faces are
 * always in the DOM (crawlers, tests, no layout jump); the inactive one is
 * aria-hidden. Auto-advances every CYCLE_MS, pauses on hover/focus, and never
 * auto-advances under prefers-reduced-motion (the tabs still switch it). */
import { useEffect, useState } from 'react';

import { EqDevice } from './EqDevice';
import { HERO_FINDING, HERO_FIX } from './hero-content';
import s from './HeroFindingCard.module.css';

const CYCLE_MS = 4500;

// Evidence bar scale (dB): wide enough to show both rows' value and target.
const EV_MIN = -36;
const EV_MAX = -12;
const evPct = (db: number) => ((Math.min(EV_MAX, Math.max(EV_MIN, db)) - EV_MIN) / (EV_MAX - EV_MIN)) * 100;
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
          <ul className={s.evidence} aria-label="Measured vs the genre's expected range">
            {HERO_FINDING.evidence.map((e) => (
              <li key={e.label} className={s.evRow}>
                <span className={s.evLabel}>{e.label}</span>
                <span className={s.evTrack} aria-hidden="true">
                  <span
                    className={s.evZone}
                    style={{ left: `${evPct(e.range[0])}%`, width: `${evPct(e.range[1]) - evPct(e.range[0])}%` }}
                  />
                  <span className={s.evDot} style={{ left: `${evPct(e.value)}%` }} />
                </span>
                <span className={`mono ${s.evValue}`}>
                  {e.value.toFixed(1)} dB <span className={s.evExpected}>vs {e.range[0]}…{e.range[1]}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className={s.also}>
            Corroborated by a second check: {HERO_FINDING.alsoFlagged.toLowerCase()}
          </p>
        </div>

        <div className={s.face} data-active={face === 'fix'} aria-hidden={face !== 'fix'}>
          <EqDevice device={HERO_FIX.device} target={`on the ${HERO_FIX.target.toLowerCase()}`} bands={HERO_FIX.bands} />
          {/* Screen readers + crawlers get the fix as plain steps too. */}
          <ol className={s.srOnly}>
            {HERO_FIX.steps.map((step) => (
              <li key={step}>{step}</li>
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
