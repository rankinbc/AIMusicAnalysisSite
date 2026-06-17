import type { Phase7Data, Phase7Issue, Phase7SectionScore } from '../../api/types';
import s from './ArrangementTab.module.css';

interface ArrangementTabProps {
  phase7: Phase7Data | undefined;
}

// Map section-type slug → display color. Kept narrow on purpose; unknown
// types fall back to the neutral background.
const SECTION_COLOR: Record<string, string> = {
  intro: 'rgba(0, 229, 176, 0.08)',
  buildup: 'rgba(167, 139, 250, 0.10)',
  drop: 'rgba(251, 146, 60, 0.10)',
  chorus: 'rgba(251, 146, 60, 0.10)',
  breakdown: 'rgba(96, 165, 250, 0.10)',
  verse: 'rgba(96, 165, 250, 0.08)',
  bridge: 'rgba(96, 165, 250, 0.08)',
  outro: 'rgba(255, 255, 255, 0.04)',
};

// Severity → CSS tone. Phase 7 ArrangementIssue.severity uses `info` /
// `warning` / `critical`; map to our orange/red palette.
const SEVERITY_TONE: Record<string, { bg: string; border: string; glyph: string }> = {
  info: {
    bg: 'rgba(96, 165, 250, 0.04)',
    border: 'rgba(96, 165, 250, 0.2)',
    glyph: 'var(--blue, #60a5fa)',
  },
  warning: {
    bg: 'rgba(251, 146, 60, 0.04)',
    border: 'rgba(251, 146, 60, 0.2)',
    glyph: 'var(--orange)',
  },
  critical: {
    bg: 'rgba(244, 63, 94, 0.06)',
    border: 'rgba(244, 63, 94, 0.32)',
    glyph: 'var(--red)',
  },
};

export function ArrangementTab({ phase7 }: ArrangementTabProps) {
  // Phase 7 may be missing entirely (skipped or failed). Render an empty
  // state rather than the old hardcoded sample arrangement.
  if (!phase7 || !phase7.section_scores || phase7.section_scores.length === 0) {
    return (
      <section className={`card ${s.card}`}>
        <div className={s.hd}>
          <span className={s.title}>Arrangement</span>
          <span className={s.score} style={{ color: 'var(--muted)' }}>
            no structure detected
          </span>
        </div>
        <p
          className={s.issueText}
          style={{ margin: 0, color: 'var(--muted)', fontStyle: 'italic' }}
        >
          Phase 7 (arrangement scan) didn't produce section data for this
          track. This usually means the structure detector couldn't find
          clear section boundaries — common on ambient or single-section
          tracks.
        </p>
      </section>
    );
  }

  const sections = phase7.section_scores;
  const totalBars = sections.reduce((acc, sec) => acc + (sec.bars ?? 0), 0) || 1;
  const arrangementLabel =
    `Arrangement timeline over ${totalBars} bars: ` +
    sections.map((sec) => `${sec.section_type} (${sec.bars} bars)`).join(', ') +
    '.';
  const issues = phase7.issues ?? [];
  const suggestions = phase7.suggestions ?? [];
  const score = phase7.overall_score;
  const grade = phase7.grade;

  const scoreColor =
    score == null
      ? 'var(--muted)'
      : score >= 80
        ? 'var(--cyan)'
        : score >= 60
          ? 'var(--yellow)'
          : 'var(--orange)';

  return (
    <section className={`card ${s.card}`}>
      <div className={s.hd}>
        <span className={s.title}>
          Arrangement
          {phase7.metadata?.section_count != null && (
            <span style={{ color: 'var(--muted)', fontWeight: 500, marginLeft: 8 }}>
              · {phase7.metadata.section_count} sections
            </span>
          )}
        </span>
        {score != null && (
          <span className={s.score} style={{ color: scoreColor }}>
            {grade ? `${grade} · ` : ''}
            {Math.round(score)}/100
          </span>
        )}
      </div>

      <div className={s.bar} role="img" aria-label={arrangementLabel}>
        {sections.map((sec, i) => (
          <SectionBlock
            key={`${sec.section_type}-${i}`}
            sec={sec}
            flex={sec.bars / totalBars}
          />
        ))}
      </div>

      {(issues.length > 0 || suggestions.length > 0) && (
        <div className={s.issues}>
          <span className={s.issuesTitle}>
            {issues.length > 0 ? `Arrangement issues · ${issues.length}` : 'Suggestions'}
          </span>
          {issues.map((iss, i) => (
            <IssueRow key={`issue-${i}`} issue={iss} />
          ))}
          {suggestions.map((sug, i) => (
            <div key={`sug-${i}`} className={s.issue}>
              <span className={s.issueGlyph} style={{ color: 'var(--cyan)' }}>
                ✦
              </span>
              <span className={s.issueText}>{sug}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionBlock({ sec, flex }: { sec: Phase7SectionScore; flex: number }) {
  const lowScore = (sec.score ?? 100) < 70;
  const eightBarFail = sec.eight_bar_compliant === false;
  const flag = lowScore || eightBarFail;
  const bg = SECTION_COLOR[sec.section_type] ?? 'rgba(255,255,255,0.04)';

  // tooltip stitches together the per-section diagnostic so users don't
  // need to dig into a side panel for "why is this section flagged?".
  const titleParts = [
    `${sec.section_type.toUpperCase()} · ${sec.bars} bars`,
    sec.time_range,
    sec.score != null ? `score ${Math.round(sec.score)}/100` : null,
    eightBarFail ? '✗ 8-bar rule' : null,
    ...(sec.issues ?? []),
  ].filter(Boolean);

  return (
    <div
      className={s.section}
      data-flag={flag ? 'true' : 'false'}
      title={titleParts.join('\n')}
      style={
        {
          flex,
          ['--sec-bg' as string]: bg,
        } as React.CSSProperties
      }
    >
      <span>{sec.section_type}</span>
      <span className={s.sectionBars}>{sec.bars} bars</span>
    </div>
  );
}

function IssueRow({ issue }: { issue: Phase7Issue }) {
  const tone = SEVERITY_TONE[issue.severity] ?? SEVERITY_TONE.warning!;
  return (
    <div
      className={s.issue}
      style={{ background: tone.bg, borderColor: tone.border }}
    >
      <span className={s.issueGlyph} style={{ color: tone.glyph }}>
        ▲
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <span className={s.issueText}>{issue.message}</span>
        {issue.fix_suggestion && (
          <span
            className={s.issueText}
            style={{ color: 'var(--muted)', fontSize: 11 }}
          >
            Fix: {issue.fix_suggestion}
          </span>
        )}
      </div>
      {issue.section && (
        <span
          className="mono"
          style={{
            fontSize: 9,
            color: 'var(--muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {issue.section}
        </span>
      )}
    </div>
  );
}
