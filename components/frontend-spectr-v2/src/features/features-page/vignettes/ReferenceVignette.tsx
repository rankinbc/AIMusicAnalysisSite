/* "Reference" vignette — modelled on the reference library card and the
 * report's Reference tab ("Compared to your reference"): the reference you
 * picked, then your mix against it metric by metric, bar length = how far
 * off. Made-up values (the sample track has no reference) — the page tags it
 * "illustration". Metric labels are the Reference tab's own. */
import { ILLUSTRATION_REFERENCE } from '../vignette-data';
import k from './kit.module.css';
import s from './reference-vignette.module.css';

const signed = (n: number, digits: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

export function ReferenceVignette() {
  const ref = ILLUSTRATION_REFERENCE;
  return (
    <div className={s.reference}>
      <div className={s.card}>
        <span className={s.cover} aria-hidden="true" />
        <div className={s.cardBody}>
          <div className={k.row}>
            <span className={s.cardTitle}>{ref.name}</span>
            <span className={s.analyzed}>analyzed</span>
          </div>
          <div className={k.row}>
            {ref.facts.map(([label, value]) => (
              <span key={label} className={k.chip}>{label} <b>{value}</b></span>
            ))}
          </div>
        </div>
      </div>

      <div className={k.panel}>
        <div className={k.panelHead}>
          <span className={k.panelTitle}>Compared to your reference</span>
          <span className={k.panelMeta}>how close you are to the track you&rsquo;re chasing</span>
        </div>
        <div className={k.panelBody}>
          <ul className={s.deltas}>
            {ref.deltas.map((d) => {
              const off = Math.min(1, Math.abs(d.delta) / d.scale);
              return (
                <li key={d.label} className={s.delta} data-far={off > 0.5}>
                  <span className={s.deltaLabel}>{d.label}</span>
                  <span className={s.deltaTrack} aria-hidden="true">
                    <span
                      className={s.deltaBar}
                      style={d.delta < 0
                        ? { right: '50%', width: `${off * 50}%` }
                        : { left: '50%', width: `${off * 50}%` }}
                    />
                  </span>
                  <span className={`mono ${s.deltaValue}`}>{signed(d.delta, d.digits)} {d.unit}</span>
                </li>
              );
            })}
          </ul>
          <p className={`mono ${s.legend}`}>
            <span>◂ less than the reference</span>
            <span>bar length = how far off</span>
            <span>more ▸</span>
          </p>
        </div>
      </div>

      <div className={k.row}>
        <span className={k.lbl}>Biggest gaps</span>
        {ref.gaps.map((g) => (
          <span key={g} className={k.chip} data-tone="orange">{g}</span>
        ))}
        <span className={`${k.btn} ${k.push}`} data-tone="cyan">See in Findings →</span>
      </div>
    </div>
  );
}
