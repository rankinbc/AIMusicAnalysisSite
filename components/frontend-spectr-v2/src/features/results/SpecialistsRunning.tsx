import { runningLabel } from './helpers/specialist-runs';
import styles from './SpecialistsRunning.module.css';

interface SpecialistsRunningProps {
  count: number;
  /** Opens the Specialist Team roster. Without it the pill is a plain status. */
  onClick?: (() => void) | undefined;
}

/** Header status pill: "3 specialists running…" with animated equalizer bars.
 *  Renders nothing when no specialist is running. */
export function SpecialistsRunning({ count, onClick }: SpecialistsRunningProps) {
  if (count <= 0) return null;
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
