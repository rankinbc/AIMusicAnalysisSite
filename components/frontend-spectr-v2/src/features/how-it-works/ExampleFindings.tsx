// "What it finds — and what it tells you to do": four findings from SPECTR's
// real analysis of the demo track, each shown problem → evidence → fix.
// All content comes from the generated landing fixture via examples-model.
import type { EvidenceView, ExampleView } from './examples-model';
import { EXAMPLE_GENRE, buildExamples } from './examples-model';
import s from './examples.module.css';

const EXAMPLES = buildExamples();

function pct(v: number, b: EvidenceView['bar']): number {
  return ((v - b.min) / (b.max - b.min)) * 100;
}

/** Healthy zone + measured marker, scaled from the real numbers. */
function RangeBar({ row }: { row: EvidenceView }) {
  const b = row.bar;
  const lo = pct(b.lo, b);
  const hi = pct(b.hi, b);
  return (
    <div className={s.bar} aria-hidden>
      <span className={s.zone} style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
      <span className={s.marker} data-out={row.out} style={{ left: `${pct(b.value, b)}%` }} />
    </div>
  );
}

function Evidence({ ex }: { ex: ExampleView }) {
  if (ex.evidence.length === 0) return null;
  const expectedHead = ex.isRule ? 'Rule passes' : `Expected${EXAMPLE_GENRE ? ` (${EXAMPLE_GENRE})` : ''}`;
  return (
    <table className={s.ev}>
      <thead>
        <tr>
          <th scope="col">Measurement</th>
          <th scope="col" className={s.num}>
            Value
          </th>
          <th scope="col" className={s.num}>
            {expectedHead}
          </th>
        </tr>
      </thead>
      <tbody>
        {ex.evidence.map((r) => (
          <tr key={r.label} data-testid="example-evidence">
            <td>
              <span className={s.evLabel}>{r.label}</span>
              <RangeBar row={r} />
            </td>
            <td className={`mono ${s.num} ${s.measured}`} data-out={r.out}>
              {r.measured}
            </td>
            <td className={`mono ${s.num} ${s.expected}`}>{r.expected}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExampleCard({ ex }: { ex: ExampleView }) {
  return (
    <article className={`card ${s.card}`} data-testid="example-card" data-example={ex.id} data-sev={ex.verdict.severity}>
      <div className={s.problem}>
        <div className={`mono ${s.meta}`}>
          <span className={s.theme}>{ex.theme}</span>
          <span className={s.sev}>
            <span className={s.sevDot} aria-hidden />
            {ex.severity}
          </span>
          <span className={s.lane} data-lane={ex.isRule ? 'rule' : 'ai'}>
            {ex.isRule ? 'Rule engine · no AI' : `AI specialist · ${ex.raisedBy}`}
          </span>
        </div>
        <h3 className={s.headline}>{ex.verdict.headline}</h3>
        <Evidence ex={ex} />
        {ex.why && (
          <p className={s.why}>
            <span className={`mono ${s.sub}`}>Why it matters</span>
            {ex.why}
          </p>
        )}
        {ex.merged.length > 0 && (
          <p className={`mono ${s.note}`}>
            Merged with a related finding: {ex.merged.map((m) => `“${m}”`).join(', ')}
          </p>
        )}
        {ex.suspected && (
          <p className={`mono ${s.note}`}>
            This rule&rsquo;s threshold is provisional until it&rsquo;s calibrated on measured reference data.
          </p>
        )}
      </div>

      <div className={s.fix}>
        <div className={s.fixHead}>
          <span className={`mono ${s.sub}`}>The fix</span>
          <span className={`mono ${s.target}`}>on {ex.target}</span>
        </div>
        <ol className={s.chain} data-testid="example-fix">
          {ex.steps.map((st, i) => (
            <li key={i} className={`mono ${s.op}`}>
              {st}
            </li>
          ))}
        </ol>
        {ex.device && <p className={`mono ${s.device}`}>In Ableton: {ex.device}</p>}
        {ex.outcome && (
          <p className={s.outcome}>
            <span className={`mono ${s.sub}`}>Expected result</span>
            {ex.outcome}
          </p>
        )}
        {ex.sameMoveBy && (
          <p className={`mono ${s.agree}`}>
            {ex.isRule ? `The ${ex.sameMoveBy} specialist` : 'The rule engine'} suggested the same move.
          </p>
        )}
        <p className={`mono ${s.priority}`}>Priority {ex.priority} · set by the fixed formula</p>
      </div>
    </article>
  );
}

export function ExampleFindings() {
  return (
    <div className={s.wrap} data-testid="example-findings">
      <div className={s.list}>
        {EXAMPLES.map((ex) => (
          <ExampleCard key={ex.id} ex={ex} />
        ))}
      </div>
      <p className={`mono ${s.credit}`}>
        Examples from SPECTR&rsquo;s analysis of the demo track &ldquo;Magnetic Fields&rdquo; by Artifact303
        (1:14 excerpt), used only as a demo.
      </p>
    </div>
  );
}
