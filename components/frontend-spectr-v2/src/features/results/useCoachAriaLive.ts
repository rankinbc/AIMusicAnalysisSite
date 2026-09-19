import { useCallback, useEffect, useRef, useState } from 'react';

// adhoc-coachchat-split (2026-09-19) — throttled aria-live mirror extracted
// from CoachChat.tsx so the component file stays under the CLAUDE.md
// ~500-line ceiling. Pure move: same refs, same throttle math, same P9
// delta-only reset.

// Aria-live throttle window: long enough that NVDA / VoiceOver don't
// stutter every token, short enough that the live region still feels
// responsive. 500 ms matches the spec dev note.
export const ARIA_LIVE_THROTTLE_MS = 500;

export function useCoachAriaLive() {
  // Throttle aria-live updates to ARIA_LIVE_THROTTLE_MS. Tokens still land
  // in the visible transcript immediately via setTurns; the live-region
  // text is the throttled mirror — DELTA only (P9), not cumulative.
  const ariaLiveBufferRef = useRef<string>('');
  const ariaLiveLastFlushRef = useRef<number>(0);
  const ariaLiveTimerRef = useRef<number | null>(null);
  const [ariaLiveText, setAriaLiveText] = useState<string>('');

  const flushAriaLive = useCallback(() => {
    ariaLiveLastFlushRef.current = Date.now();
    if (ariaLiveTimerRef.current !== null) {
      window.clearTimeout(ariaLiveTimerRef.current);
      ariaLiveTimerRef.current = null;
    }
    setAriaLiveText(ariaLiveBufferRef.current);
    // P9 — reset buffer so the next flush announces only NEW tokens.
    ariaLiveBufferRef.current = '';
  }, []);

  const scheduleAriaLive = useCallback(
    (delta: string) => {
      ariaLiveBufferRef.current += delta;
      const since = Date.now() - ariaLiveLastFlushRef.current;
      if (since >= ARIA_LIVE_THROTTLE_MS) {
        flushAriaLive();
      } else if (ariaLiveTimerRef.current === null) {
        ariaLiveTimerRef.current = window.setTimeout(
          flushAriaLive,
          ARIA_LIVE_THROTTLE_MS - since,
        );
      }
    },
    [flushAriaLive],
  );

  // Code-review P1 — unmount cleanup: clear the pending timer. Without
  // this, navigating away mid-stream leaves the 500ms timer to fire into a
  // dead closure (memory pressure). The other half of the original P1
  // cleanup (aborting the in-flight fetch) now lives in useCoachSession,
  // next to the abortRef it belongs to — split forced by the hook
  // boundary; both halves still fire on unmount exactly as before.
  useEffect(() => {
    return () => {
      if (ariaLiveTimerRef.current !== null) {
        window.clearTimeout(ariaLiveTimerRef.current);
        ariaLiveTimerRef.current = null;
      }
    };
  }, []);

  // hook-boundary note (adhoc-coachchat-split): send() used to reset these
  // refs/state inline at the top of its body (three bare statements: clear
  // buffer, zero the last-flush timestamp, clear the visible mirror). Now
  // that the refs live in this hook, that reset is exposed as a callback
  // for useCoachSession's send() to call — same three assignments, just
  // reached through a function instead of direct ref access.
  const resetAriaLive = useCallback(() => {
    ariaLiveBufferRef.current = '';
    ariaLiveLastFlushRef.current = 0;
    setAriaLiveText('');
  }, []);

  // hook-boundary note (adhoc-coachchat-split): send()'s `finally` block
  // used to reach into ariaLiveTimerRef directly to cancel any
  // still-pending flush regardless of how send() exited (the done /
  // refusal / error paths already call flushAriaLive, but the abort and
  // generic-catch paths don't) — the identical two-statement clear used
  // above in the unmount cleanup. Exposed here since the timer ref no
  // longer lives where send() does.
  const cancelAriaLiveTimer = useCallback(() => {
    if (ariaLiveTimerRef.current !== null) {
      window.clearTimeout(ariaLiveTimerRef.current);
      ariaLiveTimerRef.current = null;
    }
  }, []);

  return { ariaLiveText, flushAriaLive, scheduleAriaLive, resetAriaLive, cancelAriaLiveTimer };
}
