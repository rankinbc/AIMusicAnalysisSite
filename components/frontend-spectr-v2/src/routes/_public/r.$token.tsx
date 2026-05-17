import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  usePostShareComment,
  useShareComments,
  useSharedAnalysis,
} from '../../api/hooks';
import { isFinalJson, type FinalJson, type Phase1Data } from '../../api/types';
import { GradePill } from '../../ui/GradePill';
import { Pill } from '../../ui/Pill';
import s from './r.module.css';

// Anonymous public review page for a shared analysis. WaveSurfer-quality
// playback is out of scope for slice 1; we render a native <audio> element
// against /api/share/{token}/audio (Range-friendly) plus a comments thread
// with optional timestamp pins.

export const Route = createFileRoute('/_public/r/$token')({
  component: SharedReviewerPage,
});

function SharedReviewerPage() {
  const { token } = Route.useParams();
  const { data, isLoading, error } = useSharedAnalysis(token);
  const { data: comments } = useShareComments(token);
  const post = usePostShareComment(token);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [pinTime, setPinTime] = useState(true);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPosition(a.currentTime);
    const onDur = () => Number.isFinite(a.duration) && setDuration(a.duration);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onDur);
    a.addEventListener('durationchange', onDur);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onDur);
      a.removeEventListener('durationchange', onDur);
    };
  }, []);

  const fj: FinalJson = useMemo(() => {
    return isFinalJson(data?.finalJson) ? (data.finalJson as FinalJson) : {};
  }, [data]);
  const phase1: Phase1Data | undefined = useMemo(() => {
    const p = fj.phases?.find((x) => x.phase === 1);
    return p?.data as Phase1Data | undefined;
  }, [fj]);

  if (isLoading) {
    return (
      <div className={s.page}>
        <p className={`mono ${s.status}`}>Loading shared report…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className={s.page}>
        <h1 className={s.title}>Share link not found</h1>
        <p className={s.subtitle}>
          The link may have been revoked or the token is incorrect.
        </p>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    post.mutate(
      {
        body: body.trim(),
        timestampSeconds: pinTime ? position : null,
        authorDisplayName: name.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success('Comment posted');
          setBody('');
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not post comment'),
      },
    );
  };

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <div className={s.overline}>SPECTR · Shared review</div>
          <h1 className={s.title}>{data.songName ?? 'Untitled'}</h1>
          {(data.producerDisplayName || data.producerHandle) && (
            <p className={s.subtitle}>
              by{' '}
              {data.producerDisplayName ?? `@${data.producerHandle}`}
              {data.producerHandle && data.producerDisplayName && (
                <span style={{ color: 'var(--muted)' }}> · @{data.producerHandle}</span>
              )}
            </p>
          )}
        </div>
        <div className={s.headerMeta}>
          {fj.grade && <GradePill grade={fj.grade} size="md" />}
          {fj.overall_score != null && (
            <Pill>
              <span className="mono">{Math.round(fj.overall_score)}</span>/100
            </Pill>
          )}
        </div>
      </header>

      <section className={`card ${s.playerCard}`}>
        <audio
          ref={audioRef}
          controls
          src={`/api/share/${token}/audio`}
          className={s.audio}
          preload="metadata"
        />
        <div className={s.metaRow}>
          {phase1?.bpm != null && (
            <Pill>
              <span className="mono">{Math.round(phase1.bpm)}</span> BPM
            </Pill>
          )}
          {phase1?.detected_key && (
            <Pill>
              <span className="mono">{phase1.detected_key}</span>
            </Pill>
          )}
          {phase1?.lufs != null && (
            <Pill>
              <span className="mono">{phase1.lufs.toFixed(1)}</span> LUFS
            </Pill>
          )}
        </div>
      </section>

      <section className={`card ${s.commentsCard}`}>
        <h2 className={s.sectionTitle}>Comments</h2>
        <form onSubmit={submit} className={s.commentForm}>
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className={s.commentName}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What did you hear?"
            maxLength={2000}
            rows={3}
            className={s.commentBody}
          />
          <div className={s.commentControls}>
            <label className={s.pinToggle}>
              <input
                type="checkbox"
                checked={pinTime}
                onChange={(e) => setPinTime(e.target.checked)}
              />
              Pin to <span className="mono">{formatTime(position)}</span>
            </label>
            <button
              type="submit"
              className="btn primary sm"
              disabled={!body.trim() || post.isPending}
            >
              {post.isPending ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>

        <ul className={s.commentList}>
          {(comments ?? []).length === 0 ? (
            <li className={`mono ${s.empty}`}>No comments yet.</li>
          ) : (
            comments!.map((c) => (
              <li
                key={c.id}
                className={s.commentRow}
                onClick={() => {
                  if (audioRef.current && c.timestampSeconds != null) {
                    audioRef.current.currentTime = c.timestampSeconds;
                  }
                }}
              >
                <span className={`mono ${s.commentMeta}`}>
                  {c.timestampSeconds != null
                    ? `@${formatTime(c.timestampSeconds)}`
                    : '·'}{' '}
                  · {c.authorDisplayName ?? 'anon'} ·{' '}
                  {new Date(c.createdAt).toLocaleDateString()}
                </span>
                <p className={s.commentBodyText}>{c.body}</p>
              </li>
            ))
          )}
        </ul>
      </section>

      {duration > 0 && null /* preserve duration for future scrubber */}
    </div>
  );
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
