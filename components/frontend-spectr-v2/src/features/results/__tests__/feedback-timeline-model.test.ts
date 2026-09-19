import { describe, expect, it } from 'vitest';

import type { NoteDto } from '../../../api/types';
import { markerPct, mmss, noteMarkers } from '../feedback-timeline-model';

function note(over: Partial<NoteDto>): NoteDto {
  return {
    id: 'n1',
    versionId: 'v1',
    tSeconds: 0,
    text: 'sounds great here',
    pinned: false,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
    ...over,
  };
}

describe('noteMarkers', () => {
  it('keeps only timestamped notes (tSeconds > 0), sorted ascending', () => {
    const ms = noteMarkers([
      note({ id: 'a', tSeconds: 62.5, text: 'nice drop' }),
      note({ id: 'b', tSeconds: 0 }),
      note({ id: 'c', tSeconds: 5, text: 'earlier' }),
    ]);
    expect(ms).toHaveLength(2);
    expect(ms.map((m) => m.t)).toEqual([5, 62.5]);
    expect(ms[1]).toMatchObject({ t: 62.5, label: 'Note', detail: 'nice drop' });
  });
});

describe('mmss + markerPct', () => {
  it('formats and positions', () => {
    expect(mmss(65)).toBe('1:05');
    expect(markerPct(30, 120)).toBe(25);
    expect(markerPct(999, 120)).toBe(100);
    expect(markerPct(30, 0)).toBe(0);
  });
});
