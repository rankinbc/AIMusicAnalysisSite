import { describe, expect, it } from 'vitest';

import { parseRoomFrame } from './useRoomStream';

describe('parseRoomFrame', () => {
  it('parses a sync frame with event name + JSON data', () => {
    const frame = 'event: sync\ndata: {"type":"sync","snapshotSeq":7,"roster":[]}';
    const parsed = parseRoomFrame(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.event).toBe('sync');
    expect((parsed!.data as { snapshotSeq: number }).snapshotSeq).toBe(7);
  });

  it('parses a delta event frame', () => {
    const frame = 'id: 12\nevent: event\ndata: {"type":"reaction","seq":12,"emoji":"🔥","t":64}';
    const parsed = parseRoomFrame(frame);
    expect(parsed!.event).toBe('event');
    expect((parsed!.data as { type: string; seq: number }).type).toBe('reaction');
    expect((parsed!.data as { seq: number }).seq).toBe(12);
  });

  it('returns null for a heartbeat comment', () => {
    expect(parseRoomFrame(': heartbeat')).toBeNull();
  });

  it('returns null for a frame with no data line', () => {
    expect(parseRoomFrame('event: sync')).toBeNull();
  });

  it('returns null for malformed JSON instead of throwing', () => {
    expect(parseRoomFrame('event: event\ndata: {not json')).toBeNull();
  });
});
