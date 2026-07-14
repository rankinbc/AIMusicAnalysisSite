import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ATTRIBUTION_KEY } from '../../lib/attribution';

import {
  usePostShareComment,
  useShareComments,
  useSharedAnalysis,
} from '../../api/hooks';
import { isFinalJson, type FinalJson, type Phase1Data } from '../../api/types';
import { createMediaRetry } from '../../features/listen/media-retry';
import { GradePill } from '../../ui/GradePill';
import { Pill } from '../../ui/Pill';
import s from './r.module.css';

// Anonymous public review page for a shared analysis. WaveSurfer-quality
// playback is out of scope for slice 1; we render a native <audio> element
// against /api/share/{token}/audio (Range-friendly) plus a comments thread
// with optional timestamp pins.

// Story 7.1 — the share endpoint's projected verdict shape (snake_case, user
// state pre-stripped server-side).
interface ShareVerdict {
  id: string;
  severity: string | null;
  headline: string | null;
  summary: string | null;
  metric_line: string | null;
  evidence: { metric?: string; label?: string; value?: unknown }[] | null;
}

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
    // Story 3.3 (AC4): expired presigned URL on resume → re-request the same
    // API URL (the server mints a fresh presign) and restore the position.
    const retry = createMediaRetry({
      getSrc: () => `/api/share/${token}/audio`,
      onGiveUp: () => toast.error('Could not load audio.'),
    });
    const onErr = () => { void retry.handleError(a); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onDur);
    a.addEventListener('durationchange', onDur);
    a.addEventListener('error', onErr);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onDur);
      a.removeEventListener('durationchange', onDur);
      a.removeEventListener('error', onErr);
      retry.dispose();
    };
  }, [token]);

  const fj: FinalJson = useMemo(() => {
    return isFinalJson(data?.finalJson) ? (data.finalJson as FinalJson) : {};
  }, [data]);
  const phase1: Phase1Data | undefined = useMemo(() => {
    const p = fj.phases?.find((x) => x.phase === 1);
    return p?.data as Phase1Data | undefined;
  }, [fj]);

  // Story 7.1 (AC2) — top 3 verdicts with evidence chips, present only when
  // the owner enabled show_verdicts. The payload is the server-projected
  // shape from ShareEndpoints (snake_case fields, user state pre-stripped).
  const topVerdicts = useMemo(() => {
    if (!Array.isArray(data?.verdicts)) return [];
    return (data.verdicts as ShareVerdict[]).slice(0, 3);
  }, [data]);

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

      {topVerdicts.length > 0 && (
        <section className={`card ${s.commentsCard}`}>
          <h2 className={s.sectionTitle}>Top signals</h2>
          <ul className={s.commentList}>
            {topVerdicts.map((v) => (
              <li key={v.id} className={s.commentRow}>
                <span className={`mono ${s.commentMeta}`}>
                  {(v.severity ?? 'note').toUpperCase()}
                  {v.metric_line ? ` · ${v.metric_line}` : ''}
                </span>
                <p className={s.commentBodyText}>
                  <strong>{v.headline ?? 'Verdict'}</strong>
                  {v.summary ? ` — ${v.summary}` : ''}
                </p>
                {Array.isArray(v.evidence) && v.evidence.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {v.evidence.slice(0, 4).map((e, i) => (
                      <Pill key={i}>
                        <span className="mono">
                          {e.label ?? e.metric ?? String(e.value ?? '')}
                        </span>
                      </Pill>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

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

      {/* Story 7.4 (FR24/UX-DR35) — the viral-loop CTA. Sticky on mobile with
          a ≥40px target. Attribution: the `via` param rides to signup and is
          stashed so the funnel survives navigation; full share→visit→analysis
          →signup event recording lands with Epic 6 instrumentation (6.5). */}
      <div className={s.ctaWrap}>
        <a
          className={s.cta}
          href={`/register?via=share_${token}`}
          onClick={() => {
            try {
              // Shared key with 6.5 readAttribution (drained on the claim event).
              localStorage.setItem(ATTRIBUTION_KEY, `share_${token}`);
            } catch {
              /* storage blocked — the URL param still carries it */
            }
          }}
        >
          Analyze your own track free →
        </a>
      </div>

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
