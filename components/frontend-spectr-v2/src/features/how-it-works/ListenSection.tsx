// "Hear it in your browser" on /trust/how-its-built: a real screenshot of the
// Listen page on the demo track — two suggested fixes applied live to the rack
// (EQ + M/S Width on, chain "3 on"), the detail pane showing the applied fix.
import s from './listen-section.module.css';

const POINTS: readonly { title: string; body: string }[] = [
  {
    title: 'Every suggested fix, playable',
    body: 'Tick a fix in Actions and it’s applied live to the rack on your own track — no export, no plugin, no DAW.',
  },
  {
    title: 'Stack fixes into a preset',
    body: 'Combine as many fixes as you like; overlapping moves are merged, boosts and cuts are capped. Save the chain as a preset to come back to.',
  },
  {
    title: 'A/B before you commit',
    body: 'Flip Bypass to compare with the original, tweak any setting, and only take the moves you like back to your project.',
  },
];

export function ListenSection() {
  return (
    <div className={s.section}>
      <h2>Hear the fixes before you make them</h2>
      <p className={s.intro}>
        The Listen page plays your track through a rack in the browser. Every fix SPECTR suggests can be
        switched on and heard there, on its own or combined with others.
      </p>
      <ul className={s.points}>
        {POINTS.map((p) => (
          <li key={p.title} className={s.point}>
            <h3 className={s.pointTitle}>{p.title}</h3>
            <p className={s.pointText}>{p.body}</p>
          </li>
        ))}
      </ul>
      <figure className={s.figure}>
        <img
          className={s.shot}
          src="/images/listen-page.png"
          width={1519}
          height={818}
          loading="lazy"
          decoding="async"
          alt="The Listen page on the demo track: two suggested fixes ticked in the Actions list and applied live to the rack, with the EQ and M/S Width modules switched on and a Bypass switch for A/B."
        />
        <figcaption className={s.caption}>
          The demo track on the Listen page — two suggested fixes applied live: the EQ and M/S Width modules
          are on, and Bypass flips back to the original.
        </figcaption>
      </figure>
    </div>
  );
}
