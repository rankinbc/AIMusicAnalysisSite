import { runningLabel } from './helpers/specialist-runs';
import styles from './SpecialistsRunning.module.css';

interface SpecialistsRunningProps {
  count: number;
  /** Specialists already run. When given, the pill stays visible while none
   *  are running as a static "N specialists run". */
  ran?: number | undefined;
  /** Opens the Specialist Team roster. Without it the pill is a plain status. */
  onClick?: (() => void) | undefined;
}

/** Header status pill: "3 specialists running…" with animated equalizer bars.
 *  While none run it shows "N specialists run" (static) when `ran` is given,
 *  and nothing otherwise. */
export function SpecialistsRunning({ count, ran, onClick }: SpecialistsRunningProps) {
  if (count <= 0) {
    if (ran === undefined) return null;
    const idle = `${ran} ${ran === 1 ? 'specialist' : 'specialists'} run`;
    return (
      <span className={styles.wrap} data-testid="specialists-running">
        {onClick ? (
          <button
            type="button"
            className={`${styles.pill} ${styles.idle}`}
            onClick={onClick}
            title="Run more specialists to discover more findings"
          >
            {idle}
          </button>
        ) : (
          <span className={`${styles.pill} ${styles.idle}`}>{idle}</span>
        )}
      </span>
    );
  }
  const label = runningLabel(count);
  const bars = (
    <span className={styles.bars} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
  // role=status on a wrapper so the count change is announced politely.
  return (
    <span role="status" className={styles.wrap} data-testid="specialists-running">
      {onClick ? (
        <button
          type="button"
          className={styles.pill}
          onClick={onClick}
          title="View the specialist team"
        >
          {bars}
          {label}
        </button>
      ) : (
        <span className={styles.pill}>
          {bars}
          {label}
        </span>
      )}
    </span>
  );
}
