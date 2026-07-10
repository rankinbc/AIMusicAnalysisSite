import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { FullHealthResponse } from '../../../api/types';
import { DevHealthDotView } from '../DevHealthDot';

// Story 12.2 (AC4) — the dev shell health dot's three tones.

function health(overrides?: {
  status?: FullHealthResponse['status'];
  worker?: boolean;
  storage?: boolean;
  postgres?: boolean;
  redis?: boolean;
}): FullHealthResponse {
  return {
    status: overrides?.status ?? 'ok',
    checks: {
      postgres: overrides?.postgres ?? true,
      redis: overrides?.redis ?? true,
      worker: {
        healthy: overrides?.worker ?? true,
        lastHeartbeatAgeSeconds: 3,
        queueDepth: 0,
      },
      storage: { mode: 'local', ok: overrides?.storage ?? true },
    },
  };
}

describe('DevHealthDotView', () => {
  it('all checks ok → default tone', () => {
    const html = renderToStaticMarkup(<DevHealthDotView health={health()} />);
    expect(html).toContain('class="dot"');
    expect(html).toContain('data-tone="ok"');
    expect(html).toContain('all ok');
  });

  it('informational check failing (worker) → orange tone, named in the title', () => {
    const html = renderToStaticMarkup(
      <DevHealthDotView health={health({ worker: false })} />,
    );
    expect(html).toContain('class="dot orange"');
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain('worker');
  });

  it('degraded (redis down) → red tone', () => {
    const html = renderToStaticMarkup(
      <DevHealthDotView health={health({ status: 'degraded', redis: false })} />,
    );
    expect(html).toContain('class="dot red"');
    expect(html).toContain('data-tone="down"');
    expect(html).toContain('DEGRADED');
    expect(html).toContain('redis');
  });

  it('no data yet → warn tone with waiting title (never a false green)', () => {
    const html = renderToStaticMarkup(<DevHealthDotView health={undefined} />);
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain('waiting for first probe');
  });
});
