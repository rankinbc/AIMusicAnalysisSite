import { createFileRoute } from '@tanstack/react-router';

import { useVersionView } from '../../features/listen/useVersionShare';
import { Pill } from '../../ui/Pill';

// Listen V3 (PRP-2) — anonymous View entry for a version share link. The opaque
// token IS the grant: /api/v/{token} resolves the version within the owner's
// gates, and <audio> streams /api/v/{token}/audio (Range, AllowAnonymous). The
// full Work/View/Room experience is the page-impl thread; this is the entry.

export const Route = createFileRoute('/_public/v/$token')({
  component: VersionViewPage,
});

function VersionViewPage() {
  const { token } = Route.useParams();
  const { data, isLoading, error } = useVersionView(token);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <p className="mono" style={{ color: 'var(--muted)' }}>Loading shared version…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <h1>Link not available</h1>
        <p style={{ color: 'var(--muted)' }}>
          This share link may have been revoked, set to private, or the token is incorrect.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 32, display: 'grid', gap: 20 }}>
      <header>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--cyan)' }}>
          SPECTR · Shared listen
        </div>
        <h1 style={{ margin: '4px 0 0' }}>{data.songName}</h1>
        <p className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
          v{data.versionNumber} · {data.visibility}
        </p>
      </header>

      <section className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <audio controls src={`/api/v/${token}/audio`} preload="metadata" style={{ width: '100%' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.grade && <Pill>{data.grade}</Pill>}
          {data.score != null && (
            <Pill><span className="mono">{Math.round(data.score)}</span>/100</Pill>
          )}
          {data.gates.canComment && <Pill tone="cyan">comments open</Pill>}
          {data.gates.canSuggest && <Pill tone="violet">suggestions open</Pill>}
        </div>
      </section>
    </div>
  );
}
