import { describe, it, expect } from 'vitest';

import {
  availableModes,
  railTabsFor,
  MODE_SURFACE_MATRIX,
  MOCK_ACCESS,
  MOCK_COMMENTS,
  type AccessDto,
  type ModeId,
} from './access';

/* These pin the LISTEN_V3_UI_CONTRACT surface so the day MOCK_ACCESS is swapped
 * for the real GET /api/versions/{id}/access, any drift in mode gating or the
 * §04 surface matrix fails here instead of silently mis-rendering the page. */

// Minimal AccessDto factory — start denied, opt in per case.
function access(over: Partial<AccessDto> = {}): AccessDto {
  return {
    role: 'none',
    canWork: false,
    canView: false,
    roomHostable: false,
    roomJoinable: false,
    coachAvailable: false,
    gates: { canComment: false, canSuggest: false, canBookmark: false },
    ...over,
  };
}

describe('availableModes', () => {
  it('owner (MOCK_ACCESS) gets all three in lifecycle order', () => {
    expect(availableModes(MOCK_ACCESS)).toEqual(['work', 'view', 'room']);
  });

  it('reviewer (no Work, View + joinable Room) gets view then room', () => {
    expect(availableModes(access({ canView: true, roomJoinable: true })))
      .toEqual(['view', 'room']);
  });

  it('anon link viewer (View only) gets just view', () => {
    expect(availableModes(access({ canView: true }))).toEqual(['view']);
  });

  it('no access yields no modes', () => {
    expect(availableModes(access())).toEqual([]);
  });

  it('Room shows when EITHER hostable or joinable', () => {
    expect(availableModes(access({ roomHostable: true }))).toEqual(['room']);
    expect(availableModes(access({ roomJoinable: true }))).toEqual(['room']);
  });

  it('always emits work→view→room order regardless of which are enabled', () => {
    const all = availableModes(access({
      canWork: true, canView: true, roomHostable: true,
    }));
    expect(all).toEqual(['work', 'view', 'room']);
  });
});

describe('railTabsFor', () => {
  it('Work with coach mounts the coach tab first', () => {
    expect(railTabsFor('work', access({ coachAvailable: true })))
      .toEqual(['coach', 'plan', 'stats', 'notes']);
  });

  it('Work without coach drops only the coach tab', () => {
    expect(railTabsFor('work', access({ coachAvailable: false })))
      .toEqual(['plan', 'stats', 'notes']);
  });

  it('View without coach keeps comments/stats/notes', () => {
    expect(railTabsFor('view', access({ coachAvailable: false })))
      .toEqual(['comments', 'stats', 'notes']);
  });

  it('View with coach keeps the reference coach tab', () => {
    expect(railTabsFor('view', access({ coachAvailable: true })))
      .toEqual(['comments', 'coach', 'stats', 'notes']);
  });

  it('Room never exposes coach — coachAvailable is irrelevant', () => {
    const tabs = ['people', 'chat'];
    expect(railTabsFor('room', access({ coachAvailable: true }))).toEqual(tabs);
    expect(railTabsFor('room', access({ coachAvailable: false }))).toEqual(tabs);
  });
});

describe('MODE_SURFACE_MATRIX', () => {
  const modes: ModeId[] = ['work', 'view', 'room'];

  it('defines exactly the three modes', () => {
    expect(Object.keys(MODE_SURFACE_MATRIX).sort()).toEqual([...modes].sort());
  });

  it('coach presentation matches the contract per mode', () => {
    expect(MODE_SURFACE_MATRIX.work.coach).toBe('primary');
    expect(MODE_SURFACE_MATRIX.view.coach).toBe('reference');
    expect(MODE_SURFACE_MATRIX.room.coach).toBe('hidden');
  });

  it('rack presentation escalates private→readonly→host', () => {
    expect(MODE_SURFACE_MATRIX.work.rack).toBe('full');
    expect(MODE_SURFACE_MATRIX.view.rack).toBe('readonly');
    expect(MODE_SURFACE_MATRIX.room.rack).toBe('host');
  });

  it('every mode carries the full surface payload', () => {
    for (const m of modes) {
      const s = MODE_SURFACE_MATRIX[m];
      expect(s.label).toBeTruthy();
      expect(s.blurb).toBeTruthy();
      expect(s.accent).toMatch(/^var\(--/);
      expect(Array.isArray(s.railTabs)).toBe(true);
      expect(s.railTabs.length).toBeGreaterThan(0);
    }
  });

  it('railTabsFor only ever returns tabs declared in the matrix', () => {
    const open = access({ coachAvailable: true });
    for (const m of modes) {
      const resolved = railTabsFor(m, open);
      for (const t of resolved) {
        expect(MODE_SURFACE_MATRIX[m].railTabs).toContain(t);
      }
    }
  });
});

describe('MOCK_COMMENTS fixture', () => {
  it('models both track-level (t=null) and timestamped comments', () => {
    expect(MOCK_COMMENTS.some((c) => c.t === null)).toBe(true);
    expect(MOCK_COMMENTS.some((c) => typeof c.t === 'number')).toBe(true);
  });

  it('carries both user and anon ActorRef authors', () => {
    expect(MOCK_COMMENTS.some((c) => c.author.type === 'user')).toBe(true);
    expect(MOCK_COMMENTS.some((c) => c.author.type === 'anon')).toBe(true);
  });
});
