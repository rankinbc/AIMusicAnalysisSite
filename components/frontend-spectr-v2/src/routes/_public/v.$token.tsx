import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AnonCommentList, AnonGatePills } from '../../features/listen/AnonReviewerSurface';
import { useAnonBookmark, useAnonComments, usePostAnonComment } from '../../features/listen/useAnonFeedback';
import { useVersionView } from '../../features/listen/useVersionShare';
import { Pill } from '../../ui/Pill';

// Story 11.4 — the anonymous reviewer surface on a version share token.
// The opaque token IS the grant (ResourceToken, never JWT ?t=); the durable
// anon identity rides the signed cookie, and every write is gated server-side
// by AccessService (the pills/forms below mirror, never re-implement, that).

export const Route = createFileRoute('/_public/v/$token')({
  component: VersionViewPage,
});

function VersionViewPage() {
  const { token } = Route.useParams();
  const { data, isLoading, error } = useVersionView(token);
  const { data: comments } = useAnonComments(token, Boolean(data?.gates.canComment));
  const postComment = usePostAnonComment(token);
  const bookmark = useAnonBookmark(token);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [position, setPosition] = useState(0);
  const [pinTime, setPinTime] = useState(true);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPosition(a.currentTime);
    a.addEventListener('timeupdate', onTime);
    return () => a.removeEventListener('timeupdate', onTime);
  }, [data]);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <p className="mono" style={{ color: 'var(--muted)' }}>Loading shared version…</p>
      </div>
    );
  }
  if (error || !data) {
    // AC4 — revoked/expired/private tokens land here (server 404s).
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <h1>Link not available</h1>
        <p style={{ color: 'var(--muted)' }}>
          This share link may have been revoked, set to private, or the token is incorrect.
        </p>
      </div>
    );
  }

  const seek = (t: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = t;
  };

  const submitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    postComment.mutate(
      {
        body: body.trim(),
        t: pinTime ? position : null,
        authorDisplayName: name.trim() || null,
      },
      {
        onSuccess: () => setBody(''),
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not post comment'),
      },
    );
  };

  const dropBookmark = () => {
    bookmark.mutate(
      { t: position },
      {
        onSuccess: () => toast.success(`Bookmarked ${Math.floor(position / 60)}:${String(Math.round(position % 60)).padStart(2, '0')}`),
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not bookmark'),
      },
    );
  };

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
        <audio ref={audioRef} controls src={`/api/v/${token}/audio`} preload="metadata" style={{ width: '100%' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {data.grade && <Pill>{data.grade}</Pill>}
          {data.score != null && (
            <Pill><span className="mono">{Math.round(data.score)}</span>/100</Pill>
          )}
          <AnonGatePills gates={data.gates} />
          {data.gates.canBookmark && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={dropBookmark}
              disabled={bookmark.isPending}
              style={{ marginLeft: 'auto', fontSize: 11 }}
            >
              🔖 Bookmark this moment
            </button>
          )}
        </div>
      </section>

      {data.gates.canComment && (
        <section className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Comments</h2>
          <form onSubmit={submitComment} style={{ display: 'grid', gap: 8 }}>
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What did you hear?"
              maxLength={2000}
              rows={3}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="mono" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={pinTime} onChange={(e) => setPinTime(e.target.checked)} />
                Pin to <span className="mono">{Math.floor(position / 60)}:{String(Math.round(position % 60)).padStart(2, '0')}</span>
              </label>
              <button type="submit" className="btn primary sm" disabled={!body.trim() || postComment.isPending}>
                {postComment.isPending ? 'Posting…' : 'Post'}
              </button>
            </div>
          </form>
          <AnonCommentList comments={comments ?? []} onSeek={seek} />
        </section>
      )}
    </div>
  );
}
