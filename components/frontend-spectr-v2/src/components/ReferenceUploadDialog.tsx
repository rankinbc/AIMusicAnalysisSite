import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { useAnalyzeReference, useUploadReference } from '../api/hooks';
import f from '../styles/forms.module.css';
import s from './UploadVersionDialog.module.css';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional default genre hint inherited from the current song. */
  defaultGenre?: string;
}

/** Upload a commercial reference track for comparison. Mirrors
 *  UploadVersionDialog's UX but POSTs to /references/ and kicks off analysis
 *  on success so the new reference is immediately usable on the Compare page. */
export function ReferenceUploadDialog({ open, onOpenChange, defaultGenre }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState(defaultGenre ?? '');
  const upload = useUploadReference();
  const analyze = useAnalyzeReference();

  const reset = () => {
    setFile(null);
    setTitle('');
    setArtist('');
    setGenre(defaultGenre ?? '');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    try {
      const created = await upload.mutateAsync({
        file,
        // Server falls back to filename stem if title is empty.
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(artist.trim() ? { artist: artist.trim() } : {}),
        ...(genre.trim() ? { genre: genre.trim() } : {}),
      });
      toast.success(`Uploaded “${created.title}”`);
      // Fire-and-forget analysis — once the reference-analyzer actor lands,
      // metrics will populate; until then this just flips `analyzed=true`.
      analyze.mutate(created.id);
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>Upload reference track</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            A pro track in your genre. WAV, FLAC, MP3. Up to 250 MB. Analysis
            runs in the background.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={f.field}>
            <label className={f.label}>
              Audio file
              <input
                type="file"
                accept=".wav,.flac,.mp3,audio/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                disabled={upload.isPending}
                className={s.fileInput}
              />
            </label>
            <label className={f.label}>
              Title (optional)
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="defaults to filename"
                maxLength={200}
                disabled={upload.isPending}
              />
            </label>
            <label className={f.label}>
              Artist (optional)
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                maxLength={120}
                disabled={upload.isPending}
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
                disabled={upload.isPending}
              />
            </label>
            {upload.error && (
              <p className={f.error}>
                {upload.error instanceof Error ? upload.error.message : 'Upload failed'}
              </p>
            )}
            <div className={f.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button} disabled={upload.isPending}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={!file || upload.isPending}
                className={`${f.button} ${f.buttonPrimary}`}
              >
                {upload.isPending ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
