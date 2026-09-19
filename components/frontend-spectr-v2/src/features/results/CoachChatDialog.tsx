import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

import { Icon } from './Icon';
import s from './CoachChatDialog.module.css';

interface CoachChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** Modal shell for the "Ask the Coach" expanded view (adhoc task,
 *  2026-09-19: expand the coach chat into a modal). This component owns
 *  ONLY the dialog chrome — overlay, focus trap, Esc/overlay-click close,
 *  the visible Collapse control, and an sr-only title. CoachChat.tsx owns
 *  every bit of chat state (conversation, streaming, mode, caps, offline)
 *  and hands this component its already-built header/body JSX as
 *  `children` — moving `children` here does not remount CoachChat, so the
 *  chat state, refs and any in-flight stream survive expand/collapse. */
export function CoachChatDialog({ open, onOpenChange, children }: CoachChatDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          className={s.content}
          aria-describedby={undefined}
          // CoachChat.tsx owns focus targeting explicitly (composer input on
          // open, the Expand button on close — brief req 3), so Radix's own
          // default auto-focus (which would otherwise grab the first
          // focusable element, i.e. the Collapse button below) is disabled
          // here rather than left to compete with it.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">Ask the Coach</Dialog.Title>
          <Dialog.Close asChild>
            <button
              type="button"
              className={s.collapseBtn}
              aria-label="Collapse coach chat"
              title="Collapse"
            >
              <Icon name="x" size={16} />
            </button>
          </Dialog.Close>
          <div className={s.body}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
