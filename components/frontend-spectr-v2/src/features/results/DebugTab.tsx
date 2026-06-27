import { useMemo, useState } from 'react';

import type { PhaseResult } from '../../api/types';

interface DebugTabProps {
  phases: PhaseResult[] | undefined;
  /** The whole finalJson, for the raw payload view. */
  rawJson: unknown;
}

// What each phase consumes (for the Inputs panel). Mirrors the pipeline graph.
const PHASE_INPUTS: Record<number, string[]> = {
  1: ['audio · mix'],
  2: ['phase 1 · features'],
  3: ['phase 2 · genre', 'phase 1 · metrics'],
  4: ['audio · stems'],
  5: ['phase 1 · metrics', 'reference'],
  6: ['phase 2 · genre', 'phase 1 · metrics'],
  7: ['phase 1 · structure'],
  8: ['.als project'],
  9: ['phase 1 · metrics'],
};

const STATUS_TONE: Record<string, string> = {
  ok: 'var(--green)',
  skipped: 'var(--muted)',
  failed: 'var(--red)',
  error: 'var(--red)',
};

// The Debug tab: raw pipeline I/O. A node per phase (status-colored); click one
// to inspect its inputs + outputs (phase.data), plus the full raw payload.
export function DebugTab({ phases, rawJson }: DebugTabProps) {
  const list = useMemo(() => (phases ?? []).slice().sort((a, b) => a.phase - b.phase), [phases]);
  const [selected, setSelected] = useState<number>(
    () => list.find((p) => p.status === 'ok')?.phase ?? list[0]?.phase ?? 1,
  );
  const [copied, setCopied] = useState(false);

  if (list.length === 0) {
    return <div className="na">No phase data on this analysis.</div>;
  }

  const sel = list.find((p) => p.phase === selected) ?? list[0];
  const outputs = JSON.stringify(sel.data ?? {}, null, 2);
  const selStatus = sel.status ?? 'ok';
  const selTone = STATUS_TONE[selStatus] ?? 'var(--muted)';

  const copyOut = () => {
    if (navigator.clipboard) void navigator.clipboard.writeText(outputs).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div>
      <p className="dbg-intro">
        // raw pipeline I/O — finalJson.phases[]. Click a node for its inputs &amp; outputs.
      </p>

      <div className="dbg-nodes">
        {list.map((p) => {
          const status = p.status ?? 'ok';
          return (
            <button
              key={p.phase}
              type="button"
              className={`dbg-node${p.phase === selected ? ' sel' : ''}`}
              style={{ ['--tone' as string]: STATUS_TONE[status] ?? 'var(--muted)' }}
              onClick={() => setSelected(p.phase)}
            >
              <span className="mono dn-p">P{p.phase}</span>
              <span className="dn-n">{p.name ?? `Phase ${p.phase}`}</span>
              <span className="mono dn-s">{status}</span>
            </button>
          );
        })}
      </div>

      <div className="mono dbg-iohead">
        phase <span className="dn">P{sel.phase}</span> · {sel.name ?? `Phase ${sel.phase}`} ·{' '}
        <span style={{ color: selTone }}>{selStatus}</span>
      </div>

      <div className="dbg-io">
        <section className="json-block">
          <div className="json-hd">
            <span className="jl">Inputs</span>
          </div>
          <div className="json-inputs">
            {(PHASE_INPUTS[sel.phase] ?? ['—']).map((inp) => (
              <div key={inp} className="ji">
                → {inp}
              </div>
            ))}
            {sel.error && (
              <div className="ji" style={{ color: 'var(--red)' }}>
                error: {sel.error}
              </div>
            )}
          </div>
        </section>

        <section className="json-block">
          <div className="json-hd">
            <span className="jl">Outputs · phase.data</span>
            <button type="button" className="json-copy" onClick={copyOut}>
              {copied ? '✓ copied' : '⧉ copy'}
            </button>
          </div>
          <pre className="json-pre">{outputs}</pre>
        </section>
      </div>

      <details className="json-block">
        <summary
          className="json-hd"
          style={{ cursor: 'pointer', listStyle: 'none' }}
        >
          <span className="jl">Full raw finalJson</span>
        </summary>
        <pre className="json-pre">{JSON.stringify(rawJson, null, 2)}</pre>
      </details>
    </div>
  );
}
