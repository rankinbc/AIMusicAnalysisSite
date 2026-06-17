import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';

import { useReanalyzeVersion, useReferences } from '../../api/hooks';
import f from '../../styles/forms.module.css';

interface Props {
  /** Version to re-analyze; when null the dialog is closed/unmounted by parent. */
  versionId: string;
  songId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Re-run analysis for an existing version against a chosen saved reference,
 *  then navigate to the new job's report. Secondary entry point to the
 *  use-a-reference loop (the primary one is the unified upload dialog). */
export function ReanalyzeWithReferenceDialog({ versionId, songId, open, onOpenChange }: Props) {
  const references = useReferences();
  const reanalyze = useReanalyzeVersion(versionId);
  const navigate = useNavigate();
  const [referenceId, setReferenceId] = useState('');

  const submit = () => {
    if (!referenceId) {
      toast.error('Pick a reference first');
      return;
    }
    reanalyze.mutate(
      { referenceId },
      {
        onSuccess: (res) => {
          onOpenChange(false);
          void navigate({
            to: '/songs/$songId/results/$jobId',
            params: { songId, jobId: res.jobId },
          });
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not start re-analysis'),
      },
    );
  };

  const refs = references.data ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>Compare against a reference</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Re-run this version’s analysis with a saved reference track as the Phase 5
            comparison target.
          </Dialog.Description>
          <div className={f.field}>
            {refs.length === 0 ? (
              <p className={f.error}>
                No saved references yet. Add one in your library first.
              </p>
            ) : (
              <label className={f.label}>
                Reference
                <select value={referenceId} onChange={(e) => setReferenceId(e.target.value)}>
                  <option value="">— pick one —</option>
                  {refs.map((ref) => (
                    <option key={ref.id} value={ref.id}>
                      {ref.title}
                      {ref.artist ? ` — ${ref.artist}` : ''}
                      {ref.analyzed ? '' : ' (analyzing…)'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={f.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button} disabled={reanalyze.isPending}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={submit}
                disabled={reanalyze.isPending || refs.length === 0}
                className={`${f.button} ${f.buttonPrimary}`}
              >
                {reanalyze.isPending ? 'Starting…' : 'Re-analyze'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
