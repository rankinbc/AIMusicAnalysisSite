import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { usePatchReference } from '../../api/hooks';
import f from '../../styles/forms.module.css';
import type { ReferenceDto } from '../../api/types';

interface Props {
  reference: ReferenceDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function tagsToText(tags: unknown): string {
  return Array.isArray(tags) ? tags.filter((t) => typeof t === 'string').join(', ') : '';
}

/** Edit a saved reference's metadata (title / artist / genre / notes / tags).
 *  Audio + measured metrics are immutable here — re-upload to change those. */
export function ReferenceEditDialog({ reference, open, onOpenChange }: Props) {
  const [title, setTitle] = useState(reference.title);
  const [artist, setArtist] = useState(reference.artist ?? '');
  const [genre, setGenre] = useState(reference.genre ?? '');
  const [notes, setNotes] = useState(reference.notes ?? '');
  const [tags, setTags] = useState(tagsToText(reference.tags));
  const patch = usePatchReference(reference.id);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      toast.error('Title is required');
      return;
    }
    const tagList = tags
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    try {
      await patch.mutateAsync({
        title: t,
        artist: artist.trim() || null,
        genre: genre.trim() || null,
        notes: notes.trim() || null,
        tags: tagList,
      });
      toast.success('Reference updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>Edit reference</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Update the label and notes. Audio and measured metrics don’t change.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={f.field}>
            <label className={f.label}>
              Title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                disabled={patch.isPending}
              />
            </label>
            <label className={f.label}>
              Artist (optional)
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                maxLength={120}
                disabled={patch.isPending}
              />
            </label>
            <label className={f.label}>
              Genre (optional)
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                maxLength={50}
                placeholder="e.g. Progressive House"
                disabled={patch.isPending}
              />
            </label>
            <label className={f.label}>
              Tags (comma-separated)
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="warm, wide, loud"
                disabled={patch.isPending}
              />
            </label>
            <label className={f.label}>
              Notes (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                disabled={patch.isPending}
              />
            </label>
            {patch.error && (
              <p className={f.error}>
                {patch.error instanceof Error ? patch.error.message : 'Update failed'}
              </p>
            )}
            <div className={f.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button} disabled={patch.isPending}>
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
