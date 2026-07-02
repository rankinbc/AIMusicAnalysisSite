import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCreateShare, usePatchShare, useRegenerateShare, useRevokeShare } from '../api/hooks';
import f from '../styles/forms.module.css';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Analysis ID — POST creates the share if none exists, returns the
   *  existing token otherwise. */
  analysisId: string;
  songName: string;
}

/** Publish + manage a public share link for a song's latest analysis.
 *  Opening the dialog upserts the share (idempotent) so the link is ready
 *  immediately. Toggle reveals/hides verdicts on the public reviewer;
 *  Revoke deletes the token. */
export function SharePublishDialog({ open, onOpenChange, analysisId, songName }: Props) {
  const create = useCreateShare(analysisId);
  const patch = usePatchShare(analysisId);
  const revoke = useRevokeShare(analysisId);
  const regenerate = useRegenerateShare(analysisId);

  const [token, setToken] = useState<string | null>(null);
  const [showVerdicts, setShowVerdicts] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || token) return;
    create.mutate(undefined, {
      onSuccess: (res) => {
        setToken(res.shareToken);
        setShowVerdicts(res.shareShowVerdicts);
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Could not create share link'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset internal state once dialog fully closes so re-opening for a
  // different song doesn't show the previous URL.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setToken(null);
      setCopied(false);
    }
    onOpenChange(next);
  };

  const publicUrl = token ? `${window.location.origin}/r/${token}` : '';

  const handleCopy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy — your browser blocked clipboard access.');
    }
  };

  const handleToggleVerdicts = (next: boolean) => {
    setShowVerdicts(next);
    patch.mutate(
      { showVerdicts: next },
      {
        onError: (err) => {
          setShowVerdicts(!next);
          toast.error(err instanceof Error ? err.message : 'Could not update share settings');
        },
      },
    );
  };

  const handleRevoke = () => {
    revoke.mutate(undefined, {
      onSuccess: () => {
        toast.success('Share link revoked');
        handleOpenChange(false);
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Could not revoke share link'),
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>Publish “{songName}”</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Anyone with the link can open a read-only reviewer page with the audio,
            scores, and coach summary. They don&apos;t need an account.
          </Dialog.Description>

          {create.isPending && !token ? (
            <p className={f.dialogDescription}>Generating link…</p>
          ) : token ? (
            <>
              {/* Story 7.3 (UX-DR42) — glyph + one-line scope statement of
                  EXACTLY what a share exposes (and what it never does). */}
              <p
                className="mono"
                data-testid="share-scope"
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11,
                  lineHeight: 1.5, color: 'var(--text-2)', padding: '8px 10px',
                  borderRadius: 8, background: 'rgba(0, 229, 176, 0.06)',
                  border: '1px solid rgba(0, 229, 176, 0.25)', margin: '0 0 12px',
                }}
              >
                <span aria-hidden>🌐</span>
                <span>
                  Public link — anyone with it can play the track and see the grade,
                  score{showVerdicts ? ', top signals' : ''} and comments. Your project
                  file, stems and library stay private.
                </span>
              </p>

              <label className={f.label}>
                Public link
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    readOnly
                    value={publicUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className={`${f.button} ${f.buttonPrimary}`}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </label>

              <label
                className={f.label}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={showVerdicts}
                  onChange={(e) => handleToggleVerdicts(e.target.checked)}
                  disabled={patch.isPending}
                />
                Show AI specialist verdicts on the public report
              </label>

              <div className={f.dialogActions}>
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={revoke.isPending}
                  className={f.button}
                  style={{ color: 'var(--red)' }}
                >
                  {revoke.isPending ? 'Revoking…' : '🔒 Revoke link'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    regenerate.mutate(undefined, {
                      onSuccess: (res) => {
                        setToken(res.shareToken);
                        toast.success('New link created — the old one is dead');
                      },
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : 'Could not regenerate'),
                    })
                  }
                  disabled={regenerate.isPending}
                  className={f.button}
                  title="Mint a fresh link; the current one stops working immediately"
                >
                  {regenerate.isPending ? 'Regenerating…' : '↻ Regenerate'}
                </button>
                <Dialog.Close asChild>
                  <button type="button" className={f.button}>
                    Done
                  </button>
                </Dialog.Close>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
