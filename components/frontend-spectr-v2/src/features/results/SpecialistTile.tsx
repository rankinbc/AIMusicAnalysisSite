import type { SpecialistStatusKind } from '../../api/types';
import { groupColor, type SpecialistGroup } from './helpers/specialists';
import { MiniBot } from './TranceBot';
import s from './SpecialistTile.module.css';

interface SpecialistTileProps {
  slug: string;
  label: string;
  group: SpecialistGroup;
  status: SpecialistStatusKind;
  findings?: number;
  disabled?: boolean;
  onRun: (slug: string) => void;
}

const HEX: Record<string, string> = {
  'var(--cyan)': '#00e5b0',
  'var(--orange)': '#fb923c',
  'var(--yellow)': '#fbbf24',
  'var(--blue)': '#60a5fa',
  'var(--violet)': '#a78bfa',
  'var(--green)': '#34d399',
  'var(--muted)': '#64748b',
};

export function SpecialistTile({
  slug,
  label,
  group,
  status,
  findings = 0,
  disabled,
  onRun,
}: SpecialistTileProps) {
  const interactive = !disabled && (status === 'idle' || status === 'failed');
  const personaToken = groupColor(group);
  const personaHex = HEX[personaToken] ?? '#00e5b0';

  const dataStatus = disabled ? 'disabled' : status;

  // Contextual status text (replaces IDLE/RUNNING/DONE/FAILED).
  let statusContent: React.ReactNode = null;
  let statusKey: string = dataStatus;

  if (disabled) {
    statusContent = <span className={s.disabledHint}>Upload stems to enable</span>;
  } else if (status === 'running') {
    statusKey = 'running';
    statusContent = (
      <>
        <span className={s.eqDots} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>running…</span>
      </>
    );
  } else if (status === 'cached') {
    if (findings > 0) {
      statusKey = 'cached-issues';
      statusContent = (
        <span>
          {findings} {findings === 1 ? 'finding' : 'findings'}
        </span>
      );
    } else {
      statusKey = 'cached-clean';
      statusContent = <span>no issues</span>;
    }
  } else if (status === 'failed') {
    statusContent = <span>retry · failed</span>;
  } else {
    // idle
    statusContent = (
      <button
        type="button"
        className={s.runBtn}
        onClick={(e) => {
          e.stopPropagation();
          onRun(slug);
        }}
      >
        Run
      </button>
    );
  }

  const tileClickable = interactive;
  return (
    <div
      className={s.tile}
      data-status={dataStatus}
      data-clickable={tileClickable || undefined}
      role={tileClickable ? 'button' : undefined}
      tabIndex={tileClickable ? 0 : undefined}
      onClick={() => {
        if (tileClickable) onRun(slug);
      }}
      onKeyDown={(e) => {
        if (tileClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onRun(slug);
        }
      }}
      aria-label={`${label} specialist`}
    >
      <div className={s.top}>
        <div
          className={s.avatar}
          style={{
            background: `${personaToken}10`,
            border: `1px solid ${personaToken}40`,
          }}
        >
          <MiniBot size={20} color={personaHex} />
        </div>
        <div className={s.label}>{label}</div>
        {status === 'cached' && findings > 0 && (
          <span className={s.countPill}>{findings}</span>
        )}
      </div>
      <div className={s.statusRow} data-status={statusKey}>
        {statusContent}
        {status === 'cached' && (
          <button
            type="button"
            className={s.rerunBtn}
            onClick={(e) => {
              e.stopPropagation();
              onRun(slug);
            }}
            title="Re-run"
          >
            ↺
          </button>
        )}
      </div>
    </div>
  );
}
