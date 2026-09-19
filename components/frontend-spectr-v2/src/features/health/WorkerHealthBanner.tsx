import s from './WorkerHealthBanner.module.css';

// Global "analysis worker offline" banner. Presentational only — renders null
// when the worker is healthy (or status is still unknown), so callers can mount
// it unconditionally with zero cost in the healthy path. Mirrors DunningBanner.
//
// There's no user action here: a dead worker self-recovers on the next launch
// (scripts/recover-jobs.ps1) and the BFF StaleJobReaper fails any stuck jobs so
// they become re-runnable. This banner just makes the outage visible.

interface WorkerHealthBannerProps {
  /** True only when the BFF reports the worker offline. */
  offline: boolean;
}

export function WorkerHealthBanner({ offline }: WorkerHealthBannerProps) {
  if (!offline) return null;

  return (
    <div className={s.banner} role="status" aria-label="Analysis worker offline">
      <span className={s.dot} aria-hidden="true" />
      <p className={s.message}>
        Analysis worker offline — new analyses are paused. Retrying…
      </p>
    </div>
  );
}
