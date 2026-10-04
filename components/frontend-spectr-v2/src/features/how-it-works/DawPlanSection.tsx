// "Take it back to your DAW" on /trust/how-its-built: the plan you leave with.
// Shows an example session where stems and the Ableton project were uploaded,
// so fixes land on the producer's own tracks as well as the master:
//   - per-track chains + plan notes: MADE-UP example values (example-session.ts)
//   - the master lane: the demo track's real Coach Mix chain (daw-chain.ts)
//   - the plan file: the app's own DAW Plan export generator run on the example
//     moves, so its format can't drift from the real export.
import { EqDevice } from '../landing/EqDevice';
import { DEMO_CHAIN, DEMO_DROPPED, DEMO_EQ_BANDS } from './daw-chain';
import type { ChainDevice } from './daw-chain';
import { buildExamplePlan, EXAMPLE_NOTES, EXAMPLE_SONG, EXAMPLE_TRACKS } from './example-session';
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
  const plan = buildExamplePlan();
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
          A session with stems and an Ableton project: fixes land on your own tracks, not just the master
        </figcaption>
        <ul className={s.lanes} aria-label="Recommended chains, track by track">
          {EXAMPLE_TRACKS.map((t) => (
            <li key={t.track} className={s.lane} data-lane={t.role}>
              <div className={s.laneHead}>
                <span className={s.laneTrack}>{t.track}</span>
                <span className={`mono ${s.laneRole}`}>{t.role}</span>
                <span className={s.laneFinding}>{t.finding}</span>
              </div>
              <ol className={s.laneChain} aria-label={`Chain for ${t.track}, in signal order`}>
                {t.devices.map((d, i) => (
                  <li key={d.daw} className={s.laneDevice}>
                    <div className={s.devHead}>
                      <span className={`mono ${s.devNo}`} aria-hidden="true">{i + 1}</span>
                      <span className={s.devName}>{d.daw}</span>
                    </div>
                    <dl className={s.laneParams}>
                      {d.params.map((p) => (
                        <div key={p.label} className={s.laneParam}>
                          <dt>{p.label}</dt>
                          <dd className="mono">{p.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ol>
              <p className={s.why}>{t.why}</p>
            </li>
          ))}
        </ul>
      </figure>

      <figure className={s.figure}>
        <figcaption className={s.caption}>
          <span className="label">Master</span>
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

      <figure className={s.figure}>
        <figcaption className={s.caption}>
          <span className="label">Notes</span>
          Not everything is a device setting. Things to sort out before you upload again go in the plan too
        </figcaption>
        <ul className={s.notes}>
          {EXAMPLE_NOTES.map((n) => (
            <li key={n.title} className={s.note}>
              <span className={s.noteTitle}>{n.title}</span>
              <span className={s.noteText}>{n.note}</span>
            </li>
          ))}
        </ul>
      </figure>

      <figure className={s.excerpt}>
        <figcaption className={s.caption}>
          <span className="label">Your file</span>
          You walk away with an actual to-do list: the DAW Plan for this example, exactly as it exports
        </figcaption>
        <div className={s.file}>
          <div className={s.fileBar}>
            <span className={`mono ${s.fileName}`}>{plan.filename}</span>
            <span className={`mono ${s.fileKind}`}>Markdown</span>
          </div>
          <pre className={`mono ${s.pre}`} data-testid="daw-plan-excerpt">
            {plan.content}
          </pre>
        </div>
      </figure>

      <p className={s.then}>
        <strong>Then come back.</strong> When the moves are made, bounce the mix and upload it as the
        next version of the same song. SPECTR analyses it and keeps both versions side by side in your
        library, so you can see &mdash; and hear &mdash; how {EXAMPLE_SONG.name} is progressing from
        one bounce to the next.
      </p>
    </section>
  );
}
