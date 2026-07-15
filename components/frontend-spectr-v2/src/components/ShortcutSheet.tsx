import * as Dialog from '@radix-ui/react-dialog';

import f from '../styles/forms.module.css';
import s from './ShortcutSheet.module.css';

// Story 5.10 (UX-DR43) — the `?` shortcut sheet. Static inventory of the
// global bindings; ⌘/Ctrl shown together (mac/win).

interface ShortcutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BINDINGS: Array<{ keys: string; action: string }> = [
  { keys: '⌘K / Ctrl+K', action: 'Search songs and pages' },
  { keys: '⌘U / Ctrl+U', action: 'Upload a new song' },
  { keys: '?', action: 'This shortcut sheet' },
  { keys: 'Esc', action: 'Close dialogs and menus' },
];

export function ShortcutSheet({ open, onOpenChange }: ShortcutSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent} aria-describedby={undefined}>
          <Dialog.Title className={f.dialogTitle}>Keyboard shortcuts</Dialog.Title>
          <dl className={s.grid}>
            {BINDINGS.map((b) => (
              <div key={b.keys} className={s.row}>
                <dt className={`mono ${s.keys}`}>{b.keys}</dt>
                <dd className={s.action}>{b.action}</dd>
              </div>
            ))}
          </dl>
          <div className={f.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={f.button}>
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
