import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Mock all external hook deps so the panel renders without a real context tree.
vi.mock('../../api/hooks', () => ({
  useGenerateFixRack: () => ({ mutate: vi.fn(), isPending: false }),
  useFixRack: vi.fn(() => ({
    data: {
      name: 'Fix rack — Track',
      chain: {
        order: ['limiter'],
        modules: { limiter: { enabled: true, ceilingDb: -1 } },
        masterBypass: false,
      },
      createdAt: '2026-06-28T00:00:00Z',
      coachMeta: {
        change_log: [{ module: 'limiter', change: 'added ceiling', why: 'release-ready' }],
        degraded: true,
        arbiter_notes: null,
      },
    },
  })),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ resetQueries: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { useFixRack } from '../../api/hooks';
import { FixRackPanel } from './FixRackPanel';

describe('FixRackPanel coach meta', () => {
  it('renders the change-log rationale and a degraded badge', () => {
    const html = renderToStaticMarkup(
      <FixRackPanel jobId="j" versionId="v" committedCount={1} genPhase="generating" />,
    );
    // Change-log entry: "limiter: added ceiling — release-ready"
    expect(html).toContain('added ceiling');
    // Degraded badge copy
    expect(html).toContain('rule-based master');
  });

  it('renders why text when present', () => {
    const html = renderToStaticMarkup(
      <FixRackPanel jobId="j" versionId="v" committedCount={1} genPhase="generating" />,
    );
    expect(html).toContain('release-ready');
  });

  it('renders the module name in bold', () => {
    const html = renderToStaticMarkup(
      <FixRackPanel jobId="j" versionId="v" committedCount={1} genPhase="generating" />,
    );
    expect(html).toContain('<b>limiter</b>');
  });

  it('omits the coach block entirely when coachMeta is null (pre-port preset)', () => {
    vi.mocked(useFixRack).mockReturnValueOnce({
      data: {
        name: 'Fix rack — Track',
        chain: {
          order: ['limiter'],
          modules: { limiter: { enabled: true, ceilingDb: -1 } },
          masterBypass: false,
        },
        createdAt: '2026-06-28T00:00:00Z',
        coachMeta: null,
      },
    } as unknown as ReturnType<typeof useFixRack>);
    const html = renderToStaticMarkup(
      <FixRackPanel jobId="j" versionId="v" committedCount={1} genPhase="generating" />,
    );
    // Must not falsely claim nothing was needed under a populated chain.
    expect(html).not.toContain('No master-rack changes were needed.');
    expect(html).not.toContain('What Coach did');
  });

  it('renders fallback message when change_log is empty', () => {
    vi.mocked(useFixRack).mockReturnValueOnce({
      data: {
        name: 'Fix rack — Track',
        chain: {
          order: ['limiter'],
          modules: { limiter: { enabled: true, ceilingDb: -1 } },
          masterBypass: false,
        },
        createdAt: '2026-06-28T00:00:00Z',
        coachMeta: { change_log: [], degraded: false, arbiter_notes: null },
      },
    } as unknown as ReturnType<typeof useFixRack>);
    const html = renderToStaticMarkup(
      <FixRackPanel jobId="j" versionId="v" committedCount={1} genPhase="generating" />,
    );
    expect(html).toContain('No master-rack changes were needed.');
  });
});

// UI-cleanup sweep — the failure states the old boolean `requested` flag could
// never render (the panel used to spin "Solving your chain…" forever).
describe('FixRackPanel failure states', () => {
  const noRack = { data: undefined } as unknown as ReturnType<typeof useFixRack>;

  it('renders the error card with a Retry button', () => {
    vi.mocked(useFixRack).mockReturnValueOnce(noRack);
    const html = renderToStaticMarkup(
      <FixRackPanel jobId="j" versionId="v" committedCount={1} genPhase="error" />,
    );
    expect(html).toContain('generate the rack');
    expect(html).toContain('Retry');
  });

  it('renders the timeout card with a Retry button', () => {
    vi.mocked(useFixRack).mockReturnValueOnce(noRack);
    const html = renderToStaticMarkup(
      <FixRackPanel jobId="j" versionId="v" committedCount={1} genPhase="timeout" />,
    );
    expect(html).toContain('taking longer than expected');
    expect(html).toContain('Retry');
  });

  it('renders the spinner while generating with no rack yet', () => {
    vi.mocked(useFixRack).mockReturnValueOnce(noRack);
    const html = renderToStaticMarkup(
      <FixRackPanel jobId="j" versionId="v" committedCount={1} genPhase="generating" />,
    );
    expect(html).toContain('Solving your chain');
  });
});
