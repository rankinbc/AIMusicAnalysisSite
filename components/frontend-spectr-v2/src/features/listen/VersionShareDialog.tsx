/* Wave-3 E7.1 — minimal owner share/invite surface for a version. The backend
 * (VersionShareEndpoints) is fully shipped; this dialog is its first consumer.
 * Deliberately MINIMAL: visibility + link + gates + invite list/create — the
 * polished share center is future product work.
 *
 * Failure feedback: every mutation here carries `meta.errorToast` (Task 2's
 * global handler) — NO local onError. Local onSuccess toasts only for
 * copy/rotate/create. */
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { toast } from 'sonner';

import type { CreateInviteRequest, InviteDto, ShareSettingsDto } from '../../api/types';
import f from '../../styles/forms.module.css';
import { useCreateInvite, useInvites, useRevokeInvite } from './useInvites';
import { useRotateToken, useShareSettings, useUpdateShareSettings } from './useVersionShare';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  songName: string;
}

function inviteWhoLabel(inv: InviteDto): string {
  if (inv.invitedEmail) return inv.invitedEmail;
  if (inv.invitedHandle) return `@${inv.invitedHandle}`;
  return 'open link';
}

export function VersionShareDialog({ open, onOpenChange, versionId, songName }: Props) {
  // Fetch only while open — the dialog mounts with the page.
  const activeId = open ? versionId : '';
  const settingsQ = useShareSettings(activeId);
  const invitesQ = useInvites(activeId);
  const updateMut = useUpdateShareSettings(versionId);
  const rotateMut = useRotateToken(versionId);
  const createInviteMut = useCreateInvite(versionId);
  const revokeInviteMut = useRevokeInvite(versionId);

  const [copied, setCopied] = useState<string | null>(null); // which link was copied
  const [inviteRole, setInviteRole] = useState<'reviewer' | 'listener'>('reviewer');
  const [inviteWho, setInviteWho] = useState('');

  // Reset transient state once the dialog closes so re-opening is clean.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCopied(null);
      setInviteWho('');
      setInviteRole('reviewer');
    }
    onOpenChange(next);
  };

  const s = settingsQ.data;
  const shareUrl = s?.shareToken && s.visibility !== 'private'
    ? `${window.location.origin}/v/${s.shareToken}`
    : null;

  const copy = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Could not copy — your browser blocked clipboard access.');
    }
  };

  const createInvite = () => {
    if (createInviteMut.isPending) return;
    const who = inviteWho.trim();
    // One input, two shapes: "@handle" / bare word → handle; "a@b" → email;
    // empty → open invite (the token itself is the credential).
    const body: CreateInviteRequest = who.startsWith('@')
      ? { role: inviteRole, invitedHandle: who.slice(1) }
      : who.includes('@')
        ? { role: inviteRole, invitedEmail: who }
        : { role: inviteRole, ...(who ? { invitedHandle: who } : {}) };
    createInviteMut.mutate(body, {
      onSuccess: () => {
        setInviteWho('');
        toast.success('Invite created — copy its link below.');
      },
    });
  };

  const invites = invitesQ.data ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>Share “{songName}”</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Control who can listen to this version, mint a listen link, and
            invite reviewers or listeners.
          </Dialog.Description>

          {settingsQ.isLoading ? (
            <p className={f.dialogDescription}>Loading sharing settings…</p>
          ) : settingsQ.isError ? (
            <>
              <p className={f.error}>Couldn&rsquo;t load sharing settings.</p>
              <button type="button" className={f.button} onClick={() => void settingsQ.refetch()}>
                Retry
              </button>
            </>
          ) : s ? (
            <>
              <label className={f.label}>
                Visibility
                <select
                  className={f.input}
                  value={s.visibility}
                  disabled={updateMut.isPending}
                  onChange={(e) =>
                    updateMut.mutate({
                      visibility: e.target.value as ShareSettingsDto['visibility'],
                    })
                  }
                >
                  <option value="private">Private — only you and invitees</option>
                  <option value="unlisted">Unlisted — anyone with the link</option>
                  <option value="public">Public</option>
                </select>
              </label>

              {shareUrl && (
                <label className={f.label}>
                  Listen link
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      readOnly
                      value={shareUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className={`${f.button} ${f.buttonPrimary}`}
                      onClick={() => void copy(shareUrl, 'share')}
                    >
                      {copied === 'share' ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      className={f.button}
                      disabled={rotateMut.isPending}
                      title="Mint a fresh link; the current one stops working immediately"
                      onClick={() =>
                        rotateMut.mutate(undefined, {
                          onSuccess: () => toast.success('Link rotated — the old link is dead.'),
                        })
                      }
                    >
                      {rotateMut.isPending ? 'Rotating…' : '↻ Rotate'}
                    </button>
                  </div>
                </label>
              )}

              <label className={f.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={s.showVerdicts}
                  disabled={updateMut.isPending}
                  onChange={(e) => updateMut.mutate({ showVerdicts: e.target.checked })}
                />
                Show AI verdicts to listeners
              </label>
              <label className={f.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={s.suggestionsAllowed}
                  disabled={updateMut.isPending}
                  onChange={(e) => updateMut.mutate({ suggestionsAllowed: e.target.checked })}
                />
                Allow rack suggestions
              </label>
              <label className={f.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={s.bookmarkingAllowed}
                  disabled={updateMut.isPending}
                  onChange={(e) => updateMut.mutate({ bookmarkingAllowed: e.target.checked })}
                />
                Allow bookmarking
              </label>
              <label className={f.label}>
                Comments
                <select
                  className={f.input}
                  value={s.commentsPolicy}
                  disabled={updateMut.isPending}
                  onChange={(e) =>
                    updateMut.mutate({
                      commentsPolicy: e.target.value as ShareSettingsDto['commentsPolicy'],
                    })
                  }
                >
                  <option value="off">Off</option>
                  <option value="link">Anyone with the link</option>
                  <option value="named">Named accounts only</option>
                </select>
              </label>

              <p className={f.label} style={{ marginBottom: 4 }}>Invites</p>
              {invitesQ.isError ? (
                <p className={f.hint}>Couldn&rsquo;t load invites.</p>
              ) : invites.length === 0 ? (
                <p className={f.hint}>No invites yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {invites.map((inv) => (
                    <li key={inv.id} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                      <span className="pill">{inv.role}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inviteWhoLabel(inv)}
                      </span>
                      <span style={{ color: 'var(--muted)' }}>{inv.status}</span>
                      <button
                        type="button"
                        className={f.button}
                        onClick={() =>
                          void copy(`${window.location.origin}/invite/${inv.token}`, inv.id)
                        }
                      >
                        {copied === inv.id ? 'Copied' : 'Copy link'}
                      </button>
                      {inv.status !== 'revoked' && (
                        <button
                          type="button"
                          className={f.button}
                          style={{ color: 'var(--red)' }}
                          disabled={revokeInviteMut.isPending}
                          onClick={() => revokeInviteMut.mutate(inv.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  className={f.input}
                  style={{ width: 110, flex: 'none' }}
                  aria-label="Invite role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'reviewer' | 'listener')}
                >
                  <option value="reviewer">reviewer</option>
                  <option value="listener">listener</option>
                </select>
                <input
                  className={f.input}
                  style={{ flex: 1 }}
                  placeholder="email or @handle (optional)"
                  aria-label="Invite email or handle"
                  value={inviteWho}
                  onChange={(e) => setInviteWho(e.target.value)}
                />
                <button
                  type="button"
                  className={`${f.button} ${f.buttonPrimary}`}
                  disabled={createInviteMut.isPending}
                  onClick={createInvite}
                >
                  {createInviteMut.isPending ? 'Inviting…' : 'Invite'}
                </button>
              </div>

              <div className={f.dialogActions}>
                <Dialog.Close asChild>
                  <button type="button" className={f.button}>Done</button>
                </Dialog.Close>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
