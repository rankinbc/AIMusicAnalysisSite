import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { useUploadAls } from '../api/hooks';
import { isGuestRestrictedError } from '../api/mutation-error-toast';
import f from '../styles/forms.module.css';
import s from './UploadVersionDialog.module.css';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  songId: string;
}

export function AlsUploadDialog({ open, onOpenChange, versionId, songId }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const upload = useUploadAls(versionId);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    try {
      const res = await upload.mutateAsync({ file });
      toast.success('Project uploaded — re-analyzing.');
      onOpenChange(false);
      setFile(null);
      // This dialog always re-analyzes (never analyze=false), so the job id is
      // present; the guard satisfies the now-nullable type.
      if (res.reanalysisJobId) {
        void navigate({
          to: '/songs/$songId/results/$jobId',
          params: { songId, jobId: res.reanalysisJobId },
        });
      }
    } catch (err) {
      // D10 fix1 (item 1) — useUploadAls is a useMutation; the app's global
      // MutationCache already opened the upgrade dialog + fired analytics
      // for a guest_restricted 403 (mutation-error-toast.ts). Skip ONLY the
      // toast here — calling handleGuestRestricted again would double-fire
      // both.
      if (isGuestRestrictedError(err)) return;
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setFile(null);
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>Upload Ableton project</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            .als or gzip-compressed .als. Unlocks track-name detection,
            device-chain analysis, MIDI quantization checks.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={f.field}>
            <label className={f.label}>
              Project file
              <input
                type="file"
                accept=".als,.gz"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                disabled={upload.isPending}
                className={s.fileInput}
              />
            </label>
            {upload.error && (
              <p className={f.error}>
                {upload.error instanceof Error
                  ? upload.error.message
                  : 'Upload failed'}
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
                {upload.isPending ? 'Uploading…' : 'Upload & re-analyze'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
