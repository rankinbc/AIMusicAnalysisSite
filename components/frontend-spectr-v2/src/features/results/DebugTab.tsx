import { useMemo, useState } from 'react';

import type { PhaseResult } from '../../api/types';
import { Icon } from './Icon';

interface DebugTabProps {
  phases: PhaseResult[] | undefined;
  /** The whole finalJson, for the raw payload view. */
  rawJson: unknown;
}

// Node layout in a 560×300 space (prototype AR_DBG_POS) — the pipeline diagram
// positions each phase node absolutely from these coordinates.
const DBG_POS: Record<number, { x: number; y: number }> = {
  4: { x: 70, y: 42 },
  9: { x: 196, y: 50 },
  3: { x: 330, y: 50 },
  1: { x: 70, y: 150 },
  2: { x: 196, y: 150 },
  5: { x: 330, y: 130 },
  6: { x: 330, y: 210 },
  7: { x: 460, y: 150 },
  8: { x: 70, y: 258 },
};

// Edges as [depPhase → phase] — drawn between node centers.
const DBG_EDGES: [number, number][] = [
  [1, 2],
  [1, 3],
  [2, 3],
  [1, 5],
  [1, 6],
  [2, 6],
  [1, 7],
  [1, 9],
];

// What each phase consumes (for the Inputs panel). Mirrors the pipeline graph.
const PHASE_INPUTS: Record<number, string[]> = {
  1: ['audio · mix'],
  2: ['audio · mix', 'phase 1 · features'],
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

function shortName(name: string): string {
  return name.replace(/ (Analysis|Advice|Detection|Comparison|Scoring|Separation & Clash)$/, '');
}

// The Debug tab: raw pipeline I/O. A positioned node per phase (status-colored);
// click one to inspect its inputs + outputs (phase.data), plus the full payload.
export function DebugTab({ phases, rawJson }: DebugTabProps) {
  const list = useMemo(() => (phases ?? []).slice().sort((a, b) => a.phase - b.phase), [phases]);
  const [selected, setSelected] = useState<number>(
    () => list.find((p) => p.status === 'ok')?.phase ?? list[0]?.phase ?? 1,
  );
  const [copied, setCopied] = useState(false);

  if (list.length === 0) {
    return (
      <div className="tabbody fade-up">
        <div className="na">
          <Icon name="info" size={13} />
          No phase data on this analysis.
        </div>
      </div>
    );
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

  const positioned = list.filter((p) => DBG_POS[p.phase]);
  const edges = DBG_EDGES.filter(([a, b]) => DBG_POS[a] && DBG_POS[b]);

  return (
    <div className="tabbody fade-up">
      <p className="dbg-intro">
        // raw pipeline I/O — finalJson.phases[]. Click a node for its inputs &amp; outputs.
      </p>

      <div className="dbg-diagram">
        <div className="dbg-graph" style={{ height: 300 }}>
          <svg
            viewBox="0 0 560 300"
            width="100%"
            height="300"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            preserveAspectRatio="xMidYMid meet"
          >
            {edges.map(([a, b], i) => {
              const pa = DBG_POS[a];
              const pb = DBG_POS[b];
              return (
                <line
                  key={i}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke="rgba(255,255,255,.12)"
                  strokeWidth="1.4"
                />
              );
            })}
          </svg>
          {positioned.map((p) => {
            const pos = DBG_POS[p.phase];
            const status = p.status ?? 'ok';
            return (
              <button
                key={p.phase}
                type="button"
                className={`dbg-node ${status}${p.phase === selected ? ' sel' : ''}`}
                style={{ left: `${(pos.x / 560) * 100}%`, top: pos.y }}
                onClick={() => setSelected(p.phase)}
              >
                <div className="dn-box">
                  <div className="dn-p">P{p.phase}</div>
                  <div className="dn-n">{shortName(p.name ?? `Phase ${p.phase}`)}</div>
                  <div className="dn-s">{status}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="dbg-iohead">
        phase <span className="dn">P{sel.phase}</span> · {sel.name ?? `Phase ${sel.phase}`} ·{' '}
        <span style={{ color: selTone }}>{selStatus}</span>
      </div>

      <div className="dbg-io">
        <section className="json-block">
          <div className="json-hd">
            <span className="jl">inputs</span>
          </div>
          <div style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(PHASE_INPUTS[sel.phase] ?? ['—']).map((inp) => (
              <div
                key={inp}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 11,
                  color: 'var(--text-2)',
                }}
              >
                <Icon name="arrow" size={12} />
                {inp}
              </div>
            ))}
            {sel.error && (
              <div className="mono" style={{ color: 'var(--red)', fontSize: 11 }}>
                error: {sel.error}
              </div>
            )}
          </div>
        </section>

        <section className="json-block">
          <div className="json-hd">
            <span className="jl">outputs · phase.data</span>
            <button type="button" className="json-copy" onClick={copyOut}>
              <Icon name={copied ? 'check' : 'copy'} size={11} />
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
          <pre className="json-pre" style={{ maxHeight: 220 }}>
            {outputs}
          </pre>
        </section>
      </div>

      <div className="dbg-iohead">full payload</div>
      <div className="json-block">
        <div className="json-hd">
          <span className="jl">GET /api/jobs/{'{id}'}/results → finalJson</span>
        </div>
        <pre className="json-pre" style={{ maxHeight: 360 }}>
          {JSON.stringify(rawJson, null, 2)}
        </pre>
      </div>
    </div>
  );
}
