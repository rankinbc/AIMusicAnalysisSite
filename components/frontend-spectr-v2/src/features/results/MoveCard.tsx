import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { type Move, type MoveSev } from './move-model';
import { RackModules } from './RackModules';

interface MoveCardProps {
  move: Move;
  /** Unused in the redesign layout (kept for call-site compatibility). */
  rank?: number | undefined;
  /** Toggle the Move's plan membership (committed ⇄ suggested). */
  onToggleCommit: (move: Move) => void;
}

const SEV_VAR: Record<MoveSev, string> = {
  crit: 'var(--sev-critical)',
  warn: 'var(--sev-severe)',
  info: 'var(--sev-minor)',
  low: 'var(--sev-win)',
};

const SEV_LABEL: Record<MoveSev, string> = {
  crit: 'Critical',
  warn: 'Severe',
  info: 'Minor',
  low: 'Win',
};

/** Highlight measured tokens (−3 dB, 120 Hz, −14 LUFS, 8 ms, 62%) as params so
 *  the directive reads like the prototype WITHOUT inventing values. */
function highlightParams(text: string): ReactNode[] {
  const re = /(-?\d[\d.,]*\s?(?:dBTP|dB|LUFS|LU|kHz|Hz|ms|%))/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={key++} className="param">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Prototype "move" card: a problem kicker, the action title, the directive
// (params highlighted), and a foot with why/data/fix toggles + the Add-to-Listen
// rack toggle. Styling lives in redesign.css (scoped `.move`).
export function MoveCard({ move, onToggleCommit }: MoveCardProps) {
  const [open, setOpen] = useState<null | 'why' | 'data' | 'fix'>(null);
  const toggle = (k: 'why' | 'data' | 'fix') => setOpen((o) => (o === k ? null : k));

  const added = move.status === 'committed';
  const isAi = !move.isRule;
  const directional = !move.hasParams;
  const metric = move.evidence.metric;
  const shortMetric = metric && metric.length <= 30 ? metric : null;
  const hasSteps = move.hasParams && move.steps.length > 0;
  const directiveText = move.hasParams ? move.directive : move.directional;

  const style: CSSProperties = { ['--sev' as string]: SEV_VAR[move.sev] };

  return (
    <div className="move" data-move-id={move.id} data-added={added ? 'true' : 'false'} style={style}>
      <div className="move-main">
        <div className="move-prob">
          <span className="mp-dot" />
          <span className="mp-lab">Fix</span>
          {move.scope && <span className="mp-head">{move.scope}</span>}
          <span className="mp-spacer" />
          {shortMetric && <span className="mp-metric">{shortMetric}</span>}
          <span className="mp-sev">{SEV_LABEL[move.sev]}</span>
        </div>

        <div className="move-top">
          <div className="move-title">{move.title}</div>
        </div>

        <div className={`directive${directional ? ' directional' : ''}`}>
          <span className="arrow" aria-hidden>
            →
          </span>
          <div className="d-text">
            {!directional && move.scope && (
              <>
                <span className="scope">{move.scope}</span> ·{' '}
              </>
            )}
            {highlightParams(directiveText)}
          </div>
        </div>

        <div className="move-foot">
          <span className="move-conf">
            <span className="cv">{Math.round(move.confidence * 100)}%</span> conf
          </span>
          <span className={`move-src${isAi ? ' ai' : ''}`}>{move.source}</span>
          <span className="spacer" />
          {move.why && (
            <button
              type="button"
              className={`linkbtn${open === 'why' ? ' on' : ''}`}
              onClick={() => toggle('why')}
            >
              why <span className="chev">▾</span>
            </button>
          )}
          {metric && (
            <button
              type="button"
              className={`linkbtn${open === 'data' ? ' on' : ''}`}
              onClick={() => toggle('data')}
            >
              data <span className="chev">▾</span>
            </button>
          )}
          {hasSteps && (
            <button
              type="button"
              className={`linkbtn${open === 'fix' ? ' on' : ''}`}
              onClick={() => toggle('fix')}
            >
              suggested fix <span className="chev">▾</span>
            </button>
          )}
          <button
            type="button"
            className={`rack-toggle${added ? ' on' : ''}`}
            onClick={() => onToggleCommit(move)}
            title="Queue this fix for the Listen page"
          >
            {added ? '✓ Added' : '+ Add'}
          </button>
        </div>
      </div>

      {open && (
        <div className="move-expand fade-up">
          {open === 'why' && move.why && (
            <div className="why-callout">
              <span className="wq" aria-hidden>
                ?
              </span>
              <div className="wbody">{move.why}</div>
            </div>
          )}
          {open === 'data' && metric && (
            <div className="evidence">
              <div className="evidence-hd">
                <span className="lab">The data</span>
                {move.evidence.chartType && <span className="metric">{move.evidence.chartType}</span>}
              </div>
              <div className="ev-readout">
                <span className="ev-metric">{metric}</span>
                <div className="ev-meta">
                  <span>measured · {move.source}</span>
                </div>
                <div className="ev-conf">
                  <div className="ecl">
                    <span>confidence</span>
                    <span>{Math.round(move.confidence * 100)}%</span>
                  </div>
                  <div className="ecbar">
                    <div className="ecfill" style={{ width: `${Math.round(move.confidence * 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}
          {open === 'fix' && hasSteps && (
            <div>
              <div className="pb-h">Rack settings</div>
              <RackModules steps={move.steps} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
