import { useFullHealth } from '../../api/hooks';
import type { FullHealthResponse } from '../../api/types';

// Story 12.2 (AC4) — tiny aggregated-health dot for the dev shell. Callers
// gate the mount on import.meta.env.DEV, so prod builds never render it and
// its /health/full poll stays unmounted (zero footprint). Tone via the global
// .dot utility: bare dot = all good, orange = informational check failing
// (worker/storage), red = a hard dependency (postgres/redis) is down.

type Tone = 'ok' | 'warn' | 'down';

function classify(health: FullHealthResponse | undefined): {
  tone: Tone;
  title: string;
} {
  if (!health) return { tone: 'warn', title: 'Health: waiting for first probe…' };

  const failing: string[] = [];
  if (!health.checks.postgres) failing.push('postgres');
  if (!health.checks.redis) failing.push('redis');
  if (!health.checks.worker.healthy) failing.push('worker');
  if (!health.checks.storage.ok) failing.push(`storage (${health.checks.storage.mode})`);

  if (health.status === 'degraded') {
    return { tone: 'down', title: `Health: DEGRADED — ${failing.join(', ')}` };
  }
  if (failing.length > 0) {
    return { tone: 'warn', title: `Health: ${failing.join(', ')} failing` };
  }
  return { tone: 'ok', title: 'Health: postgres, redis, worker, storage all ok' };
}

// Presentational core — static-render testable.
export function DevHealthDotView({ health }: { health: FullHealthResponse | undefined }) {
  const { tone, title } = classify(health);
  const toneClass = tone === 'down' ? 'dot red' : tone === 'warn' ? 'dot orange' : 'dot';
  return (
    <span
      className={toneClass}
      title={title}
      role="img"
      aria-label={title}
      data-tone={tone}
    />
  );
}

export function DevHealthDot() {
  const { data } = useFullHealth();
  return <DevHealthDotView health={data} />;
}
