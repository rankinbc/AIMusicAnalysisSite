import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { VersionRowMenu } from '../VersionRowMenu';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

describe('VersionRowMenu', () => {
  it('shows "game plan" only when hasGamePlan is true', () => {
    const props = {
      version: { id: 'v1', versionNumber: 1 } as never,
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
      version: { id: 'v2', versionNumber: 2 } as never,
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
    expect(html).toContain('soon');
  });
});
