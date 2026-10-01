// The analysis page's chat log — append-only, per job.
//
// `narrate()` says which messages the current state has earned; this hook
// turns that into a CHAT: a message appears the first time its id shows up
// and keeps its place forever after (the state may move on — "picking…" →
// plan — but what was said stays said). It also drips in the coach's
// "still working" lines during long quiet stretches.
//
// The log lives in a module-level store keyed by job id, so the hand-off from
// the live (running) page to the finished report's page — a remount — keeps
// the exact same conversation, including the time-based lines.
import { useEffect, useMemo, useState } from 'react';

import { CLOSER_ID, type ChatMessage } from './helpers/coachNarration';
import { dueWaitLine } from './helpers/coachWaitLines';

interface StoredLog {
  messages: ChatMessage[];
  /** When the log last grew (epoch ms) — "quiet spell" for wait lines. */
  lastAt: number;
  /** First time each wait context was seen (fallback clock). */
  ctxSeen: Map<string, number>;
}

const LOGS = new Map<string, StoredLog>();

/** Test hook: forget every stored conversation. */
export function resetNarrationLogs(): void {
  LOGS.clear();
}

function stored(jobId: string): StoredLog {
  let s = LOGS.get(jobId);
  if (!s) {
    s = { messages: [], lastAt: Date.now(), ctxSeen: new Map() };
    LOGS.set(jobId, s);
  }
  return s;
}

/** Append `available` ids not yet in `log` (in their narrative order) and
 *  refresh the content of ones already there. The coach's closing line stays
 *  LAST: anything earned after it (a late arrangement result, a stray wait
 *  line) lands just above it. Returns `log` itself when nothing changed. */
export function appendNew(log: readonly ChatMessage[], available: readonly ChatMessage[]): ChatMessage[] {
  const fresh = new Map(available.map((m) => [m.id, m]));
  let changed = false;
  const next = log.map((m) => {
    const f = fresh.get(m.id);
    if (f && f !== m && JSON.stringify(f) !== JSON.stringify(m)) {
      changed = true;
      return f;
    }
    return m;
  });
  const have = new Set(log.map((m) => m.id));
  for (const m of available) {
    if (!have.has(m.id)) {
      const closerAt = next.findIndex((x) => x.id === CLOSER_ID);
      if (closerAt >= 0) next.splice(closerAt, 0, m);
      else next.push(m);
      have.add(m.id);
      changed = true;
    }
  }
  return changed ? next : (log as ChatMessage[]);
}

export interface LiveNarrationArgs {
  jobId: string;
  /** narrate() output for the current state. */
  available: readonly ChatMessage[];
  /** What the user is waiting on (waitContext), or null. */
  waitCtx: string | null;
  /** Server-side start of that context (e.g. the running phase), if known. */
  waitStartedAtMs?: number | undefined;
}

export interface LiveNarration {
  messages: ChatMessage[];
  /** Ids already in the log when this view mounted — not re-animated. */
  initialIds: ReadonlySet<string>;
}

export function useLiveNarration({ jobId, available, waitCtx, waitStartedAtMs }: LiveNarrationArgs): LiveNarration {
  const [initialIds] = useState<ReadonlySet<string>>(() => new Set(stored(jobId).messages.map((m) => m.id)));
  const [log, setLog] = useState<ChatMessage[]>(() => appendNew(stored(jobId).messages, available));

  // New state → new messages.
  useEffect(() => {
    setLog((prev) => appendNew(prev, available));
  }, [available]);

  // Persist (the remount at the live → report hand-off reads it back).
  useEffect(() => {
    const s = stored(jobId);
    if (log.length > s.messages.length) s.lastAt = Date.now();
    s.messages = log;
  }, [log, jobId]);

  // "Still working" lines during long quiet stretches.
  useEffect(() => {
    if (!waitCtx) return undefined;
    const s = stored(jobId);
    if (!s.ctxSeen.has(waitCtx)) s.ctxSeen.set(waitCtx, Date.now());
    const tick = () => {
      const now = Date.now();
      const st = stored(jobId);
      const since = waitStartedAtMs ?? st.ctxSeen.get(waitCtx) ?? now;
      const sent = st.messages.filter((m) => m.id.startsWith(`wait:${waitCtx}:`)).length;
      const due = dueWaitLine(waitCtx, (now - since) / 1000, (now - st.lastAt) / 1000, sent);
      if (due) setLog((prev) => appendNew(prev, [due]));
    };
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [jobId, waitCtx, waitStartedAtMs]);

  return useMemo(() => ({ messages: log, initialIds }), [log, initialIds]);
}
