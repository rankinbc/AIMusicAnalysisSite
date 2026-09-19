import { useWorkerHealth } from '../../api/hooks';
import { WorkerHealthBanner } from './WorkerHealthBanner';

// App-wide worker-offline notice mounted in the authed shell so a dead analysis
// worker is visible on every page. Mirrors AppDunningNotice: renders nothing
// (incl. the padded slot) while the worker is healthy or status is unknown.

interface AppWorkerHealthNoticeProps {
  /** Wrapper class for the layout gutter; only applied when the banner shows. */
  className?: string;
}

export function AppWorkerHealthNotice({ className }: AppWorkerHealthNoticeProps) {
  const { data } = useWorkerHealth();

  // Only render once we have a definitive "offline" reading. Treat unknown/
  // healthy as no-banner so a slow first poll never flashes a false outage.
  if (data?.healthy !== false) return null;

  return (
    <div className={className}>
      <WorkerHealthBanner offline />
    </div>
  );
}
