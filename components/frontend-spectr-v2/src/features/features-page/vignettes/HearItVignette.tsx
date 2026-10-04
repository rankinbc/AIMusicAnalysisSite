/* "Hear it" vignette — a working miniature of the Listen page: the rack bar
 * (modules on + BYPASS), module tiles, and the "fixes from analysis" list
 * whose "Apply live" buttons switch each of the sample report's fixes into
 * the rack. The curve is the computed response of whatever is applied
 * (eq-response.ts); the spectrum bars are a decorative sketch of the mix
 * moved by that same curve. Until the visitor touches it, Bypass flips on a
 * slow loop (never under prefers-reduced-motion). No audio plays here. */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import { responseDb } from '../../landing/eq-response';
import { useRevealOnScroll } from '../../landing/useRevealOnScroll';
import { HEAR_FIXES } from '../features-content';
import k from './kit.module.css';
import s from './vignettes.module.css';

const W = 320;
const H = 96;
const F_MIN = 20;
const F_MAX = 20000;
const DB_TOP = 6;
const DB_BOTTOM = -14;
const AXIS: [number, string][] = [[20, '20'], [100, '100'], [1000, '1k'], [10000, '10k']];
const LOOP_MS = 2600;
/** The Listen rack has 13 modules; every fix here is an EQ move. */
const RACK_MODULES = 13;
const IDLE_TILES = ['Compressor', 'Saturator', 'Limiter'];

// Decorative spectrum of the uploaded mix, low → high (heavy sub, thin top).
const BASE = [94, 90, 84, 74, 70, 66, 60, 56, 52, 48, 44, 40, 34, 28, 20, 14, 10, 8];
const barHz = (i: number) => F_MIN * (F_MAX / F_MIN) ** ((i + 0.5) / BASE.length);

const x = (f: number) => (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * W;
const y = (db: number) => ((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOTTOM)) * H;

export function HearItVignette() {
  const { ref, revealed } = useRevealOnScroll<HTMLDivElement>(0.4);
  const [on, setOn] = useState<boolean[]>(() => HEAR_FIXES.map(() => true));
  const [bypass, setBypass] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!revealed || touched) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = window.setInterval(() => setBypass((b) => !b), LOOP_MS);
    return () => window.clearInterval(t);
  }, [revealed, touched]);

  const applied = HEAR_FIXES.filter((_, i) => on[i]);
  const bands = useMemo(
    () => (bypass ? [] : HEAR_FIXES.filter((_, i) => on[i]).flatMap((f) => f.bands)),
    [on, bypass],
  );
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const f = F_MIN * (F_MAX / F_MIN) ** (i / 120);
      pts.push(`${x(f).toFixed(1)},${y(responseDb(bands, f)).toFixed(1)}`);
    }
    return `M${pts.join(' L')}`;
  }, [bands]);

  const active = applied.length;
  const eqOn = active > 0;
  const eqBands = applied.reduce((n, f) => n + f.bands.length, 0);
  const zeroY = y(0);

  return (
    <div ref={ref} className={s.listen} data-bypass={bypass}>
      <div className={k.row}>
        <span className={k.lbl} data-tone="cyan">Rack</span>
        <span className={`mono ${s.modulesOn}`}>{eqOn ? 1 : 0}/{RACK_MODULES} modules on</span>
        <button
          type="button"
          className={`${k.switch} ${k.push}`}
          aria-pressed={bypass}
          aria-label="Bypass"
          onClick={() => {
            setTouched(true);
            setBypass((b) => !b);
          }}
        >
          <span className={k.lbl}>Bypass</span>
          <span className={k.switchTrack} aria-hidden="true" />
        </button>
      </div>

      <div className={k.tiles} aria-hidden="true">
        <div className={k.tile} data-on={eqOn && !bypass}>
          <span className={k.tileName}>EQ</span>
          <span className={k.tilePower}>{eqOn ? 'ON' : 'OFF'}</span>
          <span className={k.tileSummary}>{eqOn ? `${eqBands} bands` : 'neutral'}</span>
        </div>
        {IDLE_TILES.map((name) => (
          <div key={name} className={k.tile}>
            <span className={k.tileName}>{name}</span>
            <span className={k.tilePower}>OFF</span>
            <span className={k.tileSummary}>neutral</span>
          </div>
        ))}
      </div>

      <div className={s.scope} aria-hidden="true">
        <div className={s.bars}>
          {BASE.map((base, i) => {
            const h = Math.max(4, Math.min(100, base + responseDb(bands, barHz(i)) * 3));
            return <span key={i} className={s.bar} style={{ '--h': `${h}%` } as CSSProperties} />;
          })}
        </div>
        <svg className={s.curveSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line className={s.zero} x1={0} x2={W} y1={zeroY} y2={zeroY} />
          <path className={s.curveFill} d={`${path} L${W},${zeroY} L0,${zeroY} Z`} />
          <path className={s.curve} d={path} />
        </svg>
        <div className={`mono ${s.axis}`}>
          {AXIS.map(([f, label]) => (
            <span key={f} style={{ left: `${(x(f) / W) * 100}%` }}>{label}</span>
          ))}
        </div>
      </div>
      <p className={s.state} aria-live="polite">
        {bypass || active === 0 ? 'Original mix' : `With ${active} ${active === 1 ? 'fix' : 'fixes'} applied`}
      </p>

      <div className={s.fixList}>
        <span className={k.lbl}>Fixes from analysis — toggle to compare</span>
        <ul className={s.toggles}>
          {HEAR_FIXES.map((f, i) => (
            <li key={f.headline} className={s.fixRow} data-on={Boolean(on[i])}>
              <span className={s.toggleHead}>{f.headline}</span>
              <span className={`mono ${s.toggleDoes}`}>{f.device} · {f.does}</span>
              <button
                type="button"
                className={k.btn}
                data-tone={on[i] ? 'solid' : 'cyan'}
                aria-pressed={Boolean(on[i])}
                aria-label={f.headline}
                onClick={() => {
                  setTouched(true);
                  setBypass(false);
                  setOn((prev) => prev.map((v, j) => (j === i ? !v : v)));
                }}
              >
                {on[i] ? 'Applied' : '+ Apply live'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
