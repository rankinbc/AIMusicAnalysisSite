/* Story 6.4 (UX-DR28) — the landing resume card. A returning anon visitor with
 * an unclaimed job gets a doorway back into /analyze (which self-restores the
 * job on mount, 6.3). Status-aware: a completed report reads "Your report from
 * {day}"; a still-running job invites resuming progress; failed/absent renders
 * nothing. Pure + static-render testable (plain <a>, no RouterProvider). */
import { GradePill } from '../../ui/GradePill';
import { formatRelative } from '../../ui/relativeTime';
import type { ResumeInfo } from './useAnonAnalysis';
import s from './resume-card.module.css';

export function ResumeCard({ resume, onDismiss }: {
  resume: ResumeInfo;
  onDismiss: () => void;
}) {
  // Failed / unknown jobs offer nothing to resume.
  if (resume.status === 'failed') return null;

  const running = resume.status !== 'complete';
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
      <a href="/analyze" className="btn primary sm" data-testid="resume-open">
        {running ? 'Resume →' : 'Open report →'}
      </a>
      <button type="button" className={s.dismiss} aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </section>
  );
}
