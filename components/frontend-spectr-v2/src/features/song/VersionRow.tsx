import { useState } from 'react';
import type { ReactNode } from 'react';
import type { VersionDto } from '../../api/types';
import type { VStatus } from './song-helpers';
import styles from './SongConsole.module.css';

const SLOT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

interface VersionRowProps {
  version: VersionDto;
  index: number;
  slotA: string | null;
  slotB: string | null;
  highlight: string | null;
  onPlay: () => void;
  onReport: () => void;
  onRetry: () => void;
  /** The VersionRowMenu node — shown when menu is open */
  menu: ReactNode;
  /** Job-derived status; defaults to computed from latestResult */
  status?: VStatus;
  progress?: number;
  /** Editing state managed by parent */
  editing?: boolean;
  editValue?: string;
  onEditChange?: (val: string) => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
}

export function VersionRow({
  version,
  index,
  slotA,
  slotB,
  highlight,
  onPlay,
  onReport,
  onRetry,
  menu,
  status,
  progress = 0,
  editing = false,
  editValue = '',
  onEditChange,
  onEditSave,
  onEditCancel,
}: VersionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const inA = version.id === slotA;
  const inB = version.id === slotB;
  const loaded = inA || inB;
  const badge = inA ? 'A' : inB ? 'B' : (SLOT_LETTERS[index] ?? String(index + 1));

  const computedStatus: VStatus = status ?? (version.latestResult?.score != null ? 'analyzed' : 'unscored');
  const isAnalyzed = computedStatus === 'analyzed';
  const isAnalyzing = computedStatus === 'analyzing';
  const isFailed = computedStatus === 'failed';
  const showReport = isAnalyzed;
  const showRetry = isFailed;

  const score = version.latestResult?.score ?? null;
  const hasScore = score != null;
  const isCurrent = version.isCurrent;
  const isHighlight = highlight === version.id;
  const hasPersonal = version.personalScore != null;
  const personalStr = hasPersonal ? String(version.personalScore) : '';

  // Accent strip: cyan for current version, violet for highlighted
  const accentBorder = isCurrent ? 'var(--cyan)' : isHighlight ? 'var(--violet)' : 'transparent';
  const accentBg = isCurrent ? 'var(--card-hover)' : isHighlight ? 'rgba(167,139,250,.05)' : undefined;

  // Badge colors: loaded (A or B slot) = cyan, else muted
  const badgeColor = loaded ? 'var(--cyan)' : 'var(--muted)';
  const badgeBorder = loaded ? 'rgba(0,229,176,.4)' : 'var(--border)';
  const badgeBg = loaded ? 'var(--cyan-dim)' : 'rgba(255,255,255,.02)';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onEditSave?.();
    if (e.key === 'Escape') onEditCancel?.();
  };

  return (
    <div
      className={styles.versionRow}
      style={{ borderLeftColor: accentBorder, background: (isCurrent || isHighlight) ? accentBg : undefined }}
    >
      {/* Slot badge */}
      <span
        className={`mono ${styles.vBadge}`}
        style={{ color: badgeColor, border: `1px solid ${badgeBorder}`, background: badgeBg }}
      >
        {badge}
      </span>

      {/* Label + date */}
      <div className={styles.vInfo}>
        {editing ? (
          <div className={styles.editRow}>
            <input
              className={styles.editInput}
              value={editValue}
              onChange={e => onEditChange?.(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button className={`btn primary sm ${styles.rowActionPadded}`} onClick={onEditSave}>Save</button>
            <button className="btn ghost sm" onClick={onEditCancel} style={{ padding: '5px 8px' }}>Cancel</button>
          </div>
        ) : (
          <div className={styles.metaRow}>
            <span className={`mono ${styles.vNum}`}>
              v{version.versionNumber}
            </span>
            <span className={styles.versionLabel}>
              {version.label ?? `Version ${version.versionNumber}`}
            </span>
            {isCurrent && <span className={`pill cyan ${styles.currentVersionPill}`}>current</span>}
            {hasPersonal && (
              <span className="pill" style={{ fontSize: '9px', padding: '2px 7px', color: 'var(--violet)', borderColor: 'rgba(167,139,250,.32)', background: 'rgba(167,139,250,.06)' }}>
                ★ {personalStr}
              </span>
            )}
            <span className="mono" style={{ fontSize: '10px', color: 'var(--muted)' }}>{fmtDate(version.createdAt)}</span>
          </div>
        )}
      </div>

      {/* Score */}
      <div className={styles.scoreBlock}>
        {hasScore ? (
          <>
            <span className="mono" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--cyan)' }}>{score}</span>
            <span className="mono" style={{ fontSize: '10px', color: 'var(--muted)' }}>/100</span>
          </>
        ) : (
          <span className="mono" style={{ fontSize: '15px', color: 'var(--dim)' }}>—</span>
        )}
      </div>

      {/* Status + actions */}
      <div className={styles.actionsBlock}>
        <div className={styles.statusBlock}>
          {isAnalyzed && (
            <span className={styles.statusAnalyzed}>
              <span className={styles.statusCheck}>✓</span>
              <span className="mono" style={{ fontSize: '10px', letterSpacing: '0.06em' }}>analyzed</span>
            </span>
          )}
          {isAnalyzing && (
            <span className={styles.statusAnalyzing}>
              <span className={styles.spinner} />
              <span className="mono" style={{ fontSize: '10px', color: 'var(--cyan)' }}>analyzing {progress}%</span>
            </span>
          )}
          {isFailed && (
            <span className={styles.statusFailed}>
              <span style={{ fontSize: '12px' }}>⚠</span>
              <span className="mono" style={{ fontSize: '10px', letterSpacing: '0.06em' }}>failed</span>
            </span>
          )}
        </div>

        <div className={styles.rowActions}>
          <button onClick={onPlay} title="Load into deck A" className={`btn ghost sm ${styles.rowActionPadded}`}>▶</button>
          {showReport && (
            <button onClick={onReport} className={`btn ghost sm ${styles.rowActionPadded}`}>
              Report <span style={{ color: 'var(--violet)' }}>↗</span>
            </button>
          )}
          {showRetry && (
            <button onClick={onRetry} className={`btn sm ${styles.rowRetryBtn}`}>
              ↻ Retry
            </button>
          )}

          <div className={styles.rowMenuWrap}>
            <button
              className="btn ghost sm"
              style={{ padding: '5px 8px' }}
              onClick={() => setMenuOpen(o => !o)}
            >
              ⋯
            </button>
            {menuOpen && menu}
          </div>
        </div>
      </div>
    </div>
  );
}
