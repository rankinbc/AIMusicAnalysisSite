import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

import s from './CoachChatDialog.module.css';

interface CoachChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** adhoc2 (2026-09-19) — root cause of "modal renders unstyled": every
   *  coach class (`.coach-hd`, `.cmsg`, `.coach-input`, …) is a GLOBAL rule
   *  scoped `.rdx .coach-*` (see redesign-v3-tabs.css ~L632+), and Radix's
   *  default `Dialog.Portal` mounts into `document.body` — outside `.rdx` —
   *  so none of those selectors match. Passing the page's `.rdx` element
   *  here (CoachChat.tsx finds it via `.closest('.rdx')`) makes the portal
   *  render *inside* `.rdx` instead, so the exact same global rules the
   *  inline card uses apply here too. Verified safe: neither `.rdx` nor any
   *  ancestor between it and `<html>` sets `transform`/`filter`/`contain`/
   *  `isolation`/`will-change`, so none of them become a containing block
   *  for this dialog's `position: fixed` overlay/content — it still covers
   *  the full viewport exactly as a `document.body` portal would, and its
   *  z-index (1000/1001) still out-ranks the app shell's sticky topnav
   *  (z-index 50, routes/_app/_appLayout.module.css) in the same root
   *  stacking context. Optional — `undefined` falls back to Radix's own
   *  `document.body` default (see @radix-ui/react-portal). */
  container?: Element | DocumentFragment | null;
}

/** Modal shell for the "Ask the Coach" expanded view (adhoc task,
 *  2026-09-19: expand the coach chat into a modal; fix round 1 moved the
 *  visible Collapse control into the coach header itself, which is now
 *  part of `children` — see CoachChatHeader.tsx). This component owns ONLY
 *  the dialog chrome — overlay, focus trap, Esc/overlay-click close, and an
 *  sr-only title. CoachChat.tsx owns every bit of chat state (conversation,
 *  streaming, mode, caps, offline) and hands this component its
 *  already-built header/body JSX as `children` — moving `children` here
 *  does not remount CoachChat, so the chat state, refs and any in-flight
 *  stream survive expand/collapse. Rendered unconditionally by the caller
 *  (`open` toggles), matching this codebase's other Radix dialogs (e.g.
 *  `CommandPalette` in `routes/_app.tsx`) — Radix's `Presence` only keeps
 *  `children` mounted while `open` is true (plus one transient frame on
 *  the way out, to check for a CSS exit animation — see the header-instance
 *  note in CoachChat.tsx for why that matters for refs). */
export function CoachChatDialog({ open, onOpenChange, children, container }: CoachChatDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          className={s.content}
          aria-describedby={undefined}
          // CoachChat.tsx owns focus targeting explicitly (composer input on
          // open, the Expand button on close — brief req 3), so Radix's own
          // default auto-focus (which would otherwise grab the first
          // focusable element inside Content) is disabled here rather than
          // left to compete with it.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">Ask the Coach</Dialog.Title>
          <div className={s.body}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
