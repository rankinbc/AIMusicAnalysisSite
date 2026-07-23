/* E6.9/E6.10/E6.13 — room UI state matrices: header state selection,
 * panel-notice copy, and the react send-honesty outcome. */
import { describe, expect, it } from 'vitest';

import { reactOutcome, roomHeaderState, roomPanelNotice } from './roomUiState';

describe('roomHeaderState', () => {
  it('ended wins over every stream status', () => {
    expect(roomHeaderState('open', true)).toBe('ended');
    expect(roomHeaderState('lost', true)).toBe('ended');
    expect(roomHeaderState('forbidden', true)).toBe('ended');
    expect(roomHeaderState('reconnecting', true)).toBe('ended');
  });

  it('maps the stream status taxonomy', () => {
    expect(roomHeaderState('open', false)).toBe('live');
    expect(roomHeaderState('connecting', false)).toBe('reconnecting');
    expect(roomHeaderState('reconnecting', false)).toBe('reconnecting');
    expect(roomHeaderState('lost', false)).toBe('lost');
    expect(roomHeaderState('forbidden', false)).toBe('forbidden');
  });

  it('renders transitional idle/closed as live (no alarm flash)', () => {
    expect(roomHeaderState('idle', false)).toBe('live');
    expect(roomHeaderState('closed', false)).toBe('live');
  });
});

describe('roomPanelNotice', () => {
  it('keeps the panels up while live or reconnecting (stale beats frozen-blank)', () => {
    expect(roomPanelNotice('live')).toBeNull();
    expect(roomPanelNotice('reconnecting')).toBeNull();
  });

  it('replaces the panels with honest copy for terminal states', () => {
    expect(roomPanelNotice('ended')).toMatch(/ended/i);
    expect(roomPanelNotice('lost')).toMatch(/connection lost/i);
    expect(roomPanelNotice('forbidden')).toMatch(/no longer have access/i);
  });
});

describe('reactOutcome (E6.13 — no optimistic pop on reject)', () => {
  it('pops only when the reaction landed', () => {
    expect(reactOutcome({ react: 'fulfilled', status: 'fulfilled' }))
      .toEqual({ pop: true, toast: false, revertStatus: false });
  });

  it('rejected reaction: no pop, toast instead', () => {
    expect(reactOutcome({ react: 'rejected', status: 'fulfilled' }))
      .toEqual({ pop: false, toast: true, revertStatus: false });
  });

  it('rejected status send reverts the optimistic myStatus even if the pop landed', () => {
    expect(reactOutcome({ react: 'fulfilled', status: 'rejected' }))
      .toEqual({ pop: true, toast: false, revertStatus: true });
  });

  it('both rejected: nothing pops, toast + revert', () => {
    expect(reactOutcome({ react: 'rejected', status: 'rejected' }))
      .toEqual({ pop: false, toast: true, revertStatus: true });
  });
});
