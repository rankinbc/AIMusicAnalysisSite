import * as Dialog from '@radix-ui/react-dialog';

import f from '../styles/forms.module.css';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  isPending = false,
}: Props) {
  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>{title}</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>{description}</Dialog.Description>
          <div className={f.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={f.button} disabled={isPending}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={`${f.button} ${danger ? f.buttonDanger : f.buttonPrimary}`}
              disabled={isPending}
              onClick={() => void handleConfirm()}
            >
              {isPending ? '…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
