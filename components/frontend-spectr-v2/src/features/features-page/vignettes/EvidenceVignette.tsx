/* "The finding" vignette — the report's finding detail for one real
 * sample-report finding, as the app lays it out: severity, source and
 * confidence chips, the headline, WHY IT MATTERS, THE DATA table (your value
 * against the expected range), and the hand-off to the fix. */
import { HERO_FINDING } from '../../landing/hero-content';
import { Coach } from '../../../ui/Coach';
import { EVIDENCE_FINDING, FIX_DETAIL } from '../features-content';
import k from './kit.module.css';
import s from './vignettes.module.css';

export function EvidenceVignette() {
  return (
    <div className={s.detail}>
      <div className={k.row}>
        <span className={k.sev}>{FIX_DETAIL.severity}</span>
        <span className={k.cat}>{FIX_DETAIL.category}</span>
        <span className={`${k.chip} ${k.push}`}>Source: <b>{EVIDENCE_FINDING.raisedBy}</b></span>
      </div>
      <div className={k.row}>
        <span className={k.chip} data-tone="orange">priority {EVIDENCE_FINDING.priority}</span>
        <span className={k.chip}>conf {EVIDENCE_FINDING.confidencePct}%</span>
        <span className={k.chip}>audio only</span>
      </div>
      <p className={k.headline}>{HERO_FINDING.headline}</p>

      <div className={k.box}>
        <span className={k.lbl} data-tone="violet">Why it matters</span>
        <p className={k.text}>{EVIDENCE_FINDING.why}</p>
      </div>

      <div className={k.box} data-kind="data">
        <span className={k.lbl}>The data</span>
        <div className={k.tbl} role="table" aria-label="Measured values against the expected range">
          <div className={s.tblRow} role="row">
            <span className={k.lbl} role="columnheader">Metric</span>
            <span className={k.lbl} role="columnheader">Yours</span>
            <span className={k.lbl} role="columnheader">Expected</span>
          </div>
          {EVIDENCE_FINDING.rows.map((r) => (
            <div key={r.label} className={s.tblRow} role="row">
              <span className={k.tblMetric} role="cell">{r.label}</span>
              <span className={k.tblYours} role="cell">{r.value.toFixed(1)}{r.unit}</span>
              <span className={k.tblExpected} role="cell">{r.range[0]} to {r.range[1]}{r.unit}</span>
            </div>
          ))}
        </div>
      </div>

      <p className={s.also}>
        <span className={k.lbl} data-tone="violet">Second check agrees</span> {HERO_FINDING.alsoFlagged}
      </p>

      <p className={s.fixAvailable}>✓ Applicable fix available</p>
      <div className={k.row}>
        <span className={k.btn}>
          <span aria-hidden="true"><Coach size={18} glow={false} /></span>
          Ask the coach about this
        </span>
        <span className={k.btn} data-tone="cyan">Show suggested fix →</span>
      </div>
    </div>
  );
}
