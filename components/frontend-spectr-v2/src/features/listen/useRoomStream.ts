/* SPECTR · Listen V3 (PRP-4) — Room SSE consumer. Mirrors CoachChat's fetch-SSE
 * (fetch + Accept: text/event-stream + Bearer + manual frame parse +
 * AbortController), generalized to a fan-out room channel. The first frame is a
 * `sync` snapshot (full current state); subsequent frames are SessionEvent
 * deltas. Anon listeners pass the share/session `token` (?token=, resolved via
 * ResourceTokenAuth — never the JWT ?t= hook). */
import { useEffect, useRef, useState } from 'react';

import { getAccessToken } from '../../api/fetcher';
import type { RoomSnapshot, SessionEvent } from '../../api/types';

export type RoomStreamStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface RoomStreamHandlers {
  onSync?: (snapshot: RoomSnapshot) => void;
  onEvent?: (event: SessionEvent) => void;
}

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

function dispatch(frame: string, handlers: RoomStreamHandlers): void {
  const parsed = parseRoomFrame(frame);
  if (!parsed) return;
  if (parsed.event === 'sync') handlers.onSync?.(parsed.data as RoomSnapshot);
  else handlers.onEvent?.(parsed.data as SessionEvent);
}

export function useRoomStream(
  sessionId: string | null,
  handlers: RoomStreamHandlers,
  token?: string | null,
): RoomStreamStatus {
  const [status, setStatus] = useState<RoomStreamStatus>('idle');
  // Latest handlers in a ref so re-renders never tear down the connection.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!sessionId) {
      setStatus('idle');
      return;
    }
    const ac = new AbortController();
    setStatus('connecting');

    void (async () => {
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
        if (!res.ok || !res.body) {
          setStatus('error');
          return;
        }
        setStatus('open');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            dispatch(buffer.slice(0, idx), handlersRef.current);
            buffer = buffer.slice(idx + 2);
          }
        }
        setStatus('closed');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setStatus('error');
      }
    })();

    return () => ac.abort();
  }, [sessionId, token]);

  return status;
}
