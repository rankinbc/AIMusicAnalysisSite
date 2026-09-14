import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ListenFix } from '../listen-rack/listenFixes';

// vi.mock is hoisted — readListenFixes is replaced before song-helpers imports it.
vi.mock('../listen-rack/listenFixes', () => ({
  readListenFixes: vi.fn((): ListenFix[] => []),
  isApplyable: vi.fn(() => true),
}));

import { hasGamePlan } from './song-helpers';
import { readListenFixes } from '../listen-rack/listenFixes';

const makeFix = (override: Partial<ListenFix> = {}): ListenFix => ({
  fixId: 'f1',
  verdictId: null,
  title: 'Test Fix',
  scope: 'eq',
  sev: 'major',
  specialist: null,
  ops: [],
  ...override,
});

describe('hasGamePlan', () => {
  beforeEach(() => {
    vi.mocked(readListenFixes).mockReturnValue([]);
  });

  it('returns false when readListenFixes returns empty array', () => {
    expect(hasGamePlan('v1')).toBe(false);
  });

  it('returns true when readListenFixes returns ≥1 fix', () => {
    vi.mocked(readListenFixes).mockReturnValue([makeFix()]);
    expect(hasGamePlan('v1')).toBe(true);
  });

  it('passes versionId through to readListenFixes', () => {
    hasGamePlan('version-abc');
    expect(vi.mocked(readListenFixes)).toHaveBeenCalledWith('version-abc');
  });
});
