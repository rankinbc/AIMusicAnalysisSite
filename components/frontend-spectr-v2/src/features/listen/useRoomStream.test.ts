import { describe, expect, it } from 'vitest';

import { isTerminalStreamStatus, nextRetryDelayMs, parseRoomFrame } from './useRoomStream';

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

  it('parses the transient ended frame (no id line, no seq)', () => {
    const parsed = parseRoomFrame('event: event\ndata: {"type":"ended","at":1750000000000}');
    expect(parsed!.event).toBe('event');
    expect(parsed!.data).toEqual({ type: 'ended', at: 1750000000000 });
  });
});

describe('nextRetryDelayMs (E6.9 — capped backoff)', () => {
  it('walks the capped schedule then gives up with null', () => {
    expect([0, 1, 2, 3, 4].map(nextRetryDelayMs)).toEqual([1000, 2000, 5000, 5000, 5000]);
    expect(nextRetryDelayMs(5)).toBeNull();
    expect(nextRetryDelayMs(99)).toBeNull();
  });
});

describe('isTerminalStreamStatus (E6.9 — never retry access loss)', () => {
  it('treats 403 and 404 as terminal', () => {
    expect(isTerminalStreamStatus(403)).toBe(true);
    expect(isTerminalStreamStatus(404)).toBe(true);
  });

  it('treats other failures as transient (retryable)', () => {
    expect(isTerminalStreamStatus(500)).toBe(false);
    expect(isTerminalStreamStatus(502)).toBe(false);
    expect(isTerminalStreamStatus(429)).toBe(false);
    expect(isTerminalStreamStatus(0)).toBe(false);
  });
});
