import type {
  CoachEvidenceDto,
  CoachStreamDonePayload,
  CoachStreamErrorPayload,
  CoachStreamRefusalPayload,
  CoachStreamTokenPayload,
} from '../../api/types';

// Story 1.8 / Task 1 — SSE frame parsing extracted from CoachChat.tsx so
// the component module exports only the React component (the
// react-refresh/only-export-components lint enforces this; mixing
// non-component exports breaks Fast Refresh in dev).

export type ParsedFrame =
  | { kind: 'token'; payload: CoachStreamTokenPayload }
  | { kind: 'done'; payload: CoachStreamDonePayload }
  | { kind: 'refusal'; payload: CoachStreamRefusalPayload }
  | { kind: 'error'; payload: CoachStreamErrorPayload }
  | { kind: 'comment' };

/** Parse one SSE frame (text between blank-line separators). Returns null
 *  for ignorable / unrecognised events. Supports four event types
 *  (token / done / refusal / error) plus `: heartbeat` comment lines. */
export function parseFrame(frame: string): ParsedFrame | null {
  // `: heartbeat\n` style comments — discard.
  const trimmed = frame.trimStart();
  if (trimmed.startsWith(':')) return { kind: 'comment' };

  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:'))
      dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }
  if (eventName === 'token' && isObj(payload) && typeof payload.text === 'string') {
    return { kind: 'token', payload: { text: payload.text } };
  }
  if (eventName === 'done' && isObj(payload)) {
    // Story 1.8 / code-review P8 — defensive per-item validation. A
    // malformed evidence array (worker bug, hijacked proxy, etc.) should
    // surface as ZERO chips rather than broken `aria-label="Cite: undefined"`.
    const raw = Array.isArray(payload.evidence) ? (payload.evidence as unknown[]) : [];
    const ev: CoachEvidenceDto[] = raw.filter(
      (e): e is CoachEvidenceDto =>
        isObj(e) && typeof (e as Record<string, unknown>).label === 'string',
    );
    return { kind: 'done', payload: { evidence: ev } };
  }
  if (
    eventName === 'refusal' &&
    isObj(payload) &&
    typeof payload.reason === 'string' &&
    typeof payload.body === 'string'
  ) {
    return {
      kind: 'refusal',
      payload: { reason: payload.reason, body: payload.body },
    };
  }
  if (
    eventName === 'error' &&
    isObj(payload) &&
    typeof payload.code === 'string' &&
    typeof payload.message === 'string'
  ) {
    return {
      kind: 'error',
      payload: { code: payload.code, message: payload.message },
    };
  }
  return null;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Extract the AR38 `error.code` field from a parsed JSON body. Returns
 *  null when the body does not match the envelope shape. */
export function extractErrorCode(body: unknown): string | null {
  if (
    isObj(body) &&
    isObj(body.error) &&
    typeof body.error.code === 'string'
  ) {
    return body.error.code;
  }
  return null;
}

/** Extract the AR38 `error.message` field. Falls back to null for
 *  non-envelope payloads (caller substitutes a generic message). */
export function extractErrorMessage(body: unknown): string | null {
  if (
    isObj(body) &&
    isObj(body.error) &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message;
  }
  return null;
}
