import { useMemo } from 'react';
import { useVerdicts } from '../../api/hooks';
import { severityColor, severityLabel } from '../results/helpers/severity';
import type { VerdictDto } from '../../api/types';
import s from './IssuesPanel.module.css';

// IssuesPanel never dispatches specialist runs, so verdict polling stays off.
const NO_RUNNING: ReadonlySet<string> = new Set();

interface Props {
  jobId: string | undefined;
}

export function IssuesPanel({ jobId }: Props) {
  const { data, isLoading } = useVerdicts(jobId ?? '', {
    enabled: Boolean(jobId),
    optimisticRunning: NO_RUNNING,
  });

  const issues = useMemo<VerdictDto[]>(() => {
    const all = data?.verdicts ?? [];
    return all
      .filter((v) => !v.userState?.dismissed)
      .sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
  }, [data]);

  if (!jobId) return <p className={s.empty}>No analysis yet for this version.</p>;
  if (isLoading) return <p className={s.empty}>Loading issues…</p>;
  if (issues.length === 0) return <p className={s.empty}>No outstanding issues. Nice mix.</p>;

  return (
    <ul className={s.list}>
      {issues.map((v) => (
        <li key={v.id} className={s.row}>
          <span
            className={s.dot}
            style={{ background: severityColor(String(v.severity)) }}
            aria-hidden
          />
          <div className={s.body}>
            <span className={s.headline}>{v.headline}</span>
            {v.summary && <span className={s.summary}>{v.summary}</span>}
          </div>
          <span className={`${s.sev} label`} style={{ color: severityColor(String(v.severity)) }}>
            {severityLabel(String(v.severity))}
          </span>
        </li>
      ))}
    </ul>
  );
}
