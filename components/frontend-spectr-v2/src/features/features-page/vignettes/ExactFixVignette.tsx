/* "The fix" vignette — the report's fix detail for one real sample-report
 * finding, laid out as the app shows it: what it addresses, the suggested
 * fix as device cards with every parameter, the DAW instructions tab, and
 * the expected outcome. */
import { useState } from 'react';

import { HERO_FIX } from '../../landing/hero-content';
import { EVIDENCE_FINDING, FIX_DETAIL } from '../features-content';
import k from './kit.module.css';
import s from './vignettes.module.css';

export function ExactFixVignette() {
  const [tab, setTab] = useState<'fix' | 'daw'>('fix');
  return (
    <div className={s.detail}>
      <div className={k.row}>
        <span className={k.sev}>{FIX_DETAIL.severity}</span>
        <span className={k.cat}>{FIX_DETAIL.category}</span>
        <span className={k.lbl}>Addresses finding</span>
      </div>
      <span className={k.link}>{FIX_DETAIL.headline}</span>

      <div className={k.row}>
        <span className={k.lbl} data-tone="cyan">The fix</span>
        <span className={k.lbl}>
          Suggested fix · {EVIDENCE_FINDING.confidencePct}% conf · {HERO_FIX.target.toLowerCase()}
        </span>
      </div>

      <div className={k.tabs} role="group" aria-label="Fix view">
        <button type="button" className={k.tab} aria-pressed={tab === 'fix'} onClick={() => setTab('fix')}>
          Applicable fix
        </button>
        <button type="button" className={k.tab} aria-pressed={tab === 'daw'} onClick={() => setTab('daw')}>
          Quick DAW instructions
        </button>
      </div>

      {tab === 'fix' ? (
        <div className={k.rack}>
          <div className={k.row}>
            <span className={k.lbl}>Suggested fix</span>
            <span className={k.chip} data-tone="cyan">{HERO_FIX.target}</span>
            <span className={`${k.btn} ${k.push}`}>+ Add to fix rack</span>
          </div>
          <div className={k.devices}>
            {FIX_DETAIL.ops.map((op) => (
              <div key={op.type} className={k.device}>
                <div className={k.deviceHead}>
                  <span className={k.deviceIcon} aria-hidden="true">≋</span>
                  {op.type}
                </div>
                <dl className={k.deviceParams}>
                  {op.params.map(([key, value]) => (
                    <div key={key} className={s.paramRow}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={k.rack}>
          <span className={k.lbl}>In your project · {HERO_FIX.device}</span>
          <ol className={s.steps}>
            {HERO_FIX.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      <div className={k.box} data-kind="outcome">
        <span className={k.lbl} data-tone="cyan">+ Expected outcome</span>
        <p className={k.text}>{HERO_FIX.outcome}</p>
      </div>

      <div className={k.row}>
        <span className={k.btn}>✓ Mark applied</span>
        <span className={`${k.btn} ${k.push}`}>Rate this suggestion</span>
      </div>
    </div>
  );
}
