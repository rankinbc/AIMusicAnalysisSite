/* SPECTR · Listen V3 (PRP-4) — Room SSE consumer. Mirrors CoachChat's fetch-SSE
 * (fetch + Accept: text/event-stream + Bearer + manual frame parse +
 * AbortController), generalized to a fan-out room channel. The first frame is a
 * `sync` snapshot (full current state); subsequent frames are SessionEvent
 * deltas. Anon listeners pass the share/session `token` (?token=, resolved via
 * ResourceTokenAuth — never the JWT ?t= hook).
 *
 * E6.9 — transient failures (network drop, 5xx, silent stream, unexpected
 * reader end) auto-reconnect with capped backoff; 403/404 are terminal
 * ('forbidden', no retry); exhausted retries land in 'lost' with a manual
 * retry() handle. A reconnect is safe by design: the server re-sends `sync`
 * and the reducer's applySnapshot fully resets state. */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getAccessToken } from '../../api/fetcher';
import type { RoomSnapshot, SessionEvent } from '../../api/types';

export type RoomStreamStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'forbidden'
  | 'lost';

export interface RoomStreamHandlers {
  onSync?: (snapshot: RoomSnapshot) => void;
  onEvent?: (event: SessionEvent) => void;
}

export interface RoomStreamHandle {
  status: RoomStreamStatus;
  /** Manual retry from the 'lost' state — resets the backoff and reconnects. */
  retry: () => void;
}

/** Capped backoff schedule. attempt 0 = first retry. null ⇒ give up ('lost'). */
export function nextRetryDelayMs(attempt: number): number | null {
  const delays = [1000, 2000, 5000, 5000, 5000];
  return delays[attempt] ?? null;
}

/** 403/404 at connect are terminal (revoked access / dead session) — never retried. */
export function isTerminalStreamStatus(httpStatus: number): boolean {
  return httpStatus === 403 || httpStatus === 404;
}

// Server heartbeats every 15 s of silence; 45 s with NO bytes ⇒ the connection
// is silently dead (NAT drop, half-open socket) — treat as a transient drop.
export const STREAM_WATCHDOG_MS = 45_000;

// Parse one SSE frame ("event:"/"data:"/"id:" lines). Returns null for heartbeat
// comments (lines starting ":") and unparseable frames. Exported for unit tests.
export function parseRoomFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) return null; // heartbeat comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    // `id:` lines are ignored — seq also rides inside the payload.
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

/** Dispatch one frame; returns the parsed event name (or null) so the caller
 * can reset the retry counter on a successful `sync`. */
function dispatch(frame: string, handlers: RoomStreamHandlers): string | null {
  const parsed = parseRoomFrame(frame);
  if (!parsed) return null;
  if (parsed.event === 'sync') handlers.onSync?.(parsed.data as RoomSnapshot);
  else handlers.onEvent?.(parsed.data as SessionEvent);
  return parsed.event;
}

export function useRoomStream(
  sessionId: string | null,
  handlers: RoomStreamHandlers,
  token?: string | null,
): RoomStreamHandle {
  const [status, setStatus] = useState<RoomStreamStatus>('idle');
  // Latest handlers in a ref so re-renders never tear down the connection.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  // Bumping the nonce re-runs the effect from a clean slate (manual Retry).
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setStatus('idle');
      return;
    }
    // StrictMode-safe: every timer/controller below is owned by THIS effect run
    // and cleared in the cleanup — the dev double-invoke never leaves a ghost
    // reconnect loop behind.
    let disposed = false;
    let attempt = 0;
    let ac = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const clearWatchdog = () => {
      if (watchdog !== null) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    const armWatchdog = () => {
      clearWatchdog();
      // Aborting surfaces as an AbortError in the read loop's catch, which
      // (disposed === false) schedules a reconnect — i.e. a transient drop.
      watchdog = setTimeout(() => ac.abort(), STREAM_WATCHDOG_MS);
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = nextRetryDelayMs(attempt);
      if (delay === null) {
        setStatus('lost');
        return;
      }
      attempt += 1;
      setStatus('reconnecting');
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposed) return;
      ac = new AbortController();
      try {
        const access = getAccessToken();
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (access) headers['Authorization'] = `Bearer ${access}`;
        const qs = token ? `?token=${encodeURIComponent(token)}` : '';
        const res = await fetch(`/api/sessions/${sessionId}/stream${qs}`, {
          method: 'GET',
          headers,
          signal: ac.signal,
          credentials: 'include',
        });
        if (disposed) return;
        if (!res.ok || !res.body) {
          if (isTerminalStreamStatus(res.status)) {
            setStatus('forbidden');
            return;
          }
          scheduleReconnect();
          return;
        }
        setStatus('open');
        armWatchdog();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (disposed) return;
          if (done) break;
          armWatchdog(); // bytes arrived (heartbeats count) — connection is alive
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const eventName = dispatch(buffer.slice(0, idx), handlersRef.current);
            buffer = buffer.slice(idx + 2);
            // A fresh sync = clean resubscription — reset the backoff budget.
            if (eventName === 'sync') attempt = 0;
          }
        }
        // Unexpected server end (the room stream never closes cleanly while
        // the session lives) — transient.
        clearWatchdog();
        scheduleReconnect();
      } catch {
        // AbortError here is either the cleanup (disposed — bail) or the
        // watchdog firing (transient drop — reconnect). Network throws are
        // transient too.
        clearWatchdog();
        if (disposed) return;
        scheduleReconnect();
      }
    };

    setStatus('connecting');
    void connect();

    return () => {
      disposed = true;
      clearWatchdog();
      if (retryTimer !== null) clearTimeout(retryTimer);
      ac.abort();
    };
  }, [sessionId, token, retryNonce]);

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  return { status, retry };
}
