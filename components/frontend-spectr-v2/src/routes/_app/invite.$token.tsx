import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { useAcceptInvite } from '../../features/listen/useInvites';
import { useOneShotEffect } from '../../lib/useOneShotEffect';

/* Wave-3 E7.1 — the invite landing route. Invite tokens are copy-paste links
 * (no email delivery); until now nothing could RECEIVE one. _app-gated, so an
 * anonymous invitee logs in first and returns here via the layout guard.
 *
 * Accept is one-shot (ref-guarded — StrictMode double-mounts effects in dev)
 * and the server side is idempotent regardless: re-accepting an accepted
 * invite re-stamps and returns 200 + InviteDto. Only missing/revoked tokens
 * 404 — with an EMPTY body, so the error copy here can't come from the server
 * (which is why this route renders a visible state instead of a toast, and
 * useAcceptInvite carries no meta.errorToast). */
function InviteAcceptRoute() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const acceptMut = useAcceptInvite();
  const [failed, setFailed] = useState(false);

  // mutateAsync, not mutate(vars, callbacks): the one-shot guard skips the
  // StrictMode re-run, but StrictMode's simulated unmount detaches the
  // MutationObserver from the in-flight mutation and the re-subscribe never
  // re-attaches it — so hook state (isError) and mutate-level callbacks are
  // lost in dev. The mutateAsync promise settles regardless of observers.
  useOneShotEffect(() => {
    acceptMut
      .mutateAsync(token)
      .then((inv) => {
        toast.success('Invite accepted.');
        void (inv.songVersionId
          ? navigate({
              to: '/listen-rack/$versionId',
              params: { versionId: inv.songVersionId },
              replace: true,
            })
          : navigate({ to: '/library', replace: true }));
      })
      .catch(() => setFailed(true));
  });

  if (failed || acceptMut.isError) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }} data-testid="invite-invalid">
        <h1>This invite is no longer valid</h1>
        <p style={{ color: 'var(--muted)' }}>
          It may have been revoked — ask for a fresh link.
        </p>
        <Link to="/library" className="btn primary sm">Go to Library</Link>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <p className="mono" style={{ color: 'var(--muted)' }}>Accepting your invite…</p>
    </div>
  );
}

export const Route = createFileRoute('/_app/invite/$token')({
  component: InviteAcceptRoute,
});
