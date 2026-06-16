import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

import { UnifiedUploadDialog } from '../UnifiedUploadDialog';

describe('UnifiedUploadDialog component shape', () => {
  it('is exported as a function component', () => {
    expect(typeof UnifiedUploadDialog).toBe('function');
  });
});
