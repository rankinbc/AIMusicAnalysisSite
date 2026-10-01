// "Take it back to your DAW" on /trust/how-its-built: the plan you leave with.
// The device row is the demo track's real Coach Mix chain (daw-chain.ts); the
// excerpt is produced by the app's own DAW Plan export generator from two of
// the demo findings shown in "What it finds", so it can't drift from the
// real export format.
import { EqDevice } from '../landing/EqDevice';
import { DEMO_CHAIN, DEMO_DROPPED, DEMO_EQ_BANDS } from './daw-chain';
import type { ChainDevice } from './daw-chain';
import { buildPlanExcerpt } from './daw-plan-excerpt';
import s from './daw-plan.module.css';

function DeviceCard({ d, n }: { d: ChainDevice; n: number }) {
  return (
    <li className={s.device} data-device={d.id}>
      <div className={s.devHead}>
        <span className={`mono ${s.devNo}`} aria-hidden="true">
          {n}
        </span>
        <span className={s.devName}>{d.daw}</span>
        <span className={`mono ${s.devModule}`}>rack: {d.module}</span>
      </div>
      {d.id === 'eq' ? (
        <div className={s.eqWrap}>
          <EqDevice device={d.daw} target="Master" bands={DEMO_EQ_BANDS} />
        </div>
      ) : null}
      <dl className={s.params}>
        {d.params.map((p) => (
          <div key={p.label} className={s.param}>
            <dt>{p.label}</dt>
            <dd className="mono">{p.value}</dd>
          </div>
        ))}
      </dl>
      <p className={s.why}>{d.why}</p>
    </li>
  );
}

export function DawPlanSection() {
  const excerpt = buildPlanExcerpt();
  return (
    <section className={s.section} aria-labelledby="hiw-daw-title" data-testid="daw-plan">
      <h2 id="hiw-daw-title">Take it back to your DAW</h2>
      <p>
        SPECTR doesn&rsquo;t leave you with a list. You finish with a plan to take back to your DAW: the
        fixes you pick, in signal-chain order, with the exact settings for each device. The DAW Plan
        exports it as Markdown or plain text, laid out move by move or grouped per device.
      </p>
      <p>
        Coach Mix goes one step further. It merges overlapping fixes into one chain &mdash; within
        do-no-harm limits: EQ boosts capped at +6&nbsp;dB, cuts at &minus;9&nbsp;dB, compression at
        4:1 &mdash; and you can audition the whole chain on your own track in the Listen rack before
        you touch your session.
      </p>

      <figure className={s.figure}>
        <figcaption className={s.caption}>
          <span className="label">Example</span>
          The final chain SPECTR built for the demo track (master bus)
        </figcaption>
        <ol className={s.chain} aria-label="Final device chain, in signal order">
          {DEMO_CHAIN.map((d, i) => (
            <DeviceCard key={d.id} d={d} n={i + 1} />
          ))}
        </ol>
        <div className={s.dropped} data-device="dropped">
          <span className={`mono ${s.droppedTag}`}>Left out</span>
          <span className={s.droppedName}>{DEMO_DROPPED.device}</span>
          <span className={s.droppedText}>{DEMO_DROPPED.rationale}</span>
        </div>
      </figure>

      <figure className={s.excerpt}>
        <figcaption className={s.caption}>
          <span className="label">Excerpt</span>
          The DAW Plan export (Markdown) for the first two findings above
        </figcaption>
        <pre className={`mono ${s.pre}`} data-testid="daw-plan-excerpt">
          {excerpt}
        </pre>
      </figure>
    </section>
  );
}
