import { useMemo } from 'react';

import type { VerdictDto } from '../../api/types';
import { severityColor, severityLabel } from './helpers/severity';
import {
  type ProblemNode,
  type Tier,
  TIER_LABEL,
  faultCount,
  formatWhere,
  groupProblems,
} from './problems-helpers';
import type { SongHeaderInputs } from './SongHeader';
import s from './ProblemsTab.module.css';

interface ProblemsTabProps {
  verdicts: VerdictDto[];
  inputs: SongHeaderInputs;
  /** Jump to the Actions tab to act on a fix. */
  onGoToActions: () => void;
}

const KIND_BADGE: Record<string, { label: string; cls: string } | null> = {
  fault: null,
  observation: { label: 'FYI', cls: 'fyi' },
  integrity: { label: 'Data', cls: 'data' },
};

const UNLOCK_COPY: Record<Tier, string> = {
  audio_only: '',
  stems: 'Upload stems to surface per-element problems (masking, balance, clashes).',
  project_midi: 'Drop your .als to surface project problems (gain-staging, humanization, clutter).',
};

export function ProblemsTab({ verdicts, inputs, onGoToActions }: ProblemsTabProps) {
  const groups = useMemo(() => groupProblems(verdicts), [verdicts]);
  const faults = faultCount(verdicts);
  const present: Record<Tier, boolean> = {
    audio_only: true,
    stems: inputs.stems,
    project_midi: inputs.als,
  };

  return (
    <div className={s.tab}>
      {faults === 0 && (
        <div className={`card ${s.allClear}`}>
          <span className={s.clearIc}>✓</span>
          <div>
            <div className={s.clearTitle}>No faults flagged</div>
            <div className={s.sub}>Nothing in the measured analysis needs fixing. Wins and notes are below.</div>
          </div>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.tier} className={s.section}>
          <header className={s.sectionHead}>
            <span className={s.sectionTitle}>{TIER_LABEL[g.tier]}</span>
            {g.nodes.length > 0 && <span className={s.sectionCount}>{g.nodes.length}</span>}
          </header>

          {g.nodes.length > 0 ? (
            g.nodes.map((node) => (
              <ProblemCard key={node.problem.id} node={node} onGoToActions={onGoToActions} />
            ))
          ) : present[g.tier] ? (
            <div className={s.tierClean}>✓ Nothing flagged from your {g.tier === 'audio_only' ? 'mix' : g.tier === 'stems' ? 'stems' : 'project'}.</div>
          ) : (
            <button type="button" className={`card ${s.unlock}`} onClick={onGoToActions}>
              <span className={s.unlockIc}>＋</span>
              <span className={s.sub}>{UNLOCK_COPY[g.tier]}</span>
            </button>
          )}
        </section>
      ))}
    </div>
  );
}

function ProblemCard({ node, onGoToActions }: { node: ProblemNode; onGoToActions: () => void }) {
  const { problem: p, children } = node;
  const color = severityColor(p.severity);
  const kindBadge = KIND_BADGE[p.kind];
  const whereLabel = formatWhere(p.where);

  return (
    <div
      className={s.card}
      data-suspected={p.suspected || undefined}
      style={{ ['--sev' as string]: color }}
    >
      <div className={s.cardHead}>
        <span className={s.sevDot} />
        <span className={s.headline}>{p.headline}</span>
        <span className={s.badges}>
          {kindBadge && <span className={`${s.badge} ${s[kindBadge.cls]}`}>{kindBadge.label}</span>}
          <span className={`${s.badge} ${p.source === 'llm_identifier' ? s.ai : s.measured}`}>
            {p.source === 'llm_identifier' ? 'AI' : 'Measured'}
          </span>
          {p.suspected && <span className={`${s.badge} ${s.unverified}`}>Unverified</span>}
        </span>
      </div>

      <div className={s.cardMeta}>
        <span className={s.sevLabel} style={{ color }}>{severityLabel(p.severity)}</span>
        <span className={s.chip}>{p.category.replace(/_/g, ' ')}</span>
        <span className={`mono ${s.dim}`}>P{p.priorityScore}</span>
        <span className={`mono ${s.dim}`}>{Math.round(p.confidence * 100)}% conf</span>
        {whereLabel && <span className={s.whereChip}>◍ {whereLabel}</span>}
      </div>

      {p.metricLine && <div className={`mono ${s.metric}`}>{p.metricLine}</div>}

      <div className={s.cardFoot}>
        {p.fixable ? (
          <button type="button" className="btn ghost sm" onClick={onGoToActions}>
            Fix in Actions →
          </button>
        ) : (
          <span className={s.noFix}>no auto-fix</span>
        )}
        {p.whyItMatters && (
          <details className={s.why}>
            <summary>why</summary>
            <p>{p.whyItMatters}</p>
          </details>
        )}
      </div>

      {children.length > 0 && (
        <div className={s.children}>
          {children.map((c) => (
            <div key={c.id} className={s.child} style={{ ['--sev' as string]: severityColor(c.severity) }}>
              <span className={s.sevDot} />
              <span className={s.childHeadline}>{c.headline}</span>
              <span className={`${s.badge} ${c.source === 'llm_identifier' ? s.ai : s.measured}`}>
                {c.source === 'llm_identifier' ? 'AI' : 'Measured'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
