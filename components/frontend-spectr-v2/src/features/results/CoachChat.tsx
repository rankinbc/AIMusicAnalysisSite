import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { VerdictDto } from '../../api/types';
import { Pill } from '../../ui/Pill';
import { Icon } from './Icon';
import { CoachChatDialog } from './CoachChatDialog';
import { CoachChatHeader, type CoachMode } from './CoachChatHeader';
import { CoachThread } from './CoachThread';
import { CoachComposer } from './CoachComposer';
import { useCoachAriaLive } from './useCoachAriaLive';
import { COACH_OFFLINE_COPY, useCoachSession } from './useCoachSession';
import s from './CoachChat.module.css';

interface CoachChatProps {
  trackName: string;
  analysisId: string;
  verdicts: VerdictDto[];
  /** Count of measurement keys surfaced from `analyses.final_json` —
   *  contributes to the grounding scope line ({n} measurements). */
  measurementsCount: number;
  /** Optional actions rendered top-right of the coach card (redesign: the
   *  Coach Mix + Specialist Team buttons live here). */
  headerActions?: React.ReactNode;
  /** Cap-line stats (prototype: "· N specialists ran · M/N suggested"). */
  specialistsRan?: number;
  specialistsSuggested?: number;
  /** Grounded greeting shown when the thread is empty (prototype seeds one). */
  greeting?: React.ReactNode;
  /** Story 12.5: unlock chips open the REAL upload dialogs (owner: ReportView).
   *  Optional so bare mounts stay valid; without it the chip routes to the
   *  song page copy instead of a stale "coming soon" toast. */
  onUnlockAction?: (intent: 'add_stems' | 'add_reference') => void;
  /** v4 "Ask the coach about this": pre-fills the input with a question about a
   *  finding. `nonce` bumps so asking about the same finding twice re-seeds. */
  askSeed?: { text: string; nonce: number } | null;
}

