/* The hero card's third face: suggested fixes play on your own track in the
 * browser (the Listen rack), stacked into one preset you A/B before touching
 * your project. The spectrum + A/B thumb are a decorative CSS loop
 * (aria-hidden); the fixes, preset and copy are real text. */
import type { CSSProperties } from 'react';

import { HERO_LISTEN } from './hero-content';
import s from './HeroListenFace.module.css';

// Decorative spectrum, low → high. A = as uploaded (heavy sub, muddy low-mids,
// thin top); B = with the preset (sub tamed, low-mids cleared).
const BARS_A = [92, 88, 70, 52, 66, 72, 64, 50, 44, 38, 34, 30, 26, 22, 18, 14];
const BARS_B = [58, 66, 64, 56, 52, 50, 50, 48, 44, 40, 36, 32, 28, 24, 20, 16];

export function HeroListenFace() {
  return (
    <div className={s.rack}>
      <div className={s.head}>
        <span className={s.name}>Listen rack</span>
        <span className={s.where}>your track · in the browser</span>
      </div>

      <div className={s.stage} aria-hidden="true">
        <div className={s.ab}>
          <span className={s.thumb} />
          <span className={s.abA}>Original</span>
          <span className={s.abB}>With preset</span>
        </div>
        <div className={s.bars}>
          {BARS_A.map((a, i) => (
            <span
              key={i}
              className={s.bar}
              style={{ '--a': `${a}%`, '--b': `${BARS_B[i]}%`, animationDelay: `${i * 18}ms` } as CSSProperties}
            />
          ))}
        </div>
      </div>

      <ul className={s.fixes} aria-label="Suggested fixes in this preset">
        {HERO_LISTEN.fixes.map((f) => (
          <li key={f.headline} className={s.fix}>
            <span className={s.check} aria-hidden="true">✓</span>
            <span className={s.fixHead}>{f.headline}</span>
            <span className={`mono ${s.fixDoes}`}>
              {f.device} · {f.does}
            </span>
          </li>
        ))}
      </ul>

      <p className={s.preset}>
        <span className={s.presetLabel}>Preset</span>
        <span className={s.presetName}>{HERO_LISTEN.preset}</span>
        <span className={`mono ${s.presetCount}`}>{HERO_LISTEN.fixes.length} fixes → 1 chain</span>
      </p>
    </div>
  );
}
