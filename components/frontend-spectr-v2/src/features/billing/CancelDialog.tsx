import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { toast } from 'sonner';

import { extractApiMessage } from '../../api/error-utils';
import { ApiError, fetcher } from '../../api/fetcher';
import type { BillingSummaryResponse } from '../../api/types';
import s from './CancelDialog.module.css';

// Story 2.2 / AC2 + AC4 — single-dialog cancellation flow. Two clicks
// total from the Billing page: Cancel (opens this) + Cancel my
// subscription (confirms). Optional reason `<select>`; no required
// fields. UX-DR33: "no retention interrogation beyond one optional
// reason field."

const REASONS = [
  { value: '', label: 'No reason given' },
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'not_using_enough', label: 'Not using it enough' },
  { value: 'missing_feature', label: 'Missing a feature I need' },
  { value: 'temporary_pause', label: 'Just need a pause' },
  { value: 'other', label: 'Other' },
] as const;

interface CancelDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: (next: BillingSummaryResponse) => void;
}

export function CancelDialog({ open, onClose, onConfirmed }: CancelDialogProps) {
  const [reason, setReason] = useState<string>('');
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    setPending(true);
    try {
      const next = await fetcher<BillingSummaryResponse>({
        url: '/billing/cancel',
        method: 'POST',
        data: { reason: reason || null },
      });
      onConfirmed(next);
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError && typeof err.body === 'object'
          ? extractApiMessage(err.body) ?? 'Could not cancel your subscription.'
          : 'Network error. Please try again.';
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // Story 2.2 review-fix P27 — reset the reason selection when
          // the dialog closes so a re-open shows the empty default
          // rather than the previously-selected reason.
          setReason('');
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          <Dialog.Title className={s.title}>Cancel your subscription</Dialog.Title>
          <Dialog.Description className={s.body}>
            Your Pro access continues until the end of the current period.
            Everything you made stays accessible forever.
          </Dialog.Description>

          <label className={s.reasonLabel}>
            Reason (optional)
            <select
              className={s.reasonSelect}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <div className={s.actions}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setReason('');
                onClose();
              }}
              disabled={pending}
            >
              Keep subscription
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={handleConfirm}
              disabled={pending}
            >
              {pending ? 'Cancelling…' : 'Cancel my subscription'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

