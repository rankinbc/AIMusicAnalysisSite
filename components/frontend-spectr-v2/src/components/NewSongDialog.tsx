import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { useCreateSong } from '../api/hooks';
import f from '../styles/forms.module.css';
import { SongFields, type SongFieldsValue } from './SongFields';
import s from './SongFields.module.css';
import { emptySongFields, songFieldsToRequest } from './song-fields-helpers';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (songId: string) => void;
}

export function NewSongDialog({ open, onOpenChange, onCreated }: Props) {
  const [value, setValue] = useState<SongFieldsValue>(emptySongFields);
  const nameRef = useRef<HTMLInputElement>(null);
  const create = useCreateSong();

  // Re-seed a fresh random visual every time the dialog opens, and focus Name.
  useEffect(() => {
    if (open) {
      setValue(emptySongFields());
      const t = window.setTimeout(() => nameRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const canSubmit = value.name.trim().length > 0 && !create.isPending;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const song = await create.mutateAsync(songFieldsToRequest(value));
      toast.success(`Created “${song.name}”`);
      onCreated?.(song.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create song');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={s.wideContent} aria-describedby={undefined}>
          <div className={s.header}>
            <Dialog.Title className={s.title}>New song</Dialog.Title>
            <Dialog.Description className={s.desc}>
              Name it and go — everything else is optional. You can upload its first version right after.
            </Dialog.Description>
          </div>

          <form onSubmit={handleSubmit}>
            <SongFields value={value} onChange={setValue} nameRef={nameRef} />

            <div className={s.actions}>
              <span className={s.spacer}>Press ⏎ to create</span>
              <Dialog.Close asChild>
                <button type="button" className={f.button} disabled={create.isPending}>
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" disabled={!canSubmit} className={`${f.button} ${f.buttonPrimary}`}>
                {create.isPending ? 'Creating…' : 'Create song'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
