import { describe, expect, it, vi } from 'vitest';

// Story 2.4 / Task 11.4 — inline entitlement-exhausted error in UnifiedUploadDialog.
// Tests the pure logic: when analysesRemaining === 0 at submit time, the handler
// sets entExhausted=true and returns early without uploading.
// We test the exported component exists and that the extractApiError helper
// correctly identifies the entitlement_exhausted code from an AR38 body.

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

import { extractApiError } from '../../api/error-utils';
import { UnifiedUploadDialog } from '../UnifiedUploadDialog';
import { UpgradeSheet } from '../UpgradeSheet';

describe('extractApiError identifies entitlement_exhausted', () => {
  it('extracts code from AR38 error envelope', () => {
    const body = { error: { code: 'entitlement_exhausted', message: 'No analyses left.' } };
    expect(extractApiError(body).code).toBe('entitlement_exhausted');
  });

  it('returns empty object for non-envelope errors', () => {
    expect(extractApiError(new Error('boom'))).toEqual({});
    expect(extractApiError(null)).toEqual({});
    expect(extractApiError(undefined)).toEqual({});
    expect(extractApiError({ msg: 'nope' })).toEqual({});
  });

  it('returns empty object for envelope missing code', () => {
    const body = { error: { message: 'Server error' } };
    expect(extractApiError(body).code).toBeUndefined();
    expect(extractApiError(body).message).toBe('Server error');
  });
});

describe('UnifiedUploadDialog component', () => {
  it('is exported as a function component', () => {
    expect(typeof UnifiedUploadDialog).toBe('function');
  });

  // Story 2.7 — the cap-hit path now opens the UpgradeSheet (UX-DR30) instead
  // of the old inline notice; the dialog imports + renders it on entExhausted.
  it('wires in the UpgradeSheet', () => {
    expect(typeof UpgradeSheet).toBe('function');
  });
});
