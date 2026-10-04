/* "Learn" vignette — how SPECTR teaches, in the report's own blocks: a
 * stem-clash finding (which two stems, which band, how badly), WHY IT
 * MATTERS, why the suggested fix is the right one, the product's own glossary
 * definitions for the jargon involved (tap a term), and the Coach's Teach
 * mode. The finding is a made-up example — the page tags it "illustration". */
import { useState } from 'react';

import { GLOSSARY } from '../../results/glossary-terms';
import { Coach } from '../../../ui/Coach';
import { COACH_MODES, LEARN_FINDING } from '../features-content';
import k from './kit.module.css';
import s from './vignettes.module.css';

const DEFINITIONS = new Map(GLOSSARY);

// Decorative low-end spectrum of the two stems (log frequency, 30–400 Hz).
const W = 320;
const H = 84;
const F_MIN = 30;
const F_MAX = 400;
const TICKS = [40, 60, 120, 250];
const x = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * W;

/** A smooth hump centred on `peakHz`, `widthOct` octaves wide, `level` 0–1 tall. */
function hump(peakHz: number, widthOct: number, level: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 64; i++) {
    const f = F_MIN * (F_MAX / F_MIN) ** (i / 64);
    const oct = Math.log2(f / peakHz);
    const yv = H - level * H * Math.exp(-(oct * oct) / (2 * widthOct * widthOct));
    pts.push(`${x(f).toFixed(1)},${yv.toFixed(1)}`);
  }
  return `M0,${H} L${pts.join(' L')} L${W},${H} Z`;
}

const KICK = hump(68, 0.42, 0.92);
const BASS = hump(98, 0.62, 0.8);

export function LearnVignette() {
  const [term, setTerm] = useState<string>(LEARN_FINDING.terms[0]);
  const [lo, hi] = LEARN_FINDING.band;

  return (
    <div className={s.detail}>
      <div className={k.row}>
        <span className={k.sev} data-sev={LEARN_FINDING.severity}>{LEARN_FINDING.severity}</span>
        <span className={k.cat}>{LEARN_FINDING.category}</span>
        <span className={`${k.chip} ${k.push}`}>stems</span>
      </div>
      <p className={k.headline}>{LEARN_FINDING.headline}</p>

      <div className={s.clash}>
        <svg className={s.clashSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <rect className={s.clashBand} x={x(lo)} y={0} width={x(hi) - x(lo)} height={H} />
          <path className={s.clashKick} d={KICK} />
          <path className={s.clashBass} d={BASS} />
        </svg>
        <div className={`mono ${s.clashAxis}`} aria-hidden="true">
          {TICKS.map((f) => (
            <span key={f} style={{ left: `${(x(f) / W) * 100}%` }}>{f}</span>
          ))}
        </div>
        <div className={k.row}>
          <span className={s.stemKick}>{LEARN_FINDING.stems[0]}</span>
          <span className={s.stemBass}>{LEARN_FINDING.stems[1]}</span>
          <span className={`${k.chip} ${k.push}`} data-tone="orange">
            overlap {LEARN_FINDING.overlap.toFixed(2)} · {LEARN_FINDING.tier}
          </span>
        </div>
      </div>

      <div className={k.box}>
        <span className={k.lbl} data-tone="violet">Why it matters</span>
        <p className={k.text}>{LEARN_FINDING.why}</p>
      </div>
      <div className={k.box} data-kind="outcome">
        <span className={k.lbl} data-tone="cyan">Why this fix · {LEARN_FINDING.fix}</span>
        <p className={k.text}>{LEARN_FINDING.fixWhy}</p>
      </div>

      <div className={s.terms} role="group" aria-label="Terms in this finding — choose one to see its definition">
        {LEARN_FINDING.terms.map((t) => (
          <button key={t} type="button" className={s.term} aria-pressed={term === t} onClick={() => setTerm(t)}>
            {t}
          </button>
        ))}
      </div>
      <p className={s.definition} aria-live="polite">
        <strong>{term}</strong> — {DEFINITIONS.get(term)}
      </p>

      <div className={`${k.row} ${s.modes}`}>
        <span className={k.btn}>
          <span aria-hidden="true"><Coach size={18} glow={false} /></span>
          Ask the coach about this
        </span>
        <span className={`${k.seg} ${k.push}`} role="img" aria-label="Coach mode: Teach">
          {COACH_MODES.map((m) => (
            <span key={m} className={k.segItem} data-on={m === 'Teach'}>{m}</span>
          ))}
        </span>
      </div>
    </div>
  );
}
