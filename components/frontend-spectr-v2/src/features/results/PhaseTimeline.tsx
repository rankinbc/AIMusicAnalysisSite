// Pipeline timeline: one row per phase, sorted by phase number. Status pill
// color is dynamic (severity tokens) so it uses an inline CSS-var color.

import type { PhaseResult } from '../../api/types';
import s from './PhaseTimeline.module.css';

interface PhaseTimelineProps {
  phases: PhaseResult[] | undefined;
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  skipped: 'SKIPPED',
  failed: 'FAILED',
};

function statusColor(status: string): string {
  switch (status) {
    case 'ok':
      return 'var(--sev-ok)';
    case 'skipped':
      return 'var(--sev-warn)';
    case 'failed':
      return 'var(--sev-fail)';
    default:
      return 'var(--sev-unknown)';
  }
}

export function PhaseTimeline({ phases }: PhaseTimelineProps) {
  if (!phases || phases.length === 0) {
    return (
      <section className={s.panel}>
        <h3 className={s.heading}>Pipeline</h3>
        <p className={s.empty}>No phase data.</p>
      </section>
    );
  }

  // Defensive copy before sort — never mutate caller's array.
  const sorted = [...phases].sort((a, b) => a.phase - b.phase);

  return (
    <section className={s.panel}>
      <h3 className={s.heading}>Pipeline</h3>
      <ul className={s.list}>
        {sorted.map((p) => {
          const label = STATUS_LABEL[p.status] ?? p.status.toUpperCase();
          return (
            <li className={s.row} key={`${p.phase}-${p.name}`}>
              <div className={s.rowMain}>
                <span className={`${s.badge} mono`}>{p.phase}</span>
                <span className={s.name}>{p.name}</span>
                <span
                  className={`${s.status} mono`}
                  style={{ color: statusColor(p.status) }}
                >
                  {label}
                </span>
              </div>
              {p.status === 'failed' && p.error ? (
                <div className={s.error}>{p.error}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
