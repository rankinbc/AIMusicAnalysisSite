// Story 4.6 (FR27) — export + delete-account controls for the profile
// Settings tab. Deletion demands the password AND a typed DELETE; an active
// subscription surfaces the cancel-first explanation (409) and requires a
// second, explicit confirmation.
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { fetcher } from '../../api/fetcher';
import f from '../../styles/forms.module.css';
import s from '../../routes/_app/profile.module.css';

export function DangerZone({ onDeleted }: { onDeleted: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await fetcher<unknown>({ url: '/me/export', method: 'GET' });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spectr-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed — wait a moment and try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={s.dangerActions}>
      <button type="button" className="btn sm" onClick={handleExport} disabled={exporting}>
        {exporting ? 'Preparing…' : '⇣ Export all data'}
      </button>
      <button
        type="button"
        className={`btn sm ${s.dangerBtn}`}
        onClick={() => setDialogOpen(true)}
      >
        Delete account
      </button>
      {dialogOpen && (
        <DeleteAccountDialog onClose={() => setDialogOpen(false)} onDeleted={onDeleted} />
      )}
    </div>
  );
}

export function DeleteAccountDialog({
  onClose,
  onDeleted,
}: {
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [needsCancelConfirm, setNeedsCancelConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = confirmText === 'DELETE' && password.length > 0 && !pending;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPending(true);
    try {
      await fetcher<void>({
        url: '/me/delete',
        method: 'POST',
        data: { password, confirmCancel: needsCancelConfirm },
      });
      onDeleted(); // signs out + clears local auth
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('409') || msg.toLowerCase().includes('subscription')) {
        // AC3: the server explained cancellation-first — surface the
        // consequence and require one more explicit go.
        setNeedsCancelConfirm(true);
        setError(
          'Your subscription is still active. Continuing cancels it immediately '
            + 'with no refund for the remaining period. Submit again to confirm.',
        );
      } else if (msg.includes('401')) {
        setError('Password check failed.');
      } else {
        setError('Deletion failed — try again.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={f.dialogOverlay} onClick={onClose}>
      <div
        className={f.dialogContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className={f.dialogTitle}>Delete your account?</h2>
        <p className={f.dialogDescription}>
          This permanently removes your audio, stems, projects, reports, and coach
          chats. There is no undo. Consider exporting first.
        </p>
        <form onSubmit={handleSubmit} className={s.settingsList}>
          <label className={f.label}>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={f.input}
            />
          </label>
          <label className={f.label}>
            Type DELETE to confirm
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className={f.input}
            />
          </label>
          {error && <p className={f.error}>{error}</p>}
          <div className={f.dialogActions}>
            <button type="button" className={f.button} onClick={onClose} disabled={pending}>
              Keep my account
            </button>
            <button
              type="submit"
              className={`${f.button} ${f.buttonDanger}`}
              disabled={!canSubmit}
            >
              {pending
                ? 'Deleting…'
                : needsCancelConfirm
                  ? 'Cancel subscription and delete'
                  : 'Delete forever'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
