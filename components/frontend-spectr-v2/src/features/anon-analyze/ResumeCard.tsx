/* Story 6.4 (UX-DR28) — the landing resume card. A returning anon visitor with
 * an unclaimed job gets a doorway back into /analyze (which self-restores the
 * job on mount, 6.3). Status-aware: a completed report reads "Your report from
 * {day}"; a still-running job invites resuming progress; failed/absent renders
 * nothing. Pure + static-render testable (plain <a>, no RouterProvider). */
import { GradePill } from '../../ui/GradePill';
import { formatRelative } from '../../ui/relativeTime';
import type { ResumeInfo } from './useAnonAnalysis';
import s from './resume-card.module.css';

// Genuinely-resumable in-progress states — an allowlist so a future/unknown
// status degrades to "no card" rather than a misleading "still analyzing"
// (review). `complete` is the report; everything else here = show progress.
const RUNNING_STATUSES = new Set(['pending', 'processing', 'awaiting_stem_mapping', 'queued']);

export function ResumeCard({ resume, onDismiss, onOpen }: {
  resume: ResumeInfo;
  onDismiss: () => void;
  onOpen?: () => void;
}) {
  const running = RUNNING_STATUSES.has(resume.status);
  // Nothing to resume: failed, or an unrecognized status.
  if (resume.status !== 'complete' && !running) return null;

  const when = formatRelative(new Date(resume.dispatchedAt));

  return (
    <section className={`card ${s.card}`} data-testid="resume-card">
      {resume.status === 'complete' && resume.grade && (
        <GradePill grade={resume.grade} size="sm" />
      )}
      <div className={s.body}>
        <span className="label">{running ? 'Analysis in progress' : 'Welcome back'}</span>
        <p className={s.line}>
          {running
            ? 'Your track is still being analyzed.'
            : `Your report from ${when} is ready.`}
        </p>
      </div>
      <a href="/analyze" className="btn primary sm" data-testid="resume-open" onClick={onOpen}>
        {running ? 'Resume →' : 'Open report →'}
      </a>
      <button type="button" className={s.dismiss} aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </section>
  );
}
