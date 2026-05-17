import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import f from '../styles/forms.module.css';
import s from './UploadVersionDialog.module.css';
import { useFileUpload } from '../hooks/useFileUpload';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId?: string; // when omitted, the BFF auto-creates a Song from the filename stem
  triggerLabel?: string;
}

export function UploadVersionDialog({ open, onOpenChange, songId }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const upload = useFileUpload();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    try {
      const fields = songId ? { song_id: songId } : {};
      const res = await upload.upload(file, fields);
      toast.success('Upload complete — analysis dispatched.');
      onOpenChange(false);
      setFile(null);
      void navigate({
        to: '/songs/$songId/results/$jobId',
        params: { songId: res.songId, jobId: res.jobId },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>
            {songId ? 'Upload new version' : 'Upload your first track'}
          </Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            WAV, FLAC, or MP3. Up to 250 MB. Analysis runs after upload.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={f.field}>
            <label className={f.label}>
              Audio file
              <input
                type="file"
                accept=".wav,.flac,.mp3,audio/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                disabled={upload.isUploading}
                className={s.fileInput}
              />
            </label>
            {upload.isUploading && (
              <progress value={upload.progress} max={1} className={s.progress} />
            )}
            {upload.error && <p className={f.error}>{upload.error}</p>}
            <div className={f.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button} disabled={upload.isUploading}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={!file || upload.isUploading}
                className={`${f.button} ${f.buttonPrimary}`}
              >
                {upload.isUploading
                  ? `Uploading… ${Math.round(upload.progress * 100)}%`
                  : 'Upload'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
