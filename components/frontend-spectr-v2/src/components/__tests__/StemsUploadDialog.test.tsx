import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

import { StemsUploadDialog } from '../StemsUploadDialog';
import { buildConfirmPayload } from '../stems-upload-helpers';

describe('StemsUploadDialog component shape', () => {
  it('is exported as a function component', () => {
    expect(typeof StemsUploadDialog).toBe('function');
  });
});

describe('buildConfirmPayload', () => {
  it('includes only staged rows and maps id + role', () => {
    const out = buildConfirmPayload([
      { serverId: 'a', role: 'kick' },
      { role: 'bass' }, // not staged → excluded
      { serverId: 'c', role: 'hats' },
    ]);
    expect(out).toEqual([
      { id: 'a', confirmedRole: 'kick' },
      { id: 'c', confirmedRole: 'hats' },
    ]);
  });

  it('returns empty when nothing is staged', () => {
    expect(buildConfirmPayload([{ role: 'kick' }])).toEqual([]);
  });
});
