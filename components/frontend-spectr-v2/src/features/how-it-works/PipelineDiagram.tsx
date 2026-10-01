// The hero figure on /trust/how-its-built: the whole analysis pipeline as
// one inline SVG. Two hand-placed layouts (wide left-to-right, narrow
// top-to-bottom) are both rendered; CSS shows exactly one, so neither ever
// has to be squeezed below legibility and the page never scrolls sideways.
import { Box, DiagramSvg, Edge, StageText } from './diagram-kit';
import { LEGEND, NARROW_LAYOUT, WIDE_LAYOUT } from './pipeline-diagram-layout';
import type { Layout } from './pipeline-diagram-layout';
import s from './diagram.module.css';

export const PIPELINE_TITLE = 'SPECTR analysis pipeline';

export const PIPELINE_DESC =
  'Your mix, plus optional stems, a reference track or an Ableton project, is converted to 44.1 kHz WAV ' +
  '(the Ableton project is parsed directly). Twelve measurement modules read it: loudness and peaks, tonal ' +
  'balance across seven bands, dynamics, stereo and mono, tempo and key, genre detection, genre scoring, ' +
  'the gap to a genre profile, frequency clashes, translation, and the optional reference comparison and ' +
  'Ableton project analysis. Audio stops there; only the numbers go on. Two lanes diagnose the track: a ' +
  'deterministic rule engine with genre-relative thresholds, and an AI triage step that reads the ' +
  'measurements and the rule findings and routes the track to AI specialists. A validator checks every ' +
  'finding against the measurements and sets its priority with a fixed formula. The result is a prioritised plan you can hear in the Listen rack and ask the coach about.';

const BOUNDARY_TEXT = 'AUDIO STOPS HERE · ONLY NUMBERS CROSS';

function Boundary({ b }: { b: Layout['boundary'] }) {
  const v = b.orient === 'v';
  const line = v ? { x1: b.at, x2: b.at, y1: b.from, y2: b.to } : { x1: b.from, x2: b.to, y1: b.at, y2: b.at };
  const t = v ? `translate(${b.at} ${b.labelAt}) rotate(-90)` : `translate(${b.labelAt} ${b.at})`;
  return (
    <g data-node="audio-boundary">
      <line {...line} className={s.boundary} />
      <g transform={t}>
        <rect x={-122} y={-8} width={244} height={15} rx={3} className={s.boundaryBg} />
        <text x={0} y={3.5} textAnchor="middle" className={s.boundaryText}>
          {BOUNDARY_TEXT}
        </text>
      </g>
    </g>
  );
}

function PipelineSvg({ layout, className }: { layout: Layout; className: string }) {
  return (
    <DiagramSvg
      width={layout.width}
      height={layout.height}
      title={PIPELINE_TITLE}
      desc={PIPELINE_DESC}
      className={className}
    >
      {(marker) => (
        <>
          {layout.stages.map((t) => (
            <StageText key={t.text} t={t} />
          ))}
          {layout.edges.map((e, i) => (
            <Edge key={i} e={e} marker={marker} />
          ))}
          <Boundary b={layout.boundary} />
          {layout.boxes.map((b) => (
            <Box key={b.id} b={b} />
          ))}
          {layout.notes.map((t) => (
            <text key={t.text} x={t.x} y={t.y} textAnchor="middle" className={s.note}>
              {t.text}
            </text>
          ))}
        </>
      )}
    </DiagramSvg>
  );
}

export function PipelineDiagram() {
  return (
    <figure className={`${s.figure} ${s.wide}`} data-testid="pipeline-diagram">
      <ul className={s.legend} aria-label="Legend">
        {LEGEND.map((l) => (
          <li key={l.tone} className={`${s.legendItem} ${s[l.tone]}`}>
            <span className={s.swatch} aria-hidden />
            {l.label}
          </li>
        ))}
        <li className={`${s.legendItem} ${s.optional}`}>
          <span className={s.swatch} aria-hidden />
          Optional
        </li>
      </ul>
      <PipelineSvg layout={WIDE_LAYOUT} className={s.layoutWide} />
      <PipelineSvg layout={NARROW_LAYOUT} className={s.layoutNarrow} />
      <figcaption className={s.caption}>
        Measurement is plain signal processing — no AI. The rule engine runs first; AI triage reads the
        measurements and the rule findings to pick the specialists. Nothing reaches you until the validator
        has checked it, and if the AI is unavailable the rule-engine findings still come through.
      </figcaption>
    </figure>
  );
}
