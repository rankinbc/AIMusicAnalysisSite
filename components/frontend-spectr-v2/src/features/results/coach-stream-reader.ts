import { parseFrame, extractErrorCode, extractErrorMessage } from './coach-stream-frames';
import type { CoachEvidenceDto } from '../../api/types';

// Task G6 fix round 1 (item 1) — the SSE read loop extracted from
// useCoachSession.ts's `send()` so `followMessage()` (the opening brief) can
// drive the exact same wire contract instead of duplicating it. Mechanical
// extraction only: same frame parsing (coach-stream-frames.ts), same
// `\\n` → `\n` decode, same terminal semantics. What each caller DOES with a
// frame (which turn it patches, whether it schedules aria-live, etc.) is the
// only thing that differs, so every frame is delivered via a callback.

export interface CoachStreamHandlers {
  onToken: (text: string) => void;
  onDone: (evidence: CoachEvidenceDto[]) => void;
  onRefusal: (reason: string, body: string) => void;
  /** Covers BOTH a terminal `error` SSE frame and a failure to open the
   *  stream at all (non-2xx / no body) — `atOpen` tells the caller which,
   *  since "no turn has any text yet" only holds for the latter. */
  onError: (code: string, message: string, atOpen: boolean) => void;
}

export type CoachStreamResult =
  | 'done'
  | 'refusal'
  | 'error'
  | 'open-failed'
  | 'ended-without-terminal'
  | 'aborted';

/** Opens `GET {url}` as an SSE coach stream and drives `handlers` off each
 *  parsed frame until a terminal frame arrives, the stream ends without one,
 *  the open itself fails, or `signal` aborts. Never throws for an abort —
 *  callers get `'aborted'` back instead, so `send()` and `followMessage()`
 *  each apply their own abort-cleanup to the specific turn they own. */
export async function readCoachStream(
  url: string,
  authHeaders: Record<string, string>,
  signal: AbortSignal,
  handlers: CoachStreamHandlers,
): Promise<CoachStreamResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', ...authHeaders },
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'aborted';
    handlers.onError('coach_error', err instanceof Error ? err.message : 'Network error', true);
    return 'open-failed';
  }

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => null as unknown);
    const code = extractErrorCode(errBody) ?? 'coach_error';
    const message = extractErrorMessage(errBody) ?? `stream HTTP ${res.status}`;
    handlers.onError(code, message, true);
    return 'open-failed';
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseFrame(frame);
        if (!event) continue;
        if (event.kind === 'comment') continue;

        if (event.kind === 'token') {
          handlers.onToken(event.payload.text.replace(/\\n/g, '\n'));
          continue;
        }
        if (event.kind === 'done') {
          handlers.onDone(event.payload.evidence);
          return 'done';
        }
        if (event.kind === 'refusal') {
          handlers.onRefusal(event.payload.reason, event.payload.body);
          return 'refusal';
        }
        if (event.kind === 'error') {
          handlers.onError(event.payload.code, event.payload.message, false);
          return 'error';
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'aborted';
    throw err;
  }

  return 'ended-without-terminal';
}
