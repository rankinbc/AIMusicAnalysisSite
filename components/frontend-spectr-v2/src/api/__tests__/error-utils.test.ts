import { describe, expect, it } from 'vitest';

// Wave 2 (E2.4/E3.7) — the canonical three-shape error parser. The server
// speaks AR38 envelopes, legacy { error: "text" } bodies, and RFC7807
// ValidationProblem — one parser understands all three; `code` is populated
// ONLY for envelopes so code-keyed branches never fire off the other shapes.

import {
  extractApiError,
  extractApiMessage,
  parseErrorBody,
  parseErrorText,
} from '../error-utils';

describe('parseErrorBody', () => {
  it('parses an AR38 envelope with code and message', () => {
    expect(
      parseErrorBody({
        error: { code: 'email_taken', message: 'Email already registered.' },
      }),
    ).toEqual({ code: 'email_taken', message: 'Email already registered.' });
  });

  it('parses an envelope without a code — message only', () => {
    expect(parseErrorBody({ error: { message: 'Nope.' } })).toEqual({
      message: 'Nope.',
    });
  });

  it('parses the legacy string shape — message, NO code', () => {
    const parsed = parseErrorBody({ error: 'A song with that name already exists.' });
    expect(parsed.message).toBe('A song with that name already exists.');
    expect(parsed.code).toBeUndefined();
  });

  it('parses the hybrid legacy shape (extra sibling fields ignored)', () => {
    expect(parseErrorBody({ error: 'text', status: 'exists' })).toEqual({
      message: 'text',
    });
  });

  it('flattens ValidationProblem to the first field message', () => {
    const parsed = parseErrorBody({
      title: 'One or more validation errors occurred.',
      errors: { password: ['At least 8 characters required.'] },
    });
    expect(parsed.message).toBe('At least 8 characters required.');
    expect(parsed.code).toBeUndefined();
  });

  it('falls back to detail, then title, for ValidationProblem without errors', () => {
    expect(
      parseErrorBody({ title: 'Bad Request', detail: 'The request was malformed.' }),
    ).toEqual({ message: 'The request was malformed.' });
    expect(parseErrorBody({ title: 'Bad Request' })).toEqual({
      message: 'Bad Request',
    });
  });

  it('returns {} for unrecognized or non-object bodies', () => {
    expect(parseErrorBody(null)).toEqual({});
    expect(parseErrorBody(undefined)).toEqual({});
    expect(parseErrorBody('oops')).toEqual({});
    expect(parseErrorBody(42)).toEqual({});
    expect(parseErrorBody({ msg: 'nope' })).toEqual({});
  });
});

describe('parseErrorText', () => {
  it('parses a valid JSON envelope body', () => {
    expect(
      parseErrorText(
        JSON.stringify({ error: { code: 'internal_error', message: 'Boom.' } }),
      ),
    ).toEqual({ code: 'internal_error', message: 'Boom.' });
  });

  it('returns {} for a plain-text body', () => {
    expect(parseErrorText('Internal Server Error')).toEqual({});
  });

  it('returns {} for an empty string', () => {
    expect(parseErrorText('')).toEqual({});
  });
});

describe('extractApiError / extractApiMessage delegate to the parser', () => {
  it('extractApiError keeps envelope behavior exactly', () => {
    expect(
      extractApiError({ error: { code: 'entitlement_exhausted', message: 'Cap hit.' } }),
    ).toEqual({ code: 'entitlement_exhausted', message: 'Cap hit.' });
    expect(extractApiError({ error: 'legacy text' }).code).toBeUndefined();
  });

  it('extractApiMessage returns the parsed message for every shape', () => {
    expect(extractApiMessage({ error: { message: 'From envelope.' } })).toBe(
      'From envelope.',
    );
    expect(extractApiMessage({ error: 'From legacy.' })).toBe('From legacy.');
    expect(extractApiMessage({ title: 'From title.' })).toBe('From title.');
    expect(extractApiMessage({})).toBeUndefined();
  });
});
