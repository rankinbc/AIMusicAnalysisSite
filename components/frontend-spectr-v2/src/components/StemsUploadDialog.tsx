import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { useUploadStems } from '../api/hooks';
import { STEM_ROLES, type StemRole } from '../api/types';
import f from '../styles/forms.module.css';
import s from './UploadVersionDialog.module.css';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  songId: string;
}

/** Multi-file picker for per-role stem uploads. Each role is independent —
 *  users typically upload 4-8 stems, not all 10, and we don't gate on the
 *  full set being present. */
export function StemsUploadDialog({ open, onOpenChange, versionId, songId }: Props) {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const upload = useUploadStems(versionId);
  const navigate = useNavigate();

  const reset = () => setFiles({});

  const setFile = (role: StemRole, file: File | null) => {
    setFiles((prev) => ({ ...prev, [role]: file }));
  };

  const filled = Object.entries(files).filter(([, f]) => f != null) as [
    StemRole,
    File,
  ][];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (filled.length === 0) return;
    try {
      const payload: Record<string, File> = {};
      for (const [role, file] of filled) payload[role] = file;
      const res = await upload.mutateAsync(payload);
      toast.success(
        `Uploaded ${filled.length} stem${filled.length === 1 ? '' : 's'} — re-analyzing.`,
      );
      onOpenChange(false);
      reset();
      void navigate({
        to: '/songs/$songId/results/$jobId',
        params: { songId, jobId: res.reanalysisJobId },
      });
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
          <Dialog.Title className={f.dialogTitle}>Upload stems</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            One file per role. WAV/FLAC, up to 250 MB each. Skip roles you
            don't have — partial sets are fine.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={f.field}>
            <div className={s.stemGrid}>
              {STEM_ROLES.map((role) => (
                <label key={role} className={s.stemRow}>
                  <span className={s.stemRole}>{role}</span>
                  <input
                    type="file"
                    accept=".wav,.flac,audio/*"
                    onChange={(e) => setFile(role, e.target.files?.[0] ?? null)}
                    disabled={upload.isPending}
                    className={s.fileInput}
                  />
                </label>
              ))}
            </div>
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
                disabled={filled.length === 0 || upload.isPending}
                className={`${f.button} ${f.buttonPrimary}`}
              >
                {upload.isPending
                  ? 'Uploading…'
                  : `Upload ${filled.length} & re-analyze`}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
