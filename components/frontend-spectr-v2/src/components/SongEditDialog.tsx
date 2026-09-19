import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';

import { useCreateTag, useDeleteTag, usePatchSong, useReferenceSets } from '../api/hooks';
import type { SongDto } from '../api/types';
import f from '../styles/forms.module.css';
import { SongFields, type SongFieldsValue } from './SongFields';
import sf from './SongFields.module.css';
import { songFieldsFromSong, songFieldsToRequest } from './song-fields-helpers';
import s from './SongEditDialog.module.css';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: SongDto;
}

export function SongEditDialog({ open, onOpenChange, song }: Props) {
  const { data: sets } = useReferenceSets();
  const [value, setValue] = useState<SongFieldsValue>(() => songFieldsFromSong(song, sets ?? []));
  const [tagInput, setTagInput] = useState('');
  const [isPublicTag, setIsPublicTag] = useState(false);

  const patch = usePatchSong(song.id);
  const createTag = useCreateTag(song.id);
  const deleteTag = useDeleteTag(song.id);

  // Re-seed when (re)opening or once reference sets resolve (so a set-kind
  // profile shows its name/hue rather than staying blank).
  useEffect(() => {
    if (open) {
      setValue(songFieldsFromSong(song, sets ?? []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, song.id, sets]);

  const canSubmit = value.name.trim().length > 0 && !patch.isPending;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await patch.mutateAsync(songFieldsToRequest(value));
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
        <Dialog.Content className={sf.wideContent} aria-describedby={undefined}>
          <div className={sf.header}>
            <Dialog.Title className={sf.title}>Edit song</Dialog.Title>
          </div>

          <form onSubmit={handleSubmit}>
            <SongFields value={value} onChange={setValue} />

            <div className={s.tagSection}>
              <span className={sf.fieldLabel}>Tags</span>
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

            <div className={sf.actions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button} disabled={patch.isPending}>
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" disabled={!canSubmit} className={`${f.button} ${f.buttonPrimary}`}>
                {patch.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
