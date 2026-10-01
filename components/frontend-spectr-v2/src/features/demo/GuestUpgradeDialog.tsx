import * as Dialog from '@radix-ui/react-dialog';
import { Link } from '@tanstack/react-router';

import type { GuestUpgradeReason } from './guest-upgrade-bus';
import f from '../../styles/forms.module.css';
import s from './demo.module.css';

// D10 — the ONE guest upgrade dialog, mounted once in `_app.tsx` and driven
// entirely through `onGuestUpgrade`/`openGuestUpgrade` (guest-upgrade-bus.ts):
// no per-feature copies. Radix Dialog gives focus trap + Esc-to-close +
// a labelled title for free, same as ConfirmDialog/UpgradeSheet elsewhere.
//
// Body copy priority: the server's own `error.message` (passed through from
// a guest_restricted 403) when we have one, else a reason-keyed fallback for
// a proactive (pre-request) gate that never hit the network — e.g.
// UnifiedUploadDialog substituting this dialog before the guest can even
// submit the form.
const REASON_FALLBACK: Record<GuestUpgradeReason, string> = {
  not_allowed: "That's not available on a guest account — create a free account to do this.",
  upload_limit: "You've used the uploads included with a guest account — create a free account to analyze more.",
  analysis_limit:
    "You've used the analyses included with a guest account — create a free account to analyze more.",
  stems_limit: "You've reached the stems limit for a guest account — create a free account to add more.",
  reference_limit:
    "You've used the reference track included with a guest account — create a free account to add more.",
  fix_rack_limit:
    "You've used the fix-rack generations included with a guest account — create a free account for more.",
  specialist_limit:
    "You've used the specialist reviews included with a guest account — create a free account for more.",
};

interface GuestUpgradeDialogProps {
  open: boolean;
  reason: GuestUpgradeReason;
  /** The server's `error.message`, when this dialog was opened from a
   *  guest_restricted 403. Falls back to reason-keyed copy otherwise. */
  message?: string;
  onOpenChange: (open: boolean) => void;
}

export function GuestUpgradeDialog({ open, reason, message, onOpenChange }: GuestUpgradeDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {/* Same purchase layer as UpgradeSheet: a guest limit can fire from
          inside any modal and this must land in front of it. */}
      <Dialog.Portal>
        <Dialog.Overlay className={`${f.dialogOverlay} ${f.topLayer}`} data-layer="purchase" />
        <Dialog.Content className={`${f.dialogContent} ${f.topLayer}`} data-layer="purchase">
          <Dialog.Title className={f.dialogTitle}>Create a free account to continue</Dialog.Title>
          <Dialog.Description className={`${f.dialogDescription} ${s.upgradeBody}`}>
            {message ?? REASON_FALLBACK[reason]}
          </Dialog.Description>
          <div className={f.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={f.button}>
                Not now
              </button>
            </Dialog.Close>
            <Link
              to="/register"
              search={{ from: 'guest' }}
              className={`${f.button} ${f.buttonPrimary}`}
              onClick={() => onOpenChange(false)}
            >
              Create a free account
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
