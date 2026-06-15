import { describe, expect, it } from 'vitest';

import { extractErrorCode, parseFrame } from '../coach-stream-frames';

// Story 1.8 / Tasks 1 + 6 + 7 — frame parser must handle the four event
// types AR44 emits (token / done / refusal / error) + the `: heartbeat`
// comment frames the BFF sends every 15 s. Malformed frames return null
// (so the consumer drops them silently instead of crashing).

describe('CoachChat parseFrame (Story 1.6/1.8 wire format)', () => {
  it('parses a token frame and decodes \\n escapes through the consumer', () => {
    const f = parseFrame('event: token\ndata: {"type":"token","text":"hello"}');
    expect(f).toEqual({ kind: 'token', payload: { text: 'hello' } });
  });

  it('parses a done frame with evidence', () => {
    const f = parseFrame(
      'event: done\ndata: {"type":"done","evidence":[{"label":"LUFS -11","path":"verdict-x"}]}',
    );
    expect(f?.kind).toBe('done');
    if (f?.kind !== 'done') throw new Error('type guard');
    expect(f.payload.evidence).toHaveLength(1);
    expect(f.payload.evidence[0]).toEqual({ label: 'LUFS -11', path: 'verdict-x' });
  });

  it('defaults evidence to [] when the done frame omits the field', () => {
    const f = parseFrame('event: done\ndata: {"type":"done"}');
    expect(f).toEqual({ kind: 'done', payload: { evidence: [] } });
  });

  it('parses a refusal frame with reason + body', () => {
    const f = parseFrame(
      'event: refusal\ndata: {"type":"refusal","reason":"missing_data","body":"I do not have stems."}',
    );
    expect(f).toEqual({
      kind: 'refusal',
      payload: { reason: 'missing_data', body: 'I do not have stems.' },
    });
  });

  it('parses an error frame with AR38 code + message', () => {
    const f = parseFrame(
      'event: error\ndata: {"type":"error","code":"coach_offline","message":"down"}',
    );
    expect(f).toEqual({
      kind: 'error',
      payload: { code: 'coach_offline', message: 'down' },
    });
  });

  it('recognises `: heartbeat` comment frames as ignorable', () => {
    expect(parseFrame(': heartbeat')).toEqual({ kind: 'comment' });
  });

  it('returns null on malformed JSON in data', () => {
    expect(parseFrame('event: token\ndata: not-json')).toBeNull();
  });

  it('returns null on frames missing required fields', () => {
    expect(
      parseFrame('event: refusal\ndata: {"type":"refusal","reason":"x"}'),
    ).toBeNull();
  });
});

describe('CoachChat extractErrorCode (AR38 envelope)', () => {
  it('extracts the `error.code` field from a BFF AR38 envelope', () => {
    expect(
      extractErrorCode({
        error: { code: 'coach_offline', message: 'down', details: null },
      }),
    ).toBe('coach_offline');
  });

  it('returns null for non-envelope payloads', () => {
    expect(extractErrorCode(null)).toBeNull();
    expect(extractErrorCode({ message: 'plain error' })).toBeNull();
    expect(extractErrorCode({ error: 'string' })).toBeNull();
  });
});