export function CoachChat({
  analysisId,
  headerActions,
  specialistsRan = 0,
  specialistsSuggested = 0,
  greeting,
  onUnlockAction,
  askSeed,
}: CoachChatProps) {
  const [input, setInput] = useState('');
  // v4 ask-the-coach: seed the input from a finding row/detail CTA and bring
  // the composer into view. Seed only — the user still hits send.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!askSeed) return;
    setInput(askSeed.text);
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [askSeed]);
  // teach-mode-coach + adhoc-concise: the header mode toggle (Concise ·
  // Normal · Teach) derives the wire mode sent on the next question —
  // Teach → 'teach' (lesson grounded in this track), Concise → 'concise'
  // (terse style overlay on the grounded prompt), Normal → 'qa'.
  const [mode, setMode] = useState<CoachMode>('Normal');
  const wireMode: 'qa' | 'teach' | 'concise' =
    mode === 'Teach' ? 'teach' : mode === 'Concise' ? 'concise' : 'qa';

  // adhoc task (2026-09-19): expand the coach chat into a modal. `expanded`
  // swaps BOTH the header (mode toggle + headerActions) and the body
  // (thread + input + cap line) between rendering inline and rendering
  // inside CoachChatDialog — fix round 1 (2026-09-19): the header used to
  // stay put, but that left the mode toggle/headerActions unreachable while
  // the dialog's full-viewport overlay + focus trap were up. See the
  // `headerNode`/`chatBody` builds + return JSX below.
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  // adhoc2 (2026-09-19) — scoping fix for "modal renders unstyled". Every
  // coach class is a GLOBAL rule scoped `.rdx .coach-*` (the results-page
  // root — see ReportView.tsx's `<div className="rdx">`); a bare Radix
  // `Dialog.Portal` mounts into `document.body`, outside `.rdx`, so none of
  // those rules matched. `coachWrapRef` lets CoachChatDialog's portal target
  // the closest `.rdx` ancestor instead (see the `container` prop doc on
  // CoachChatDialog for why that's safe re: stacking contexts). Read via
  // `.closest()` at render time, not stored in state: `expanded` can only
  // flip true from a click handler, which necessarily runs after the DOM
  // has committed and `coachWrapRef.current` is populated — no extra
  // render/effect needed just to resolve it.
  const coachWrapRef = useRef<HTMLDivElement | null>(null);

  // adhoc-coachchat-split (2026-09-19) — throttled aria-live mirror lives in
  // its own hook now (useCoachAriaLive.ts); same refs, same throttle math,
  // same P9 delta-only reset, just moved.
  const { ariaLiveText, flushAriaLive, scheduleAriaLive, resetAriaLive, cancelAriaLiveTimer } =
    useCoachAriaLive();

  // adhoc-coachchat-split (2026-09-19) — clearInput is send()'s "way to
  // clear the input" now that `input`/`setInput` live here and `send`
  // lives in useCoachSession. Wrapping setInput('') keeps a stable
  // identity (setInput itself is already stable, per React's guarantee)
  // so send()'s dependency array behaves exactly as it did when it closed
  // over `setInput` directly.
  const clearInput = useCallback(() => setInput(''), []);

  // adhoc-coachchat-split (2026-09-19) — the conversation/streaming state
  // machine (turns, streaming, offlineState, streamStatus, caps, the
  // hydration + reset effects, send/handleStop/handleRetry) lives in its
  // own hook now (useCoachSession.ts); same statements, same conditions,
  // same dependency arrays, just moved. The wire mode is passed in fresh
  // every render so send() never closes over a stale mode (invariant 4).
  const { turns, streaming, offlineState, streamStatus, caps, send, handleStop, handleRetry } =
    useCoachSession({
      analysisId,
      wireMode,
      input,
      clearInput,
      scheduleAriaLive,
      flushAriaLive,
      resetAriaLive,
      cancelAriaLiveTimer,
    });

  // adhoc task (2026-09-19) — auto-scroll the thread to the latest message
  // on every turn change (send / stream token) AND whenever the dialog
  // opens (brief req 4 "on open ... the thread is scrolled to the latest
  // message"). `threadRef` is attached to whichever thread element is
  // currently mounted — inline or inside the dialog, never both.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, expanded]);

  // adhoc task (2026-09-19) — focus management (brief req 3: "on open,
  // focus the message input; on close, focus returns to the expand
  // button"). CoachChatDialog disables Radix's own default auto-focus
  // (`onOpenAutoFocus`/`onCloseAutoFocus` both `preventDefault`d), but
  // Radix's FocusScope still does its own mount-time focus handling one
  // animation frame later even with the default prevented — a plain
  // `useEffect` (same commit, prior frame) loses that race on OPEN, so it
  // hops a frame with `requestAnimationFrame` to run after it. CLOSE
  // doesn't need the same hop: nothing else claims focus on the way out
  // (see the header-instance note below), so a synchronous effect wins
  // outright. `wasExpandedRef` distinguishes "closed after a real open"
  // from the initial mount (expanded starts false) so page load never
  // steals focus.
  const wasExpandedRef = useRef(false);
  useEffect(() => {
    if (expanded) {
      wasExpandedRef.current = true;
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    if (wasExpandedRef.current) {
      wasExpandedRef.current = false;
      expandButtonRef.current?.focus();
    }
    return undefined;
  }, [expanded]);

  // Wired to the dialog's onOpenChange(false) (covers Esc + overlay click)
  // and directly to the header's own trailing Collapse button when it's
  // rendered inside the dialog (fix round 1 — the inline placeholder no
  // longer has any button of its own). Focus-return itself happens in the
  // effect above, once the dialog has actually unmounted.
  const handleCollapse = useCallback(() => {
    setExpanded(false);
  }, []);

  const handleUnlock = useCallback((intent: string) => {
    // Story 12.5: real destinations — the stale "coming with Epic 2 /
    // Phase E" toasts promised things that shipped long ago.
    if (intent === 'upgrade') {
      // Same idiom as CoachGateInline — /pricing is a _public route.
      window.location.assign('/pricing');
      return;
    }
    if (intent === 'add_stems' || intent === 'add_reference') {
      if (onUnlockAction) {
        onUnlockAction(intent);
        return;
      }
      // Bare mount without the dialog owner: honest pointer, no fake promise.
      toast.info(
        intent === 'add_reference'
          ? 'Add a reference from the song page to unlock this.'
          : 'Add stems from the song page to unlock this.',
      );
    }
  }, [onUnlockAction]);

  // adhoc task (2026-09-19) — built ONCE per render; only the thread's
  // className changes based on `expanded`. There is exactly one live copy
  // of the thread/input/cap-line/aria-live regions — this JSX mounts either
  // inline or inside CoachChatDialog, never both (brief req 6).
  //
  // adhoc2 fix (2026-09-19): every element below now keeps the SAME
  // `.rdx .coach-*` global class in both places (`coach-body`,
  // `coach-thread`, `coach-input`, `coach-cap`, `cmsg`, …) — no restyled
  // copies. What actually makes the modal *look* styled is
  // CoachChatDialog's portal now targeting the page's `.rdx` root (see the
  // `container` prop below); these classes are meaningless outside it. The
  // ONLY per-view difference left is `.dialogThread`, composed onto
  // `coach-thread` (not swapped in for it) so the thread fills the dialog's
  // 88vh box instead of the inline card's `max-height:150px` cap — see
  // CoachChat.module.css for why it's written as
  // `:global(.rdx .coach-thread).dialogThread` rather than a bare local
  // class. The narrow 760px-capped center column from the previous round is
  // gone (brief req 2: bubbles lay out exactly as inline, just in a
  // wider/taller box) — dropping it also puts `coach-thread` back as a
  // DIRECT flex child of `coach-body` in the expanded case, which is what
  // lets its `flex:1` actually grow to fill the modal's real height
  // (`coach-body`'s own `flex:1` only has definite space to resolve
  // against inside the dialog, whose `.content` is a fixed 88vh box — the
  // inline card's ancestor chain has no such definite height, so this
  // structural simplification is a no-op there and the inline card's
  // existing max-height-driven sizing is unaffected).
  const chatBody = (
    <div className="coach-body">
      <CoachThread
        turns={turns}
        streaming={streaming}
        expanded={expanded}
        greeting={greeting}
        handleUnlock={handleUnlock}
        threadRef={threadRef}
      />

      {offlineState && (
        <section
          className={`card ${s.offlineCard}`}
          aria-labelledby="coach-offline-heading"
          style={{ margin: '14px 14px 0' }}
        >
          <div className={s.offlineHeader}>
            <span className="label" id="coach-offline-heading">
              Coach offline
            </span>
            <Pill tone="orange">unavailable</Pill>
          </div>
          <p className={s.offlineBody}>{COACH_OFFLINE_COPY}</p>
          <div className={s.offlineActions}>
            <button type="button" className="btn sm" onClick={handleRetry}>
              Retry
            </button>
          </div>
        </section>
      )}

      <CoachComposer
        caps={caps}
        streaming={streaming}
        offlineState={offlineState}
        input={input}
        setInput={setInput}
        send={send}
        handleStop={handleStop}
        inputRef={inputRef}
        specialistsRan={specialistsRan}
        specialistsSuggested={specialistsSuggested}
      />

      {/* SR-only live regions for stream-state + token mirror. */}
      <span className="sr-only" aria-live="polite">
        {streamStatus}
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="false" aria-relevant="additions">
        {ariaLiveText}
      </span>
    </div>
  );

  // Fix round 1 (2026-09-19) — the mode toggle + headerActions markup is
  // owned by ONE component (`CoachChatHeader`, no duplicated JSX) and only
  // one instance of it is ever mounted in the DOM at a time — but it is
  // instantiated twice here (`inlineHeader`/`dialogHeader`), not shared as
  // a single element like `chatBody` is. Reason: Radix's `Dialog.Portal`
  // uses `Presence`, which briefly MOUNTS the closing content for one
  // frame to check for a CSS exit animation before actually removing it —
  // even though `open` has already flipped to false. Sharing one element
  // object (with `expandButtonRef` attached) between the inline slot and
  // the dialog's children meant that transient Presence-mount re-attached
  // `expandButtonRef` to the about-to-be-discarded dialog copy and then
  // nulled it on its way out, clobbering the ref out from under the real,
  // still-mounted inline button (confirmed by instrumenting the ref
  // callback — verified this before landing the fix). Each instance's
  // trailing action is now fixed to what's semantically correct for where
  // it lives (Expand inline, Collapse in the dialog) rather than branching
  // on `expanded`, so `expandButtonRef` is only ever attached to the real
  // inline button. `chatBody` doesn't have this problem (nothing reads
  // `inputRef`/`threadRef` on close) and stays a single shared instance,
  // exactly as before.
  const inlineHeader = (
    <CoachChatHeader
      thinking={streaming}
      mode={mode}
      onModeChange={setMode}
      headerActions={headerActions}
      trailingAction={
        <button
          type="button"
          ref={expandButtonRef}
          className={s.headerActionBtn}
          onClick={() => setExpanded(true)}
          aria-label="Expand coach chat"
          title="Expand"
        >
          <Icon name="expand" size={15} />
        </button>
      }
    />
  );

  const dialogHeader = (
    <CoachChatHeader
      thinking={streaming}
      mode={mode}
      onModeChange={setMode}
      headerActions={headerActions}
      trailingAction={
        <button
          type="button"
          className={s.headerActionBtn}
          onClick={handleCollapse}
          aria-label="Collapse coach chat"
          title="Collapse"
        >
          <Icon name="x" size={16} />
        </button>
      }
    />
  );

  return (
    <div className="coach-wrap" ref={coachWrapRef}>
      {expanded ? (
        // Static, non-interactive placeholder only (fix round 1) — the
        // real header (with the mode toggle, headerActions and the
        // Collapse control) lives inside the dialog while expanded; a
        // second copy or a second button here would sit behind the
        // dialog's full-viewport overlay and be unreachable.
        <div className={s.collapsedNotice}>
          <p className={s.collapsedNoticeTitle}>Ask the Coach</p>
          <p className={s.collapsedNoticeText}>Coach is open in the expanded view.</p>
        </div>
      ) : (
        <>
          {inlineHeader}
          {chatBody}
        </>
      )}

      {/* Fix round 1 — rendered unconditionally with `open` toggling
          (matches CommandPalette's usage in routes/_app.tsx). Radix's
          Presence only mounts `children` into the DOM while `open` is
          true (plus the brief transient exit-check above), so the header
          + body never render twice in steady state. */}
      <CoachChatDialog
        open={expanded}
        onOpenChange={(next) => {
          if (!next) handleCollapse();
        }}
        container={coachWrapRef.current?.closest<HTMLElement>('.rdx') ?? null}
      >
        {dialogHeader}
        {chatBody}
      </CoachChatDialog>
    </div>
  );
}
