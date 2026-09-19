import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { VersionRow } from '../VersionRow';
import { VersionRowMenu } from '../VersionRowMenu';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const baseVersion = {
  id: 'v1',
  songId: 's1',
  versionNumber: 1,
  label: null,
  isCurrent: false,
  filePath: '/foo.wav',
  createdAt: '2024-01-01',
  alsFilePath: null,
  referencePath: null,
  latestResult: null,
  personalScore: null,
};

describe('VersionRow', () => {
  const rowProps = {
    version: baseVersion,
    index: 0,
    slotA: null,
    slotB: null,
    highlight: null,
    onPlay: vi.fn(),
    onReport: vi.fn(),
    onRetry: vi.fn(),
    menu: null,
  };

  it('shows ◷ plan pill when hasGamePlan is true', () => {
    const html = renderToStaticMarkup(<VersionRow {...rowProps} hasGamePlan />);
    expect(html).toContain('◷ plan');
  });

  it('does not show ◷ plan pill when hasGamePlan is false', () => {
    const html = renderToStaticMarkup(<VersionRow {...rowProps} hasGamePlan={false} />);
    expect(html).not.toContain('◷ plan');
  });
});

describe('VersionRowMenu', () => {
  it('shows "game plan" only when hasGamePlan is true', () => {
    const props = {
      onMakeCurrent: vi.fn(),
      onEditLabel: vi.fn(),
      onReanalyze: vi.fn(),
      onReanalyzeRef: vi.fn(),
      onOpenListen: vi.fn(),
      onViewGamePlan: vi.fn(),
      onDelete: vi.fn(),
    };
    const withPlan = renderToStaticMarkup(<VersionRowMenu {...props} hasGamePlan />);
    const without = renderToStaticMarkup(<VersionRowMenu {...props} hasGamePlan={false} />);
    expect(withPlan).toContain('game plan');
    expect(without).not.toContain('game plan');
  });

  it('always renders core menu items', () => {
    const props = {
      onMakeCurrent: vi.fn(),
      onEditLabel: vi.fn(),
      onReanalyze: vi.fn(),
      onReanalyzeRef: vi.fn(),
      onOpenListen: vi.fn(),
      onViewGamePlan: vi.fn(),
      onDelete: vi.fn(),
    };
    const html = renderToStaticMarkup(<VersionRowMenu {...props} />);
    expect(html).toContain('Make current');
    expect(html).toContain('Edit label');
    expect(html).toContain('Reanalyze');
    expect(html).toContain('Open in Listen');
    expect(html).toContain('Delete version');
  });
});
