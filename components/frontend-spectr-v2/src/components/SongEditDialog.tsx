import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';

import { useCreateTag, useDeleteTag, usePatchSong } from '../api/hooks';
import type { SongDto } from '../api/types';
import f from '../styles/forms.module.css';
import s from './SongEditDialog.module.css';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: SongDto;
}

export function SongEditDialog({ open, onOpenChange, song }: Props) {
  const [name, setName] = useState(song.name);
  const [genre, setGenre] = useState(song.genreHint ?? '');
  const [tagInput, setTagInput] = useState('');
  const [isPublicTag, setIsPublicTag] = useState(false);

  const patch = usePatchSong(song.id);
  const createTag = useCreateTag(song.id);
  const deleteTag = useDeleteTag(song.id);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    try {
      await patch.mutateAsync({
        name: trimmedName !== song.name ? trimmedName : null,
        genreHint: genre.trim() || null,
      });
      toast.success('Saved');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save changes');
    }
  };

  const addTag = async () => {
    const n = tagInput.trim();
    if (!n) return;
    try {
      await createTag.mutateAsync({ name: n, isPublic: isPublicTag });
      setTagInput('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add tag');
    }
  };

  const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void addTag();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>Edit song</Dialog.Title>

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

            <div className={f.label}>
              Tags
              <div className={s.tagInputRow}>
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={onTagKeyDown}
                  maxLength={64}
                  placeholder="Type a tag and press Enter"
                  className={f.input}
                />
                <label className={s.publicToggle}>
                  <input
                    type="checkbox"
                    checked={isPublicTag}
                    onChange={(e) => setIsPublicTag(e.target.checked)}
                  />
                  public
                </label>
              </div>
              {song.tags.length > 0 && (
                <div className={s.tagList}>
                  {song.tags.map((t) => (
                    <span key={t.id} className={s.tagPill} data-public={t.isPublic}>
                      {t.name}
                      {t.isPublic && <span className={s.tagScope}>pub</span>}
                      <button
                        type="button"
                        className={s.tagRemove}
                        onClick={() => void deleteTag.mutateAsync(t.id)}
                        aria-label={`Remove tag ${t.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className={f.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={patch.isPending}
                className={`${f.button} ${f.buttonPrimary}`}
              >
                {patch.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
