import { useState } from 'react';
import type { CSSProperties } from 'react';

import type { FeedbackKind, VerdictDspOp, VerdictDto } from '../../api/types';
import { specialistGroup, groupColor } from './helpers/specialists';
import { severityColor, severityLabel } from './helpers/severity';
import { MiniBot } from './TranceBot';
import s from './VerdictCard.module.css';

interface VerdictCardProps {
  verdict: VerdictDto;
  rank?: number;
  onDismiss: (id: string) => void;
  onApply: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackKind) => void;
}

export function VerdictCard({ verdict, rank, onDismiss, onApply, onFeedback }: VerdictCardProps) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { userState } = verdict;
  const isFailMarker = verdict.headline === 'Specialist failed';

  const sevColor = severityColor(verdict.severity);
  const sevTint = sevColor.replace(')', ', 0.04)').replace('var(', 'color-mix(in srgb, var(');
  const sevTintStrong = sevColor.replace(')', ', 0.1)').replace('var(', 'color-mix(in srgb, var(');

  const group = specialistGroup(verdict.specialist);
  const personaColor = group ? groupColor(group) : 'var(--muted)';

  const impact = impactTag(verdict.priorityScore);
  const confidencePct = Math.round((verdict.confidence ?? 0) * 100);

  // Compose CSS custom props for the sev-driven gradient + accents.
  const cardStyle: CSSProperties = {
    ['--sev-color' as string]: sevColor,
    ['--sev-tint' as string]: sevTint,
    ['--sev-tint-strong' as string]: sevTintStrong,
  };

  const personaStyle: CSSProperties = {
    ['--persona-color' as string]: personaColor,
    ['--persona-bg' as string]: `${personaColor}10`,
    ['--persona-border' as string]: `${personaColor}40`,
  };

  return (
    <article
      className={s.card}
      style={cardStyle}
      data-dismissed={userState.dismissed || undefined}
      data-applied={userState.applied || undefined}
      data-failed={isFailMarker || undefined}
    >
      <div className={s.severityStrip} />
      <div className={s.body}>
        {rank != null && (
          <div className={s.atmosphericNumeral}>{String(rank).padStart(2, '0')}</div>
        )}

        <header className={s.header}>
          <span className={s.personaChip} style={personaStyle}>
            <MiniBot size={18} color={personaColor.startsWith('var') ? '#00e5b0' : personaColor} />
            {group ?? 'OTHER'}
          </span>
          {rank != null && (
            <span className={s.findingNum}>Finding #{String(rank).padStart(2, '0')}</span>
          )}
          <span className={s.sevPill} style={{ color: sevColor }}>
            {severityLabel(verdict.severity)}
          </span>
          <span
            className={s.impactTag}
            style={{ color: impact.color }}
            title={`Priority score: ${verdict.priorityScore}`}
          >
            {impact.glyph} {impact.label}
          </span>
          <span className={s.confidence}>
            confidence
            <span className={s.confidenceBar}>
              <div style={{ width: `${confidencePct}%` }} />
            </span>
            {confidencePct}%
          </span>
        </header>

        <h4 className={s.headline}>{verdict.headline}</h4>

        {verdict.summary && <p className={s.summary}>{verdict.summary}</p>}
        {verdict.body && verdict.body !== verdict.summary && (
          <p className={s.bodyText}>{verdict.body}</p>
        )}
        {verdict.metricLine && <span className={s.metricLine}>{verdict.metricLine}</span>}
        {verdict.whyItMatters && (
          <p className={s.why}>
            <span className={s.whyLabel}>Why this matters:</span> {verdict.whyItMatters}
          </p>
        )}

        {verdict.fix?.dsp_chain && verdict.fix.dsp_chain.length > 0 && (
          <div className={s.fix}>
            <div className={s.fixHeader}>
              <span className={s.fixTitle}>
                <span style={{ color: 'var(--cyan)' }}>◆</span> The Fix
              </span>
              {verdict.presetName && (
                <span className="pill cyan">preset · {verdict.presetName}</span>
              )}
            </div>
            <ol className={s.fixSteps}>
              {verdict.fix.dsp_chain.map((op, i) => (
                <li key={i} className={s.fixStep}>
                  <FixStep op={op} />
                </li>
              ))}
            </ol>
            {verdict.fix.expected_outcome && (
              <p className={s.outcome}>{verdict.fix.expected_outcome}</p>
            )}
          </div>
        )}

        {!isFailMarker && (
          <div className={s.actions}>
            <button
              type="button"
              className="btn primary sm"
              onClick={() => onApply(verdict.id)}
              disabled={userState.applied}
            >
              {userState.applied ? '✓ Applied' : '✦ Mark applied'}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => onDismiss(verdict.id)}
              disabled={userState.dismissed}
            >
              {userState.dismissed ? 'Dismissed' : 'Dismiss'}
            </button>

            <div className={s.feedbackGroup}>
              <span className={s.feedbackLabel}>helpful?</span>
              {feedbackOpen ? (
                <>
                  <button
                    type="button"
                    className={s.feedbackBtn}
                    onClick={() => {
                      onFeedback(verdict.id, 'helpful');
                      setFeedbackOpen(false);
                    }}
                    data-state={userState.feedback === 'helpful' ? 'on' : undefined}
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    className={s.feedbackBtn}
                    onClick={() => {
                      onFeedback(verdict.id, 'wrong');
                      setFeedbackOpen(false);
                    }}
                    data-state={userState.feedback === 'wrong' ? 'on' : undefined}
                  >
                    👎
                  </button>
                  <button
                    type="button"
                    className={s.feedbackBtn}
                    onClick={() => {
                      onFeedback(verdict.id, 'unclear');
                      setFeedbackOpen(false);
                    }}
                    data-state={userState.feedback === 'unclear' ? 'on' : undefined}
                  >
                    ❓
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={s.feedbackBtn}
                  onClick={() => setFeedbackOpen(true)}
                  data-state={userState.feedback ? 'on' : undefined}
                >
                  {userState.feedback ? userState.feedback : '👍 👎 ❓'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function impactTag(priorityScore: number): { glyph: string; label: string; color: string } {
  if (priorityScore >= 75) return { glyph: '↑↑', label: 'HIGH IMPACT', color: 'var(--orange)' };
  if (priorityScore >= 45) return { glyph: '↑', label: 'MED IMPACT', color: 'var(--yellow)' };
  return { glyph: '·', label: 'LOW IMPACT', color: 'var(--muted)' };
}

function FixStep({ op }: { op: VerdictDspOp }) {
  const params = Object.entries(op.params)
    .map(([k, v]) => `${k}=${formatParam(v)}`)
    .join(', ');
  return (
    <>
      <span className={`mono ${s.fixType}`}>{op.type}</span>
      {params && <span className={`mono ${s.fixParams}`}>{params}</span>}
    </>
  );
}

function formatParam(v: unknown): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (v === null || v === undefined) return '—';
  return String(v);
}
