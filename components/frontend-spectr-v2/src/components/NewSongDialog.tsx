import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import f from '../styles/forms.module.css';
import { useCreateSong } from '../api/hooks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (songId: string) => void;
}

export function NewSongDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const [genre, setGenre] = useState('');
  const create = useCreateSong();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const song = await create.mutateAsync({
        name: name.trim(),
        genreHint: genre.trim() || null,
      });
      toast.success(`Created “${song.name}”`);
      setName('');
      setGenre('');
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
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>New song</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Start a song. You can upload its first version after creating it.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={f.field}>
            <label className={f.label}>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                className={f.input}
              />
            </label>
            <label className={f.label}>
              Genre hint <span className={f.hint}>(optional)</span>
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                maxLength={50}
                className={f.input}
              />
            </label>
            <div className={f.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={create.isPending}
                className={`${f.button} ${f.buttonPrimary}`}
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
